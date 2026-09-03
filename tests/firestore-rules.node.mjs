import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const projectId = 'dispatch-rules-test';
let environment;

const users = {
  managerA: {
    uid: 'manager-a',
    displayName: 'Manager A',
    email: 'manager-a@example.test',
    canonicalEmail: 'manager-a@example.test',
    role: 'manager',
    organizationId: 'org-a',
  },
  managerACo: {
    uid: 'manager-a-co',
    displayName: 'Manager A Co',
    email: 'manager-a-co@example.test',
    canonicalEmail: 'manager-a-co@example.test',
    role: 'manager',
    organizationId: 'org-a',
  },
  managerB: {
    uid: 'manager-b',
    displayName: 'Manager B',
    email: 'manager-b@example.test',
    canonicalEmail: 'manager-b@example.test',
    role: 'manager',
    organizationId: 'org-b',
  },
  workerA: {
    uid: 'worker-a',
    displayName: 'Worker A',
    email: 'worker-a@example.test',
    canonicalEmail: 'worker-a@example.test',
    role: 'worker',
    organizationId: 'org-a',
  },
  workerAOther: {
    uid: 'worker-a-other',
    displayName: 'Worker A Other',
    email: 'worker-a-other@example.test',
    canonicalEmail: 'worker-a-other@example.test',
    role: 'worker',
    organizationId: 'org-a',
  },
  workerB: {
    uid: 'worker-b',
    displayName: 'Worker B',
    email: 'worker-b@example.test',
    canonicalEmail: 'worker-b@example.test',
    role: 'worker',
    organizationId: 'org-b',
  },
  workerPending: {
    uid: 'worker-pending',
    displayName: 'Worker Pending',
    email: 'worker-pending@example.test',
    canonicalEmail: 'worker-pending@example.test',
    role: 'worker',
    organizationId: null,
  },
  newManager: {
    uid: 'manager-new',
    displayName: 'Manager New',
    email: 'manager-new@example.test',
    canonicalEmail: 'manager-new@example.test',
    role: 'manager',
    organizationId: null,
  },
};

function authed(user) {
  return environment.authenticatedContext(user.uid, {
    email: user.email,
    email_verified: true,
  }).firestore();
}

function eventFixture(overrides = {}) {
  return {
    managerId: users.managerA.uid,
    organizationId: 'org-a',
    workerIds: [users.workerA.uid],
    name: 'Event A',
    location: 'Venue A',
    startsAt: '2026-09-02T16:00:00.000Z',
    teamIds: ['team-a'],
    roles: [
      {
        id: 'role-a',
        name: 'Crew',
        assignedWorkerIds: [],
        eligibleWaitlistWorkerIds: [users.workerA.uid],
        openSlots: 1,
        tasks: [{ id: 'task-a', name: 'Check in', completedBy: [] }],
      },
    ],
    revision: 0,
    ...overrides,
  };
}

