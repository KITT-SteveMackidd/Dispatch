const assert = require('node:assert/strict');
const test = require('node:test');
const { eventAccessForRoleInvitation } = require('../lib/event-role-access');

const notification = {
  workerId: 'worker-1',
  eventId: 'event-1',
  roleId: 'role-1',
  action: 'assign',
  status: 'pending',
};
const event = {
  workerIds: ['worker-2'],
  roles: [{ id: 'role-1', assignedWorkerIds: [] }],
};

test('pending role invite grants Event access without changing role assignment', () => {
  const result = eventAccessForRoleInvitation(notification, event, 'worker-1');
  assert.deepEqual(result, { changed: true, workerIds: ['worker-2', 'worker-1'] });
  assert.deepEqual(event.roles[0].assignedWorkerIds, []);
});

test('existing Event access is an idempotent no-op', () => {
  const result = eventAccessForRoleInvitation(
    notification,
    { ...event, workerIds: ['worker-1', 'worker-2'] },
    'worker-1'
  );
  assert.deepEqual(result, { changed: false, workerIds: ['worker-1', 'worker-2'] });
});

test('another user cannot repair someone else\'s invitation', () => {
  assert.throws(
    () => eventAccessForRoleInvitation(notification, event, 'worker-3'),
    /belongs to another user/
  );
});

test('removed roles and inactive invitations are rejected', () => {
  assert.throws(
    () => eventAccessForRoleInvitation({ ...notification, status: 'accepted' }, event, 'worker-1'),
    /no longer available/
  );
  assert.throws(
    () => eventAccessForRoleInvitation(notification, { ...event, roles: [] }, 'worker-1'),
    /no longer exists/
  );
});
