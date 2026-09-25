import { describe, expect, it } from 'vitest';
import { buildEventSchedule, formatEventTimeRange } from '../lib/event-schedule';

describe('buildEventSchedule', () => {
  it('keeps the end time optional', () => {
    const schedule = buildEventSchedule('2026-09-21', '18:30');

    expect(schedule).toHaveProperty('startsAt');
    expect(schedule).not.toHaveProperty('endsAt');
  });

  it('stores a same-day end time', () => {
    const schedule = buildEventSchedule('2026-09-21', '18:30', '21:00');

    expect(Date.parse(schedule.endsAt!) - Date.parse(schedule.startsAt)).toBe(150 * 60 * 1000);
  });

  it('treats an end time at or before the start as an overnight event', () => {
    const schedule = buildEventSchedule('2026-09-21', '23:00', '01:00');

    expect(Date.parse(schedule.endsAt!) - Date.parse(schedule.startsAt)).toBe(2 * 60 * 60 * 1000);
  });

  it('rejects invalid end times', () => {
    expect(() => buildEventSchedule('2026-09-21', '18:30', 'not-a-time')).toThrow('valid event end time');
  });
});

describe('formatEventTimeRange', () => {
  it('shows only the start time when no end time was provided', () => {
    const startsAt = '2026-09-21T18:30:00.000Z';

    expect(formatEventTimeRange(startsAt)).toBe(
      new Date(startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    );
  });

  it('includes the end date for an overnight event', () => {
    const startsAt = new Date(2026, 8, 21, 23, 0).toISOString();
    const endsAt = new Date(2026, 8, 22, 1, 0).toISOString();

    expect(formatEventTimeRange(startsAt, endsAt)).toContain(
      new Date(endsAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
    );
  });
});
