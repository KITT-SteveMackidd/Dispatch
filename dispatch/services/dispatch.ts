import {
  addDoc,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DispatchEvent, EventRole, Team, UserProfile } from '@/types/dispatch';

function mapEvents(snap: { docs: Array<{ id: string; data: () => unknown }> }): DispatchEvent[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DispatchEvent, 'id'>) }));
}

function mapTeams(snap: { docs: Array<{ id: string; data: () => unknown }> }): Team[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Team, 'id'>) }));
}

function sortByStartAsc(items: DispatchEvent[]) {
  return [...items].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
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
    await sendInviteEmail({
      email: normalizedEmail,
      teamName: team.name,
      appLink,
      inviteId: inviteRef.id,
      managerId,
      teamId,
    });

    await updateDoc(inviteRef, {
      status: 'sent',
      statusReason: 'Invite email delivered to configured transport.',
      sentAt: serverTimestamp(),
    });

    return { inviteId: inviteRef.id, queued: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Invite email transport failed';
    await updateDoc(inviteRef, {
      status: 'send_failed',
      statusReason: `Invite queued but email failed: ${reason}`,
      deliveryErrorAt: serverTimestamp(),
    });
    throw new Error(`Invite saved, but email failed to send: ${reason}`);
  }
}

async function sendInviteEmail(params: {
  email: string;
  teamName: string;
  appLink: string;
  inviteId: string;
  managerId: string;
  teamId: string;
}) {
  const endpoint = (process.env.EXPO_PUBLIC_INVITE_EMAIL_ENDPOINT || '').trim();
  if (!endpoint) {
    throw new Error('Missing EXPO_PUBLIC_INVITE_EMAIL_ENDPOINT for invite email transport');
  }

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

  await batch.commit();
}
