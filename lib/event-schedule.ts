export type EventSchedule = {
  startsAt: string;
  endsAt?: string;
};

function parseLocalDateTime(date: string, time: string) {
  const parsed = new Date(`${date.trim()}T${time.trim()}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildEventSchedule(date: string, startTime: string, endTime?: string): EventSchedule {
  const startsAt = parseLocalDateTime(date, startTime);
  if (!startsAt) throw new Error('Enter a valid event date and time.');

  const trimmedEndTime = endTime?.trim() || '';
  if (!trimmedEndTime) return { startsAt: startsAt.toISOString() };

  const endsAt = parseLocalDateTime(date, trimmedEndTime);
  if (!endsAt) throw new Error('Enter a valid event end time.');

  if (endsAt.getTime() <= startsAt.getTime()) {
    endsAt.setDate(endsAt.getDate() + 1);
  }

  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };
}

export function formatEventTimeRange(startsAt: string, endsAt?: string) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return 'TBD';

  const startTime = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (!endsAt) return startTime;

  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) return startTime;

  const endTime = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (start.toDateString() === end.toDateString()) return `${startTime} - ${endTime}`;

  const endDate = end.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${startTime} - ${endDate}, ${endTime}`;
}