async function seed() {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'organizations', 'org-a'), {
        name: 'Organization A',
        managerIds: [users.managerA.uid, users.managerACo.uid],
        workerIds: [users.workerA.uid, users.workerAOther.uid],
        createdBy: users.managerA.uid,
      }),
      setDoc(doc(db, 'organizations', 'org-b'), {
        name: 'Organization B',
        managerIds: [users.managerB.uid],
        workerIds: [users.workerB.uid],
        createdBy: users.managerB.uid,
      }),
      ...Object.values(users).map((user) => setDoc(doc(db, 'users', user.uid), user)),
      setDoc(doc(db, 'teams', 'team-a'), {
        managerId: users.managerA.uid,
        managerIds: [users.managerA.uid, users.managerACo.uid],
        organizationId: 'org-a',
        name: 'Team A',
        workerIds: [users.workerA.uid],
      }),
      setDoc(doc(db, 'events', 'event-a'), eventFixture()),
      setDoc(doc(db, 'events', 'event-b'), eventFixture({
        managerId: users.managerB.uid,
        organizationId: 'org-b',
        workerIds: [users.workerB.uid],
        name: 'Event B',
      })),
      setDoc(doc(db, 'eventTemplates', 'template-a'), {
        managerId: users.managerA.uid,
        name: 'Template A',
        roles: [],
      }),
      setDoc(doc(db, 'chatThreads', 'thread-a'), {
        id: 'thread-a',
        teamId: 'team-a',
        organizationId: 'org-a',
        kind: 'custom',
        title: 'Thread A',
        participants: [users.managerA.uid, users.workerA.uid],
        createdBy: users.managerA.uid,
      }),
      setDoc(doc(db, 'chatUnread', 'worker-a__thread-a'), {
        userId: users.workerA.uid,
        threadId: 'thread-a',
        teamId: 'team-a',
        unreadCount: 2,
      }),
      setDoc(doc(db, 'workerInvites', 'invite-pending'), {
        managerId: users.managerA.uid,
        teamId: 'team-a',
        teamName: 'Team A',
        organizationId: 'org-a',
        organizationName: 'Organization A',
        email: users.workerPending.email,
        normalizedEmail: users.workerPending.email,
        workerId: null,
        claimRequired: false,
        status: 'pending_acceptance',
        expiresAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
      setDoc(doc(db, 'roleAssignmentNotifications', 'role-note-a'), {
        workerId: users.workerA.uid,
        managerId: users.managerA.uid,
        eventId: 'event-a',
        roleId: 'role-a',
        action: 'assign',
        status: 'pending',
      }),
      setDoc(doc(db, 'userNotifications', 'user-note-a'), {
        userId: users.workerA.uid,
        kind: 'role_removed',
        title: 'Role changed',
        body: 'Your role changed.',
        relatedEventId: 'event-a',
        read: false,
      }),
    ]);
  });
}

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8185,
      rules: await readFile('firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await seed();
});

after(async () => {
  await environment?.cleanup();
});

test('anonymous clients cannot read protected operational data', async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'events', 'event-a')));
  await assertFails(getDoc(doc(db, 'chatThreads', 'thread-a')));
  await assertFails(getDoc(doc(db, 'eventTemplates', 'template-a')));
});

test('event reads are limited to organization managers and involved workers', async () => {
  await assertSucceeds(getDoc(doc(authed(users.managerA), 'events', 'event-a')));
  await assertSucceeds(getDoc(doc(authed(users.managerACo), 'events', 'event-a')));
  await assertSucceeds(getDoc(doc(authed(users.workerA), 'events', 'event-a')));
  await assertFails(getDoc(doc(authed(users.workerAOther), 'events', 'event-a')));
  await assertFails(getDoc(doc(authed(users.managerB), 'events', 'event-a')));
});

test('manager event queries must stay inside the caller organization', async () => {
  const managerDb = authed(users.managerA);
  await assertSucceeds(getDocs(query(
    collection(managerDb, 'events'),
    where('organizationId', '==', 'org-a'),
  )));
  await assertFails(getDocs(collection(managerDb, 'events')));
});

test('event writes preserve manager and organization identity', async () => {
  const managerDb = authed(users.managerACo);
  await assertSucceeds(updateDoc(doc(managerDb, 'events', 'event-a'), { location: 'Venue B' }));
  await assertFails(updateDoc(doc(managerDb, 'events', 'event-a'), { organizationId: 'org-b' }));
  await assertFails(updateDoc(doc(authed(users.managerB), 'events', 'event-a'), { location: 'Venue C' }));
});

test('worker event writes are limited to role state and cannot rewrite event identity or membership', async () => {
  const workerDb = authed(users.workerA);
  const nextRoles = eventFixture().roles.map((role) => ({
    ...role,
    tasks: role.tasks.map((task) => ({ ...task, completedBy: [users.workerA.uid] })),
  }));
  await assertSucceeds(updateDoc(doc(workerDb, 'events', 'event-a'), {
    roles: nextRoles,
    revision: 1,
  }));
  await assertFails(updateDoc(doc(workerDb, 'events', 'event-a'), { name: 'Hijacked' }));
  await assertFails(updateDoc(doc(workerDb, 'events', 'event-a'), {
    workerIds: [users.workerA.uid, users.workerAOther.uid],
  }));
});

