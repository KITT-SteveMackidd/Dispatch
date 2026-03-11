import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
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
import { db } from '@/lib/firebase';
import { DispatchEvent, EventRole, EventTemplate, EventTemplateRole, Team, UserProfile } from '@/types/dispatch';

export type TeamUnreadCount = {
  teamId: string;
  unreadCount: number;
};

export type PersistedChatMessage = {
  id: string;
  senderId: string;
  text: string;
  createdAt?: { toDate?: () => Date } | Date | null;
};

export type RoleAssignmentNotification = {
  id: string;
  workerId: string;
  managerId: string;
  eventId: string;
  roleId: string;
  eventName?: string;
  action: 'assign' | 'remove';
  status: 'pending' | 'accepted' | 'declined';
  statusReason?: string;
  createdAt?: { toDate?: () => Date } | Date | null;
};

export type UserNotification = {
  id: string;
  userId: string;
  kind: 'role_invite_response' | 'task_behind_schedule';
  title: string;
  body: string;
  relatedEventId?: string;
  relatedRoleId?: string;
  relatedTaskId?: string;
  read: boolean;
  createdAt?: { toDate?: () => Date } | Date | null;
};

export type CreateEventRoleInput = {
  id: string;
  name: string;
  assignedWorkerId?: string | null;
  tasks?: Array<{ id: string; name: string; expectedOffsetMinutes?: number; optional?: boolean }>;
};

export type UpsertEventTemplateInput = {
  name: string;
  roles: EventTemplateRole[];
  defaultLocation?: string;
  defaultTime?: string;
  defaultDescription?: string;
};

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

export function watchChatMessages(threadId: string, cb: (items: PersistedChatMessage[]) => void) {
  const q = query(collection(db, 'chatThreads', threadId, 'messages'), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => {
    const messages = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PersistedChatMessage, 'id'>) }));
    cb(messages);
  });
}

export async function sendChatMessage(params: {
  threadId: string;
  teamId?: string;
  senderId: string;
  recipientIds: string[];
  text: string;
}) {
  const text = params.text.trim();
  if (!text) return;

  await addDoc(collection(db, 'chatThreads', params.threadId, 'messages'), {
    senderId: params.senderId,
    text,
    createdAt: serverTimestamp(),
  });

  await setDoc(
    doc(db, 'chatThreads', params.threadId),
    {
      id: params.threadId,
      teamId: params.teamId || null,
      participants: [params.senderId, ...params.recipientIds],
      lastMessageText: text,
      lastMessageSenderId: params.senderId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  if (params.teamId) {
    const recipientIds = [...new Set(params.recipientIds.filter((id) => id && id !== params.senderId))];
    await Promise.all(
      recipientIds.map((userId) =>
        setDoc(
          doc(db, 'chatUnread', `${userId}__${params.teamId}`),
          {
            userId,
            teamId: params.teamId,
            unreadCount: increment(1),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      )
    );
  }
}

export async function markTeamChatRead(params: { userId: string; teamId: string }) {
  await setDoc(
    doc(db, 'chatUnread', `${params.userId}__${params.teamId}`),
    {
      userId: params.userId,
      teamId: params.teamId,
      unreadCount: 0,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

function mapEvents(snap: { docs: Array<{ id: string; data: () => unknown }> }): DispatchEvent[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DispatchEvent, 'id'>) }));
}

function mapTeams(snap: { docs: Array<{ id: string; data: () => unknown }> }): Team[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Team, 'id'>) }));
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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getInviteAppLink() {
  return process.env.EXPO_PUBLIC_APP_INVITE_URL?.trim() || 'https://dispatchapp.ca/download';
}

async function ensureManagerWorkerThread(params: { managerId: string; workerId: string; teamId: string }) {
  const threadId = [params.managerId, params.workerId].sort().join('__');
  await setDoc(
    doc(db, 'chatThreads', threadId),
    {
      id: threadId,
      managerId: params.managerId,
      workerId: params.workerId,
      teamId: params.teamId,
      participants: [params.managerId, params.workerId],
      updatedAt: serverTimestamp(),
      createdByInvite: true,
    },
    { merge: true }
  );
}

