const assert = require('node:assert/strict');
const test = require('node:test');
const { buildEventRoleResponse } = require('../lib/event-role-response');

const notification = {
  id: 'invite-1',
  workerId: 'worker-1',
  managerId: 'manager-1',
  eventId: 'event-1',
  roleId: 'role-1',
  roleName: 'Box Office',
  action: 'assign',
  status: 'pending',
};
const event = {
  name: 'Opening Night',
  workerIds: ['worker-2', 'worker-3'],
  revision: 4,
  roles: [
    { id: 'role-1', name: 'Box Office', assignedWorkerIds: [], openSlots: 1 },
    { id: 'role-2', name: 'Usher', assignedWorkerIds: [], waitlistWorkerIds: ['worker-1'], openSlots: 1 },
  ],
};

test('accepting a role is atomic and preserves other pending Event participants', () => {
  const result = buildEventRoleResponse({ notification, event, workerId: 'worker-1', workerName: 'Taylor', response: 'accept' });
  assert.deepEqual(result.eventPatch.workerIds, ['worker-2', 'worker-3', 'worker-1']);
  assert.deepEqual(result.eventPatch.roles[0].assignedWorkerIds, ['worker-1']);
  assert.deepEqual(result.eventPatch.roles[1].waitlistWorkerIds, []);
  assert.equal(result.eventPatch.revision, 5);
  assert.equal(result.notificationPatch.status, 'accepted');
  assert.equal(result.managerNotification.body, 'Taylor accepted Box Office for Opening Night.');
  assert.equal(result.shouldQueueReminder, true);
});

test('declining an assignment retains Event access and waitlist eligibility', () => {
  const result = buildEventRoleResponse({ notification, event, workerId: 'worker-1', workerName: 'Taylor', response: 'decline' });
  assert.deepEqual(result.eventPatch.roles[0].eligibleWaitlistWorkerIds, ['worker-1']);
  assert.deepEqual(result.eventPatch.workerIds, ['worker-2', 'worker-3', 'worker-1']);
  assert.equal(result.notificationPatch.status, 'declined');
  assert.equal(result.shouldQueueReminder, false);
});

test('declining removal restores the worker while accepting removal leaves the Event unchanged', () => {
  const removal = { ...notification, action: 'remove' };
  const declined = buildEventRoleResponse({ notification: removal, event, workerId: 'worker-1', workerName: 'Taylor', response: 'decline' });
  assert.deepEqual(declined.eventPatch.roles[0].assignedWorkerIds, ['worker-1']);
  const accepted = buildEventRoleResponse({ notification: removal, event, workerId: 'worker-1', workerName: 'Taylor', response: 'accept' });
  assert.equal(accepted.eventPatch, null);
  assert.equal(accepted.notificationPatch.status, 'accepted');
});

test('full roles, cross-user responses, and stale responses are handled safely', () => {
  assert.throws(() => buildEventRoleResponse({
    notification,
    event: { ...event, roles: [{ ...event.roles[0], assignedWorkerIds: ['worker-9'], openSlots: 0 }] },
    workerId: 'worker-1',
    workerName: 'Taylor',
    response: 'accept',
  }), /full/);
  assert.throws(() => buildEventRoleResponse({ notification, event, workerId: 'worker-9', workerName: 'Other', response: 'accept' }), /another user/);
  assert.equal(buildEventRoleResponse({
    notification: { ...notification, status: 'accepted' }, event, workerId: 'worker-1', workerName: 'Taylor', response: 'accept',
  }).alreadyHandled, true);
});
