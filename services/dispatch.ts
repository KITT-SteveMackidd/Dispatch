import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  DocumentReference,
  documentId,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '@/lib/firebase';
import { buildEventTaskFromTemplate, buildNewEventRoleForFirestore, EventTaskTemplateInput, sanitizeEventRoleForFirestore } from '@/lib/firestore-event-data';
import { normalizeTeamMemberRole, validateTeamWorkerSelection } from '@/lib/team-membership';
import { buildWorkerInviteEmailDocument } from '@/lib/worker-invite-email';
import { canManagerManageEvent, hasConcurrentEventChange, mergeManagerEventScopes } from '@/lib/event-manager-access';
import { preserveTemplateTaskOrder } from '@/lib/template-task-order';
import { buildEventDetailsUpdate, type EventDetailsDraft } from '@/lib/event-schedule-edit';
import { clearWorkerTaskCompletions } from '@/services/event-logic';
import { buildLateTaskNotificationTargets } from '@/lib/task-notification-targets';
import { removeCustomChatParticipant } from '@/lib/custom-chat-membership';
import { clearWorkerEventRoleRemoval, removeEventRoleAndRebuildWorkers, removeWorkerFromEventRoleAndRebuildWorkers } from '@/lib/event-role-deletion';
import { getAvailableRoleSlots } from '@/lib/worker-role-action';
import { canonicalizeEmail, normalizeEmail } from '@/lib/email-identity';
import { DispatchEvent, EventRole, EventTaskAttachment, EventTemplate, EventTemplateRole, InviteTokenStatus, ManagerInvite, Organisation, Team, UserProfile, WorkerInvite, WorkerInviteStatus } from '@/types/dispatch';
export type { InviteToken, InviteTokenStatus, WorkerInvite, WorkerInviteStatus } from '@/types/dispatch';

export type ChatUnreadCount = {
  threadId?: string;
  teamId?: string;
  unreadCount: number;
};

export type ChatAttachment = {
  id: string;
  kind: 'image' | 'file' | 'audio';
  name: string;
  mimeType?: string;
  size?: number;
  url: string;
};

export type PersistedChatMessage = {
  id: string;
  senderId: string;
  senderName?: string;
  text: string;
  attachments?: ChatAttachment[];
  createdAt?: { toDate?: () => Date } | Date | null;
};

export type ChatThreadHead = {
  id: string;
  teamId?: string | null;
  organizationId?: string | null;
  title?: string | null;
  kind?: 'organization' | 'team' | 'manager' | 'direct' | 'custom';
  participants?: string[];
  pushSeenBy?: string[];
  lastMessageText?: string;
  lastMessageSenderId?: string;
  updatedAt?: { toDate?: () => Date } | Date | null;
};

export type RoleAssignmentNotification = {
  id: string;
  workerId: string;
  managerId: string;
  eventId: string;
  roleId: string;
  eventName?: string;
  eventLocation?: string;
  eventStartsAt?: string;
  roleName?: string;
  roleTaskNames?: string[];
  action: 'assign' | 'remove';
  status: 'pending' | 'accepted' | 'declined' | 'waitlisted';
  statusReason?: string;
  roleOpenSlots?: number;
  roleAssignedWorkerIds?: string[];
  roleWaitlistWorkerIds?: string[];
  roleEligibleWaitlistWorkerIds?: string[];
  roleWaitlistInviteWorkerIds?: string[];
  roleRemovedWorkerIds?: string[];
  pushSeenBy?: string[];
  createdAt?: { toDate?: () => Date } | Date | null;
};

export type UserNotification = {
  id: string;
  userId: string;
  kind: 'role_invite_response' | 'role_removed' | 'role_available' | 'task_behind_schedule' | 'worker_team_invite' | 'worker_role_cancelled' | 'manager_organisation_invite';
  title: string;
  body: string;
  relatedEventId?: string;
  relatedRoleId?: string;
  relatedTaskId?: string;
  read: boolean;
  pushSeenBy?: string[];
  createdAt?: { toDate?: () => Date } | Date | null;
};

export type CreateEventRoleInput = {
  id: string;
  name: string;
  assignedWorkerId?: string | null;
  tasks?: EventTaskTemplateInput[];
};

export type UpsertEventTemplateInput = {
  name: string;
  roles: EventTemplateRole[];
  defaultLocation?: string;
  defaultLocationPlaceId?: string;
  defaultTime?: string;
  defaultDescription?: string;
};

const ACTIVE_INVITE_STATUSES: WorkerInviteStatus[] = ['created', 'delivery_queued', 'delivered', 'delivery_failed', 'pending_acceptance'];
const INVITE_AUTO_EXPIRY_MS = 1000 * 60 * 60 * 24 * 7;

function toDateMs(value?: { toDate?: () => Date } | Date | null) {
  if (!value) return 0;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value.toDate === 'function') {
    const d = value.toDate();
    return Number.isFinite(d.getTime()) ? d.getTime() : 0;
  }
  return 0;
}

export function buildChatThreadId(params: {
  teamId?: string;
  selfId: string;
  otherUserId?: string;
  isTeamBroadcast?: boolean;
}) {
  const { teamId, selfId, otherUserId, isTeamBroadcast } = params;
  if (isTeamBroadcast && teamId) return `team:${teamId}:all`;

  const participants = [selfId, otherUserId].filter(Boolean).sort().join('__');
  if (!participants) throw new Error('Cannot build chat thread without participants');
  return teamId ? `team:${teamId}:dm:${participants}` : `dm:${participants}`;
}

export function buildOrganizationChatThreadId(organizationId: string) {
  return `organization:${organizationId}:all`;
}

export function buildOrganizationManagersThreadId(organizationId: string, workerId: string) {
  return `organization:${organizationId}:managers:${workerId}`;
}

export function watchChatMessages(
  threadId: string,
  cb: (items: PersistedChatMessage[]) => void,
  onError?: (error: Error) => void
) {
  const q = query(collection(db, 'chatThreads', threadId, 'messages'), orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const messages = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PersistedChatMessage, 'id'>) }));
      cb(messages);
    },
    (error) => {
      console.warn(`Unable to watch messages for chat thread ${threadId}.`, error);
      cb([]);
      onError?.(error);
    }
  );
}

export function watchChatThread(
  threadId: string,
  cb: (thread: ChatThreadHead | null) => void,
  onError?: (error: Error) => void
) {
  return onSnapshot(
    doc(db, 'chatThreads', threadId),
    (snap) => cb(snap.exists() ? { id: snap.id, ...(snap.data() as Omit<ChatThreadHead, 'id'>) } : null),
    (error) => {
      console.warn(`Unable to watch chat thread ${threadId}.`, error);
      onError?.(error);
    }
  );
}

export async function setChatThreadViewerPresence(params: {
  threadId: string;
  userId: string;
  active: boolean;
}) {
  const viewerRef = doc(db, 'chatThreads', params.threadId, 'activeViewers', params.userId);
  if (!params.active) {
    await deleteDoc(viewerRef);
    return;
  }

  await setDoc(viewerRef, {
    userId: params.userId,
    threadId: params.threadId,
    expiresAtMs: Date.now() + 90 * 1000,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export function watchIncomingChatThreadHeads(
  userId: string,
  cb: (items: ChatThreadHead[]) => void,
  onError?: (error: Error) => void
) {
  const withOrderQuery = query(collection(db, 'chatThreads'), where('participants', 'array-contains', userId), orderBy('updatedAt', 'desc'), limit(30));

  const subscribeWithoutOrder = () => {
    const fallbackQuery = query(collection(db, 'chatThreads'), where('participants', 'array-contains', userId), limit(100));
    return onSnapshot(
      fallbackQuery,
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<ChatThreadHead, 'id'>) }))
          .sort((a, b) => {
            const aMs = toDateMs(a.updatedAt);
            const bMs = toDateMs(b.updatedAt);
            return bMs - aMs;
          })
          .slice(0, 30);
        cb(items);
      },
      (error) => {
        console.warn('Unable to watch chat threads without ordering.', error);
        cb([]);
        onError?.(error);
      }
    );
  };

  let unsubscribe = () => {};

  unsubscribe = onSnapshot(
    withOrderQuery,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChatThreadHead, 'id'>) }));
      cb(items);
    },
    (error) => {
      if (error?.code === 'failed-precondition') {
        console.warn('Missing composite index for chatThreads watcher; using client-side sort fallback.', error);
        unsubscribe();
        unsubscribe = subscribeWithoutOrder();
        return;
      }
      console.warn('Unable to watch chat threads.', error);
      cb([]);
      onError?.(error);
    }
  );

  return () => unsubscribe();
}

export async function ensureChatThread(params: {
  threadId: string;
  organizationId: string;
  teamId?: string | null;
  title?: string | null;
  kind: NonNullable<ChatThreadHead['kind']>;
  creatorId: string;
  participantIds: string[];
}) {
  const participants = [...new Set([params.creatorId, ...params.participantIds].filter(Boolean))];
  if (participants.length < 2) throw new Error('A chat needs at least two participants.');

  const threadRef = doc(db, 'chatThreads', params.threadId);
  const existing = await getDoc(threadRef).catch(() => null);
  if (existing?.exists()) return;

  await setDoc(threadRef, {
    id: params.threadId,
    organizationId: params.organizationId,
    teamId: params.teamId || null,
    title: params.title?.trim() || 'Chat',
    kind: params.kind,
    participants,
    createdBy: params.creatorId,
    updatedAt: serverTimestamp(),
  });
}