export function watchManagerEvents(managerId: string, cb: (items: DispatchEvent[]) => void) {
  const q = query(collection(db, 'events'), where('managerId', '==', managerId));
  return onSnapshot(q, (snap) => cb(sortDispatchEvents(mapEvents(snap))));
}

export function watchWorkerEvents(workerId: string, cb: (items: DispatchEvent[]) => void) {
  const q = query(collection(db, 'events'), where('workerIds', 'array-contains', workerId));
  return onSnapshot(q, (snap) => cb(sortDispatchEvents(mapEvents(snap))));
}

export function watchManagerTeams(managerId: string, cb: (items: Team[]) => void) {
  const q = query(collection(db, 'teams'), where('managerId', '==', managerId));
  return onSnapshot(q, (snap) => cb(mapTeams(snap)));
}

function mapEventTemplates(snap: { docs: Array<{ id: string; data: () => unknown }> }): EventTemplate[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EventTemplate, 'id'>) }));
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
  return onSnapshot(q, (snap) => {
    const notifications = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<RoleAssignmentNotification, 'id'>) }))
      .filter((item) => item.status === 'pending')
      .sort((a, b) => {
        const aTime = a.createdAt && 'toDate' in a.createdAt && typeof a.createdAt.toDate === 'function'
          ? a.createdAt.toDate().getTime()
          : 0;
        const bTime = b.createdAt && 'toDate' in b.createdAt && typeof b.createdAt.toDate === 'function'
          ? b.createdAt.toDate().getTime()
          : 0;
        return bTime - aTime;
      });

    cb(notifications);
  });
}

export async function createDispatchEvent(params: {
  managerId: string;
  name: string;
  date: string;
  time: string;
  location: string;
  description: string;
  roles: CreateEventRoleInput[];
}): Promise<DispatchEvent> {
  const startsAt = new Date(`${params.date.trim()}T${params.time.trim()}:00`);
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error('Enter a valid event date and time.');
  }

  const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
  const roles = params.roles.map((role) => {
    const assignedWorkerIds = role.assignedWorkerId ? [role.assignedWorkerId] : [];
    return {
      id: role.id,
      name: role.name,
      assignedWorkerIds,
      openSlots: assignedWorkerIds.length ? 0 : 1,
      tasks: (role.tasks || []).map((task) => ({
        id: task.id,
        name: task.name,
        expectedOffsetMinutes: Math.max(0, Math.round(task.expectedOffsetMinutes || 0)),
        dueAt: new Date(startsAt.getTime() + Math.max(0, Math.round(task.expectedOffsetMinutes || 0)) * 60 * 1000).toISOString(),
        optional: !!task.optional,
        completedBy: [],
      })),
    } satisfies EventRole;
  });

  const workerIds = [...new Set(roles.flatMap((role) => role.assignedWorkerIds || []))];

  const eventPayload = {
    managerId: params.managerId,
    workerIds,
    name: params.name.trim(),
    location: params.location.trim(),
    description: params.description.trim(),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    teamIds: [],
    roles,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(collection(db, 'events'), eventPayload);

  return {
    id: docRef.id,
    managerId: eventPayload.managerId,
    name: eventPayload.name,
    location: eventPayload.location,
    startsAt: eventPayload.startsAt,
    endsAt: eventPayload.endsAt,
    teamIds: eventPayload.teamIds,
    roles: eventPayload.roles,
  };
}

