const test = require('node:test');
const assert = require('node:assert/strict');
const { lateTaskNotificationDocuments, taskDueAtMs } = require('../lib/late-task-notifications');

test('uses the event start plus task offset before the legacy dueAt value', () => {
  assert.equal(taskDueAtMs({ startsAt: '2026-08-04T18:00:00.000Z' }, {
    expectedOffsetMinutes: 30,
    dueAt: '2026-08-04T19:00:00.000Z',
  }), Date.parse('2026-08-04T18:30:00.000Z'));
});

test('creates one deterministic late-task alert for every organization Manager', () => {
  const documents = lateTaskNotificationDocuments({
    nowMs: Date.parse('2026-08-04T18:31:00.000Z'),
    organizationManagerIds: ['manager-2', 'manager-1', 'manager-2'],
    event: {
      id: 'event-1',
      name: 'Concert',
      managerId: 'manager-1',
      startsAt: '2026-08-04T18:00:00.000Z',
      roles: [{
        id: 'role-1',
        name: 'Box Office',
        tasks: [{ id: 'task-1', name: 'Open doors', expectedOffsetMinutes: 30, completedBy: [] }],
      }],
    },
  });

  assert.deepEqual(documents.map(({ id, userId }) => ({ id, userId })), [
    { id: 'behind_schedule__event-1__role-1__task-1', userId: 'manager-1' },
    { id: 'behind_schedule__event-1__role-1__task-1__manager-2', userId: 'manager-2' },
  ]);
  assert.match(documents[0].body, /Concert.*Box Office.*Open doors/);
});

test('skips future and completed tasks', () => {
  const documents = lateTaskNotificationDocuments({
    nowMs: Date.parse('2026-08-04T18:29:00.000Z'),
    organizationManagerIds: [],
    event: {
      id: 'event-1',
      managerId: 'manager-1',
      startsAt: '2026-08-04T18:00:00.000Z',
      roles: [{
        id: 'role-1',
        tasks: [
          { id: 'future', expectedOffsetMinutes: 30, completedBy: [] },
          { id: 'done', expectedOffsetMinutes: 0, completedBy: ['worker-1'] },
        ],
      }],
    },
  });

  assert.deepEqual(documents, []);
});