export async function uploadChatAttachment(params: {
  senderId: string;
  threadId: string;
  uri: string;
  kind: 'image' | 'file' | 'audio';
  name: string;
  mimeType?: string;
}) {
  const response = await fetch(params.uri);
  const blob = await response.blob();
  const ext = params.name.includes('.') ? params.name.split('.').pop() : 'bin';
  const safeExt = (ext || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
  const objectPath = `chatAttachments/${params.threadId}/${params.senderId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const objectRef = ref(storage, objectPath);

  await uploadBytes(objectRef, blob, {
    contentType: params.mimeType || blob.type || 'application/octet-stream',
  });

  const url = await getDownloadURL(objectRef);
  return {
    id: objectPath,
    kind: params.kind,
    name: params.name,
    mimeType: params.mimeType || blob.type || undefined,
    size: blob.size,
    url,
  } satisfies ChatAttachment;
}

export async function uploadTemplateTaskAttachment(params: {
  managerId: string;
  taskId: string;
  uri: string;
  kind: 'photo' | 'document';
  name: string;
  mimeType?: string;
}) {
  const response = await fetch(params.uri);
  const blob = await response.blob();
  const ext = params.name.includes('.') ? params.name.split('.').pop() : params.kind === 'photo' ? 'jpg' : 'bin';
  const safeExt = (ext || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
  const objectPath = `dispatchTemplateAttachments/${params.managerId}/${params.taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const objectRef = ref(storage, objectPath);

  await uploadBytes(objectRef, blob, {
    contentType: params.mimeType || blob.type || 'application/octet-stream',
  });

  const url = await getDownloadURL(objectRef);
  return {
    id: objectPath,
    kind: params.kind,
    name: params.name,
    url,
  } satisfies EventTaskAttachment;
}

export async function sendChatMessage(params: {
  threadId: string;
  teamId?: string;
  senderId: string;
  senderName?: string;
  recipientIds: string[];
  text: string;
  attachments?: ChatAttachment[];
}) {
  const text = params.text.trim();
  const attachments = params.attachments || [];
  if (!text && !attachments.length) return;
  const recipientIds = [...new Set(params.recipientIds.filter((id) => id && id !== params.senderId))];

  await addDoc(collection(db, 'chatThreads', params.threadId, 'messages'), {
    threadId: params.threadId,
    teamId: params.teamId || null,
    senderId: params.senderId,
    senderName: params.senderName?.trim() || null,
    recipientIds,
    text,
    attachments,
    createdAt: serverTimestamp(),
  });

  await setDoc(
    doc(db, 'chatThreads', params.threadId),
    {
      id: params.threadId,
      teamId: params.teamId || null,
      participants: [...new Set([params.senderId, ...params.recipientIds].filter(Boolean))],
      pushSeenBy: [params.senderId],
      lastMessageText: text || (attachments.length ? `Sent ${attachments.length} attachment${attachments.length > 1 ? 's' : ''}` : ''),
      lastMessageSenderId: params.senderId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await Promise.all(
    recipientIds.map((userId) =>
      setDoc(
        doc(db, 'chatUnread', `${userId}__${params.threadId}`),
        {
          userId,
          threadId: params.threadId,
          teamId: params.teamId || null,
          unreadCount: increment(1),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    )
  );
}

export async function markChatThreadRead(params: { userId: string; threadId: string; teamId?: string }) {
  const writes = [
    setDoc(
      doc(db, 'chatUnread', `${params.userId}__${params.threadId}`),
      {
        userId: params.userId,
        threadId: params.threadId,
        teamId: params.teamId || null,
        unreadCount: 0,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ),
  ];

  if (params.teamId) {
    writes.push(setDoc(
      doc(db, 'chatUnread', `${params.userId}__${params.teamId}`),
      {
        userId: params.userId,
        teamId: params.teamId,
        unreadCount: 0,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ));
  }

  await Promise.all(writes);
}

function mapEvents(snap: { docs: Array<{ id: string; data: () => unknown }> }): DispatchEvent[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DispatchEvent, 'id'>) }));
}

function mapTeams(snap: { docs: Array<{ id: string; data: () => unknown }> }): Team[] {
  return snap.docs.map((d) => {
    const data = d.data() as Omit<Team, 'id'>;
    return {
      id: d.id,
      ...data,
      managerIds: [...new Set([data.managerId, ...(data.managerIds || [])].filter(Boolean))],
    };
  });
}

function removeWorkerFromOtherRoleWaitlists(role: EventRole, acceptedRoleId: string, workerId: string): EventRole {
  if (role.id === acceptedRoleId) return role;
  return {
    ...role,
    waitlistWorkerIds: (role.waitlistWorkerIds || []).filter((id) => id !== workerId),
    waitlistInviteWorkerIds: (role.waitlistInviteWorkerIds || []).filter((id) => id !== workerId),
    eligibleWaitlistWorkerIds: (role.eligibleWaitlistWorkerIds || []).filter((id) => id !== workerId),
  };
}

function parseEventDateTime(value?: string) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function sortDispatchEvents(items: DispatchEvent[]) {
  return [...items].sort((a, b) => {
    const aStartsAt = parseEventDateTime(a.startsAt);
    const bStartsAt = parseEventDateTime(b.startsAt);

    if (aStartsAt !== bStartsAt) return aStartsAt - bStartsAt;

    const aEndsAt = parseEventDateTime(a.endsAt ?? a.startsAt);
    const bEndsAt = parseEventDateTime(b.endsAt ?? b.startsAt);

    if (aEndsAt !== bEndsAt) return aEndsAt - bEndsAt;

    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;

    return a.id.localeCompare(b.id);
  });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getFutureDate(msFromNow: number) {
  return new Date(Date.now() + msFromNow);
}

function generateInviteToken() {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function getInviteTokenPreview(token: string) {
  return token.slice(0, 8);
}

function isInviteExpired(invite: Pick<WorkerInvite, 'expiresAt' | 'status'>) {
  if (invite.status === 'expired') return true;
  const expiresAtMs = toDateMs(invite.expiresAt);
  return !!expiresAtMs && expiresAtMs <= Date.now();
}

function shouldTreatInviteAsActive(invite: WorkerInvite) {
  return ACTIVE_INVITE_STATUSES.includes(invite.status) && !isInviteExpired(invite);
}

async function expireInviteIfNeeded(inviteRef: ReturnType<typeof doc>, invite: WorkerInvite) {
  if (!shouldTreatInviteAsActive(invite) && invite.status !== 'expired' && isInviteExpired(invite)) {
    await updateDoc(inviteRef, {
      status: 'expired',
      statusReason: 'Invite expired before worker accepted it.',
      expiredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await syncInviteTokenState({ inviteId: inviteRef.id, status: 'expired' });
    return true;
  }
  return false;
}

async function loadActiveInvite(params: { managerId: string; teamId?: string; email: string }) {
  const canonicalEmail = canonicalizeEmail(params.email);
  const invitesSnap = await getDocs(query(collection(db, 'workerInvites'), where('managerId', '==', params.managerId)));
  const matches = invitesSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<WorkerInvite, 'id'>) }))
    .filter((invite) => (
      (invite.teamId || null) === (params.teamId || null)
      && canonicalizeEmail(invite.normalizedEmail || invite.email || invite.canonicalEmail) === canonicalEmail
    ));

  for (const invite of matches) {
    const inviteRef = doc(db, 'workerInvites', invite.id);
    await expireInviteIfNeeded(inviteRef, invite);
  }

  return matches.find((invite) => shouldTreatInviteAsActive(invite)) || null;
}

function getInviteAppLink() {
  return process.env.EXPO_PUBLIC_DISPATCH_APP_LINK?.trim() || 'https://dispatchcrewmanager.com';
}

async function loadOrganisationManagerIds(organizationId?: string | null) {
  if (!organizationId) return [];
  const organisationSnap = await getDoc(doc(db, 'organizations', organizationId)).catch(() => null);
  if (!organisationSnap?.exists()) return [];
  const organisation = organisationSnap.data() as Partial<Organisation>;
  return organisation.managerIds || [];
}

async function ensureOrganisationManagersOnTeam(
  teamRef: DocumentReference,
  team: Omit<Team, 'id'>,
  activeManagerId?: string
) {
  const organisationManagerIds = await loadOrganisationManagerIds(team.organizationId);
  const managerIds = [
    ...new Set([
      team.managerId,
      ...(team.managerIds || []),
      activeManagerId,
      ...organisationManagerIds,
    ].filter(Boolean)),
  ] as string[];

  const existingManagerIds = team.managerIds || [];
  const hasAllManagers = managerIds.every((managerId) => existingManagerIds.includes(managerId));
  if (!hasAllManagers) {
    await updateDoc(teamRef, {
      managerIds,
      updatedAt: serverTimestamp(),
    });
  }

  return managerIds;
}

async function ensureTeamChatThreads(params: {
  teamId: string;
  teamName?: string;
  managerIds: string[];
  workerIds: string[];
  organizationId?: string | null;
}) {
  const managerIds = [...new Set([...(params.managerIds || []), ...(await loadOrganisationManagerIds(params.organizationId))].filter(Boolean))];
  const workerIds = [...new Set((params.workerIds || []).filter(Boolean))];
  const participantIds = [...new Set([...managerIds, ...workerIds])];
  if (!participantIds.length) return;

  await setDoc(
    doc(db, 'chatThreads', buildChatThreadId({ teamId: params.teamId, selfId: managerIds[0] || participantIds[0], isTeamBroadcast: true })),
    {
      id: buildChatThreadId({ teamId: params.teamId, selfId: managerIds[0] || participantIds[0], isTeamBroadcast: true }),
      teamId: params.teamId,
      organizationId: params.organizationId || null,
      teamName: params.teamName || null,
      title: params.teamName || 'Team',
      kind: 'team',
      participants: participantIds,
      createdByTeamSync: true,
    },
    { merge: true }
  );

}

async function syncOrganisationTeamsForManager(params: { organizationId: string; managerId: string }) {
  const teamsSnap = await getDocs(query(collection(db, 'teams'), where('organizationId', '==', params.organizationId))).catch(() => null);
  await Promise.all((teamsSnap?.docs || []).map(async (teamDoc) => {
    const team = { id: teamDoc.id, ...(teamDoc.data() as Omit<Team, 'id'>) };
    const managerIds = [...new Set([team.managerId, ...(team.managerIds || []), params.managerId].filter(Boolean))];
    await updateDoc(teamDoc.ref, {
      managerIds,
      updatedAt: serverTimestamp(),
    });
    await ensureTeamChatThreads({
      teamId: team.id,
      teamName: team.name,
      managerIds,
      workerIds: team.workerIds || [],
      organizationId: team.organizationId || params.organizationId,
    });
  }));
}

export async function ensureTeamCommunicationThreads(team: Team) {
  await ensureTeamChatThreads({
    teamId: team.id,
    teamName: team.name,
    managerIds: team.managerIds || [team.managerId],
    workerIds: team.workerIds || [],
    organizationId: team.organizationId || null,
  });
}

export function watchManagerEvents(
  managerId: string,
  cb: (items: DispatchEvent[]) => void,
  organizationId?: string | null
) {
  if (!organizationId) {
    const ownEventsQuery = query(collection(db, 'events'), where('managerId', '==', managerId));
    return onSnapshot(ownEventsQuery, (snap) => cb(sortDispatchEvents(mapEvents(snap))));
  }

  let organizationEvents: DispatchEvent[] = [];
  let legacyOwnEvents: DispatchEvent[] = [];
  const emit = () => cb(sortDispatchEvents(mergeManagerEventScopes(organizationEvents, legacyOwnEvents)));
  const unsubscribeOrganization = onSnapshot(
    query(collection(db, 'events'), where('organizationId', '==', organizationId)),
    (snap) => {
      organizationEvents = mapEvents(snap);
      emit();
    }
  );
  const unsubscribeOwn = onSnapshot(
    query(collection(db, 'events'), where('managerId', '==', managerId)),
    (snap) => {
      legacyOwnEvents = mapEvents(snap);
      emit();
    }
  );

  return () => {
    unsubscribeOrganization();
    unsubscribeOwn();
  };
}

export async function updateTeamWorkerMembership(params: {
  managerId: string;
  teamId: string;
  workerIds: string[];
}) {
  const teamRef = doc(db, 'teams', params.teamId);
  const [teamSnapshot, managerSnapshot] = await Promise.all([
    getDoc(teamRef),
    getDoc(doc(db, 'users', params.managerId)),
  ]);
  if (!teamSnapshot.exists()) throw new Error('Team not found.');
  if (!managerSnapshot.exists()) throw new Error('Manager profile not found.');

  const team = { id: teamSnapshot.id, ...(teamSnapshot.data() as Omit<Team, 'id'>) };
  const manager = managerSnapshot.data() as Partial<UserProfile>;
  const organizationId = team.organizationId;
  const canManageTeam = normalizeTeamMemberRole(manager.role) === 'manager'
    && !!organizationId
    && manager.organizationId === organizationId;
  if (!canManageTeam) throw new Error('Only an organization manager can update this Team.');

  const { organization, members } = await loadOrganizationMembers(organizationId);
  const workerIds = validateTeamWorkerSelection(members, params.workerIds);
  const managerIds = [...new Set([
    team.managerId,
    ...(team.managerIds || []),
    ...organization.managerIds,
    params.managerId,
  ].filter(Boolean))];

  await updateDoc(teamRef, {
    managerIds,
    workerIds,
    updatedAt: serverTimestamp(),
  });
  await ensureTeamChatThreads({
    teamId: team.id,
    teamName: team.name,
    managerIds,
    workerIds,
    organizationId,
  });

  return { ...team, managerIds, workerIds } satisfies Team;
}

export async function markChatNotificationSeen(params: { threadId: string; userId: string }) {
  await updateDoc(doc(db, 'chatThreads', params.threadId), {
    pushSeenBy: arrayUnion(params.userId),
  });
}

export async function markRoleAssignmentNotificationPushSeen(params: { notificationId: string; userId: string }) {
  await updateDoc(doc(db, 'roleAssignmentNotifications', params.notificationId), {
    pushSeenBy: arrayUnion(params.userId),
  });
}

export async function markUserNotificationPushSeen(params: { notificationId: string; userId: string }) {
  await updateDoc(doc(db, 'userNotifications', params.notificationId), {
    pushSeenBy: arrayUnion(params.userId),
  });
}

export async function markEventReminderScheduled(params: { userId: string; reminderKey: string }) {
  await updateDoc(doc(db, 'users', params.userId), {
    scheduledEventReminderKeys: arrayUnion(params.reminderKey),
    updatedAt: serverTimestamp(),
  });
}

export async function createChatGroup(params: {
  threadId: string;
  organizationId: string;
  title: string;
  creatorId: string;
  participantIds: string[];
}) {
  const participants = [...new Set([params.creatorId, ...params.participantIds].filter(Boolean))];
  if (participants.length < 2) throw new Error('Select at least one person to start a chat.');

  await setDoc(
    doc(db, 'chatThreads', params.threadId),
    {
      id: params.threadId,
      organizationId: params.organizationId,
      title: params.title.trim() || 'Group chat',
      kind: 'custom',
      participants,
      createdBy: params.creatorId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function addChatParticipants(params: { threadId: string; participantIds: string[] }) {
  const participantIds = [...new Set(params.participantIds.filter(Boolean))];
  if (!participantIds.length) return;

  await setDoc(
    doc(db, 'chatThreads', params.threadId),
    { participants: arrayUnion(...participantIds) },
    { merge: true }
  );
}

export async function renameCustomChat(params: { threadId: string; userId: string; title: string }) {
  const title = params.title.trim();
  if (!title) throw new Error('Enter a chat name.');

  const threadRef = doc(db, 'chatThreads', params.threadId);
  const threadSnapshot = await getDoc(threadRef);
  if (!threadSnapshot.exists()) throw new Error('Chat not found.');
  const thread = threadSnapshot.data() as Partial<ChatThreadHead>;
  if (thread.kind !== 'custom') throw new Error('Only custom chats can be renamed.');
  if (!(thread.participants || []).includes(params.userId)) throw new Error('You are not a member of this chat.');

  await updateDoc(threadRef, { title });
}

export async function leaveCustomChat(params: { threadId: string; userId: string }) {
  const threadRef = doc(db, 'chatThreads', params.threadId);
  await runTransaction(db, async (transaction) => {
    const threadSnapshot = await transaction.get(threadRef);
    if (!threadSnapshot.exists()) throw new Error('Chat not found.');
    const thread = threadSnapshot.data() as Partial<ChatThreadHead>;
    if (thread.kind !== 'custom') throw new Error('Only custom chats can be left.');

    const participants = thread.participants || [];
    if (!participants.includes(params.userId)) return;
    transaction.update(threadRef, {
      participants: removeCustomChatParticipant(participants, params.userId),
      updatedAt: serverTimestamp(),
    });
  });
  await deleteDoc(doc(db, 'chatUnread', `${params.userId}__${params.threadId}`)).catch(() => undefined);
}

export async function loadRoleAssignmentExport(params: {
  managerId: string;
  organizationId?: string | null;
  startDate: Date;
  endDate: Date;
}) {
  const eventsQuery = params.organizationId
    ? query(collection(db, 'events'), where('organizationId', '==', params.organizationId))
    : query(collection(db, 'events'), where('managerId', '==', params.managerId));
  const eventsSnapshot = await getDocs(eventsQuery);
  const startTime = startOfLocalDay(params.startDate).getTime();
  const endTime = endOfLocalDay(params.endDate).getTime();
  const events = sortDispatchEvents(mapEvents(eventsSnapshot)).filter((event) => {
    const startsAt = new Date(event.startsAt).getTime();
    return Number.isFinite(startsAt) && startsAt >= startTime && startsAt <= endTime;
  });
  const workerIds = events.flatMap((event) =>
    event.roles.flatMap((role) => role.assignedWorkerIds || [])
  );
  const workers = await loadUserProfilesByIds(workerIds);

  return { events, workers };
}

function startOfLocalDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfLocalDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function watchWorkerEvents(workerId: string, cb: (items: DispatchEvent[]) => void) {
  const q = query(collection(db, 'events'), where('workerIds', 'array-contains', workerId));
  return onSnapshot(q, (snap) => cb(sortDispatchEvents(mapEvents(snap))));
}

export function watchManagerTeams(
  managerId: string,
  cb: (items: Team[]) => void,
  organizationId?: string | null,
  onError?: (error: Error) => void
) {
  const q = organizationId
    ? query(collection(db, 'teams'), where('organizationId', '==', organizationId))
    : query(collection(db, 'teams'), where('managerId', '==', managerId));
  return onSnapshot(
    q,
    async (snap) => {
      try {
        const teams = mapTeams(snap);
        if (!organizationId) {
          cb(teams);
          return;
        }

        const organisationManagerIds = await loadOrganisationManagerIds(organizationId);
        cb(teams.map((team) => ({
          ...team,
          managerIds: [...new Set([...(team.managerIds || []), ...organisationManagerIds].filter(Boolean))],
        })));
      } catch (error) {
        console.warn('Unable to prepare manager teams.', error);
        cb([]);
        onError?.(error instanceof Error ? error : new Error('Unable to prepare manager teams.'));
      }
    },
    (error) => {
      console.warn('Unable to watch manager teams.', error);
      cb([]);
      onError?.(error);
    }
  );
}

function mapEventTemplates(snap: { docs: Array<{ id: string; data: () => unknown }> }): EventTemplate[] {
  return snap.docs.map((d) => {
    const template = { id: d.id, ...(d.data() as Omit<EventTemplate, 'id'>) };
    return {
      ...template,
      roles: (template.roles || []).map((role) => ({ ...role, tasks: preserveTemplateTaskOrder(role.tasks || []) })),
    };
  });
}

function toTemplateUpdateTime(value: EventTemplate['updatedAt']) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if ('toDate' in value && typeof value.toDate === 'function') return value.toDate().getTime();
  return 0;
}

export async function ensureDefaultEventTemplates(managerId: string) {
  const existing = await getDocs(query(collection(db, 'eventTemplates'), where('managerId', '==', managerId), limit(1)));
  if (!existing.empty) return;

  await addDoc(collection(db, 'eventTemplates'), {
    managerId,
    name: 'General Event Template',
    roles: [
      {
        id: 'lead',
        name: 'Team Lead',
        tasks: [
          { id: 'briefing', name: 'Run pre-shift briefing', expectedOffsetMinutes: 15 },
          { id: 'checkpoint', name: 'Send first-hour checkpoint', expectedOffsetMinutes: 60 },
        ],
      },
    ],
    defaultTime: '10:00',
    defaultLocation: 'TBD',
    defaultDescription: 'Default event template. Customize roles and tasks as needed.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function watchManagerEventTemplates(managerId: string, cb: (items: EventTemplate[]) => void) {
  const q = query(collection(db, 'eventTemplates'), where('managerId', '==', managerId));
  return onSnapshot(q, (snap) => {
    const items = mapEventTemplates(snap).sort((a, b) => toTemplateUpdateTime(b.updatedAt) - toTemplateUpdateTime(a.updatedAt));
    cb(items);
  });
}

export async function createEventTemplate(managerId: string, input: UpsertEventTemplateInput) {
  const ref = await addDoc(collection(db, 'eventTemplates'), {
    managerId,
    name: input.name,
    roles: input.roles,
    defaultLocation: input.defaultLocation || null,
    defaultLocationPlaceId: input.defaultLocationPlaceId || null,
    defaultTime: input.defaultTime || null,
    defaultDescription: input.defaultDescription || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}

export async function updateEventTemplate(params: { managerId: string; templateId: string; input: UpsertEventTemplateInput }) {
  const ref = doc(db, 'eventTemplates', params.templateId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Template not found');

  const template = snap.data() as Partial<EventTemplate>;
  if (template.managerId !== params.managerId) throw new Error('You can only edit your own templates');

  await updateDoc(ref, {
    name: params.input.name,
    roles: params.input.roles,
    defaultLocation: params.input.defaultLocation || null,
    defaultLocationPlaceId: params.input.defaultLocationPlaceId || null,
    defaultTime: params.input.defaultTime || null,
    defaultDescription: params.input.defaultDescription || null,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteEventTemplate(params: { managerId: string; templateId: string }) {
  const ref = doc(db, 'eventTemplates', params.templateId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const template = snap.data() as Partial<EventTemplate>;
  if (template.managerId !== params.managerId) throw new Error('You can only delete your own templates');

  await deleteDoc(ref);
}

export function watchWorkerRoleAssignmentNotifications(workerId: string, cb: (items: RoleAssignmentNotification[]) => void) {
  const q = query(collection(db, 'roleAssignmentNotifications'), where('workerId', '==', workerId));
  let notifications: RoleAssignmentNotification[] = [];
  const eventStates = new Map<string, Omit<DispatchEvent, 'id'> | null>();
  const unavailableEventIds = new Set<string>();
  const eventUnsubscribers = new Map<string, () => void>();
  let disposed = false;

  const emit = () => {
    if (disposed) return;

    const requiredEventIds = [...new Set(
      notifications
        .filter((notification) => notification.eventId && notification.roleId)
        .map((notification) => notification.eventId)
    )];
    if (requiredEventIds.some((eventId) => !eventStates.has(eventId) && !unavailableEventIds.has(eventId))) {
      return;
    }

    const items = notifications.map((notification) => {
      if (!notification.eventId || !notification.roleId || unavailableEventIds.has(notification.eventId)) {
        return notification;
      }

      const event = eventStates.get(notification.eventId);
      if (!event) return null;

      const role = (event.roles || []).find((item) => item.id === notification.roleId);
      if (!role) return null;

      return {
        ...notification,
        roleOpenSlots: Math.max(0, role.openSlots || 0),
        roleAssignedWorkerIds: role.assignedWorkerIds || [],
        roleWaitlistWorkerIds: role.waitlistWorkerIds || [],
        roleEligibleWaitlistWorkerIds: role.eligibleWaitlistWorkerIds || [],
        roleWaitlistInviteWorkerIds: role.waitlistInviteWorkerIds || [],
        roleRemovedWorkerIds: role.removedWorkerIds || [],
      };
    });

    cb(items.filter((item): item is RoleAssignmentNotification => !!item));
  };

  const syncEventSubscriptions = () => {
    const eventIds = new Set(
      notifications
        .filter((notification) => notification.eventId && notification.roleId)
        .map((notification) => notification.eventId)
    );

    eventUnsubscribers.forEach((unsubscribe, eventId) => {
      if (eventIds.has(eventId)) return;
      unsubscribe();
      eventUnsubscribers.delete(eventId);
      eventStates.delete(eventId);
      unavailableEventIds.delete(eventId);
    });

    eventIds.forEach((eventId) => {
      if (eventUnsubscribers.has(eventId)) return;

      const unsubscribe = onSnapshot(
        doc(db, 'events', eventId),
        (eventSnap) => {
          if (disposed || !eventUnsubscribers.has(eventId)) return;
          unavailableEventIds.delete(eventId);
          eventStates.set(eventId, eventSnap.exists() ? eventSnap.data() as Omit<DispatchEvent, 'id'> : null);
          emit();
        },
        () => {
          if (disposed || !eventUnsubscribers.has(eventId)) return;
          unavailableEventIds.add(eventId);
          emit();
        }
      );
      eventUnsubscribers.set(eventId, unsubscribe);
    });

    emit();
  };

  const unsubscribeNotifications = onSnapshot(q, (snap) => {
    notifications = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<RoleAssignmentNotification, 'id'>) }))
      .filter((item) => item.status === 'pending' || item.status === 'declined' || item.status === 'waitlisted')
      .sort((a, b) => {
        const aTime = a.createdAt && 'toDate' in a.createdAt && typeof a.createdAt.toDate === 'function'
          ? a.createdAt.toDate().getTime()
          : 0;
        const bTime = b.createdAt && 'toDate' in b.createdAt && typeof b.createdAt.toDate === 'function'
          ? b.createdAt.toDate().getTime()
          : 0;
        return bTime - aTime;
      });
    syncEventSubscriptions();
  });

  return () => {
    disposed = true;
    unsubscribeNotifications();
    eventUnsubscribers.forEach((unsubscribe) => unsubscribe());
    eventUnsubscribers.clear();
  };
}

export function watchManagerPendingRoleInvites(managerId: string, cb: (items: RoleAssignmentNotification[]) => void) {
  const q = query(collection(db, 'roleAssignmentNotifications'), where('managerId', '==', managerId));
  return onSnapshot(q, (snap) => {
    const invites = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<RoleAssignmentNotification, 'id'>) }))
      .filter((item) => item.action === 'assign' && (item.status === 'pending' || item.status === 'waitlisted'));

    cb(invites);
  });
}

export function watchManagerRoleInvites(managerId: string, cb: (items: RoleAssignmentNotification[]) => void) {
  const q = query(collection(db, 'roleAssignmentNotifications'), where('managerId', '==', managerId));
  return onSnapshot(q, (snap) => {
    const invites = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<RoleAssignmentNotification, 'id'>) }))
      .filter((item) => item.action === 'assign');

    cb(invites);
  });
}

export async function createDispatchEvent(params: {
  managerId: string;
  name: string;
  date: string;
  time: string;
  location: string;
  locationPlaceId: string;
  description: string;
  roles: CreateEventRoleInput[];
}): Promise<DispatchEvent> {
  const startsAt = new Date(`${params.date.trim()}T${params.time.trim()}:00`);
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error('Enter a valid event date and time.');
  }
  if (!params.locationPlaceId.trim()) {
    throw new Error('Choose an event location from the Google Places suggestions.');
  }

  const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
  const roles = params.roles.map((role) => {
    const assignedWorkerIds = role.assignedWorkerId ? [role.assignedWorkerId] : [];
    return {
      id: role.id,
      name: role.name,
      assignedWorkerIds,
      openSlots: assignedWorkerIds.length ? 0 : 1,
      tasks: (role.tasks || []).map((task, index) => buildEventTaskFromTemplate(task, startsAt.getTime(), index)),
    } satisfies EventRole;
  });

  const workerIds = [...new Set(roles.flatMap((role) => role.assignedWorkerIds || []))];
  const managerSnap = await getDoc(doc(db, 'users', params.managerId));
  const manager = managerSnap.exists() ? managerSnap.data() as Partial<UserProfile> : {};

  const eventPayload = {
    managerId: params.managerId,
    organizationId: manager.organizationId || null,
    revision: 0,
    workerIds,
    name: params.name.trim(),
    location: params.location.trim(),
    locationPlaceId: params.locationPlaceId.trim(),
    description: params.description.trim(),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    teamIds: [],
    roles,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(collection(db, 'events'), eventPayload);
  await Promise.all(
    roles.flatMap((role) =>
      (role.assignedWorkerIds || []).map((workerId) =>
        queueEventRoleReminderEmail({ eventId: docRef.id, roleId: role.id, workerId }).catch((error) => {
          console.warn('Dispatch event reminder email queue failed', error);
        })
      )
    )
  );

  return {
    id: docRef.id,
    managerId: eventPayload.managerId,
    organizationId: eventPayload.organizationId,
    name: eventPayload.name,
    location: eventPayload.location,
    locationPlaceId: eventPayload.locationPlaceId,
    startsAt: eventPayload.startsAt,
    endsAt: eventPayload.endsAt,
    teamIds: eventPayload.teamIds,
    roles: eventPayload.roles,
  };
}

export async function updateDispatchEventDetails(params: {
  eventId: string;
  managerId: string;
  draft: EventDetailsDraft;
  expectedRevision?: number;
}) {
  await runTransaction(db, async (tx) => {
    const eventRef = doc(db, 'events', params.eventId);
    const managerRef = doc(db, 'users', params.managerId);
    const [eventSnap, managerSnap] = await Promise.all([tx.get(eventRef), tx.get(managerRef)]);
    if (!eventSnap.exists()) throw new Error('Event not found');

    const event = { id: eventSnap.id, ...(eventSnap.data() as Omit<DispatchEvent, 'id'>) };
    const manager = managerSnap.exists() ? managerSnap.data() as Partial<UserProfile> : {};
    if (!canManagerManageEvent({
      eventManagerId: event.managerId,
      eventOrganizationId: event.organizationId,
      managerId: params.managerId,
      managerOrganizationId: manager.organizationId,
      managerRole: manager.role,
    })) throw new Error('Only a Manager in this event organization can edit it');
    if (hasConcurrentEventChange(event.revision, params.expectedRevision)) {
      throw new Error('This event changed on another device. Review the latest version, then try your edit again.');
    }

    const update = buildEventDetailsUpdate(event, params.draft);
    tx.update(eventRef, {
      ...update,
      revision: (event.revision ?? 0) + 1,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function deleteDispatchEvent(params: { eventId: string; managerId: string }) {
  const ref = doc(db, 'events', params.eventId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const event = snap.data() as Omit<DispatchEvent, 'id'>;
  const managerSnap = await getDoc(doc(db, 'users', params.managerId));
  const manager = managerSnap.exists() ? managerSnap.data() as Partial<UserProfile> : {};
  if (!canManagerManageEvent({
    eventManagerId: event.managerId,
    eventOrganizationId: event.organizationId,
    managerId: params.managerId,
    managerOrganizationId: manager.organizationId,
    managerRole: manager.role,
  })) throw new Error('Only a Manager in this event organization can delete it');

  const [roleNotificationsSnap, userNotificationsSnap] = await Promise.all([
    getDocs(query(collection(db, 'roleAssignmentNotifications'), where('eventId', '==', params.eventId))),
    getDocs(query(collection(db, 'userNotifications'), where('relatedEventId', '==', params.eventId))),
  ]);
  const relatedRefs = [...new Map(
    [...roleNotificationsSnap.docs, ...userNotificationsSnap.docs].map((item) => [item.ref.path, item.ref])
  ).values()];

  // Keep the event available while every related-record permission is checked.
  while (relatedRefs.length) {
    const cleanupBatch = writeBatch(db);
    relatedRefs.splice(0, 500).forEach((relatedRef) => cleanupBatch.delete(relatedRef));
    await cleanupBatch.commit();
  }

  await deleteDoc(ref);
}

export async function loadWorkerTeams(workerId: string, organizationId?: string | null): Promise<Team[]> {
  const q = organizationId
    ? query(collection(db, 'teams'), where('organizationId', '==', organizationId))
    : query(collection(db, 'teams'), where('workerIds', 'array-contains', workerId));
  const snap = await getDocs(q);
  const teams = mapTeams(snap).filter((team) => (team.workerIds || []).includes(workerId));
  if (!organizationId) return teams;

  const organizationManagerIds = await loadOrganisationManagerIds(organizationId);
  return teams.map((team) => ({
    ...team,
    managerIds: [...new Set([...(team.managerIds || [team.managerId]), ...organizationManagerIds])],
  }));
}

export function watchWorkerTeams(
  workerId: string,
  cb: (items: Team[]) => void,
  onError?: (error: Error) => void,
  organizationId?: string | null
) {
  const q = organizationId
    ? query(collection(db, 'teams'), where('organizationId', '==', organizationId))
    : query(collection(db, 'teams'), where('workerIds', 'array-contains', workerId));
  return onSnapshot(q, (snap) => cb(mapTeams(snap)), (error) => {
    console.warn('Unable to watch worker teams.', error);
    cb([]);
    onError?.(error);
  });
}

export function watchUserTeamUnreadCounts(
  userId: string,
  cb: (items: ChatUnreadCount[]) => void,
  onError?: (error: Error) => void
) {
  const q = query(collection(db, 'chatUnread'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d): ChatUnreadCount | null => {
          const data = d.data() as Partial<{ threadId: string; teamId: string; unreadCount: number }>;
          if (!data.threadId && !data.teamId) return null;
          return {
            threadId: data.threadId,
            teamId: data.teamId,
            unreadCount: Math.max(0, Number(data.unreadCount ?? 0)),
          } satisfies ChatUnreadCount;
        })
        .filter((item): item is ChatUnreadCount => !!item);

      cb(items);
    },
    (error) => {
      console.warn('Unable to watch team unread counts.', error);
      cb([]);
      onError?.(error);
    }
  );
}

export function watchUserUnreadNotificationCount(
  userId: string,
  cb: (count: number) => void,
  onError?: (error: Error) => void
) {
  const q = query(collection(db, 'userNotifications'), where('userId', '==', userId), where('read', '==', false));
  return onSnapshot(q, (snap) => cb(snap.docs.length), (error) => {
    console.warn('Unable to watch unread notifications.', error);
    cb(0);
    onError?.(error);
  });
}

export function watchManagerWorkerInvites(managerId: string, cb: (items: WorkerInvite[]) => void) {
  const q = query(collection(db, 'workerInvites'), where('managerId', '==', managerId));
  return onSnapshot(q, (snap) => {
    const items = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<WorkerInvite, 'id'>) }))
      .filter((invite) => !invite.managerClearedAt)
      .sort((a, b) => {
        const aTime = a.createdAt && 'toDate' in a.createdAt && typeof a.createdAt.toDate === 'function' ? a.createdAt.toDate().getTime() : 0;
        const bTime = b.createdAt && 'toDate' in b.createdAt && typeof b.createdAt.toDate === 'function' ? b.createdAt.toDate().getTime() : 0;
        return bTime - aTime;
      });

    cb(items);
  });
}

export async function saveUserPushToken(params: {
  userId: string;
  token: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
  permissionStatus: 'granted' | 'denied' | 'undetermined';
}) {
  await setDoc(
    doc(db, 'users', params.userId),
    {
      pushTokens: arrayUnion(params.token),
      pushPermissionStatus: params.permissionStatus,
      pushTokenUpdatedAt: serverTimestamp(),
      pushPlatform: params.platform,
    },
    { merge: true }
  );
}

export async function removeUserPushToken(params: { userId: string; token: string }) {
  await setDoc(
    doc(db, 'users', params.userId),
    {
      pushTokens: arrayRemove(params.token),
      pushTokenUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function watchUserNotifications(userId: string, cb: (items: UserNotification[]) => void) {
  const withOrderQuery = query(collection(db, 'userNotifications'), where('userId', '==', userId), orderBy('createdAt', 'desc'));

  const subscribeWithoutOrder = () => {
    const fallbackQuery = query(collection(db, 'userNotifications'), where('userId', '==', userId), limit(100));
    return onSnapshot(
      fallbackQuery,
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<UserNotification, 'id'>) }))
          .sort((a, b) => toDateMs(b.createdAt) - toDateMs(a.createdAt));
        cb(items);
      },
      (error) => {
        console.warn('Unable to watch notifications without ordering.', error);
        cb([]);
      }
    );
  };

  let unsubscribe = () => {};

  unsubscribe = onSnapshot(
    withOrderQuery,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UserNotification, 'id'>) }));
      cb(items);
    },
    (error) => {
      if (error?.code === 'failed-precondition') {
        console.warn('Missing composite index for userNotifications watcher; using client-side sort fallback.', error);
        unsubscribe();
        unsubscribe = subscribeWithoutOrder();
        return;
      }
      console.warn('Unable to watch notifications.', error);
      cb([]);
    }
  );

  return () => unsubscribe();
}