test('event templates are private to their manager owner', async () => {
  await assertSucceeds(getDoc(doc(authed(users.managerA), 'eventTemplates', 'template-a')));
  await assertFails(getDoc(doc(authed(users.managerACo), 'eventTemplates', 'template-a')));
  await assertFails(getDoc(doc(authed(users.workerA), 'eventTemplates', 'template-a')));
  await assertSucceeds(updateDoc(doc(authed(users.managerA), 'eventTemplates', 'template-a'), { name: 'Updated' }));
  await assertFails(updateDoc(doc(authed(users.managerA), 'eventTemplates', 'template-a'), { managerId: users.managerB.uid }));
});

test('chat threads and messages are participant scoped', async () => {
  const managerDb = authed(users.managerA);
  const workerDb = authed(users.workerA);
  await assertSucceeds(getDocs(query(
    collection(managerDb, 'chatThreads'),
    where('participants', 'array-contains', users.managerA.uid),
  )));
  await assertSucceeds(getDoc(doc(managerDb, 'chatThreads', 'thread-a')));
  await assertSucceeds(getDoc(doc(workerDb, 'chatThreads', 'thread-a')));
  await assertFails(getDoc(doc(authed(users.workerAOther), 'chatThreads', 'thread-a')));
  await assertSucceeds(addDoc(collection(workerDb, 'chatThreads', 'thread-a', 'messages'), {
    senderId: users.workerA.uid,
    recipientIds: [users.managerA.uid],
    text: 'Hello',
  }));
  await assertFails(addDoc(collection(workerDb, 'chatThreads', 'thread-a', 'messages'), {
    senderId: users.workerA.uid,
    recipientIds: [users.workerB.uid],
    text: 'Cross-organization',
  }));
  await assertFails(addDoc(collection(authed(users.workerAOther), 'chatThreads', 'thread-a', 'messages'), {
    senderId: users.workerAOther.uid,
    recipientIds: [users.managerA.uid],
    text: 'Not a participant',
  }));
});

test('only organization managers can create chats and add participants', async () => {
  await assertSucceeds(setDoc(doc(authed(users.managerA), 'chatThreads', 'new-thread'), {
    id: 'new-thread',
    organizationId: 'org-a',
    kind: 'custom',
    title: 'New thread',
    participants: [users.managerA.uid, users.workerA.uid],
    createdBy: users.managerA.uid,
  }));
  await assertFails(setDoc(doc(authed(users.workerA), 'chatThreads', 'worker-thread'), {
    id: 'worker-thread',
    organizationId: 'org-a',
    kind: 'custom',
    title: 'Worker thread',
    participants: [users.workerA.uid, users.managerA.uid],
    createdBy: users.workerA.uid,
  }));
  await assertFails(updateDoc(doc(authed(users.workerA), 'chatThreads', 'thread-a'), {
    participants: [users.managerA.uid, users.workerA.uid, users.workerAOther.uid],
  }));
  await assertSucceeds(updateDoc(doc(authed(users.managerA), 'chatThreads', 'thread-a'), {
    participants: [users.managerA.uid, users.workerA.uid, users.workerAOther.uid],
  }));
});

test('chat unread state is private and increments only between thread participants', async () => {
  await assertSucceeds(getDoc(doc(authed(users.workerA), 'chatUnread', 'worker-a__thread-a')));
  await assertFails(getDoc(doc(authed(users.managerA), 'chatUnread', 'worker-a__thread-a')));
  await assertSucceeds(updateDoc(doc(authed(users.workerA), 'chatUnread', 'worker-a__thread-a'), { unreadCount: 0 }));
  await assertSucceeds(updateDoc(doc(authed(users.managerA), 'chatUnread', 'worker-a__thread-a'), {
    unreadCount: increment(1),
  }));
  await assertFails(updateDoc(doc(authed(users.workerAOther), 'chatUnread', 'worker-a__thread-a'), {
    unreadCount: increment(1),
  }));
});

