import { DispatchEvent, EventRole, EventTask } from '../types/dispatch';

function parseEventDateTime(value?: string) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function sortEventsByDate(items: DispatchEvent[]) {
  return [...items].sort((a, b) => {
    const aStartsAt = parseEventDateTime(a.startsAt);
    const bStartsAt = parseEventDateTime(b.startsAt);
    if (aStartsAt !== bStartsAt) return aStartsAt - bStartsAt;

    const aEndsAt = parseEventDateTime(a.endsAt ?? a.startsAt);
    const bEndsAt = parseEventDateTime(b.endsAt ?? b.startsAt);
    if (aEndsAt !== bEndsAt) return aEndsAt - bEndsAt;

    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;

    return a.id.localeCompare(b.id);
  });
}

export function computeRoleTaskProgress(role: EventRole, workerId?: string) {
  const tasks = role.tasks || [];
  const total = tasks.length;
  const assignedWorkerIds = new Set(role.assignedWorkerIds || []);

  const done = tasks.filter((task: EventTask) => {
    const completedBy = task.completedBy || [];
    return workerId
      ? assignedWorkerIds.has(workerId) && completedBy.includes(workerId)
      : completedBy.some((completedWorkerId) => assignedWorkerIds.has(completedWorkerId));
  }).length;

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, percent };
}

export function computeEventTaskProgress(event: DispatchEvent, options?: { excludeUnfilledRoles?: boolean }) {
  const roles = options?.excludeUnfilledRoles
    ? event.roles.filter((role) => (role.assignedWorkerIds?.length ?? 0) > 0)
    : event.roles;

  const total = roles.reduce((sum, role) => sum + (role.tasks || []).length, 0);
  const done = roles.reduce((sum, role) => sum + computeRoleTaskProgress(role).done, 0);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return { total, done, percent };
}

export function clearWorkerTaskCompletions(role: EventRole, workerId: string): EventRole {
  return {
    ...role,
    tasks: (role.tasks || []).map((task) => ({
      ...task,
      completedBy: (task.completedBy || []).filter((completedWorkerId) => completedWorkerId !== workerId),
    })),
  };
}

export function getEventOperationalWindow(event: DispatchEvent, leadMinutes = 120, trailMinutes = 120) {
  const startsAtMs = new Date(event.startsAt).getTime();
  if (!Number.isFinite(startsAtMs)) return null;

  const candidateEndTimes = [startsAtMs];
  const endsAtMs = event.endsAt ? new Date(event.endsAt).getTime() : Number.NaN;
  if (Number.isFinite(endsAtMs)) candidateEndTimes.push(endsAtMs);

  event.roles.forEach((role) => {
    (role.tasks || []).forEach((task) => {
      const dueAtMs = task.dueAt ? new Date(task.dueAt).getTime() : Number.NaN;
      if (Number.isFinite(dueAtMs)) {
        candidateEndTimes.push(dueAtMs);
        return;
      }
      if (Number.isFinite(task.expectedOffsetMinutes)) {
        candidateEndTimes.push(startsAtMs + Math.max(0, task.expectedOffsetMinutes as number) * 60 * 1000);
      }
    });
  });

  return {
    startsAtMs: startsAtMs - Math.max(0, leadMinutes) * 60 * 1000,
    endsAtMs: Math.max(...candidateEndTimes) + Math.max(0, trailMinutes) * 60 * 1000,
  };
}

export function isEventOperationalAt(event: DispatchEvent, timestamp: number, leadMinutes = 120, trailMinutes = 120) {
  const window = getEventOperationalWindow(event, leadMinutes, trailMinutes);
  return Boolean(window && timestamp >= window.startsAtMs && timestamp <= window.endsAtMs);
}

function localCalendarDayNumber(timestamp: number) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / (24 * 60 * 60 * 1000);
}

export function isEventVisibleOnToday(event: DispatchEvent, timestamp: number) {
  const eventStartsAtMs = new Date(event.startsAt).getTime();
  const eventDay = localCalendarDayNumber(eventStartsAtMs);
  const currentDay = localCalendarDayNumber(timestamp);
  if (eventDay === null || currentDay === null) return false;

  const dayDifference = eventDay - currentDay;
  if (dayDifference === 0) return true;
  if (Math.abs(dayDifference) !== 1) return false;

  return isEventOperationalAt(event, timestamp);
}
