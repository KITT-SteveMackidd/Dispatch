import { describe, expect, it } from 'vitest';
import { clearWorkerTaskCompletions, computeEventTaskProgress, computeRoleTaskProgress, getEventOperationalWindow, isEventOperationalAt, isEventVisibleOnToday, sortEventsByDate } from '../services/event-logic';
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

  it('ignores stale completions from cancelled Workers and clears them on cancellation', () => {
    const role = {
      id: 'r1',
      name: 'Crew',
      assignedWorkerIds: ['replacement'],
      openSlots: 0,
      tasks: [{ id: 't1', name: 'Setup', completedBy: ['cancelled-worker'] }],
    };
    const event = makeEvent({ roles: [role] });

    expect(computeEventTaskProgress(event)).toEqual({ total: 1, done: 0, percent: 0 });
    expect(clearWorkerTaskCompletions({ ...role, assignedWorkerIds: ['cancelled-worker'] }, 'cancelled-worker').tasks[0].completedBy).toEqual([]);
  });

  it('uses a two-hour lead and two-hour trail around the last task deadline', () => {
    const event = makeEvent({
      startsAt: '2026-08-01T01:00:00.000Z',
      endsAt: '2026-08-01T03:00:00.000Z',
      roles: [{
        id: 'r1',
        name: 'Crew',
        assignedWorkerIds: ['w1'],
        openSlots: 0,
        tasks: [{ id: 'late', name: 'Close', expectedOffsetMinutes: 240 }],
      }],
    });

    expect(getEventOperationalWindow(event)).toEqual({
      startsAtMs: Date.parse('2026-07-31T23:00:00.000Z'),
      endsAtMs: Date.parse('2026-08-01T07:00:00.000Z'),
    });
    expect(isEventOperationalAt(event, Date.parse('2026-07-31T23:30:00.000Z'))).toBe(true);
    expect(isEventOperationalAt(event, Date.parse('2026-08-01T06:30:00.000Z'))).toBe(true);
    expect(isEventOperationalAt(event, Date.parse('2026-08-01T07:00:00.001Z'))).toBe(false);
  });

  it('shows every event dated today in the device local calendar', () => {
    const now = new Date(2026, 6, 31, 14, 0).getTime();
    const event = makeEvent({
      startsAt: new Date(2026, 6, 31, 20, 0).toISOString(),
      endsAt: new Date(2026, 6, 31, 22, 0).toISOString(),
    });

    expect(isEventVisibleOnToday(event, now)).toBe(true);
  });

  it('shows adjacent-day events only inside their extended operational window', () => {
    const tomorrowEvent = makeEvent({
      startsAt: new Date(2026, 7, 1, 1, 0).toISOString(),
      endsAt: new Date(2026, 7, 1, 3, 0).toISOString(),
    });
    const yesterdayEvent = makeEvent({
      startsAt: new Date(2026, 6, 30, 20, 0).toISOString(),
      endsAt: new Date(2026, 6, 30, 22, 0).toISOString(),
      roles: [{
        id: 'r1',
        name: 'Crew',
        assignedWorkerIds: ['w1'],
        openSlots: 0,
        tasks: [{ id: 'late', name: 'Close', expectedOffsetMinutes: 180 }],
      }],
    });

    expect(isEventVisibleOnToday(tomorrowEvent, new Date(2026, 6, 31, 22, 59).getTime())).toBe(false);
    expect(isEventVisibleOnToday(tomorrowEvent, new Date(2026, 6, 31, 23, 30).getTime())).toBe(true);
    expect(isEventVisibleOnToday(yesterdayEvent, new Date(2026, 6, 31, 0, 30).getTime())).toBe(true);
    expect(isEventVisibleOnToday(yesterdayEvent, new Date(2026, 6, 31, 1, 0, 0, 1).getTime())).toBe(false);
  });

  it('does not surface events more than one local calendar day away', () => {
    const event = makeEvent({
      startsAt: new Date(2026, 7, 2, 1, 0).toISOString(),
      endsAt: new Date(2026, 7, 2, 3, 0).toISOString(),
    });

    expect(isEventVisibleOnToday(event, new Date(2026, 6, 31, 23, 30).getTime())).toBe(false);
  });
});
