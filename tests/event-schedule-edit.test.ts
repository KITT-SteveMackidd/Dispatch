import { describe, expect, it } from 'vitest';
import { buildEventDetailsUpdate } from '../lib/event-schedule-edit';
import type { DispatchEvent } from '../types/dispatch';

const event: DispatchEvent = {
  id: 'event-1',
  managerId: 'manager-1',
  name: 'Old event',
  location: 'Old venue',
  startsAt: '2026-07-31T10:00:00.000Z',
  endsAt: '2026-07-31T12:00:00.000Z',
  teamIds: [],
  roles: [{
    id: 'role-1',
    name: 'Crew',
    assignedWorkerIds: [],
    openSlots: 1,
    tasks: [
      { id: 'timed', name: 'Briefing', expectedOffsetMinutes: 30, dueAt: '2026-07-31T10:30:00.000Z' },
      { id: 'untimed', name: 'Welcome', dueAt: '2026-07-31T11:00:00.000Z' },
    ],
  }],
};

describe('buildEventDetailsUpdate', () => {
  it('moves the event window and recalculates only countdown task deadlines', () => {
    const result = buildEventDetailsUpdate(event, {
      name: ' New event ',
      date: '2026-08-01',
      time: '09:00',
      location: ' New venue ',
      locationPlaceId: 'place-new',
      description: ' Updated ',
    });

    expect(result.name).toBe('New event');
    expect(Date.parse(result.endsAt) - Date.parse(result.startsAt)).toBe(2 * 60 * 60 * 1000);
    expect(Date.parse(result.roles[0].tasks[0].dueAt!) - Date.parse(result.startsAt)).toBe(30 * 60 * 1000);
    expect(result.roles[0].tasks[1]).not.toHaveProperty('dueAt');
    expect(event.roles[0].tasks[0].dueAt).toBe('2026-07-31T10:30:00.000Z');
  });

  it('rejects invalid required fields and schedules', () => {
    expect(() => buildEventDetailsUpdate(event, { name: '', date: 'bad', time: 'bad', location: '', locationPlaceId: '', description: '' })).toThrow('Event name');
  });
});
