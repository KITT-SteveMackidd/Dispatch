import type { DispatchEvent, EventRole } from '@/types/dispatch';

export type EventDetailsDraft = {
  name: string;
  date: string;
  time: string;
  location: string;
  locationPlaceId: string;
  description: string;
};

export function buildEventDetailsUpdate(event: DispatchEvent, draft: EventDetailsDraft) {
  const name = draft.name.trim();
  const location = draft.location.trim();
  const description = draft.description.trim();
  if (!name) throw new Error('Event name is required.');
  if (!location) throw new Error('Event location is required.');
  if (!draft.locationPlaceId.trim()) throw new Error('Choose the event location from the Google Places suggestions.');

  const startsAt = new Date(`${draft.date.trim()}T${draft.time.trim()}:00`);
  if (Number.isNaN(startsAt.getTime())) throw new Error('Enter a valid event date and time.');

  const previousStartMs = new Date(event.startsAt).getTime();
  const previousEndMs = event.endsAt ? new Date(event.endsAt).getTime() : Number.NaN;
  const durationMs = Number.isFinite(previousStartMs) && Number.isFinite(previousEndMs) && previousEndMs > previousStartMs
    ? previousEndMs - previousStartMs
    : 2 * 60 * 60 * 1000;
  const startsAtMs = startsAt.getTime();

  const roles: EventRole[] = (event.roles || []).map((role) => ({
    ...role,
    tasks: (role.tasks || []).map((task) => {
      if (!Number.isFinite(task.expectedOffsetMinutes)) {
        const { dueAt: _dueAt, ...taskWithoutDueAt } = task;
        return taskWithoutDueAt;
      }
      return {
        ...task,
        dueAt: new Date(startsAtMs + Math.max(0, task.expectedOffsetMinutes as number) * 60 * 1000).toISOString(),
      };
    }),
  }));

  return {
    name,
    location,
    locationPlaceId: draft.locationPlaceId.trim(),
    description,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAtMs + durationMs).toISOString(),
    roles,
  };
}
