import { describe, expect, it } from 'vitest';
import { computeEventTaskProgress, computeRoleTaskProgress, sortEventsByDate } from '../services/event-logic';
import { DispatchEvent } from '../types/dispatch';

const makeEvent = (overrides: Partial<DispatchEvent>): DispatchEvent => ({
  id: overrides.id || 'e1',
  managerId: overrides.managerId || 'm1',
  name: overrides.name || 'Event',
  location: overrides.location || 'Test',
  startsAt: overrides.startsAt || '2026-03-13T12:00:00.000Z',
  endsAt: overrides.endsAt,
  teamIds: overrides.teamIds || [],
  roles: overrides.roles || [],
});

describe('event-logic', () => {
  it('sorts events by start time then name', () => {
    const events = [
      makeEvent({ id: 'b', name: 'B', startsAt: '2026-03-14T12:00:00.000Z' }),
      makeEvent({ id: 'a', name: 'A', startsAt: '2026-03-13T12:00:00.000Z' }),
      makeEvent({ id: 'c', name: 'C', startsAt: '2026-03-13T12:00:00.000Z' }),
    ];

    const sorted = sortEventsByDate(events).map((e) => e.id);
    expect(sorted).toEqual(['a', 'c', 'b']);
  });

  it('computes event progress and excludes unfilled roles when requested', () => {
    const event = makeEvent({
      roles: [
        {
          id: 'r1',
          name: 'Filled',
          assignedWorkerIds: ['w1'],
          openSlots: 0,
          tasks: [
            { id: 't1', name: 'Done', completedBy: ['w1'] },
            { id: 't2', name: 'Todo', completedBy: [] },
          ],
        },
        {
          id: 'r2',
          name: 'Unfilled',
          assignedWorkerIds: [],
          openSlots: 1,
          tasks: [{ id: 't3', name: 'Unfilled task', completedBy: [] }],
        },
      ],
    });

    expect(computeEventTaskProgress(event)).toEqual({ total: 3, done: 1, percent: 33 });
    expect(computeEventTaskProgress(event, { excludeUnfilledRoles: true })).toEqual({ total: 2, done: 1, percent: 50 });
  });

  it('computes role progress for all completions or worker-specific completions', () => {
    const role = {
      id: 'r1',
      name: 'Ops',
      assignedWorkerIds: ['w1', 'w2'],
      openSlots: 0,
      tasks: [
        { id: 'a', name: 'A', completedBy: ['w1'] },
        { id: 'b', name: 'B', completedBy: ['w2'] },
        { id: 'c', name: 'C', completedBy: [] },
      ],
    };

    expect(computeRoleTaskProgress(role)).toEqual({ total: 3, done: 2, percent: 67 });
    expect(computeRoleTaskProgress(role, 'w1')).toEqual({ total: 3, done: 1, percent: 33 });
  });
});
