const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WORKER_EVENT_ACTION_TYPES,
  planAcceptWaitlistInvite,
  planCancelWorkerRole,
  planJoinEventWaitlist,
  planRespondRoleNotification,
  planToggleTaskCompletion,
  planWorkerEventAction,
} = require('../lib/worker-event-actions');

function role(id, overrides = {}) {
  return {
    id,
    name: id === 'role-1' ? 'Box Office' : 'Stage Crew',
    assignedWorkerIds: [],
    waitlistWorkerIds: [],
    eligibleWaitlistWorkerIds: [],
    waitlistInviteWorkerIds: [],
    removedWorkerIds: [],
    openSlots: 0,
    tasks: [],
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: 'event-1',
    managerId: 'manager-1',
    name: 'Summer Festival',
    roles: [role('role-1'), role('role-2')],
    ...overrides,
  };
}

const identityFailure = {
  ok: false,
  code: 'permission-denied',
  reason: 'caller-identity-mismatch',
  message: 'A worker action can modify only the authenticated worker identity.',
};

test('binds every worker action to callerUserId before reading client worker state', () => {
  const planners = [
    planCancelWorkerRole,
    planJoinEventWaitlist,
    planAcceptWaitlistInvite,
    planRespondRoleNotification,
    planToggleTaskCompletion,
  ];
  planners.forEach((planner) => {
    assert.deepEqual(planner({ callerUserId: 'worker-1', workerId: 'worker-2' }), identityFailure);
  });
  assert.deepEqual(planCancelWorkerRole({ callerUserId: '', event: event() }), {
    ok: false,
    code: 'unauthenticated',
    reason: 'missing-caller',
    message: 'Sign in before changing an event.',
  });
});

test('rejects mismatched document ids and malformed or ambiguous event state', () => {
  assert.equal(planToggleTaskCompletion({
    callerUserId: 'worker-1',
    eventId: 'event-2',
    event: event(),
    roleId: 'role-1',
    taskId: 'task-1',
    complete: true,
  }).reason, 'event-id-mismatch');

  assert.equal(planCancelWorkerRole({
    callerUserId: 'worker-1',
    event: event({ roles: [role('role-1'), role('role-1')] }),
    roleId: 'role-1',
  }).reason, 'invalid-event-state');

  assert.equal(planCancelWorkerRole({
    callerUserId: 'worker-1',
    event: event({ roles: [role('role-1', { assignedWorkerIds: ['worker-1', 'worker-1'] })] }),
    roleId: 'role-1',
  }).reason, 'invalid-event-state');
});

