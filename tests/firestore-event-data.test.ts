import { describe, expect, it } from 'vitest';
import { buildEventTaskFromTemplate, buildNewEventRoleForFirestore, sanitizeEventRoleForFirestore } from '../lib/firestore-event-data';

function containsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsUndefined);
  if (value && typeof value === 'object') return Object.values(value).some(containsUndefined);
  return false;
}

describe('sanitizeEventRoleForFirestore', () => {
  it('removes undefined optional task fields before a Firestore update', () => {
    const role = sanitizeEventRoleForFirestore({
      id: 'role-1',
      name: 'Box Office',
      assignedWorkerIds: [],
      openSlots: 1,
      tasks: [{
        id: 'task-1',
        name: 'Open doors',
        description: undefined,
        expectedOffsetMinutes: undefined,
        dueAt: undefined,
        attachments: [],
        completedBy: [],
      }],
    });

    expect(containsUndefined(role)).toBe(false);
    expect(role.tasks[0]).not.toHaveProperty('description');
    expect(role.tasks[0]).not.toHaveProperty('expectedOffsetMinutes');
    expect(role.tasks[0]).not.toHaveProperty('dueAt');
  });

  it('copies template descriptions and attachments into event tasks', () => {
    const task = buildEventTaskFromTemplate({
      id: 'task-1',
      name: 'Open doors',
      description: 'Unlock the east and west entrances.',
      attachments: [{ id: 'photo-1', name: 'Door map', url: 'https://example.com/door-map.jpg', kind: 'photo' }],
      expectedOffsetMinutes: 30,
    }, new Date('2026-07-15T10:00:00.000Z').getTime(), 0);

    expect(task).toMatchObject({
      description: 'Unlock the east and west entrances.',
      attachments: [{ id: 'photo-1', name: 'Door map', url: 'https://example.com/door-map.jpg', kind: 'photo' }],
      expectedOffsetMinutes: 30,
      dueAt: '2026-07-15T10:30:00.000Z',
    });
  });

  it('preserves valid countdown and task details', () => {
    const role = sanitizeEventRoleForFirestore({
      id: 'role-1',
      name: 'Box Office',
      assignedWorkerIds: ['worker-1'],
      openSlots: 0,
      tasks: [{
        id: 'task-1',
        name: ' Sign off ',
        description: ' Finish the report ',
        expectedOffsetMinutes: 90,
        dueAt: '2026-07-15T12:00:00.000Z',
        attachments: [],
        completedBy: ['worker-1'],
      }],
    });

    expect(role.tasks[0]).toMatchObject({
      name: 'Sign off',
      description: 'Finish the report',
      expectedOffsetMinutes: 90,
      dueAt: '2026-07-15T12:00:00.000Z',
    });
  });

  it('preserves and deduplicates removed-worker tombstones during role edits', () => {
    const role = sanitizeEventRoleForFirestore({
      id: 'role-1',
      name: 'Box Office',
      assignedWorkerIds: [],
      removedWorkerIds: ['worker-1', 'worker-1', 'worker-2', ''],
      openSlots: 1,
      tasks: [],
    });

    expect(role.removedWorkerIds).toEqual(['worker-1', 'worker-2']);
  });

  it('builds an assignable open role without changing template-shaped task input', () => {
    const tasks = [{ id: 'task-1', name: 'Briefing', expectedOffsetMinutes: 15 }];
    const role = buildNewEventRoleForFirestore('role-new', ' Floor Crew ', tasks, Date.parse('2026-07-31T10:00:00.000Z'));

    expect(role).toMatchObject({
      id: 'role-new',
      name: 'Floor Crew',
      assignedWorkerIds: [],
      openSlots: 1,
      tasks: [{ dueAt: '2026-07-31T10:15:00.000Z' }],
    });
    expect(tasks[0]).not.toHaveProperty('dueAt');
  });
});
