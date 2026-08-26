const test = require('node:test');
const assert = require('node:assert/strict');
const { removeWorkerFromEventMembership } = require('../lib/event-membership');

test('removes an organization member from every event role, task, and worker index', () => {
  const roles = [{
    id: 'role-1',
    assignedWorkerIds: ['worker-1', 'worker-2'],
    waitlistWorkerIds: ['worker-1', 'worker-3'],
    eligibleWaitlistWorkerIds: ['worker-1'],
    waitlistInviteWorkerIds: ['worker-1', 'worker-4'],
    removedWorkerIds: ['worker-1', 'worker-5'],
    openSlots: 0,
    tasks: [{ id: 'task-1', completedBy: ['worker-1', 'worker-2'] }],
  }, {
    id: 'role-2',
    assignedWorkerIds: ['worker-1'],
    openSlots: 2,
    tasks: [],
  }];

  const result = removeWorkerFromEventMembership(roles, 'worker-1');

  assert.equal(result.changed, true);
  assert.deepEqual(result.roles[0], {
    ...roles[0],
    assignedWorkerIds: ['worker-2'],
    waitlistWorkerIds: ['worker-3'],
    eligibleWaitlistWorkerIds: [],
    waitlistInviteWorkerIds: ['worker-4'],
    removedWorkerIds: ['worker-5'],
    openSlots: 1,
    tasks: [{ id: 'task-1', completedBy: ['worker-2'] }],
  });
  assert.equal(result.roles[1].openSlots, 3);
  assert.deepEqual(result.workerIds, ['worker-2', 'worker-3', 'worker-4']);
  assert.deepEqual(roles[0].assignedWorkerIds, ['worker-1', 'worker-2']);
});

test('keeps open slots stable when removing only waitlist and completion references', () => {
  const result = removeWorkerFromEventMembership([{
    id: 'role-1',
    assignedWorkerIds: ['worker-2'],
    waitlistWorkerIds: ['worker-1'],
    openSlots: 4,
    tasks: [{ id: 'task-1', completedBy: ['worker-1'] }],
  }], 'worker-1');

  assert.equal(result.changed, true);
  assert.equal(result.roles[0].openSlots, 4);
  assert.deepEqual(result.workerIds, ['worker-2']);
});

test('normalizes an empty target without mutating roles', () => {
  const roles = [{ id: 'role-1', assignedWorkerIds: ['worker-1'], openSlots: 0, tasks: [] }];
  const result = removeWorkerFromEventMembership(roles, '  ');
  assert.equal(result.changed, false);
  assert.equal(result.roles, roles);
  assert.deepEqual(result.workerIds, ['worker-1']);
});