export async function deleteDispatchEvent(params: { eventId: string; managerId: string }) {
  const ref = doc(db, 'events', params.eventId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const event = snap.data() as Omit<DispatchEvent, 'id'>;
  if (event.managerId !== params.managerId) throw new Error('Only the event manager can delete this event');

  await deleteDoc(ref);
}

export async function loadWorkerTeams(workerId: string): Promise<Team[]> {
  const q = query(collection(db, 'teams'), where('workerIds', 'array-contains', workerId));
  const snap = await getDocs(q);
  return mapTeams(snap);
}


export function watchUserTeamUnreadCounts(userId: string, cb: (items: TeamUnreadCount[]) => void) {
  const q = query(collection(db, 'chatUnread'), where('userId', '==', userId));
  return onSnapshot(q, (snap) => {
    const items = snap.docs
      .map((d) => {
        const data = d.data() as Partial<{ teamId: string; unreadCount: number }>;
        if (!data.teamId) return null;
        return {
          teamId: data.teamId,
          unreadCount: Math.max(0, Number(data.unreadCount ?? 0)),
        } satisfies TeamUnreadCount;
      })
      .filter((item): item is TeamUnreadCount => !!item);

    cb(items);
  });
}

export function watchUserUnreadNotificationCount(userId: string, cb: (count: number) => void) {
  const q = query(collection(db, 'userNotifications'), where('userId', '==', userId), where('read', '==', false));
  return onSnapshot(q, (snap) => cb(snap.docs.length));
}

export function watchUserNotifications(userId: string, cb: (items: UserNotification[]) => void) {
  const q = query(collection(db, 'userNotifications'), where('userId', '==', userId), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UserNotification, 'id'>) }));
    cb(items);
  });
}

export async function markUserNotificationsRead(params: { userId: string; notificationIds: string[] }) {
  const ids = [...new Set(params.notificationIds.filter(Boolean))];
  if (!ids.length) return;

  await runTransaction(db, async (tx) => {
    for (const id of ids) {
      const ref = doc(db, 'userNotifications', id);
      const snap = await tx.get(ref);
      if (!snap.exists()) continue;

      const data = snap.data() as Partial<UserNotification>;
      if (data.userId !== params.userId || data.read) continue;

      tx.update(ref, {
        read: true,
        readAt: serverTimestamp(),
      });
    }
  });
}

