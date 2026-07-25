const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRoleNotificationState,
  roleNotificationStateChanged,
  roleStateFingerprint,
} = require('../lib/role-state');

const event = {
  name: 'Concert',
  location: 'Main Hall',
  startsAt: '2026-08-01T18:00:00.000Z',
  roles: [
    {
      id: 'box-office',
      name: 'Box Office',
      openSlots: 0,
      assignedWorkerIds: ['worker-1'],
      waitlistWorkerIds: ['worker-2'],
      eligibleWaitlistWorkerIds: ['worker-3'],
      waitlistInviteWorkerIds: ['worker-2'],
      tasks: [{ name: 'Open doors', completedBy: [] }],
    },
    {
      id: 'usher',
      name: 'Usher',
      openSlots: 1,
      assignedWorkerIds: [],
      waitlistWorkerIds: ['worker-1'],
      tasks: [],
    },
  ],
};

test('fans canonical role availability out to another worker invite', () => {
  const state = buildRoleNotificationState({
    action: 'assign',
    status: 'pending',
    workerId: 'worker-4',
    roleId: 'box-office',
  }, event);

  assert.equal(state.status, undefined);
  assert.equal(state.roleOpenSlots, 0);
  assert.deepEqual(state.roleAssignedWorkerIds, ['worker-1']);
  assert.deepEqual(state.roleWaitlistWorkerIds, ['worker-2']);
  assert.deepEqual(state.roleWaitlistInviteWorkerIds, ['worker-2']);
});

test('derives accepted and waitlisted statuses from the event', () => {
  assert.equal(buildRoleNotificationState({
    action: 'assign',
    status: 'pending',
    workerId: 'worker-1',
    roleId: 'box-office',
  }, event).status, 'accepted');

  assert.equal(buildRoleNotificationState({
    action: 'assign',
    status: 'declined',
    workerId: 'worker-2',
    roleId: 'box-office',
  }, event).status, 'waitlisted');
});

test('declines competing invites after a worker accepts another event role', () => {
  const state = buildRoleNotificationState({
    action: 'assign',
    status: 'waitlisted',
    workerId: 'worker-1',
    roleId: 'usher',
  }, event);

  assert.equal(state.status, 'declined');
  assert.match(state.statusReason, /another role/);
});

test('only reports a notification change when synchronized fields differ', () => {
  const nextState = buildRoleNotificationState({
    action: 'assign',
    status: 'pending',
    workerId: 'worker-4',
    roleId: 'box-office',
  }, event);

  assert.equal(roleNotificationStateChanged(nextState, nextState), false);
  assert.equal(roleNotificationStateChanged({ ...nextState, roleOpenSlots: 1 }, nextState), true);
});

test('ignores task completion when deciding whether role availability changed', () => {
  const completedEvent = structuredClone(event);
  completedEvent.roles[0].tasks[0].completedBy = ['worker-1'];
  assert.equal(roleStateFingerprint(completedEvent), roleStateFingerprint(event));

  completedEvent.roles[0].waitlistWorkerIds.push('worker-5');
  assert.notEqual(roleStateFingerprint(completedEvent), roleStateFingerprint(event));
});
