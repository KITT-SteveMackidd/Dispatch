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

  const done = tasks.filter((task: EventTask) => {
    const completedBy = task.completedBy || [];
    return workerId ? completedBy.includes(workerId) : completedBy.length > 0;
  }).length;

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, percent };
}

export function computeEventTaskProgress(event: DispatchEvent, options?: { excludeUnfilledRoles?: boolean }) {
  const roles = options?.excludeUnfilledRoles
    ? event.roles.filter((role) => (role.assignedWorkerIds?.length ?? 0) > 0)
    : event.roles;

  const tasks = roles.flatMap((role) => role.tasks || []);
  const total = tasks.length;
  const done = tasks.filter((task) => (task.completedBy?.length ?? 0) > 0).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return { total, done, percent };
}