export async function ensureTaskBehindScheduleNotification(params: {
  managerId: string;
  eventId: string;
  eventName: string;
  roleId: string;
  roleName: string;
  taskId: string;
  taskName: string;
  dueAt: string;
}) {
  const notificationId = `behind_schedule__${params.eventId}__${params.roleId}__${params.taskId}`;

  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'userNotifications', notificationId);
    const snap = await tx.get(ref);
    if (snap.exists()) return;

    tx.set(ref, {
      userId: params.managerId,
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
}

export async function createTeam(managerId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Team name is required');

  await addDoc(collection(db, 'teams'), {
    managerId,
    name: trimmed,
    workerIds: [],
  });
}

export async function inviteWorkerToTeam(params: { managerId: string; teamId: string; email: string }) {
  const { managerId, teamId, email } = params;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Worker email is required');
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error('Enter a valid email address');

  const teamRef = doc(db, 'teams', teamId);
  const teamSnap = await getDoc(teamRef);
  if (!teamSnap.exists()) throw new Error('Team not found');

  const team = teamSnap.data() as Omit<Team, 'id'>;
  if (team.managerId !== managerId) throw new Error('Only the team manager can invite workers');

  const appLink = (process.env.EXPO_PUBLIC_DISPATCH_APP_LINK || '').trim() || 'https://dispatch.app/download';
  const inviteRef = await addDoc(collection(db, 'workerInvites'), {
    managerId,
    teamId,
    teamName: team.name,
    email: normalizedEmail,
    appLink,
    workerId: null,
    status: 'pending',
    statusReason: 'Pending account creation/login acceptance.',
    createdAt: serverTimestamp(),
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

    await updateDoc(inviteRef, {
      status: delivery.status,
      statusReason: delivery.reason,
      sentAt: serverTimestamp(),
      emailDelivery: delivery.via,
    });

    return { inviteId: inviteRef.id, queued: delivery.status !== 'sent', via: delivery.via };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Invite email transport failed';
    await updateDoc(inviteRef, {
      status: 'send_failed',
      statusReason: `Invite saved but delivery failed: ${reason}`,
      deliveryErrorAt: serverTimestamp(),
    });
    throw new Error(`Invite saved, but delivery failed: ${reason}`);
  }
}

async function sendInviteEmail(params: {
  email: string;
  teamName: string;
  appLink: string;
  inviteId: string;
  managerId: string;
  teamId: string;
}): Promise<{ status: 'sent' | 'queued'; reason: string; via: 'http-endpoint' | 'firebase-mail-collection' }> {
  const endpoint = (process.env.EXPO_PUBLIC_INVITE_EMAIL_ENDPOINT || '').trim();

  if (endpoint) {
    const token = (process.env.EXPO_PUBLIC_INVITE_EMAIL_BEARER_TOKEN || '').trim();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        type: 'dispatch-worker-invite',
        to: params.email,
        teamName: params.teamName,
        appLink: params.appLink,
        inviteId: params.inviteId,
        managerId: params.managerId,
        teamId: params.teamId,
      }),
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(raw || `Transport HTTP ${response.status}`);
    }

    return {
      status: 'sent',
      reason: 'Invite email delivered through configured HTTP endpoint.',
      via: 'http-endpoint',
    };
  }

  const collectionName = (process.env.EXPO_PUBLIC_INVITE_EMAIL_COLLECTION || '').trim() || 'mail';
  await addDoc(collection(db, collectionName), {
    to: [params.email],
    message: {
      subject: `You are invited to join ${params.teamName} on Dispatch`,
      text: `You have been invited to join ${params.teamName} on Dispatch. Download the app and sign in with this email to connect with your manager automatically: ${params.appLink}`,
      html: `<p>You have been invited to join <strong>${params.teamName}</strong> on Dispatch.</p><p><a href="${params.appLink}">Download the app</a> and sign in with <strong>${params.email}</strong> to connect with your manager automatically.</p>`,
    },
    dispatchInvite: {
      inviteId: params.inviteId,
      managerId: params.managerId,
      teamId: params.teamId,
      teamName: params.teamName,
      appLink: params.appLink,
      email: params.email,
    },
    createdAt: serverTimestamp(),
  });

  return {
    status: 'queued',
    reason: `Invite email queued in Firestore collection "${collectionName}" for delivery worker.`,
    via: 'firebase-mail-collection',
  };
}

export async function acceptPendingInvitesForUser(params: { userId: string; email: string }) {
  const normalizedEmail = params.email.trim().toLowerCase();
  if (!normalizedEmail) return;

  const inviteStatuses = ['pending', 'queued', 'sent', 'send_failed'] as const;

  for (const status of inviteStatuses) {
    const invitesSnap = await getDocs(
      query(
        collection(db, 'workerInvites'),
        where('email', '==', normalizedEmail),
        where('status', '==', status)
      )
    );

    for (const inviteDoc of invitesSnap.docs) {
      const invite = inviteDoc.data() as {
        teamId?: string;
        managerId?: string;
      };

      if (!invite.teamId || !invite.managerId) continue;

      await updateDoc(doc(db, 'teams', invite.teamId), {
        workerIds: arrayUnion(params.userId),
      });

      await updateDoc(inviteDoc.ref, {
        workerId: params.userId,
        status: 'accepted',
        statusReason: 'Accepted automatically after worker sign-in.',
        acceptedAt: serverTimestamp(),
      });

      await ensureManagerWorkerThread({
        managerId: invite.managerId,
        workerId: params.userId,
        teamId: invite.teamId,
      });
    }
  }
}