test('the mobile chat send flow can write its message, thread summary, and unread counter', async () => {
  const managerDb = authed(users.managerA);
  await assertSucceeds(addDoc(collection(managerDb, 'chatThreads', 'thread-a', 'messages'), {
    threadId: 'thread-a',
    teamId: 'team-a',
    senderId: users.managerA.uid,
    senderName: users.managerA.displayName,
    recipientIds: [users.workerA.uid],
    text: 'Mobile flow message',
    attachments: [],
    createdAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(managerDb, 'chatThreads', 'thread-a'), {
    id: 'thread-a',
    teamId: 'team-a',
    participants: [users.managerA.uid, users.workerA.uid],
    pushSeenBy: [users.managerA.uid],
    lastMessageText: 'Mobile flow message',
    lastMessageSenderId: users.managerA.uid,
    updatedAt: serverTimestamp(),
  }, { merge: true }));
  await assertSucceeds(setDoc(doc(managerDb, 'chatUnread', 'worker-a__thread-a'), {
    userId: users.workerA.uid,
    threadId: 'thread-a',
    teamId: 'team-a',
    unreadCount: increment(1),
    updatedAt: serverTimestamp(),
  }, { merge: true }));
});

test('role assignment notifications are limited to the manager and target worker', async () => {
  await assertSucceeds(getDoc(doc(authed(users.workerA), 'roleAssignmentNotifications', 'role-note-a')));
  await assertSucceeds(getDoc(doc(authed(users.managerA), 'roleAssignmentNotifications', 'role-note-a')));
  await assertSucceeds(getDoc(doc(authed(users.managerACo), 'roleAssignmentNotifications', 'role-note-a')));
  await assertFails(getDoc(doc(authed(users.workerAOther), 'roleAssignmentNotifications', 'role-note-a')));
  await assertSucceeds(updateDoc(doc(authed(users.workerA), 'roleAssignmentNotifications', 'role-note-a'), {
    status: 'accepted',
    response: 'accept',
  }));
  await assertFails(updateDoc(doc(authed(users.workerA), 'roleAssignmentNotifications', 'role-note-a'), {
    managerId: users.managerB.uid,
  }));
});

test('role invite status transitions follow the mobile worker and manager flows', async () => {
  await assertSucceeds(updateDoc(doc(authed(users.managerACo), 'roleAssignmentNotifications', 'role-note-a'), {
    status: 'declined',
    statusReason: 'The manager withdrew this role invitation.',
    response: 'decline',
    respondedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(authed(users.workerA), 'roleAssignmentNotifications', 'role-note-a'), {
    status: 'accepted',
    response: 'accept',
  }));
});

test('user notifications are readable by their recipient and event owner but mutable only by their recipient', async () => {
  await assertSucceeds(getDoc(doc(authed(users.workerA), 'userNotifications', 'user-note-a')));
  await assertSucceeds(getDoc(doc(authed(users.managerA), 'userNotifications', 'user-note-a')));
  await assertSucceeds(updateDoc(doc(authed(users.workerA), 'userNotifications', 'user-note-a'), {
    read: true,
  }));
  await assertFails(updateDoc(doc(authed(users.managerA), 'userNotifications', 'user-note-a'), {
    read: true,
  }));
});

test('event owners can query and clean up notifications only for events they manage', async () => {
  const managerDb = authed(users.managerA);
  await assertSucceeds(getDocs(query(
    collection(managerDb, 'roleAssignmentNotifications'),
    where('eventId', '==', 'event-a'),
  )));
  await assertSucceeds(getDocs(query(
    collection(managerDb, 'userNotifications'),
    where('relatedEventId', '==', 'event-a'),
  )));
  await assertFails(getDocs(query(
    collection(managerDb, 'userNotifications'),
    where('relatedEventId', '==', 'event-b'),
  )));
  await assertSucceeds(deleteDoc(doc(managerDb, 'roleAssignmentNotifications', 'role-note-a')));
  await assertSucceeds(deleteDoc(doc(managerDb, 'userNotifications', 'user-note-a')));
  await assertSucceeds(deleteDoc(doc(managerDb, 'events', 'event-a')));
});

test('notification creation cannot target unrelated users', async () => {
  const managerDb = authed(users.managerA);
  await assertSucceeds(addDoc(collection(managerDb, 'userNotifications'), {
    userId: users.workerA.uid,
    kind: 'role_removed',
    title: 'Role changed',
    body: 'Your role changed.',
    relatedEventId: 'event-a',
    read: false,
  }));
  await assertFails(addDoc(collection(managerDb, 'userNotifications'), {
    userId: users.workerB.uid,
    kind: 'role_removed',
    title: 'Cross organization',
    body: 'Not allowed.',
    relatedEventId: 'event-a',
    read: false,
  }));
});

test('a worker can notify all organization managers about a late event task', async () => {
  await assertSucceeds(addDoc(collection(authed(users.workerA), 'userNotifications'), {
    userId: users.managerACo.uid,
    kind: 'task_behind_schedule',
    title: 'Task behind schedule',
    body: 'Event A: Crew is behind on Check in.',
    relatedEventId: 'event-a',
    relatedRoleId: 'role-a',
    relatedTaskId: 'task-a',
    dueAt: '2026-09-02T16:30:00.000Z',
    read: false,
    createdAt: serverTimestamp(),
  }));
});

test('mail writes are restricted to the authoritative event participant email', async () => {
  const managerDb = authed(users.managerA);
  await assertSucceeds(addDoc(collection(managerDb, 'mail'), {
    to: [users.workerA.email],
    message: { subject: 'Event invite', text: 'Join the event.' },
    dispatchEventRoleInvite: {
      managerId: users.managerA.uid,
      workerId: users.workerA.uid,
      eventId: 'event-a',
      roleId: 'role-a',
      email: users.workerA.email,
    },
  }));
  await assertFails(addDoc(collection(managerDb, 'mail'), {
    to: ['attacker@example.test'],
    message: { subject: 'Arbitrary mail', text: 'Not allowed.' },
    dispatchEventRoleInvite: {
      managerId: users.managerA.uid,
      workerId: users.workerA.uid,
      eventId: 'event-a',
      roleId: 'role-a',
      email: 'attacker@example.test',
    },
  }));
  await assertFails(addDoc(collection(authed(users.workerA), 'mail'), {
    to: [users.workerB.email],
    message: { subject: 'Cross organization', text: 'Not allowed.' },
  }));
});

test('the mobile event assignment flow can queue a pending organization worker without assigning them first', async () => {
  const managerDb = authed(users.managerA);
  await assertSucceeds(runTransaction(managerDb, async (tx) => {
    tx.update(doc(managerDb, 'events', 'event-a'), {
      workerIds: [users.workerA.uid],
      roles: eventFixture().roles,
      revision: 1,
      updatedAt: serverTimestamp(),
    });
    tx.set(doc(managerDb, 'roleAssignmentNotifications', 'role-note-mobile'), {
      workerId: users.workerAOther.uid,
      managerId: users.managerA.uid,
      eventId: 'event-a',
      roleId: 'role-a',
      action: 'assign',
      status: 'pending',
      createdAt: serverTimestamp(),
    });
  }));
  await assertSucceeds(addDoc(collection(managerDb, 'mail'), {
    to: [users.workerAOther.email],
    message: { subject: 'Event invite', text: 'Join the event.' },
    dispatchEventRoleInvite: {
      managerId: users.managerA.uid,
      workerId: users.workerAOther.uid,
      eventId: 'event-a',
      roleId: 'role-a',
      email: users.workerAOther.email,
    },
  }));
  await assertFails(addDoc(collection(managerDb, 'roleAssignmentNotifications'), {
    workerId: users.workerB.uid,
    managerId: users.managerA.uid,
    eventId: 'event-a',
    roleId: 'role-a',
    action: 'assign',
    status: 'pending',
    createdAt: serverTimestamp(),
  }));
});

test('the mobile role acceptance transaction updates the event, invite, and manager notification', async () => {
  const workerDb = authed(users.workerA);
  const nextRole = {
    ...eventFixture().roles[0],
    assignedWorkerIds: [users.workerA.uid],
    eligibleWaitlistWorkerIds: [],
    openSlots: 0,
  };
  await assertSucceeds(runTransaction(workerDb, async (tx) => {
    tx.update(doc(workerDb, 'events', 'event-a'), {
      roles: [nextRole],
      workerIds: [users.workerA.uid],
      revision: 1,
      updatedAt: serverTimestamp(),
    });
    tx.update(doc(workerDb, 'roleAssignmentNotifications', 'role-note-a'), {
      status: 'accepted',
      statusReason: 'Worker accepted this role assignment update.',
      respondedAt: serverTimestamp(),
      response: 'accept',
    });
    tx.set(doc(workerDb, 'userNotifications', 'role-accepted-note'), {
      userId: users.managerA.uid,
      kind: 'role_invite_response',
      title: 'Role invite accepted',
      body: 'Worker A accepted Crew for Event A.',
      relatedEventId: 'event-a',
      relatedRoleId: 'role-a',
      sourceNotificationId: 'role-note-a',
      read: false,
      createdAt: serverTimestamp(),
    });
  }));
});

test('the mobile worker cancellation transaction can notify the manager and waitlist', async () => {
  const managerDb = authed(users.managerA);
  const startingRole = {
    ...eventFixture().roles[0],
    assignedWorkerIds: [users.workerA.uid],
    waitlistWorkerIds: [users.workerAOther.uid],
    eligibleWaitlistWorkerIds: [],
    openSlots: 0,
  };
  await assertSucceeds(updateDoc(doc(managerDb, 'events', 'event-a'), {
    roles: [startingRole],
    workerIds: [users.workerA.uid, users.workerAOther.uid],
  }));

  const workerDb = authed(users.workerA);
  const nextRole = {
    ...startingRole,
    assignedWorkerIds: [],
    waitlistInviteWorkerIds: [users.workerAOther.uid],
    eligibleWaitlistWorkerIds: [users.workerA.uid],
    openSlots: 1,
  };
  await assertSucceeds(runTransaction(workerDb, async (tx) => {
    tx.update(doc(workerDb, 'events', 'event-a'), {
      roles: [nextRole],
      workerIds: [users.workerA.uid, users.workerAOther.uid],
      revision: 1,
      updatedAt: serverTimestamp(),
    });
    tx.set(doc(workerDb, 'userNotifications', 'role-cancelled-note'), {
      userId: users.managerA.uid,
      kind: 'worker_role_cancelled',
      title: 'Worker cancelled role',
      body: 'Event A: a worker cancelled Crew.',
      relatedEventId: 'event-a',
      relatedRoleId: 'role-a',
      read: false,
      createdAt: serverTimestamp(),
    });
    tx.set(doc(workerDb, 'userNotifications', 'role-available-note'), {
      userId: users.workerAOther.uid,
      kind: 'role_available',
      title: 'Role available',
      body: 'Event A: Crew is available.',
      relatedEventId: 'event-a',
      relatedRoleId: 'role-a',
      read: false,
      createdAt: serverTimestamp(),
    });
  }));
});

test('a scheduled event reminder can be safely refreshed without changing its identity', async () => {
  const managerDb = authed(users.managerA);
  const reminderRef = doc(managerDb, 'mail', 'event-a__role-a__worker-a__reminder');
  const reminder = {
    eventId: 'event-a',
    roleId: 'role-a',
    workerId: users.workerA.uid,
    email: users.workerA.email,
    reminderAt: new Date('2026-09-02T14:00:00.000Z'),
  };
  await assertSucceeds(setDoc(reminderRef, {
    to: [users.workerA.email],
    delivery: { startTime: reminder.reminderAt },
    message: { subject: 'Dispatch reminder', text: 'First reminder.' },
    dispatchEventReminder: reminder,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true }));
  await assertSucceeds(setDoc(reminderRef, {
    to: [users.workerA.email],
    delivery: { startTime: new Date('2026-09-02T14:15:00.000Z') },
    message: { subject: 'Dispatch reminder', text: 'Updated reminder.' },
    dispatchEventReminder: {
      ...reminder,
      reminderAt: new Date('2026-09-02T14:15:00.000Z'),
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true }));
  await assertFails(setDoc(reminderRef, {
    to: [users.workerB.email],
    dispatchEventReminder: {
      ...reminder,
      workerId: users.workerB.uid,
      email: users.workerB.email,
    },
    updatedAt: serverTimestamp(),
  }, { merge: true }));
});

test('the mobile worker invite acceptance transaction updates only the invited worker membership', async () => {
  const workerDb = authed(users.workerPending);
  await assertSucceeds(runTransaction(workerDb, async (tx) => {
    tx.update(doc(workerDb, 'workerInvites', 'invite-pending'), {
      workerId: users.workerPending.uid,
      status: 'accepted',
      statusReason: 'Worker accepted invite in app.',
      acceptedAt: serverTimestamp(),
      consumedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.update(doc(workerDb, 'teams', 'team-a'), {
      workerIds: arrayUnion(users.workerPending.uid),
      lastAcceptedInviteId: 'invite-pending',
      updatedAt: serverTimestamp(),
    });
    tx.update(doc(workerDb, 'organizations', 'org-a'), {
      workerIds: arrayUnion(users.workerPending.uid),
      lastAcceptedInviteId: 'invite-pending',
      updatedAt: serverTimestamp(),
    });
    tx.set(doc(workerDb, 'users', users.workerPending.uid), {
      organizationId: 'org-a',
      organizationName: 'Organization A',
      updatedAt: serverTimestamp(),
    }, { merge: true });
    tx.set(doc(workerDb, 'userNotifications', 'invite-accepted-note'), {
      userId: users.managerA.uid,
      kind: 'worker_team_invite',
      title: 'Team invite accepted',
      body: 'Worker Pending accepted the invite to join Team A.',
      relatedRoleId: 'invite-pending',
      read: false,
      createdAt: serverTimestamp(),
    });
  }));
});

test('an invited worker cannot redirect an invite or add another worker during acceptance', async () => {
  const workerDb = authed(users.workerPending);
  await assertFails(updateDoc(doc(workerDb, 'workerInvites', 'invite-pending'), {
    workerId: users.workerPending.uid,
    organizationId: 'org-b',
    status: 'accepted',
  }));
  await assertFails(runTransaction(workerDb, async (tx) => {
    tx.update(doc(workerDb, 'workerInvites', 'invite-pending'), {
      workerId: users.workerPending.uid,
      status: 'accepted',
      acceptedAt: serverTimestamp(),
      consumedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.update(doc(workerDb, 'teams', 'team-a'), {
      workerIds: arrayUnion(users.workerPending.uid, users.workerAOther.uid),
      lastAcceptedInviteId: 'invite-pending',
      updatedAt: serverTimestamp(),
    });
  }));
});

test('manager onboarding can atomically create an organization and link the manager profile', async () => {
  const managerDb = authed(users.newManager);
  await assertSucceeds(runTransaction(managerDb, async (tx) => {
    tx.set(doc(managerDb, 'organizations', 'org-new'), {
      name: 'Organization New',
      managerIds: [users.newManager.uid],
      workerIds: [],
      createdBy: users.newManager.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.set(doc(managerDb, 'users', users.newManager.uid), {
      role: 'manager',
      organizationId: 'org-new',
      organizationName: 'Organization New',
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }));
});

test('real-time listener query shapes are authorized only within the caller scope', async () => {
  const managerDb = authed(users.managerA);
  const workerDb = authed(users.workerA);
  await assertSucceeds(getDocs(query(collection(managerDb, 'teams'), where('organizationId', '==', 'org-a'))));
  await assertSucceeds(getDocs(query(collection(workerDb, 'users'), where('organizationId', '==', 'org-a'))));
  await assertSucceeds(getDocs(query(collection(workerDb, 'roleAssignmentNotifications'), where('workerId', '==', users.workerA.uid))));
  await assertSucceeds(getDocs(query(collection(workerDb, 'userNotifications'), where('userId', '==', users.workerA.uid))));
  await assertSucceeds(getDocs(query(collection(workerDb, 'chatUnread'), where('userId', '==', users.workerA.uid))));
  await assertFails(getDocs(query(collection(workerDb, 'userNotifications'), where('userId', '==', users.workerB.uid))));
});

test('a self-service profile cannot claim membership in another organization', async () => {
  const workerDb = authed(users.workerA);
  await assertFails(updateDoc(doc(workerDb, 'users', users.workerA.uid), {
    organizationId: 'org-b',
    role: 'manager',
  }));
  await assertSucceeds(updateDoc(doc(workerDb, 'users', users.workerA.uid), {
    displayName: 'Worker A Updated',
  }));
});

test('only organization managers can mutate teams', async () => {
  await assertSucceeds(updateDoc(doc(authed(users.managerACo), 'teams', 'team-a'), { name: 'Updated Team' }));
  await assertFails(updateDoc(doc(authed(users.workerA), 'teams', 'team-a'), { name: 'Worker Rewrite' }));
  await assertFails(deleteDoc(doc(authed(users.managerB), 'teams', 'team-a')));
});

test('test fixtures are internally consistent', () => {
  assert.equal(users.managerA.organizationId, 'org-a');
  assert.equal(users.workerB.organizationId, 'org-b');
});