test('cancels only the caller assignment, clears their completions, and emits deterministic notices', () => {
  const source = event({
    roles: [
      role('role-1', {
        assignedWorkerIds: ['worker-1', 'worker-x'],
        waitlistWorkerIds: ['worker-2', 'worker-3'],
        eligibleWaitlistWorkerIds: [],
        waitlistInviteWorkerIds: ['worker-4'],
        openSlots: 0,
        tasks: [{ id: 'task-1', name: 'Open doors', completedBy: ['worker-1', 'worker-2'] }],
      }),
      role('role-2', { assignedWorkerIds: ['worker-9'] }),
    ],
  });
  const original = structuredClone(source);

  const result = planCancelWorkerRole({
    callerUserId: 'worker-1',
    workerId: 'worker-1',
    eventId: 'event-1',
    event: source,
    roleId: 'role-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'cancelled');
  assert.equal(result.eventChanged, true);
  assert.deepEqual(result.roles[0], {
    ...source.roles[0],
    assignedWorkerIds: ['worker-x'],
    waitlistWorkerIds: ['worker-2', 'worker-3'],
    eligibleWaitlistWorkerIds: ['worker-1'],
    waitlistInviteWorkerIds: ['worker-4', 'worker-2', 'worker-3'],
    openSlots: 1,
    tasks: [{ id: 'task-1', name: 'Open doors', completedBy: ['worker-2'] }],
  });
  assert.deepEqual(result.workerIds, [
    'worker-x', 'worker-2', 'worker-3', 'worker-1', 'worker-4', 'worker-9',
  ]);
  assert.deepEqual(result.notificationSpecs.map((notice) => [notice.userId, notice.kind]), [
    ['manager-1', 'worker_role_cancelled'],
    ['worker-2', 'role_available'],
    ['worker-3', 'role_available'],
  ]);
  assert.equal(result.roleNotificationUpdate, null);
  assert.equal(result.reminderEmailSpec, null);
  assert.deepEqual(source, original);
});

test('refuses to cancel a missing role or an assignment owned by someone else', () => {
  const source = event({ roles: [role('role-1', { assignedWorkerIds: ['worker-2'] })] });
  assert.equal(planCancelWorkerRole({
    callerUserId: 'worker-1', event: source, roleId: 'missing',
  }).reason, 'role-not-found');
  assert.equal(planCancelWorkerRole({
    callerUserId: 'worker-1', event: source, roleId: 'role-1',
  }).reason, 'caller-not-assigned');
});

test('joins only an eligible caller to a full role waitlist and consumes stale availability markers', () => {
  const source = event({
    roles: [role('role-1', {
      assignedWorkerIds: ['worker-2'],
      eligibleWaitlistWorkerIds: ['worker-1'],
      waitlistInviteWorkerIds: ['worker-1'],
      openSlots: 0,
    })],
  });
  const result = planJoinEventWaitlist({
    callerUserId: 'worker-1', event: source, roleId: 'role-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'waitlisted');
  assert.deepEqual(result.roles[0].waitlistWorkerIds, ['worker-1']);
  assert.deepEqual(result.roles[0].eligibleWaitlistWorkerIds, []);
  assert.deepEqual(result.roles[0].waitlistInviteWorkerIds, []);
  assert.deepEqual(result.workerIds, ['worker-2', 'worker-1']);
  assert.deepEqual(result.notificationSpecs, []);

  assert.equal(planJoinEventWaitlist({
    callerUserId: 'worker-3', event: source, roleId: 'role-1',
  }).reason, 'caller-not-waitlist-eligible');
  assert.equal(planJoinEventWaitlist({
    callerUserId: 'worker-1',
    event: event({ roles: [role('role-1', { openSlots: 1, eligibleWaitlistWorkerIds: ['worker-1'] })] }),
    roleId: 'role-1',
  }).reason, 'role-has-open-slot');
});

test('prevents an assigned caller from joining another waitlist', () => {
  const result = planJoinEventWaitlist({
    callerUserId: 'worker-1',
    event: event({
      roles: [
        role('role-1', { assignedWorkerIds: ['worker-2'], eligibleWaitlistWorkerIds: ['worker-1'] }),
        role('role-2', { assignedWorkerIds: ['worker-1'] }),
      ],
    }),
    roleId: 'role-1',
  });
  assert.equal(result.reason, 'caller-already-assigned');
});

test('an owned assignment notification authorizes waitlisting and is advanced atomically', () => {
  const result = planJoinEventWaitlist({
    callerUserId: 'worker-1',
    event: event({ roles: [role('role-1', { assignedWorkerIds: ['worker-2'], openSlots: 0 })] }),
    roleId: 'role-1',
    notificationId: 'notification-1',
    notification: {
      id: 'notification-1',
      workerId: 'worker-1',
      managerId: 'manager-1',
      eventId: 'event-1',
      roleId: 'role-1',
      action: 'assign',
      status: 'pending',
    },
    authorizedManagerIds: ['manager-1'],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.roles[0].waitlistWorkerIds, ['worker-1']);
  assert.deepEqual(result.roleNotificationUpdate, {
    notificationId: 'notification-1',
    status: 'waitlisted',
    statusReason: 'Worker joined the waitlist for this role.',
  });
});

test('a foreign or stale assignment notification cannot authorize waitlisting', () => {
  const source = event({ roles: [role('role-1', { assignedWorkerIds: ['worker-2'], openSlots: 0 })] });
  const notification = {
    id: 'notification-1',
    workerId: 'worker-1',
    managerId: 'manager-1',
    eventId: 'event-1',
    roleId: 'role-1',
    action: 'assign',
    status: 'pending',
  };
  assert.equal(planJoinEventWaitlist({
    callerUserId: 'worker-1', event: source, roleId: 'role-1',
    notificationId: 'notification-1', notification: { ...notification, workerId: 'worker-2' },
  }).reason, 'waitlist-notification-invalid');
  assert.equal(planJoinEventWaitlist({
    callerUserId: 'worker-1', event: source, roleId: 'role-1',
    notificationId: 'notification-1', notification: { ...notification, status: 'accepted' },
  }).reason, 'waitlist-notification-invalid');
});

test('accepts an available waitlist role for the caller and clears only their other waitlist state', () => {
  const source = event({
    roles: [
      role('role-1', {
        waitlistWorkerIds: ['worker-1', 'worker-3'],
        waitlistInviteWorkerIds: ['worker-1'],
        openSlots: 1,
      }),
      role('role-2', {
        waitlistWorkerIds: ['worker-1', 'worker-4'],
        eligibleWaitlistWorkerIds: ['worker-1', 'worker-5'],
        waitlistInviteWorkerIds: ['worker-1', 'worker-6'],
      }),
    ],
  });
  const result = planAcceptWaitlistInvite({
    callerUserId: 'worker-1',
    callerDisplayName: 'Avery',
    event: source,
    roleId: 'role-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'accepted');
  assert.deepEqual(result.roles[0].assignedWorkerIds, ['worker-1']);
  assert.deepEqual(result.roles[0].waitlistWorkerIds, ['worker-3']);
  assert.deepEqual(result.roles[0].waitlistInviteWorkerIds, []);
  assert.equal(result.roles[0].openSlots, 0);
  assert.deepEqual(result.roles[1].waitlistWorkerIds, ['worker-4']);
  assert.deepEqual(result.roles[1].eligibleWaitlistWorkerIds, ['worker-5']);
  assert.deepEqual(result.roles[1].waitlistInviteWorkerIds, ['worker-6']);
  assert.deepEqual(result.notificationSpecs, [{
    userId: 'manager-1',
    kind: 'role_invite_response',
    title: 'Waitlist invite accepted',
    body: 'Avery accepted Box Office for Summer Festival.',
    relatedEventId: 'event-1',
    relatedRoleId: 'role-1',
    read: false,
  }]);
  assert.deepEqual(result.reminderEmailSpec, {
    eventId: 'event-1', roleId: 'role-1', workerId: 'worker-1',
  });
});

test('keeps a raced full-role acceptance on the waitlist without claiming capacity', () => {
  const result = planAcceptWaitlistInvite({
    callerUserId: 'worker-1',
    event: event({
      roles: [role('role-1', {
        assignedWorkerIds: ['worker-2'],
        waitlistInviteWorkerIds: ['worker-1'],
        openSlots: 0,
      })],
    }),
    roleId: 'role-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'waitlisted_role_full');
  assert.deepEqual(result.roles[0].assignedWorkerIds, ['worker-2']);
  assert.deepEqual(result.roles[0].waitlistWorkerIds, ['worker-1']);
  assert.deepEqual(result.roles[0].waitlistInviteWorkerIds, []);
  assert.deepEqual(result.notificationSpecs, []);
  assert.equal(result.reminderEmailSpec, null);
});

test('fails closed when accepting unavailable waitlist state or a second event role', () => {
  assert.equal(planAcceptWaitlistInvite({
    callerUserId: 'worker-1', event: event(), roleId: 'role-1',
  }).reason, 'waitlist-invite-unavailable');

  assert.equal(planAcceptWaitlistInvite({
    callerUserId: 'worker-1',
    event: event({
      roles: [
        role('role-1', { openSlots: 1, waitlistInviteWorkerIds: ['worker-1'] }),
        role('role-2', { assignedWorkerIds: ['worker-1'] }),
      ],
    }),
    roleId: 'role-1',
  }).reason, 'caller-already-assigned');
});

test('accepts an owned pending assignment notification from an authorized Manager', () => {
  const source = event({ roles: [
    role('role-1', { openSlots: 1, waitlistWorkerIds: ['worker-1'] }),
    role('role-2', { eligibleWaitlistWorkerIds: ['worker-1'] }),
  ] });
  const result = planRespondRoleNotification({
    callerUserId: 'worker-1',
    callerDisplayName: 'Avery',
    event: source,
    notificationId: 'notification-1',
    notification: {
      id: 'notification-1',
      workerId: 'worker-1',
      managerId: 'manager-2',
      eventId: 'event-1',
      roleId: 'role-1',
      action: 'assign',
      status: 'pending',
    },
    authorizedManagerIds: ['manager-1', 'manager-2'],
    response: 'accept',
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'assign_accept');
  assert.deepEqual(result.roles[0].assignedWorkerIds, ['worker-1']);
  assert.deepEqual(result.roles[0].waitlistWorkerIds, []);
  assert.deepEqual(result.roles[1].eligibleWaitlistWorkerIds, []);
  assert.deepEqual(result.roleNotificationUpdate, {
    notificationId: 'notification-1',
    status: 'accepted',
    statusReason: 'Worker accepted this role assignment update.',
    response: 'accept',
  });
  assert.deepEqual(result.notificationSpecs[0], {
    userId: 'manager-2',
    kind: 'role_invite_response',
    title: 'Role invite accepted',
    body: 'Avery accepted Box Office for Summer Festival.',
    relatedEventId: 'event-1',
    relatedRoleId: 'role-1',
    sourceNotificationId: 'notification-1',
    read: false,
  });
  assert.deepEqual(result.reminderEmailSpec, {
    eventId: 'event-1', roleId: 'role-1', workerId: 'worker-1',
  });
});

test('rejects stale, foreign, mismatched, and unauthorized role notifications', () => {
  const base = {
    callerUserId: 'worker-1',
    event: event(),
    notificationId: 'notification-1',
    notification: {
      id: 'notification-1',
      workerId: 'worker-1',
      managerId: 'manager-1',
      eventId: 'event-1',
      roleId: 'role-1',
      action: 'assign',
      status: 'pending',
    },
    response: 'decline',
  };
  assert.equal(planRespondRoleNotification({
    ...base, notification: { ...base.notification, workerId: 'worker-2' },
  }).reason, 'notification-not-owned');
  assert.equal(planRespondRoleNotification({
    ...base, notification: { ...base.notification, status: 'accepted' },
  }).reason, 'notification-not-pending');
  assert.equal(planRespondRoleNotification({
    ...base, notification: { ...base.notification, eventId: 'event-2' },
  }).reason, 'notification-event-mismatch');
  assert.equal(planRespondRoleNotification({
    ...base,
    notification: { ...base.notification, managerId: 'manager-2' },
    authorizedManagerIds: ['manager-1'],
  }).reason, 'notification-manager-not-authorized');
});

test('declines an assignment without removing an active assignment', () => {
  const notification = {
    id: 'notification-1', workerId: 'worker-1', managerId: 'manager-1',
    eventId: 'event-1', roleId: 'role-1', action: 'assign', status: 'pending',
  };
  const valid = planRespondRoleNotification({
    callerUserId: 'worker-1', event: event(), notificationId: 'notification-1', notification,
    response: 'decline',
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.roles[0].eligibleWaitlistWorkerIds, ['worker-1']);
  assert.equal(valid.roleNotificationUpdate.status, 'declined');

  const invalid = planRespondRoleNotification({
    callerUserId: 'worker-1',
    event: event({ roles: [role('role-1', { assignedWorkerIds: ['worker-1'] })] }),
    notificationId: 'notification-1',
    notification,
    response: 'decline',
  });
  assert.equal(invalid.reason, 'notification-event-state-mismatch');
});

test('restores a declined removal only from an explicit removed state with capacity', () => {
  const notification = {
    id: 'notification-1', workerId: 'worker-1', managerId: 'manager-1',
    eventId: 'event-1', roleId: 'role-1', action: 'remove', status: 'pending',
  };
  const source = event({ roles: [role('role-1', {
    assignedWorkerIds: ['worker-2'], removedWorkerIds: ['worker-1'], openSlots: 1,
  })] });
  const result = planRespondRoleNotification({
    callerUserId: 'worker-1', event: source, notificationId: 'notification-1', notification,
    response: 'decline',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.roles[0].assignedWorkerIds, ['worker-2', 'worker-1']);
  assert.deepEqual(result.roles[0].removedWorkerIds, []);
  assert.equal(result.roles[0].openSlots, 0);
  assert.equal(result.roleNotificationUpdate.status, 'declined');

  assert.equal(planRespondRoleNotification({
    callerUserId: 'worker-1', event: event(), notificationId: 'notification-1', notification,
    response: 'accept',
  }).reason, 'notification-event-state-mismatch');
});

test('toggles only an assigned caller completion on an existing task and is idempotent', () => {
  const source = event({ roles: [role('role-1', {
    assignedWorkerIds: ['worker-1'],
    tasks: [{ id: 'task-1', name: 'Open doors', completedBy: ['worker-2'] }],
  })] });
  const completed = planToggleTaskCompletion({
    callerUserId: 'worker-1', event: source, roleId: 'role-1', taskId: 'task-1', complete: true,
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.outcome, 'completed');
  assert.deepEqual(completed.roles[0].tasks[0].completedBy, ['worker-2', 'worker-1']);
  assert.deepEqual(completed.notificationSpecs, []);

  const alreadyComplete = planToggleTaskCompletion({
    callerUserId: 'worker-1',
    event: event({ roles: completed.roles }),
    roleId: 'role-1',
    taskId: 'task-1',
    complete: true,
  });
  assert.equal(alreadyComplete.ok, true);
  assert.equal(alreadyComplete.eventChanged, false);
  assert.equal(alreadyComplete.outcome, 'already_complete');

  const reopened = planToggleTaskCompletion({
    callerUserId: 'worker-1',
    event: event({ roles: completed.roles }),
    roleId: 'role-1',
    taskId: 'task-1',
    complete: false,
  });
  assert.deepEqual(reopened.roles[0].tasks[0].completedBy, ['worker-2']);
});

test('refuses task mutation for an unassigned caller, missing task, or invalid completion state', () => {
  const source = event({ roles: [role('role-1', {
    assignedWorkerIds: ['worker-2'], tasks: [{ id: 'task-1', completedBy: [] }],
  })] });
  assert.equal(planToggleTaskCompletion({
    callerUserId: 'worker-1', event: source, roleId: 'role-1', taskId: 'task-1', complete: true,
  }).reason, 'caller-not-assigned');
  assert.equal(planToggleTaskCompletion({
    callerUserId: 'worker-2', event: source, roleId: 'role-1', taskId: 'missing', complete: true,
  }).reason, 'task-not-found');
  assert.equal(planToggleTaskCompletion({
    callerUserId: 'worker-2', event: source, roleId: 'role-1', taskId: 'task-1', complete: 'yes',
  }).reason, 'invalid-completion-state');
});

test('dispatches only the five explicit worker action names', () => {
  assert.deepEqual(WORKER_EVENT_ACTION_TYPES, [
    'cancel_worker_role',
    'join_event_waitlist',
    'accept_waitlist_invite',
    'respond_role_notification',
    'toggle_task_completion',
  ]);
  const result = planWorkerEventAction({
    actionType: 'toggle_task_completion',
    callerUserId: 'worker-1',
    event: event({ roles: [role('role-1', {
      assignedWorkerIds: ['worker-1'], tasks: [{ id: 'task-1', completedBy: [] }],
    })] }),
    roleId: 'role-1',
    taskId: 'task-1',
    complete: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.actionType, 'toggle_task_completion');
  assert.equal(planWorkerEventAction({ actionType: 'delete_event' }).reason, 'invalid-worker-action');
});