export async function inviteWorkerByEmailToTeam(params: {
  managerId: string;
  teamId: string;
  email: string;
  managerName?: string;
}) {
  const { managerId, teamId, managerName } = params;
  const normalizedEmail = normalizeEmail(params.email);
  if (!normalizedEmail) throw new Error('Worker email is required');
  if (!isValidEmail(normalizedEmail)) throw new Error('Enter a valid email address');

  const usersSnap = await getDocs(query(
    collection(db, 'users'),
    where('email', '==', normalizedEmail),
    where('role', '==', 'worker')
  ));

  const foundWorker = usersSnap.docs[0];
  const foundWorkerId = foundWorker?.id;

  await runTransaction(db, async (tx) => {
    const teamRef = doc(db, 'teams', teamId);
    const teamSnap = await tx.get(teamRef);

    if (!teamSnap.exists()) throw new Error('Team not found');

    const team = teamSnap.data() as Omit<Team, 'id'>;
    if (team.managerId !== managerId) throw new Error('Only the team manager can invite workers');

    if (foundWorkerId) {
      const nextWorkerIds = [...new Set([...(team.workerIds || []), foundWorkerId])];
      tx.update(teamRef, { workerIds: nextWorkerIds });

      const threadId = [managerId, foundWorkerId].sort().join('__');
      tx.set(
        doc(db, 'chatThreads', threadId),
        {
          id: threadId,
          managerId,
          workerId: foundWorkerId,
          teamId,
          participants: [managerId, foundWorkerId],
          updatedAt: serverTimestamp(),
          createdByInvite: true,
        },
        { merge: true }
      );
    }
  });

  await addDoc(collection(db, 'workerInvites'), {
    managerId,
    teamId,
    email: normalizedEmail,
    workerId: foundWorkerId || null,
    status: foundWorkerId ? 'linked' : 'pending',
    createdAt: serverTimestamp(),
  });

  const appLink = getInviteAppLink();
  const inviterLabel = managerName?.trim() || 'A Dispatch manager';

  await addDoc(collection(db, 'mail'), {
    to: [normalizedEmail],
    message: {
      subject: `${inviterLabel} invited you to Dispatch`,
      text: `${inviterLabel} invited you to join Dispatch. Download the app and sign in with this email to get connected automatically: ${appLink}`,
      html: `<p>${inviterLabel} invited you to join Dispatch.</p><p>Download the app and sign in with this email to get connected automatically.</p><p><a href="${appLink}">Open Dispatch app link</a></p>`,
    },
    createdAt: serverTimestamp(),
  });

  return { linked: !!foundWorkerId };
}

export async function linkPendingEmailInvites(params: { workerId: string; email: string }) {
  const normalizedEmail = normalizeEmail(params.email);
  if (!normalizedEmail) return;

  const invitesSnap = await getDocs(query(
    collection(db, 'workerInvites'),
    where('email', '==', normalizedEmail),
    where('status', '==', 'pending')
  ));

  if (!invitesSnap.docs.length) return;

  await runTransaction(db, async (tx) => {
    for (const inviteDoc of invitesSnap.docs) {
      const invite = inviteDoc.data() as { teamId?: string; managerId?: string };
      if (!invite.teamId || !invite.managerId) continue;

      const teamRef = doc(db, 'teams', invite.teamId);
      const teamSnap = await tx.get(teamRef);
      if (!teamSnap.exists()) continue;

      const team = teamSnap.data() as Omit<Team, 'id'>;
      const nextWorkerIds = [...new Set([...(team.workerIds || []), params.workerId])];
      tx.update(teamRef, { workerIds: nextWorkerIds });

      tx.update(inviteDoc.ref, {
        workerId: params.workerId,
        status: 'linked',
        linkedAt: serverTimestamp(),
      });

      const threadId = [invite.managerId, params.workerId].sort().join('__');
      tx.set(
        doc(db, 'chatThreads', threadId),
        {
          id: threadId,
          managerId: invite.managerId,
          workerId: params.workerId,
          teamId: invite.teamId,
          participants: [invite.managerId, params.workerId],
          updatedAt: serverTimestamp(),
          createdByInvite: true,
        },
        { merge: true }
      );
    }
  });
}

