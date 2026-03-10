import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DispatchEvent, EventRole, Team, UserProfile } from '@/types/dispatch';

export type TeamUnreadCount = {
  teamId: string;
  unreadCount: number;
};

function mapEvents(snap: { docs: Array<{ id: string; data: () => unknown }> }): DispatchEvent[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DispatchEvent, 'id'>) }));
}

function mapTeams(snap: { docs: Array<{ id: string; data: () => unknown }> }): Team[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Team, 'id'>) }));
}

function sortByStartAsc(items: DispatchEvent[]) {
  return [...items].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
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

export function watchManagerEvents(managerId: string, cb: (items: DispatchEvent[]) => void) {
  const q = query(collection(db, 'events'), where('managerId', '==', managerId));
  return onSnapshot(q, (snap) => cb(sortByStartAsc(mapEvents(snap))));
}

export function watchWorkerEvents(workerId: string, cb: (items: DispatchEvent[]) => void) {
  const q = query(collection(db, 'events'), where('workerIds', 'array-contains', workerId));
  return onSnapshot(q, (snap) => cb(sortByStartAsc(mapEvents(snap))));
}

export function watchManagerTeams(managerId: string, cb: (items: Team[]) => void) {
  const q = query(collection(db, 'teams'), where('managerId', '==', managerId));
  return onSnapshot(q, (snap) => cb(mapTeams(snap)));
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

      const threadId = [invite.managerId, params.userId].sort().join('__');
      await setDoc(
        doc(db, 'chatThreads', threadId),
        {
          id: threadId,
          managerId: invite.managerId,
          workerId: params.userId,
          teamId: invite.teamId,
          participants: [invite.managerId, params.userId],
          updatedAt: serverTimestamp(),
          createdByInvite: true,
        },
        { merge: true }
      );
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
      const invite = inviteDoc.data() as { teamId?: string };
      if (!invite.teamId) continue;

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
    let assignmentChanged = false;

    const nextRoles = roles.map((role) => {
      if (role.id !== roleId) return role;

      const assignedWorkerIds = role.assignedWorkerIds || [];
      const alreadyAssigned = assignedWorkerIds.includes(workerId);

      if (action === 'assign' && !alreadyAssigned) {
        assignmentChanged = true;
        return {
          ...role,
          assignedWorkerIds: [...assignedWorkerIds, workerId],
          openSlots: Math.max(0, (role.openSlots || 0) - 1),
        };
      }

      if (action === 'remove' && alreadyAssigned) {
        assignmentChanged = true;
        return {
          ...role,
          assignedWorkerIds: assignedWorkerIds.filter((id) => id !== workerId),
          openSlots: (role.openSlots || 0) + 1,
        };
      }

      return role;
    });

    if (!assignmentChanged) return;

    const workerIds = [...new Set(nextRoles.flatMap((role) => role.assignedWorkerIds || []))];

    tx.update(ref, {
      roles: nextRoles,
      workerIds,
      updatedAt: serverTimestamp(),
    });

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
          ? 'Worker must accept or decline this role assignment.'
          : 'Worker must accept or decline this role removal update.',
      responseOptions: ['accept', 'decline'],
      createdAt: serverTimestamp(),
    });
  });
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