export async function markUserNotificationsRead(params: { userId: string; notificationIds: string[] }) {
  const ids = [...new Set(params.notificationIds.filter(Boolean))];
  if (!ids.length) return;

  const batch = writeBatch(db);
  ids.forEach((id) => {
    batch.set(
      doc(db, 'userNotifications', id),
      {
        userId: params.userId,
        read: true,
        readAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  await batch.commit();
}

export async function ensureTaskBehindScheduleNotification(params: {
  managerId: string;
  organizationId?: string | null;
  eventId: string;
  eventName: string;
  roleId: string;
  roleName: string;
  taskId: string;
  taskName: string;
  dueAt: string;
}) {
  const organizationManagerIds = params.organizationId
    ? await loadOrganisationManagerIds(params.organizationId)
    : [];
  const targets = buildLateTaskNotificationTargets({
    eventManagerId: params.managerId,
    organizationManagerIds,
    eventId: params.eventId,
    roleId: params.roleId,
    taskId: params.taskId,
  });

  return runTransaction(db, async (tx) => {
    const refs = targets.map((target) => doc(db, 'userNotifications', target.notificationId));
    const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
    const createdManagerIds: string[] = [];

    targets.forEach((target, index) => {
      if (snapshots[index].exists()) return;
      createdManagerIds.push(target.managerId);
      tx.set(refs[index], {
        userId: target.managerId,
        kind: 'task_behind_schedule',
        title: 'Task behind schedule',
        body: `${params.eventName}: ${params.roleName} is behind on "${params.taskName}".`,
        relatedEventId: params.eventId,
        relatedRoleId: params.roleId,
        relatedTaskId: params.taskId,
        dueAt: params.dueAt,
        read: false,
        createdAt: serverTimestamp(),
        statusReason: `Task due at ${params.dueAt} passed before completion.`,
      });
    });

    return createdManagerIds;
  });
}

export async function createOrganisationForManager(params: { managerId: string; name: string }): Promise<Organisation> {
  const name = params.name.trim();
  if (!name) throw new Error('Organisation name is required');

  const managerRef = doc(db, 'users', params.managerId);
  await setDoc(
    managerRef,
    {
      role: 'manager',
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  const organisationRef = doc(collection(db, 'organizations'));
  const organisation: Omit<Organisation, 'id'> = {
    name,
    managerIds: [params.managerId],
    workerIds: [],
    createdBy: params.managerId,
  };

  await runTransaction(db, async (tx) => {
    tx.set(organisationRef, {
      ...organisation,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.set(
      managerRef,
      {
        role: 'manager',
        organizationId: organisationRef.id,
        organizationName: name,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { id: organisationRef.id, ...organisation };
}

export async function createTeam(managerId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Team name is required');

  const managerSnap = await getDoc(doc(db, 'users', managerId));
  const manager = managerSnap.exists() ? managerSnap.data() as Partial<UserProfile> : {};
  const organizationId = manager.organizationId || null;
  const managerIds = [
    ...new Set([
      managerId,
      ...(await loadOrganisationManagerIds(organizationId)),
    ].filter(Boolean)),
  ] as string[];

  const teamRef = await addDoc(collection(db, 'teams'), {
    managerId,
    managerIds,
    organizationId,
    organizationName: manager.organizationName || null,
    name: trimmed,
    workerIds: [],
  });

  await ensureTeamChatThreads({
    teamId: teamRef.id,
    teamName: trimmed,
    managerIds,
    workerIds: [],
    organizationId,
  });
}

async function createInviteTokenRecord(params: {
  inviteId: string;
  managerId: string;
  teamId?: string;
  email: string;
  token: string;
  expiresAt: Date;
}) {
  const inviteTokenRef = doc(db, 'inviteTokens', params.inviteId);
  await setDoc(inviteTokenRef, {
    inviteId: params.inviteId,
    managerId: params.managerId,
    teamId: params.teamId || null,
    email: params.email,
    token: params.token,
    tokenPreview: getInviteTokenPreview(params.token),
    status: 'active',
    expiresAt: params.expiresAt,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return inviteTokenRef;
}

async function syncInviteTokenState(params: {
  inviteId: string;
  status: InviteTokenStatus;
  timestampField?: 'consumedAt' | 'revokedAt' | 'cancelledAt';
}) {
  const inviteTokenRef = doc(db, 'inviteTokens', params.inviteId);
  const inviteTokenSnap = await getDoc(inviteTokenRef);
  if (!inviteTokenSnap.exists()) return;

  await updateDoc(inviteTokenRef, {
    status: params.status,
    ...(params.timestampField ? { [params.timestampField]: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  });
}

async function createWorkerInviteRecord(params: {
  managerId: string;
  teamId?: string;
  teamName: string;
  organizationId?: string | null;
  organizationName?: string | null;
  email: string;
  workerId?: string | null;
  deliveryChannel: 'email' | 'in_app';
  status: WorkerInviteStatus;
  statusReason: string;
  appLink: string;
}) {
  const token = generateInviteToken();
  const expiresAt = getFutureDate(INVITE_AUTO_EXPIRY_MS);
  const teamName = params.teamName?.trim() || (params.teamId ? 'Dispatch Team' : 'Solo worker');
  const inviteRef = await addDoc(collection(db, 'workerInvites'), {
    managerId: params.managerId,
    teamId: params.teamId || null,
    teamName,
    organizationId: params.organizationId || null,
    organizationName: params.organizationName || null,
    appLink: params.appLink,
    email: params.email,
    normalizedEmail: params.email,
    canonicalEmail: canonicalizeEmail(params.email),
    workerId: params.workerId || null,
    inviteTokenId: null,
    tokenPreview: getInviteTokenPreview(token),
    deliveryChannel: params.deliveryChannel,
    status: params.status,
    statusReason: params.statusReason,
    sendCount: params.deliveryChannel === 'email' ? 1 : 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt,
    lastSentAt: params.deliveryChannel === 'email' ? serverTimestamp() : null,
  });

  await createInviteTokenRecord({
    inviteId: inviteRef.id,
    managerId: params.managerId,
    teamId: params.teamId,
    email: params.email,
    token,
    expiresAt,
  });

  await updateDoc(inviteRef, {
    inviteTokenId: inviteRef.id,
    updatedAt: serverTimestamp(),
  });

  return { inviteRef, token, expiresAt };
}

async function updateInviteDeliveryState(params: {
  inviteId: string;
  status: WorkerInviteStatus;
  statusReason: string;
  via?: 'http-endpoint' | 'firebase-auth-email-link' | 'firebase-mail-collection';
  incrementSendCount?: boolean;
}) {
  await updateDoc(doc(db, 'workerInvites', params.inviteId), {
    status: params.status,
    statusReason: params.statusReason,
    sentAt: serverTimestamp(),
    lastSentAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(params.via ? { emailDelivery: params.via } : {}),
    ...(params.incrementSendCount ? { sendCount: increment(1) } : {}),
  });
}

export async function inviteWorkerToTeam(params: { managerId: string; teamId: string; email: string }) {
  const { managerId, teamId } = params;
  const normalizedEmail = normalizeEmail(params.email);
  if (!normalizedEmail) throw new Error('Worker email is required');
  if (!isValidEmail(normalizedEmail)) throw new Error('Enter a valid email address');

  const managerSnap = await getDoc(doc(db, 'users', managerId));
  const manager = managerSnap.exists() ? managerSnap.data() as Partial<UserProfile> : {};
  const teamRef = doc(db, 'teams', teamId);
  const teamSnap = await getDoc(teamRef);
  if (!teamSnap.exists()) throw new Error('Team not found');

  const team = teamSnap.data() as Omit<Team, 'id'>;
  const managerCanUseTeam = team.managerId === managerId
    || Boolean(team.organizationId && manager.organizationId && team.organizationId === manager.organizationId && normalizeTeamMemberRole(manager.role) === 'manager');
  if (!managerCanUseTeam) throw new Error('Only managers in this organisation can invite workers to this team');
  await ensureOrganisationManagersOnTeam(teamRef, team, managerId);

  const existingInvite = await loadActiveInvite({ managerId, teamId, email: normalizedEmail });
  if (existingInvite) {
    if (existingInvite.status === 'delivery_failed') {
      await retryWorkerInviteDelivery({ managerId, inviteId: existingInvite.id });
      return { inviteId: existingInvite.id, queued: false, via: existingInvite.emailDelivery || 'firebase-mail-collection', reused: true };
    }
    return { inviteId: existingInvite.id, queued: existingInvite.status !== 'delivered', via: existingInvite.emailDelivery || 'firebase-mail-collection', reused: true };
  }

  const appLink = (process.env.EXPO_PUBLIC_DISPATCH_APP_LINK || '').trim() || 'https://dispatchcrewmanager.com';
  const { inviteRef } = await createWorkerInviteRecord({
    managerId,
    teamId,
    teamName: team.name,
    organizationId: team.organizationId || null,
    organizationName: team.organizationName || null,
    email: normalizedEmail,
    deliveryChannel: 'email',
    status: 'created',
    statusReason: 'Invite created and awaiting delivery.',
    appLink,
  });

  try {
    const delivery = await sendInviteEmail({
      email: normalizedEmail,
      teamName: team.name,
      appLink,
      inviteId: inviteRef.id,
      managerId,
      teamId,
    });

    await updateInviteDeliveryState({
      inviteId: inviteRef.id,
      status: 'delivery_queued',
      statusReason: delivery.reason,
      via: delivery.via,
    });

    return { inviteId: inviteRef.id, queued: true, via: delivery.via, reused: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Invite email transport failed';
    await updateDoc(inviteRef, {
      status: 'delivery_failed',
      statusReason: `Invite saved but delivery failed: ${reason}`,
      deliveryErrorAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    throw new Error(`Invite saved, but delivery failed: ${reason}`);
  }
}

async function sendInviteEmail(params: {
  email: string;
  teamName?: string;
  appLink: string;
  inviteId: string;
  managerId: string;
  teamId?: string;
}): Promise<{
  status: 'queued';
  reason: string;
  via: 'firebase-mail-collection';
}> {
  const collectionName = (process.env.EXPO_PUBLIC_INVITE_EMAIL_COLLECTION || '').trim() || 'mail';
  await addDoc(collection(db, collectionName), {
    ...buildWorkerInviteEmailDocument(params),
    createdAt: serverTimestamp(),
  });

  return {
    status: 'queued',
    reason: `Invite email queued in Firestore collection "${collectionName}" for delivery worker.`,
    via: 'firebase-mail-collection',
  };
}

async function queueEventRoleInviteEmail(params: {
  email?: string | null;
  eventName: string;
  eventLocation?: string | null;
  eventStartsAt?: string | null;
  roleName: string;
  roleOpenSlots: number;
  roleTasks: EventRole['tasks'];
  managerId: string;
  workerId: string;
  eventId: string;
  roleId: string;
}) {
  const email = params.email?.trim().toLowerCase();
  if (!email) return;

  const appLink = getInviteAppLink();
  const eventDate = params.eventStartsAt
    ? new Date(params.eventStartsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : 'the scheduled event time';
  const locationText = params.eventLocation?.trim() || 'Location TBD';
  const collectionName = (process.env.EXPO_PUBLIC_INVITE_EMAIL_COLLECTION || '').trim() || 'mail';
  const taskDetails = (params.roleTasks || []).map((task, index) => {
    const countdown = Number.isFinite(task.expectedOffsetMinutes)
      ? `Countdown offset: ${task.expectedOffsetMinutes} minute${task.expectedOffsetMinutes === 1 ? '' : 's'} from event start.`
      : 'No countdown timer.';
    const description = task.description?.trim() || '';
    const attachmentText = (task.attachments || []).map((attachment) => `${attachment.name}: ${attachment.url}`).join(', ');
    const attachmentHtml = (task.attachments || []).map((attachment) => `<a href="${escapeHtml(attachment.url)}">${escapeHtml(attachment.name)}</a>`).join(', ');
    return {
      text: `${index + 1}. ${task.name}${description ? ` - ${description}` : ''}. ${countdown}${attachmentText ? ` Attachments: ${attachmentText}` : ''}`,
      html: `<li><strong>${escapeHtml(task.name)}</strong>${description ? `<br/>${escapeHtml(description)}` : ''}<br/>${escapeHtml(countdown)}${attachmentHtml ? `<br/>Attachments: ${attachmentHtml}` : ''}</li>`,
    };
  });
  const taskText = taskDetails.length ? `\n\nTasks:\n${taskDetails.map((task) => task.text).join('\n')}` : '\n\nTasks: No tasks listed.';
  const taskHtml = taskDetails.length ? `<p><strong>Tasks</strong></p><ol>${taskDetails.map((task) => task.html).join('')}</ol>` : '<p><strong>Tasks:</strong> No tasks listed.</p>';

  await addDoc(collection(db, collectionName), {
    to: [email],
    message: {
      subject: `Dispatch role invite: ${params.roleName} for ${params.eventName}`,
      text: `You have been invited to ${params.roleName} for ${params.eventName}.\nWhen: ${eventDate}\nWhere: ${locationText}\nOpen positions: ${params.roleOpenSlots}${taskText}\n\nOpen Dispatch to accept or join the waitlist: ${appLink}`,
      html: `<p>You have been invited to <strong>${escapeHtml(params.roleName)}</strong> for <strong>${escapeHtml(params.eventName)}</strong>.</p><p><strong>When:</strong> ${escapeHtml(eventDate)}<br/><strong>Where:</strong> ${escapeHtml(locationText)}<br/><strong>Open positions:</strong> ${params.roleOpenSlots}</p>${taskHtml}<p><a href="${escapeHtml(appLink)}">Open Dispatch</a> to accept or join the waitlist.</p>`,
    },
    dispatchEventRoleInvite: {
      managerId: params.managerId,
      workerId: params.workerId,
      eventId: params.eventId,
      roleId: params.roleId,
      eventName: params.eventName,
      roleName: params.roleName,
      roleOpenSlots: params.roleOpenSlots,
      roleTasks: params.roleTasks,
      appLink,
      email,
    },
    createdAt: serverTimestamp(),
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function queueEventRoleReminderEmail(params: {
  eventId: string;
  roleId: string;
  workerId: string;
}) {
  const [eventSnap, workerSnap] = await Promise.all([
    getDoc(doc(db, 'events', params.eventId)).catch(() => null),
    getDoc(doc(db, 'users', params.workerId)).catch(() => null),
  ]);
  if (!eventSnap?.exists() || !workerSnap?.exists()) return;

  const event = eventSnap.data() as Omit<DispatchEvent, 'id'>;
  const worker = workerSnap.data() as Partial<UserProfile>;
  const email = worker.email?.trim().toLowerCase();
  if (!email) return;

  const role = (event.roles || []).find((item) => item.id === params.roleId);
  if (!role || !(role.assignedWorkerIds || []).includes(params.workerId)) return;

  const eventStart = new Date(event.startsAt);
  if (Number.isNaN(eventStart.getTime()) || eventStart.getTime() <= Date.now()) return;

  const reminderAt = new Date(Math.max(Date.now(), eventStart.getTime() - 12 * 60 * 60 * 1000));
  const eventDate = eventStart.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const locationText = event.location?.trim() || 'Location TBD';
  const appLink = getInviteAppLink();
  const collectionName = (process.env.EXPO_PUBLIC_INVITE_EMAIL_COLLECTION || '').trim() || 'mail';
  const reminderId = `event-reminder-${params.eventId}-${params.roleId}-${params.workerId}`.replace(/[^A-Za-z0-9_-]/g, '-');

  await setDoc(doc(db, collectionName, reminderId), {
    to: [email],
    delivery: {
      startTime: reminderAt,
    },
    message: {
      subject: `Dispatch reminder: ${event.name} today`,
      text: `Reminder: you are assigned to ${role.name} for ${event.name} at ${eventDate}. Location: ${locationText}. Open Dispatch: ${appLink}`,
      html: `<p>Reminder: you are assigned to <strong>${role.name}</strong> for <strong>${event.name}</strong>.</p><p><strong>When:</strong> ${eventDate}<br/><strong>Where:</strong> ${locationText}</p><p><a href="${appLink}">Open Dispatch</a></p>`,
    },
    dispatchEventReminder: {
      eventId: params.eventId,
      roleId: params.roleId,
      workerId: params.workerId,
      eventName: event.name,
      roleName: role.name,
      appLink,
      email,
      reminderAt,
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function retryWorkerInviteDelivery(params: { managerId: string; inviteId: string }) {
  const inviteRef = doc(db, 'workerInvites', params.inviteId);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) throw new Error('Invite not found');

  const invite = { id: inviteSnap.id, ...(inviteSnap.data() as Omit<WorkerInvite, 'id'>) };
  if (invite.managerId !== params.managerId) throw new Error('You can only retry your own invites');
  if (!invite.email) throw new Error('Invite data is incomplete for retry');
  if (invite.status === 'revoked' || invite.status === 'cancelled') throw new Error('Revoked or cancelled invites cannot be retried');

  const teamName = invite.teamName || 'Dispatch Team';
  const appLink = invite.appLink || (process.env.EXPO_PUBLIC_DISPATCH_APP_LINK || '').trim() || 'https://dispatchcrewmanager.com';

  const expired = await expireInviteIfNeeded(inviteRef, invite);
  const refreshedInvite = expired ? { ...invite, status: 'expired' as WorkerInviteStatus } : invite;
  if (refreshedInvite.status === 'expired') {
    throw new Error('Invite expired. Create a new invite instead of retrying this one.');
  }

  try {
    const delivery = await sendInviteEmail({
      email: invite.email,
      teamName,
      appLink,
      inviteId: params.inviteId,
      managerId: params.managerId,
      teamId: invite.teamId || undefined,
    });

    await updateInviteDeliveryState({
      inviteId: params.inviteId,
      status: 'delivery_queued',
      statusReason: `Retry successful: ${delivery.reason}`,
      via: delivery.via,
      incrementSendCount: true,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Retry transport failed';
    await updateDoc(inviteRef, {
      status: 'delivery_failed',
      statusReason: `Retry failed: ${reason}`,
      retryAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    throw new Error(reason);
  }
}

async function ensureWorkerInviteNotification(params: {
  userId: string;
  inviteId: string;
  teamName?: string;
  managerName?: string;
}) {
  const notificationId = `worker_team_invite__${params.inviteId}__${params.userId}`;

  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'userNotifications', notificationId);
    const snap = await tx.get(ref);
    if (snap.exists()) return;

    tx.set(ref, {
      userId: params.userId,
      kind: 'worker_team_invite',
      title: 'You have a team invite waiting',
      body: `${params.managerName || 'A manager'} invited you to join ${params.teamName || 'a Dispatch team'}. Open the app and review your pending invite.`,
      relatedRoleId: params.inviteId,
      read: false,
      createdAt: serverTimestamp(),
      statusReason: 'Pending team invite surfaced after account creation or sign-in.',
    });
  });
}

async function setInvitePendingAcceptance(params: { userId: string; email: string }) {
  const normalizedEmail = normalizeEmail(params.email);
  if (!normalizedEmail) return;

  const inviteStatuses: WorkerInviteStatus[] = ['created', 'delivery_queued', 'delivered', 'delivery_failed'];

  for (const status of inviteStatuses) {
    const invitesSnap = await getDocs(
      query(
        collection(db, 'workerInvites'),
        where('email', '==', normalizedEmail),
        where('status', '==', status)
      )
    );

    for (const inviteDoc of invitesSnap.docs) {
      const invite = { id: inviteDoc.id, ...(inviteDoc.data() as Omit<WorkerInvite, 'id'>) };
      if (!invite.managerId || invite.claimRequired) continue;
      if (await expireInviteIfNeeded(inviteDoc.ref, invite)) continue;

      let managerName = 'A manager';
      try {
        const managerSnap = await getDoc(doc(db, 'users', invite.managerId));
        if (managerSnap.exists()) {
          managerName = ((managerSnap.data() as Partial<UserProfile>).displayName || managerName);
        }
      } catch {
        managerName = 'A manager';
      }

      await updateDoc(inviteDoc.ref, {
        workerId: params.userId,
        status: 'pending_acceptance',
        statusReason: 'Worker account found. Awaiting explicit in-app acceptance.',
        linkedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await ensureWorkerInviteNotification({
        userId: params.userId,
        inviteId: invite.id,
        teamName: invite.teamName,
        managerName,
      });
    }
  }
}

export async function acceptPendingInvitesForUser(params: { userId: string; email: string }) {
  await setInvitePendingAcceptance(params);
}

export async function acceptPendingWorkerInvitesForUser(params: { userId: string; email: string }) {
  const normalizedEmail = normalizeEmail(params.email);
  if (!normalizedEmail) return;

  await setInvitePendingAcceptance(params).catch(() => null);

  const inviteStatuses: WorkerInviteStatus[] = ['created', 'delivery_queued', 'delivered', 'delivery_failed', 'pending_acceptance'];
  const inviteDocsById = new Map<string, Omit<WorkerInvite, 'id'> & { id: string }>();

  for (const status of inviteStatuses) {
    const invitesSnap = await getDocs(
      query(
        collection(db, 'workerInvites'),
        where('email', '==', normalizedEmail),
        where('status', '==', status)
      )
    ).catch(() => null);

    invitesSnap?.docs.forEach((inviteDoc) => {
      inviteDocsById.set(inviteDoc.id, { id: inviteDoc.id, ...(inviteDoc.data() as Omit<WorkerInvite, 'id'>) });
    });
  }

  for (const invite of inviteDocsById.values()) {
    if (invite.claimRequired) continue;
    if (invite.workerId && invite.workerId !== params.userId) continue;
    await acceptWorkerInvite({ userId: params.userId, inviteId: invite.id }).catch(() => null);
  }
}

export async function searchWorkersByEmail(email: string): Promise<UserProfile[]> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) return [];

  const usersSnap = await getDocs(query(
    collection(db, 'users'),
    where('email', '==', normalizedEmail),
    where('role', '==', 'worker')
  )).catch(() => null);

  return (usersSnap?.docs || []).map((docSnap) => {
    const data = docSnap.data() as Partial<UserProfile>;
      return {
        uid: docSnap.id,
        displayName: data.displayName || 'Dispatch User',
        role: (data.role as UserProfile['role']) || 'worker',
        organizationId: data.organizationId || null,
        organizationName: data.organizationName || null,
        phoneNumber: data.phoneNumber,
        avatarUrl: data.avatarUrl,
      };
  });
}

export async function linkPendingManagerInvites(params: { userId: string; email: string }) {
  const normalizedEmail = normalizeEmail(params.email);
  if (!normalizedEmail) return;
  const canonicalEmail = canonicalizeEmail(normalizedEmail);

  const userRef = doc(db, 'users', params.userId);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;

  const user = userSnap.data() as Partial<UserProfile>;
  if (user.role !== 'manager') return;

  await updateDoc(userRef, {
    email: normalizedEmail,
    canonicalEmail,
    updatedAt: serverTimestamp(),
  });

  const invitesSnap = await getDocs(query(
    collection(db, 'managerInvites'),
    where('normalizedEmail', '==', normalizedEmail),
    where('status', '==', 'pending')
  ));
  const canonicalInvitesSnap = canonicalEmail !== normalizedEmail
    ? await getDocs(query(
      collection(db, 'managerInvites'),
      where('canonicalEmail', '==', canonicalEmail),
      where('status', '==', 'pending')
    ))
    : null;

  const inviteDocsById = new Map(invitesSnap.docs.map((inviteDoc) => [inviteDoc.id, inviteDoc]));
  canonicalInvitesSnap?.docs.forEach((inviteDoc) => inviteDocsById.set(inviteDoc.id, inviteDoc));

  for (const inviteDoc of inviteDocsById.values()) {
    const invite = { id: inviteDoc.id, ...(inviteDoc.data() as Omit<ManagerInvite, 'id'>) };
    if (invite.claimRequired) continue;
    const batch = writeBatch(db);
    batch.update(userRef, {
      organizationId: invite.organizationId,
      organizationName: invite.organizationName || null,
      email: normalizedEmail,
      canonicalEmail,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'organizations', invite.organizationId), {
      managerIds: arrayUnion(params.userId),
      updatedAt: serverTimestamp(),
    });
    batch.update(inviteDoc.ref, {
      managerUserId: params.userId,
      status: 'accepted',
      statusReason: 'Manager account linked to organisation invite.',
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await syncOrganisationTeamsForManager({ organizationId: invite.organizationId, managerId: params.userId });
  }
}

export async function inviteManagerByEmailToOrganisation(params: {
  inviterId: string;
  email: string;
}): Promise<{ linked: boolean; reused?: boolean }> {
  const normalizedEmail = normalizeEmail(params.email);
  if (!normalizedEmail) throw new Error('Manager email is required');
  if (!isValidEmail(normalizedEmail)) throw new Error('Enter a valid email address');
  const canonicalEmail = canonicalizeEmail(normalizedEmail);

  const inviterSnap = await getDoc(doc(db, 'users', params.inviterId));
  if (!inviterSnap.exists()) throw new Error('Manager profile not found');

  const inviter = inviterSnap.data() as Partial<UserProfile>;
  if (inviter.role !== 'manager') throw new Error('Only managers can invite other managers');
  if (!inviter.organizationId) throw new Error('Create or join an organisation before inviting managers');

  const existingInviteSnap = await getDocs(query(
    collection(db, 'managerInvites'),
    where('inviterId', '==', params.inviterId),
    where('normalizedEmail', '==', normalizedEmail),
    where('organizationId', '==', inviter.organizationId),
    where('status', '==', 'pending'),
    limit(1)
  ));

  if (!existingInviteSnap.empty) {
    await updateDoc(doc(db, 'organizations', inviter.organizationId), {
      pendingManagerInviteEmails: arrayUnion(normalizedEmail),
      pendingManagerInviteCanonicalEmails: arrayUnion(canonicalEmail),
      updatedAt: serverTimestamp(),
    });
    return { linked: false, reused: true };
  }

  const existingCanonicalInviteSnap = canonicalEmail !== normalizedEmail
    ? await getDocs(query(
      collection(db, 'managerInvites'),
      where('inviterId', '==', params.inviterId),
      where('canonicalEmail', '==', canonicalEmail),
      where('organizationId', '==', inviter.organizationId),
      where('status', '==', 'pending'),
      limit(1)
    ))
    : null;

  if (existingCanonicalInviteSnap && !existingCanonicalInviteSnap.empty) {
    await updateDoc(doc(db, 'organizations', inviter.organizationId), {
      pendingManagerInviteEmails: arrayUnion(normalizedEmail),
      pendingManagerInviteCanonicalEmails: arrayUnion(canonicalEmail),
      updatedAt: serverTimestamp(),
    });
    return { linked: false, reused: true };
  }

  await addDoc(collection(db, 'managerInvites'), {
    inviterId: params.inviterId,
    organizationId: inviter.organizationId,
    organizationName: inviter.organizationName || null,
    email: normalizedEmail,
    normalizedEmail,
    canonicalEmail,
    managerUserId: null,
    status: 'pending',
    statusReason: 'Waiting for manager account with this email.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, 'organizations', inviter.organizationId), {
    pendingManagerInviteEmails: arrayUnion(normalizedEmail),
    pendingManagerInviteCanonicalEmails: arrayUnion(canonicalEmail),
    updatedAt: serverTimestamp(),
  });

  return { linked: false };
}

export async function inviteWorkerByEmailToTeam(params: {
  managerId: string;
  teamId?: string;
  email: string;
  managerName?: string;
}) {
  const { managerId, teamId } = params;
  const normalizedEmail = normalizeEmail(params.email);
  if (!normalizedEmail) throw new Error('Worker email is required');
  if (!isValidEmail(normalizedEmail)) throw new Error('Enter a valid email address');

  const managerSnap = await getDoc(doc(db, 'users', managerId));
  const manager = managerSnap.exists() ? managerSnap.data() as Partial<UserProfile> : {};
  if (normalizeTeamMemberRole(manager.role) !== 'manager') {
    throw new Error('Only Managers can invite Workers. Refresh your profile if your role recently changed.');
  }

  let teamName = 'Solo worker';
  let organizationId: string | null = null;
  let organizationName: string | null = null;
  let teamWorkerIds: string[] = [];
  if (teamId) {
    const teamRef = doc(db, 'teams', teamId);
    const teamSnap = await getDoc(teamRef);
    if (!teamSnap.exists()) throw new Error('Team not found');
    const team = teamSnap.data() as Omit<Team, 'id'>;
    const managerCanUseTeam = team.managerId === managerId
      || Boolean(team.organizationId && manager.organizationId && team.organizationId === manager.organizationId && normalizeTeamMemberRole(manager.role) === 'manager');
    if (!managerCanUseTeam) throw new Error('Only managers in this organisation can invite workers to this team');
    await ensureOrganisationManagersOnTeam(teamRef, team, managerId);
    teamName = team.name || 'Dispatch Team';
    organizationId = team.organizationId || null;
    organizationName = team.organizationName || null;
    teamWorkerIds = team.workerIds || [];
  } else {
    organizationId = manager.organizationId || null;
    organizationName = manager.organizationName || null;
  }

  const existingInvite = await loadActiveInvite({ managerId, teamId, email: normalizedEmail });
  if (existingInvite) {
    if (existingInvite.status === 'delivery_failed') {
      await retryWorkerInviteDelivery({ managerId, inviteId: existingInvite.id });
      return { linked: !!existingInvite.workerId, reused: true };
    }
    return { linked: !!existingInvite.workerId, reused: true };
  }

  const canonicalEmail = canonicalizeEmail(normalizedEmail);
  const organizationUsersSnap = organizationId
    ? await getDocs(query(collection(db, 'users'), where('organizationId', '==', organizationId))).catch(() => null)
    : null;
  const foundWorker = organizationUsersSnap?.docs.find((userDoc) => {
    const data = userDoc.data() as Partial<UserProfile>;
    return normalizeTeamMemberRole(data.role) === 'worker'
      && canonicalizeEmail(data.email || data.canonicalEmail) === canonicalEmail;
  });
  const foundWorkerId = foundWorker?.id;

  if (foundWorkerId && teamWorkerIds.includes(foundWorkerId)) {
    throw new Error('This worker is already an active member of this team.');
  }

  const appLink = getInviteAppLink();
  const initialStatus: WorkerInviteStatus = foundWorkerId ? 'pending_acceptance' : 'created';
  const initialReason = foundWorkerId
    ? (teamId ? 'Worker account already exists. Awaiting explicit in-app acceptance to join team.' : 'Worker account already exists. Awaiting explicit in-app acceptance for direct invite.')
    : 'Invite created and awaiting delivery.';
  const deliveryChannel: 'email' | 'in_app' = foundWorkerId ? 'in_app' : 'email';

  const { inviteRef } = await createWorkerInviteRecord({
    managerId,
    teamId,
    teamName,
    organizationId,
    organizationName,
    email: normalizedEmail,
    workerId: foundWorkerId || null,
    deliveryChannel,
    status: initialStatus,
    statusReason: initialReason,
    appLink,
  });

  if (foundWorkerId) {
    const managerProfile = await getDoc(doc(db, 'users', managerId));
    const managerName = (managerProfile.exists() ? ((managerProfile.data() as Partial<UserProfile>).displayName || null) : null) || params.managerName || 'A manager';

    await ensureWorkerInviteNotification({
      userId: foundWorkerId,
      inviteId: inviteRef.id,
      teamName,
      managerName,
    });

    return { linked: true, reused: false, workerId: foundWorkerId };
  }

  try {
    const delivery = await sendInviteEmail({
      email: normalizedEmail,
      teamName,
      appLink,
      inviteId: inviteRef.id,
      managerId,
      teamId,
    });

    await updateInviteDeliveryState({
      inviteId: inviteRef.id,
      status: 'delivery_queued',
      statusReason: delivery.reason,
      via: delivery.via,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Invite email transport failed';
    await updateDoc(inviteRef, {
      status: 'delivery_failed',
      statusReason: `Invite saved but delivery failed: ${reason}`,
      deliveryErrorAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    throw new Error(`Invite saved, but delivery failed: ${reason}`);
  }

  return { linked: false, reused: false };
}

export async function linkPendingEmailInvites(params: { userId: string; email: string }) {
  await setInvitePendingAcceptance(params);
}

export async function cancelWorkerInvite(params: { managerId: string; inviteId: string }) {
  const inviteRef = doc(db, 'workerInvites', params.inviteId);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) throw new Error('Invite not found');

  const invite = inviteSnap.data() as WorkerInvite;
  if (invite.managerId !== params.managerId) throw new Error('You can only cancel your own invites');
  if (invite.status === 'accepted') throw new Error('Accepted invites cannot be cancelled');

  await updateDoc(inviteRef, {
    status: 'cancelled',
    statusReason: 'Invite cancelled by manager.',
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await syncInviteTokenState({ inviteId: params.inviteId, status: 'cancelled', timestampField: 'cancelledAt' });
}

export async function revokeWorkerInvite(params: { managerId: string; inviteId: string }) {
  const inviteRef = doc(db, 'workerInvites', params.inviteId);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) throw new Error('Invite not found');

  const invite = inviteSnap.data() as WorkerInvite;
  if (invite.managerId !== params.managerId) throw new Error('You can only revoke your own invites');
  if (invite.status === 'accepted') throw new Error('Accepted invites cannot be revoked');

  await updateDoc(inviteRef, {
    status: 'revoked',
    statusReason: 'Invite revoked by manager.',
    revokedAt: serverTimestamp(),
    revokedBy: params.managerId,
    updatedAt: serverTimestamp(),
  });
  await syncInviteTokenState({ inviteId: params.inviteId, status: 'revoked', timestampField: 'revokedAt' });
}

export async function acceptWorkerInvite(params: { userId: string; inviteId: string }) {
  const inviteRef = doc(db, 'workerInvites', params.inviteId);
  type AcceptedTeamSync = {
    teamId: string;
    teamName?: string;
    managerId: string;
    workerId: string;
    organizationId?: string | null;
  };
  let acceptedTeamSync: AcceptedTeamSync | null = null;

  await runTransaction(db, async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists()) throw new Error('Invite not found');

    const invite = inviteSnap.data() as WorkerInvite;
    if (invite.workerId && invite.workerId !== params.userId) throw new Error('This invite belongs to another user');
    if (isInviteExpired(invite)) throw new Error('This invite has expired');
    if (invite.status !== 'pending_acceptance' && invite.status !== 'delivered' && invite.status !== 'delivery_queued' && invite.status !== 'delivery_failed' && invite.status !== 'created') {
      throw new Error('Invite is not available to accept');
    }

    const workerSnap = await tx.get(doc(db, 'users', params.userId));
    const workerName = workerSnap.exists()
      ? ((workerSnap.data() as Partial<UserProfile>).displayName || 'Worker')
      : 'Worker';
    let teamName = invite.teamName || 'Dispatch team';
    let organizationId = invite.organizationId || null;
    let organizationName = invite.organizationName || null;
    if (invite.teamId) {
      const teamRef = doc(db, 'teams', invite.teamId);
      tx.update(teamRef, {
        workerIds: arrayUnion(params.userId),
        lastAcceptedInviteId: params.inviteId,
        updatedAt: serverTimestamp(),
      });
      acceptedTeamSync = {
        teamId: invite.teamId,
        teamName,
        managerId: invite.managerId,
        workerId: params.userId,
        organizationId,
      };
    }

    tx.update(inviteRef, {
      workerId: params.userId,
      status: 'accepted',
      statusReason: 'Worker accepted invite in app.',
      acceptedAt: serverTimestamp(),
      consumedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (organizationId || organizationName) {
      tx.set(
        doc(db, 'users', params.userId),
        {
          organizationId,
          organizationName,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    if (organizationId) {
      tx.update(doc(db, 'organizations', organizationId), {
        workerIds: arrayUnion(params.userId),
        lastAcceptedInviteId: params.inviteId,
        updatedAt: serverTimestamp(),
      });
    }

    const managerNotificationRef = doc(collection(db, 'userNotifications'));
    tx.set(managerNotificationRef, {
      userId: invite.managerId,
      kind: 'worker_team_invite',
      title: 'Team invite accepted',
      body: `${workerName} accepted the invite to join ${teamName}.`,
      relatedRoleId: params.inviteId,
      read: false,
      createdAt: serverTimestamp(),
    });
  });

  const teamSync = acceptedTeamSync as AcceptedTeamSync | null;
  let acceptedOrganizationId = teamSync?.organizationId || null;
  if (teamSync) {
    const acceptedTeamSnapshot = await getDoc(doc(db, 'teams', teamSync.teamId)).catch(() => null);
    if (acceptedTeamSnapshot?.exists()) {
      const acceptedTeam = { id: acceptedTeamSnapshot.id, ...(acceptedTeamSnapshot.data() as Omit<Team, 'id'>) };
      acceptedOrganizationId = acceptedTeam.organizationId || acceptedOrganizationId;
      await ensureTeamCommunicationThreads(acceptedTeam).catch(() => null);
    }
  }

  if (acceptedOrganizationId) {
    await ensureOrganizationCommunicationThreads(acceptedOrganizationId).catch(() => null);
  }

  await syncInviteTokenState({ inviteId: params.inviteId, status: 'consumed', timestampField: 'consumedAt' });
}

export async function declineWorkerInvite(params: { userId: string; inviteId: string }) {
  const inviteRef = doc(db, 'workerInvites', params.inviteId);
  await runTransaction(db, async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists()) throw new Error('Invite not found');

    const invite = inviteSnap.data() as WorkerInvite;
    if (invite.workerId && invite.workerId !== params.userId) throw new Error('This invite belongs to another user');
    if (isInviteExpired(invite)) throw new Error('This invite has expired');
    if (invite.status !== 'pending_acceptance' && invite.status !== 'delivered' && invite.status !== 'delivery_queued' && invite.status !== 'created') {
      throw new Error('Invite is not available to decline');
    }

    const workerSnap = await tx.get(doc(db, 'users', params.userId));
    const workerName = workerSnap.exists()
      ? ((workerSnap.data() as Partial<UserProfile>).displayName || 'Worker')
      : 'Worker';

    tx.update(inviteRef, {
      workerId: params.userId,
      status: 'declined',
      statusReason: 'Worker declined invite in app.',
      declinedAt: serverTimestamp(),
      consumedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const teamName = invite.teamName || 'Dispatch team';
    const managerNotificationRef = doc(collection(db, 'userNotifications'));
    tx.set(managerNotificationRef, {
      userId: invite.managerId,
      kind: 'worker_team_invite',
      title: 'Team invite declined',
      body: `${workerName} declined the invite to join ${teamName}.`,
      relatedRoleId: params.inviteId,
      read: false,
      createdAt: serverTimestamp(),
    });
  });

  await syncInviteTokenState({ inviteId: params.inviteId, status: 'consumed', timestampField: 'consumedAt' });
}

export async function loadUserProfilesByIds(userIds: string[]): Promise<UserProfile[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];

  const snapshots = await Promise.all(
    ids.map((id) => getDoc(doc(db, 'users', id)).catch(() => null))
  );

  return snapshots
    .filter((snap): snap is NonNullable<typeof snap> => Boolean(snap?.exists()))
    .map((snap) => {
      const data = snap.data() as Partial<UserProfile>;
      return {
        uid: snap.id,
        displayName: data.displayName || 'Dispatch User',
        role: normalizeTeamMemberRole(data.role) || 'worker',
        organizationId: data.organizationId || null,
        organizationName: data.organizationName || null,
        email: data.email || null,
        canonicalEmail: data.canonicalEmail || null,
        phoneNumber: data.phoneNumber,
        avatarUrl: data.avatarUrl,
      };
    });
}

export async function loadOrganizationMembers(organizationId: string): Promise<{
  organization: Organisation;
  members: UserProfile[];
}> {
  const organizationSnapshot = await getDoc(doc(db, 'organizations', organizationId));
  if (!organizationSnapshot.exists()) throw new Error('Organization not found.');

  const data = organizationSnapshot.data() as Omit<Organisation, 'id'>;
  const storedOrganization: Organisation = {
    id: organizationSnapshot.id,
    ...data,
    managerIds: [...new Set((data.managerIds || []).filter(Boolean))],
    workerIds: [...new Set((data.workerIds || []).filter(Boolean))],
  };
  const rosterMembers = await loadUserProfilesByIds([
    ...storedOrganization.managerIds,
    ...(storedOrganization.workerIds || []),
  ]);
  const organizationMembersSnapshot = await getDocs(
    query(collection(db, 'users'), where('organizationId', '==', organizationId))
  ).catch(() => null);
  const queriedMembers = (organizationMembersSnapshot?.docs || []).map((memberSnapshot) => {
    const member = memberSnapshot.data() as Partial<UserProfile>;
    return {
      uid: memberSnapshot.id,
      displayName: member.displayName || 'Dispatch User',
      role: normalizeTeamMemberRole(member.role) || 'worker',
      organizationId: member.organizationId || null,
      organizationName: member.organizationName || null,
      email: member.email || null,
      canonicalEmail: member.canonicalEmail || null,
      phoneNumber: member.phoneNumber,
      avatarUrl: member.avatarUrl,
    } satisfies UserProfile;
  });
  const members = [...new Map([...rosterMembers, ...queriedMembers].map((member) => [member.uid, member])).values()];
  const organization: Organisation = {
    ...storedOrganization,
    managerIds: [...new Set([
      ...storedOrganization.managerIds,
      ...members.filter((member) => member.role === 'manager').map((member) => member.uid),
    ])],
    workerIds: [...new Set([
      ...(storedOrganization.workerIds || []),
      ...members.filter((member) => member.role === 'worker').map((member) => member.uid),
    ])],
  };

  return { organization, members };
}

export async function ensureOrganizationCommunicationThreads(organizationId: string) {
  const { organization, members } = await loadOrganizationMembers(organizationId);
  const participantIds = members.map((member) => member.uid);
  if (!participantIds.length) return;

  const writes: Promise<unknown>[] = [
    setDoc(
      doc(db, 'chatThreads', buildOrganizationChatThreadId(organizationId)),
      {
        id: buildOrganizationChatThreadId(organizationId),
        organizationId,
        title: organization.name || 'Organization',
        kind: 'organization',
        participants: participantIds,
      },
      { merge: true }
    ),
  ];

  (organization.workerIds || []).forEach((workerId) => {
    const worker = members.find((member) => member.uid === workerId);
    writes.push(
      setDoc(
        doc(db, 'chatThreads', buildOrganizationManagersThreadId(organizationId, workerId)),
        {
          id: buildOrganizationManagersThreadId(organizationId, workerId),
          organizationId,
          title: worker?.displayName || 'Worker',
          kind: 'manager',
          participants: [...new Set([workerId, ...organization.managerIds])],
        },
        { merge: true }
      )
    );
  });

  await Promise.all(writes);
}

export async function updateEventRoleAssignment(params: {
  eventId: string;
  roleId: string;
  managerId: string;
  workerId: string;
  action: 'assign' | 'remove';
}) {
  const { eventId, roleId, managerId, workerId, action } = params;

  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'events', eventId);
    const managerRef = doc(db, 'users', managerId);
    const [snap, managerSnap] = await Promise.all([tx.get(ref), tx.get(managerRef)]);
    if (!snap.exists()) throw new Error('Event not found');

    const event = snap.data() as Omit<DispatchEvent, 'id'>;
    const manager = managerSnap.exists() ? managerSnap.data() as Partial<UserProfile> : {};
    if (!canManagerManageEvent({
      eventManagerId: event.managerId,
      eventOrganizationId: event.organizationId,
      managerId,
      managerOrganizationId: manager.organizationId,
      managerRole: manager.role,
    })) throw new Error('Only a Manager in this event organization can change role assignments');

    const roles = (event.roles || []) as EventRole[];
    const role = roles.find((item) => item.id === roleId);
    if (!role) throw new Error('Role not found');

    const assignedWorkerIds = role.assignedWorkerIds || [];
    const alreadyAssigned = assignedWorkerIds.includes(workerId);

    if (action === 'assign' && alreadyAssigned) return;
    if (action === 'remove' && !alreadyAssigned) return;

    let nextRoles = roles;

    // Assignments are now pending until worker accepts.
    if (action === 'remove') {
      const removal = removeWorkerFromEventRoleAndRebuildWorkers(roles, roleId, workerId);
      nextRoles = removal.roles;
      tx.update(ref, {
        roles: nextRoles,
        workerIds: removal.workerIds,
        revision: (event.revision ?? 0) + 1,
        updatedAt: serverTimestamp(),
      });

      const removalNotificationRef = doc(collection(db, 'userNotifications'));
      tx.set(removalNotificationRef, {
        userId: workerId,
        kind: 'role_removed',
        title: 'Removed from role',
        body: `${event.name}: you were removed from ${role.name}.`,
        relatedEventId: eventId,
        relatedRoleId: roleId,
        read: false,
        createdAt: serverTimestamp(),
      });

      removal.waitlistWorkerIdsToNotify.forEach((waitlistWorkerId) => {
        const availableNotificationRef = doc(collection(db, 'userNotifications'));
        tx.set(availableNotificationRef, {
          userId: waitlistWorkerId,
          kind: 'role_available',
          title: 'Role available',
          body: `${event.name}: ${role.name} is available.`,
          relatedEventId: eventId,
          relatedRoleId: roleId,
          read: false,
          createdAt: serverTimestamp(),
        });
      });
      return;
    }

    const clearedRemoval = clearWorkerEventRoleRemoval(roles, roleId, workerId);
    nextRoles = clearedRemoval.roles;
    tx.update(ref, {
      roles: nextRoles,
      workerIds: clearedRemoval.workerIds,
      revision: (event.revision ?? 0) + 1,
      updatedAt: serverTimestamp(),
    });

    const inviteRole = nextRoles.find((item) => item.id === roleId) || role;

    const notificationRef = doc(collection(db, 'roleAssignmentNotifications'));
    tx.set(notificationRef, {
      workerId,
      managerId,
      eventId,
      roleId,
      eventName: event.name,
      eventLocation: event.location || '',
      eventStartsAt: event.startsAt || '',
      roleName: inviteRole.name,
      roleTaskNames: (inviteRole.tasks || []).map((task) => task.name).filter(Boolean),
      roleOpenSlots: Math.max(0, inviteRole.openSlots || 0),
      roleAssignedWorkerIds: inviteRole.assignedWorkerIds || [],
      roleWaitlistWorkerIds: inviteRole.waitlistWorkerIds || [],
      roleEligibleWaitlistWorkerIds: inviteRole.eligibleWaitlistWorkerIds || [],
      roleWaitlistInviteWorkerIds: inviteRole.waitlistInviteWorkerIds || [],
      roleRemovedWorkerIds: inviteRole.removedWorkerIds || [],
      action,
      status: 'pending',
      statusReason: `${event.name}: You were invited to ${role.name}. Accept or decline in Dispatch.`,
      responseOptions: ['accept', 'decline'],
      createdAt: serverTimestamp(),
    });

  });

  if (action === 'assign') {
    const [workerSnap, eventSnap] = await Promise.all([
      getDoc(doc(db, 'users', workerId)).catch(() => null),
      getDoc(doc(db, 'events', eventId)).catch(() => null),
    ]);
    const worker = workerSnap?.exists() ? workerSnap.data() as Partial<UserProfile> : null;
    const event = eventSnap?.exists() ? eventSnap.data() as Omit<DispatchEvent, 'id'> : null;
    const role = event?.roles?.find((item) => item.id === roleId);
    if (!event || !role) return;

    await queueEventRoleInviteEmail({
      email: worker?.email,
      managerId,
      workerId,
      eventId,
      roleId,
      eventName: event.name,
      eventLocation: event.location || null,
      eventStartsAt: event.startsAt || null,
      roleName: role.name,
      roleOpenSlots: role.openSlots || 0,
      roleTasks: role.tasks || [],
    }).catch((error) => {
      console.warn('Dispatch event role invite email queue failed', error);
    });
  }
}

export async function withdrawPendingEventRoleInvite(params: {
  eventId: string;
  roleId: string;
  managerId: string;
  workerId: string;
}) {
  const inviteSnap = await getDocs(
    query(
      collection(db, 'roleAssignmentNotifications'),
      where('eventId', '==', params.eventId),
      where('roleId', '==', params.roleId),
      where('managerId', '==', params.managerId),
      where('workerId', '==', params.workerId),
      where('status', '==', 'pending')
    )
  );

  if (inviteSnap.empty) return;

  const batch = writeBatch(db);
  inviteSnap.docs.forEach((inviteDoc) => {
    batch.update(inviteDoc.ref, {
      status: 'declined',
      statusReason: 'The manager withdrew this role invitation.',
      response: 'decline',
      respondedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

export async function updateEventRoleDetails(params: {
  eventId: string;
  roleId: string;
  managerId: string;
  name: string;
  tasks?: EventRole['tasks'];
  expectedRevision?: number;
}) {
  const { eventId, roleId, managerId, name } = params;
  const nextName = name.trim();
  if (!nextName.length) throw new Error('Role name is required');

  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'events', eventId);
    const managerRef = doc(db, 'users', managerId);
    const [snap, managerSnap] = await Promise.all([tx.get(ref), tx.get(managerRef)]);
    if (!snap.exists()) throw new Error('Event not found');

    const event = snap.data() as Omit<DispatchEvent, 'id'>;
    const manager = managerSnap.exists() ? managerSnap.data() as Partial<UserProfile> : {};
    if (!canManagerManageEvent({
      eventManagerId: event.managerId,
      eventOrganizationId: event.organizationId,
      managerId,
      managerOrganizationId: manager.organizationId,
      managerRole: manager.role,
    })) throw new Error('Only a Manager in this event organization can edit roles');
    if (hasConcurrentEventChange(event.revision, params.expectedRevision)) {
      throw new Error('This event changed on another device. Review the latest version, then try your edit again.');
    }

    const roles = (event.roles || []) as EventRole[];
    if (!roles.some((role) => role.id === roleId)) throw new Error('Role not found');

    const nextRoles = roles.map((role) => sanitizeEventRoleForFirestore(
      role.id === roleId ? { ...role, name: nextName } : role,
      role.id === roleId && params.tasks ? params.tasks : role.tasks
    ));

    tx.update(ref, {
      roles: nextRoles,
      revision: (event.revision ?? 0) + 1,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function addEventRole(params: {
  eventId: string;
  managerId: string;
  name: string;
  tasks?: EventRole['tasks'];
  expectedRevision?: number;
}) {
  const name = params.name.trim();
  if (!name) throw new Error('Role name is required');
  const roleId = doc(collection(db, 'events')).id;

  await runTransaction(db, async (tx) => {
    const eventRef = doc(db, 'events', params.eventId);
    const managerRef = doc(db, 'users', params.managerId);
    const [eventSnap, managerSnap] = await Promise.all([tx.get(eventRef), tx.get(managerRef)]);
    if (!eventSnap.exists()) throw new Error('Event not found');

    const event = eventSnap.data() as Omit<DispatchEvent, 'id'>;
    const manager = managerSnap.exists() ? managerSnap.data() as Partial<UserProfile> : {};
    if (!canManagerManageEvent({
      eventManagerId: event.managerId,
      eventOrganizationId: event.organizationId,
      managerId: params.managerId,
      managerOrganizationId: manager.organizationId,
      managerRole: manager.role,
    })) throw new Error('Only a Manager in this event organization can add roles');
    if (hasConcurrentEventChange(event.revision, params.expectedRevision)) {
      throw new Error('This event changed on another device. Review the latest version, then add the role again.');
    }

    const startsAtMs = new Date(event.startsAt).getTime();
    const role = buildNewEventRoleForFirestore(
      roleId,
      name,
      params.tasks || [],
      Number.isFinite(startsAtMs) ? startsAtMs : Date.now()
    );
    tx.update(eventRef, {
      roles: [...(event.roles || []), role],
      revision: (event.revision ?? 0) + 1,
      updatedAt: serverTimestamp(),
    });
  });

  return roleId;
}

export async function deleteEventRole(params: {
  eventId: string;
  roleId: string;
  managerId: string;
}) {
  const { eventId, roleId, managerId } = params;

  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'events', eventId);
    const managerRef = doc(db, 'users', managerId);
    const [snap, managerSnap] = await Promise.all([tx.get(ref), tx.get(managerRef)]);
    if (!snap.exists()) throw new Error('Event not found');

    const event = snap.data() as Omit<DispatchEvent, 'id'>;
    const manager = managerSnap.exists() ? managerSnap.data() as Partial<UserProfile> : {};
    if (!canManagerManageEvent({
      eventManagerId: event.managerId,
      eventOrganizationId: event.organizationId,
      managerId,
      managerOrganizationId: manager.organizationId,
      managerRole: manager.role,
    })) throw new Error('Only a Manager in this event organization can delete roles');

    const roles = (event.roles || []) as EventRole[];
    if (!roles.some((role) => role.id === roleId)) throw new Error('Role not found');

    const { roles: nextRoles, workerIds } = removeEventRoleAndRebuildWorkers(roles, roleId);

    tx.update(ref, {
      roles: nextRoles,
      workerIds,
      revision: (event.revision ?? 0) + 1,
      updatedAt: serverTimestamp(),
    });
  });

  // Assignment notifications whose role no longer exists are filtered from
  // worker views by watchWorkerRoleAssignmentNotifications. Leaving the audit
  // records untouched avoids an unauthorized client-side update after the
  // role itself has already been removed successfully.
}

export async function cancelWorkerEventRole(params: {
  eventId: string;
  roleId: string;
  workerId: string;
}) {
  const { eventId, roleId, workerId } = params;

  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'events', eventId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Event not found');

    const event = snap.data() as Omit<DispatchEvent, 'id'>;
    const roles = (event.roles || []) as EventRole[];
    const role = roles.find((item) => item.id === roleId);
    if (!role) throw new Error('Role not found');

    const assignedWorkerIds = role.assignedWorkerIds || [];
    if (!assignedWorkerIds.includes(workerId)) throw new Error('You are not assigned to this role');

    const waitlistWorkerIds = role.waitlistWorkerIds || [];
    const waitlistInviteWorkerIds = waitlistWorkerIds.filter((id) => id !== workerId);
    const nextRoles = roles.map((item) => {
      if (item.id !== roleId) return item;

      const eligibleWaitlistWorkerIds = item.eligibleWaitlistWorkerIds || [];

      return {
        ...clearWorkerTaskCompletions(item, workerId),
        assignedWorkerIds: assignedWorkerIds.filter((id) => id !== workerId),
        openSlots: (item.openSlots || 0) + 1,
        waitlistWorkerIds: waitlistWorkerIds.filter((id) => id !== workerId),
        waitlistInviteWorkerIds: [...new Set([
          ...(item.waitlistInviteWorkerIds || []).filter((id) => id !== workerId),
          ...waitlistInviteWorkerIds,
        ])],
        eligibleWaitlistWorkerIds: eligibleWaitlistWorkerIds.includes(workerId)
          ? eligibleWaitlistWorkerIds
          : [...eligibleWaitlistWorkerIds, workerId],
      };
    });
    const workerIds = [...new Set(nextRoles.flatMap((item) => [
      ...(item.assignedWorkerIds || []),
      ...(item.waitlistWorkerIds || []),
      ...(item.eligibleWaitlistWorkerIds || []),
      ...(item.waitlistInviteWorkerIds || []),
    ]))];

    tx.update(ref, {
      roles: nextRoles,
      workerIds,
      revision: (event.revision ?? 0) + 1,
      updatedAt: serverTimestamp(),
    });

    const managerNotificationRef = doc(collection(db, 'userNotifications'));
    tx.set(managerNotificationRef, {
      userId: event.managerId,
      kind: 'worker_role_cancelled',
      title: 'Worker cancelled role',
      body: `${event.name}: a worker cancelled ${role.name}.`,
      relatedEventId: eventId,
      relatedRoleId: roleId,
      read: false,
      createdAt: serverTimestamp(),
    });

    waitlistInviteWorkerIds.forEach((waitlistWorkerId) => {
      const availableNotificationRef = doc(collection(db, 'userNotifications'));
      tx.set(availableNotificationRef, {
        userId: waitlistWorkerId,
        kind: 'role_available',
        title: 'Role available',
        body: `${event.name}: ${role.name} is available.`,
        relatedEventId: eventId,
        relatedRoleId: roleId,
        read: false,
        createdAt: serverTimestamp(),
      });
    });
  });
}

export async function joinRoleWaitlist(params: {
  notificationId: string;
  workerId: string;
}) {
  await runTransaction(db, async (tx) => {
    const notificationRef = doc(db, 'roleAssignmentNotifications', params.notificationId);
    const notificationSnap = await tx.get(notificationRef);
    if (!notificationSnap.exists()) throw new Error('Notification not found');

    const notification = notificationSnap.data() as Omit<RoleAssignmentNotification, 'id'>;
    if (notification.workerId !== params.workerId) throw new Error('You can only waitlist your own invite');
    if (notification.status !== 'pending' && notification.status !== 'declined') return;
    if (notification.action !== 'assign') throw new Error('Only assignment invites can be waitlisted');

    const eventRef = doc(db, 'events', notification.eventId);
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists()) throw new Error('Event not found');

    const event = eventSnap.data() as Omit<DispatchEvent, 'id'>;
    const roles = (event.roles || []) as EventRole[];
    const role = roles.find((item) => item.id === notification.roleId);
    if (!role) throw new Error('Role not found');
    if ((role.assignedWorkerIds || []).includes(params.workerId)) return;

    const waitlistWorkerIds = role.waitlistWorkerIds || [];
    const nextWaitlistWorkerIds = waitlistWorkerIds.includes(params.workerId)
      ? waitlistWorkerIds
      : [...waitlistWorkerIds, params.workerId];

    const nextRoles = roles.map((item) => (
      item.id === notification.roleId
        ? {
          ...item,
          waitlistWorkerIds: nextWaitlistWorkerIds,
          eligibleWaitlistWorkerIds: (item.eligibleWaitlistWorkerIds || []).filter((id) => id !== params.workerId),
          waitlistInviteWorkerIds: (item.waitlistInviteWorkerIds || []).filter((id) => id !== params.workerId),
        }
        : item
    ));
    const workerIds = [...new Set(nextRoles.flatMap((item) => [
      ...(item.assignedWorkerIds || []),
      ...(item.waitlistWorkerIds || []),
      ...(item.eligibleWaitlistWorkerIds || []),
      ...(item.waitlistInviteWorkerIds || []),
    ]))];

    tx.update(eventRef, { roles: nextRoles, workerIds, revision: (event.revision ?? 0) + 1, updatedAt: serverTimestamp() });

    tx.update(notificationRef, {
      status: 'waitlisted',
      statusReason: 'Worker joined the waitlist for this role.',
      waitlistedAt: serverTimestamp(),
    });
  });
}

export async function joinEventRoleWaitlist(params: {
  eventId: string;
  roleId: string;
  workerId: string;
}) {
  await runTransaction(db, async (tx) => {
    const eventRef = doc(db, 'events', params.eventId);
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists()) throw new Error('Event not found');

    const event = eventSnap.data() as Omit<DispatchEvent, 'id'>;
    const roles = (event.roles || []) as EventRole[];
    const role = roles.find((item) => item.id === params.roleId);
    if (!role) throw new Error('Role not found');
    if ((role.assignedWorkerIds || []).includes(params.workerId)) return;

    const waitlistWorkerIds = role.waitlistWorkerIds || [];
    const nextWaitlistWorkerIds = waitlistWorkerIds.includes(params.workerId)
      ? waitlistWorkerIds
      : [...waitlistWorkerIds, params.workerId];

    const nextRoles = roles.map((item) => (
      item.id === params.roleId
        ? {
          ...item,
          waitlistWorkerIds: nextWaitlistWorkerIds,
          eligibleWaitlistWorkerIds: (item.eligibleWaitlistWorkerIds || []).filter((id) => id !== params.workerId),
          waitlistInviteWorkerIds: (item.waitlistInviteWorkerIds || []).filter((id) => id !== params.workerId),
        }
        : item
    ));
    const workerIds = [...new Set(nextRoles.flatMap((item) => [
      ...(item.assignedWorkerIds || []),
      ...(item.waitlistWorkerIds || []),
      ...(item.eligibleWaitlistWorkerIds || []),
      ...(item.waitlistInviteWorkerIds || []),
    ]))];

    tx.update(eventRef, { roles: nextRoles, workerIds, revision: (event.revision ?? 0) + 1, updatedAt: serverTimestamp() });
  });
}

export async function acceptEventRoleWaitlistInvite(params: {
  eventId: string;
  roleId: string;
  workerId: string;
}) {
  await runTransaction(db, async (tx) => {
    const eventRef = doc(db, 'events', params.eventId);
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists()) throw new Error('Event not found');

    const event = eventSnap.data() as Omit<DispatchEvent, 'id'>;
    const roles = (event.roles || []) as EventRole[];
    const role = roles.find((item) => item.id === params.roleId);
    if (!role) throw new Error('Role not found');
    const alreadyAssignedToEvent = roles.some((item) => (item.assignedWorkerIds || []).includes(params.workerId));
    if (alreadyAssignedToEvent && !(role.assignedWorkerIds || []).includes(params.workerId)) {
      throw new Error('You already accepted a role for this event.');
    }
    const hasWaitlistInvite = (role.waitlistInviteWorkerIds || []).includes(params.workerId);
    const isWaitlisted = (role.waitlistWorkerIds || []).includes(params.workerId);
    const isWaitlistEligible = (role.eligibleWaitlistWorkerIds || []).includes(params.workerId);
    if (!hasWaitlistInvite && !isWaitlisted && !isWaitlistEligible) {
      throw new Error('This invite is no longer available.');
    }
    if ((role.assignedWorkerIds || []).includes(params.workerId)) return;

    const roleOpenSlots = getAvailableRoleSlots(role);
    if (roleOpenSlots <= 0) {
      const waitlistWorkerIds = role.waitlistWorkerIds || [];
      const nextWaitlistWorkerIds = waitlistWorkerIds.includes(params.workerId)
        ? waitlistWorkerIds
        : [...waitlistWorkerIds, params.workerId];

      const nextRoles = roles.map((item) => (
        item.id === params.roleId
          ? {
            ...item,
            waitlistWorkerIds: nextWaitlistWorkerIds,
            waitlistInviteWorkerIds: (item.waitlistInviteWorkerIds || []).filter((id) => id !== params.workerId),
            eligibleWaitlistWorkerIds: (item.eligibleWaitlistWorkerIds || []).filter((id) => id !== params.workerId),
          }
          : item
      ));
      const workerIds = [...new Set(nextRoles.flatMap((item) => [
        ...(item.assignedWorkerIds || []),
        ...(item.waitlistWorkerIds || []),
        ...(item.eligibleWaitlistWorkerIds || []),
        ...(item.waitlistInviteWorkerIds || []),
      ]))];

      tx.update(eventRef, { roles: nextRoles, workerIds, revision: (event.revision ?? 0) + 1, updatedAt: serverTimestamp() });
      return;
    }

    const workerSnap = await tx.get(doc(db, 'users', params.workerId));
    const workerName = workerSnap.exists()
      ? ((workerSnap.data() as Partial<UserProfile>).displayName || 'Worker')
      : 'Worker';
    const nextRoles = roles.map((item) => {
      if (item.id === params.roleId) {
        return {
          ...item,
          assignedWorkerIds: [...(item.assignedWorkerIds || []), params.workerId],
          waitlistWorkerIds: (item.waitlistWorkerIds || []).filter((id) => id !== params.workerId),
          waitlistInviteWorkerIds: (item.waitlistInviteWorkerIds || []).filter((id) => id !== params.workerId),
          eligibleWaitlistWorkerIds: (item.eligibleWaitlistWorkerIds || []).filter((id) => id !== params.workerId),
          openSlots: Math.max(0, getAvailableRoleSlots(item) - 1),
        };
      }

      return removeWorkerFromOtherRoleWaitlists(item, params.roleId, params.workerId);
    });
    const workerIds = [...new Set(nextRoles.flatMap((item) => [
      ...(item.assignedWorkerIds || []),
      ...(item.waitlistWorkerIds || []),
      ...(item.eligibleWaitlistWorkerIds || []),
      ...(item.waitlistInviteWorkerIds || []),
    ]))];

    tx.update(eventRef, { roles: nextRoles, workerIds, revision: (event.revision ?? 0) + 1, updatedAt: serverTimestamp() });

    const managerNotificationRef = doc(collection(db, 'userNotifications'));
    tx.set(managerNotificationRef, {
      userId: event.managerId,
      kind: 'role_invite_response',
      title: 'Waitlist invite accepted',
      body: `${workerName} accepted ${role.name} for ${event.name}.`,
      relatedEventId: params.eventId,
      relatedRoleId: params.roleId,
      read: false,
      createdAt: serverTimestamp(),
    });

  });

  await queueEventRoleReminderEmail({
    eventId: params.eventId,
    roleId: params.roleId,
    workerId: params.workerId,
  }).catch((error) => {
    console.warn('Dispatch event reminder email queue failed', error);
  });
}

export async function respondToRoleAssignmentNotification(params: {
  notificationId: string;
  workerId: string;
  response: 'accept' | 'decline';
}) {
  await runTransaction(db, async (tx) => {
    const notificationRef = doc(db, 'roleAssignmentNotifications', params.notificationId);
    const notificationSnap = await tx.get(notificationRef);
    if (!notificationSnap.exists()) throw new Error('Notification not found');

    const notification = notificationSnap.data() as Omit<RoleAssignmentNotification, 'id'>;
    if (notification.workerId !== params.workerId) throw new Error('You can only respond to your own notifications');
    if (notification.status !== 'pending') return;

    const eventRef = doc(db, 'events', notification.eventId);
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists()) throw new Error('Event not found');

    const event = eventSnap.data() as Omit<DispatchEvent, 'id'>;
    const workerSnap = await tx.get(doc(db, 'users', params.workerId));
    const workerName = workerSnap.exists()
      ? ((workerSnap.data() as Partial<UserProfile>).displayName || 'Worker')
      : 'Worker';
    let nextRoles = (event.roles || []) as EventRole[];
    const notificationRole = nextRoles.find((role) => role.id === notification.roleId);
    const roleName = notificationRole?.name || notification.roleName || 'role';

    if (notification.action === 'assign' && params.response === 'accept') {
      const targetRole = notificationRole;
      if (!targetRole) throw new Error('Role not found');
      const alreadyAssigned = (targetRole.assignedWorkerIds || []).includes(params.workerId);
      const alreadyAssignedToEvent = nextRoles.some((role) => (role.assignedWorkerIds || []).includes(params.workerId));
      if (alreadyAssignedToEvent && !alreadyAssigned) {
        throw new Error('You already accepted a role for this event.');
      }
      if (!alreadyAssigned && getAvailableRoleSlots(targetRole) <= 0) {
        throw new Error('This role is full. Join the waitlist instead.');
      }

      nextRoles = nextRoles.map((role) => {
        if (role.id !== notification.roleId) {
          return removeWorkerFromOtherRoleWaitlists(role, notification.roleId, params.workerId);
        }

        const assignedWorkerIds = role.assignedWorkerIds || [];
        if (assignedWorkerIds.includes(params.workerId)) return role;

        return {
          ...role,
          assignedWorkerIds: [...assignedWorkerIds, params.workerId],
          waitlistWorkerIds: (role.waitlistWorkerIds || []).filter((id) => id !== params.workerId),
          eligibleWaitlistWorkerIds: (role.eligibleWaitlistWorkerIds || []).filter((id) => id !== params.workerId),
          waitlistInviteWorkerIds: (role.waitlistInviteWorkerIds || []).filter((id) => id !== params.workerId),
          openSlots: Math.max(0, getAvailableRoleSlots(role) - 1),
        };
      });

      const workerIds = [...new Set(nextRoles.flatMap((role) => [
        ...(role.assignedWorkerIds || []),
        ...(role.waitlistWorkerIds || []),
        ...(role.eligibleWaitlistWorkerIds || []),
        ...(role.waitlistInviteWorkerIds || []),
      ]))];
      tx.update(eventRef, { roles: nextRoles, workerIds, revision: (event.revision ?? 0) + 1, updatedAt: serverTimestamp() });
    }

    if (notification.action === 'assign' && params.response === 'decline') {
      nextRoles = nextRoles.map((role) => {
        if (role.id !== notification.roleId) return role;

        const eligibleWaitlistWorkerIds = role.eligibleWaitlistWorkerIds || [];

        return {
          ...role,
          assignedWorkerIds: (role.assignedWorkerIds || []).filter((id) => id !== params.workerId),
          waitlistWorkerIds: (role.waitlistWorkerIds || []).filter((id) => id !== params.workerId),
          waitlistInviteWorkerIds: (role.waitlistInviteWorkerIds || []).filter((id) => id !== params.workerId),
          eligibleWaitlistWorkerIds: eligibleWaitlistWorkerIds.includes(params.workerId)
            ? eligibleWaitlistWorkerIds
            : [...eligibleWaitlistWorkerIds, params.workerId],
        };
      });

      const workerIds = [...new Set(nextRoles.flatMap((role) => [
        ...(role.assignedWorkerIds || []),
        ...(role.waitlistWorkerIds || []),
        ...(role.eligibleWaitlistWorkerIds || []),
        ...(role.waitlistInviteWorkerIds || []),
      ]))];
      tx.update(eventRef, { roles: nextRoles, workerIds, revision: (event.revision ?? 0) + 1, updatedAt: serverTimestamp() });
    }

    if (notification.action === 'remove' && params.response === 'decline') {
      nextRoles = nextRoles.map((role) => {
        if (role.id !== notification.roleId) return role;

        const assignedWorkerIds = role.assignedWorkerIds || [];
        if (assignedWorkerIds.includes(params.workerId)) return role;

        return {
          ...role,
          assignedWorkerIds: [...assignedWorkerIds, params.workerId],
          openSlots: Math.max(0, (role.openSlots || 0) - 1),
        };
      });

      const workerIds = [...new Set(nextRoles.flatMap((role) => role.assignedWorkerIds || []))];
      tx.update(eventRef, { roles: nextRoles, workerIds, revision: (event.revision ?? 0) + 1, updatedAt: serverTimestamp() });
    }

    tx.update(notificationRef, {
      status: params.response === 'accept' ? 'accepted' : 'declined',
      statusReason:
        params.response === 'accept'
          ? 'Worker accepted this role assignment update.'
          : 'Worker declined this role assignment update.',
      respondedAt: serverTimestamp(),
      response: params.response,
    });

    const managerNotificationRef = doc(collection(db, 'userNotifications'));
    tx.set(managerNotificationRef, {
      userId: notification.managerId,
      kind: 'role_invite_response',
      title: params.response === 'accept' ? 'Role invite accepted' : 'Role invite declined',
      body: `${workerName} ${params.response === 'accept' ? 'accepted' : 'declined'} ${roleName} for ${event.name}.`,
      relatedEventId: notification.eventId,
      relatedRoleId: notification.roleId,
      sourceNotificationId: params.notificationId,
      read: false,
      createdAt: serverTimestamp(),
    });
  });

  if (params.response === 'accept') {
    try {
      const acceptedNotificationRef = doc(db, 'roleAssignmentNotifications', params.notificationId);
      const acceptedNotificationSnap = await getDoc(acceptedNotificationRef);
      if (!acceptedNotificationSnap.exists()) return;

      const acceptedNotification = acceptedNotificationSnap.data() as Partial<RoleAssignmentNotification>;
      if (acceptedNotification.action !== 'assign' || !acceptedNotification.eventId || !acceptedNotification.roleId) return;

      await queueEventRoleReminderEmail({
        eventId: acceptedNotification.eventId,
        roleId: acceptedNotification.roleId,
        workerId: params.workerId,
      }).catch((error) => {
        console.warn('Dispatch event reminder email queue failed', error);
      });
    } catch (error) {
      console.warn('Dispatch event reminder email queue failed', error);
    }
  }
}

export async function toggleTaskCompletion(params: {
  eventId: string;
  roleId: string;
  taskId: string;
  workerId: string;
  complete: boolean;
}) {
  const { eventId, roleId, taskId, workerId, complete } = params;

  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'events', eventId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Event not found');

    const event = snap.data() as Omit<DispatchEvent, 'id'>;
    const roles = (event.roles || []) as EventRole[];

    const nextRoles = roles.map((role) => {
      if (role.id !== roleId) return role;

      const nextTasks = role.tasks.map((task) => {
        if (task.id !== taskId) return task;
        const completedBy = task.completedBy ?? [];

        if (complete && !completedBy.includes(workerId)) {
          return { ...task, completedBy: [...completedBy, workerId] };
        }

        if (!complete && completedBy.includes(workerId)) {
          return { ...task, completedBy: completedBy.filter((id) => id !== workerId) };
        }

        return task;
      });

      return { ...role, tasks: nextTasks };
    });

    tx.update(ref, { roles: nextRoles, revision: (event.revision ?? 0) + 1, updatedAt: serverTimestamp() });
  });
}

export async function seedDemoData(profile: UserProfile) {
  const now = new Date();
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const managerId = profile.role === 'manager' ? profile.uid : `demo-manager-${profile.uid.slice(-6)}`;
  const workerIds = profile.role === 'worker' ? [profile.uid] : [`demo-worker-a-${profile.uid.slice(-4)}`, `demo-worker-b-${profile.uid.slice(-4)}`];

  const teamAId = `demo-team-core-${profile.uid}`;
  const teamBId = `demo-team-support-${profile.uid}`;
  const eventTodayId = `demo-event-today-${profile.uid}`;
  const eventTomorrowId = `demo-event-tomorrow-${profile.uid}`;

  const batch = writeBatch(db);

  batch.set(doc(db, 'teams', teamAId), {
    managerId,
    name: 'Core Event Crew',
    workerIds,
  });

  batch.set(doc(db, 'teams', teamBId), {
    managerId,
    name: 'Support Team',
    workerIds,
  });

  batch.set(doc(db, 'events', eventTodayId), {
    managerId,
    workerIds,
    name: 'Downtown Promo Activation',
    location: 'Calgary Tower Plaza',
    startsAt: now.toISOString(),
    endsAt: inTwoHours.toISOString(),
    teamIds: [teamAId],
    roles: [
      {
        id: 'lead',
        name: 'Team Lead',
        assignedWorkerIds: workerIds.slice(0, 1),
        openSlots: 0,
        tasks: [
          { id: 'brief', name: 'Run pre-shift briefing', completedBy: [] },
          { id: 'setup', name: 'Confirm booth setup and signage', completedBy: [] },
        ],
      },
      {
        id: 'support',
        name: 'Support Rep',
        assignedWorkerIds: workerIds,
        openSlots: 1,
        tasks: [
          { id: 'stock', name: 'Restock promo materials', completedBy: [] },
          { id: 'photo', name: 'Capture event photos', optional: true, completedBy: [] },
        ],
      },
    ],
  });

  batch.set(doc(db, 'events', eventTomorrowId), {
    managerId,
    workerIds,
    name: 'Mall Brand Pop-up',
    location: 'Chinook Centre',
    startsAt: tomorrow.toISOString(),
    endsAt: new Date(tomorrow.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    teamIds: [teamAId, teamBId],
    roles: [
      {
        id: 'greeter',
        name: 'Greeter',
        assignedWorkerIds: workerIds,
        openSlots: 0,
        tasks: [
          { id: 'checkin', name: 'Open check-in station', completedBy: [] },
          { id: 'handoff', name: 'Handoff lead list to manager', completedBy: [] },
        ],
      },
    ],
  });

  batch.set(doc(db, 'chatUnread', `demo-unread-${profile.uid}-${teamAId}`), {
    userId: profile.uid,
    teamId: teamAId,
    unreadCount: 3,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'chatUnread', `demo-unread-${profile.uid}-${teamBId}`), {
    userId: profile.uid,
    teamId: teamBId,
    unreadCount: 1,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}