export async function loadUserProfilesByIds(userIds: string[]): Promise<UserProfile[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));

  const snapshots = await Promise.all(
    chunks.map((chunk) =>
      getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk)))
    )
  );

  return snapshots.flatMap((snap) =>
    snap.docs.map((d) => {
      const data = d.data() as Partial<UserProfile>;
      return {
        uid: d.id,
        displayName: data.displayName || 'Dispatch User',
        role: (data.role as UserProfile['role']) || 'worker',
        phoneNumber: data.phoneNumber,
        avatarUrl: data.avatarUrl,
      };
    })
  );
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
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Event not found');

    const event = snap.data() as Omit<DispatchEvent, 'id'>;
    if (event.managerId !== managerId) throw new Error('Only the event manager can change role assignments');

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
      nextRoles = roles.map((item) => {
        if (item.id !== roleId) return item;
        return {
          ...item,
          assignedWorkerIds: assignedWorkerIds.filter((id) => id !== workerId),
          openSlots: (item.openSlots || 0) + 1,
        };
      });

      const workerIds = [...new Set(nextRoles.flatMap((item) => item.assignedWorkerIds || []))];
      tx.update(ref, {
        roles: nextRoles,
        workerIds,
        updatedAt: serverTimestamp(),
      });
    }

    const notificationRef = doc(collection(db, 'roleAssignmentNotifications'));
    tx.set(notificationRef, {
      workerId,
      managerId,
      eventId,
      roleId,
      eventName: event.name,
      action,
      status: 'pending',
      statusReason:
        action === 'assign'
          ? 'Worker must accept or decline this role assignment before it is finalized.'
          : 'Worker must accept or decline this role removal update.',
      responseOptions: ['accept', 'decline'],
      createdAt: serverTimestamp(),
    });
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
    let nextRoles = (event.roles || []) as EventRole[];

    if (notification.action === 'assign' && params.response === 'accept') {
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
      tx.update(eventRef, { roles: nextRoles, workerIds, updatedAt: serverTimestamp() });
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
      tx.update(eventRef, { roles: nextRoles, workerIds, updatedAt: serverTimestamp() });
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
      body: `${event.name}: worker ${params.response === 'accept' ? 'accepted' : 'declined'} role update.`,
      relatedEventId: notification.eventId,
      relatedRoleId: notification.roleId,
      sourceNotificationId: params.notificationId,
      read: false,
      createdAt: serverTimestamp(),
    });
  });

  if (params.response === 'accept') {
    const acceptedNotificationRef = doc(db, 'roleAssignmentNotifications', params.notificationId);
    const acceptedNotificationSnap = await getDoc(acceptedNotificationRef);
    if (!acceptedNotificationSnap.exists()) return;

    const acceptedNotification = acceptedNotificationSnap.data() as Partial<RoleAssignmentNotification>;
    if (acceptedNotification.action !== 'assign' || !acceptedNotification.eventId || !acceptedNotification.roleId) return;

    const competingNotifications = await getDocs(
      query(
        collection(db, 'roleAssignmentNotifications'),
        where('eventId', '==', acceptedNotification.eventId),
        where('roleId', '==', acceptedNotification.roleId),
        where('action', '==', 'assign'),
        where('status', '==', 'pending')
      )
    );

    await Promise.all(
      competingNotifications.docs
        .filter((docSnap) => docSnap.id !== params.notificationId)
        .map((docSnap) =>
          updateDoc(docSnap.ref, {
            status: 'declined',
            statusReason: 'Role accepted by another worker; this competing invite was removed.',
            respondedAt: serverTimestamp(),
            response: 'decline',
          })
        )
    );
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

    tx.update(ref, { roles: nextRoles });
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
