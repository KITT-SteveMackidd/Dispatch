import { DispatchEvent, UserProfile } from '@/types/dispatch';

export type WorkerRoleExport = {
  dates: string[];
  rows: Array<{ roleTitle: string; workersByDate: Record<string, string[]> }>;
};

export function buildWorkerRoleExport(events: DispatchEvent[], workers: UserProfile[]): WorkerRoleExport {
  const workerNames = new Map(workers.map((worker) => [worker.uid, worker.displayName || 'Dispatch User']));
  const roleRows = new Map<string, Map<string, Set<string>>>();
  const usedDates = new Set<string>();

  events.forEach((event) => {
    const date = toLocalDateKey(event.startsAt);
    if (!date) return;

    event.roles.forEach((role) => {
      const assignedWorkers = role.assignedWorkerIds || [];
      if (!assignedWorkers.length) return;

      usedDates.add(date);
      const datesForRole = roleRows.get(role.name) || new Map<string, Set<string>>();
      const namesForDate = datesForRole.get(date) || new Set<string>();
      assignedWorkers.forEach((workerId) => namesForDate.add(workerNames.get(workerId) || workerId));
      datesForRole.set(date, namesForDate);
      roleRows.set(role.name, datesForRole);
    });
  });

  const dates = [...usedDates].sort();
  const rows = [...roleRows.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([roleTitle, datesForRole]) => ({
      roleTitle,
      workersByDate: Object.fromEntries(
        dates.map((date) => [date, [...(datesForRole.get(date) || [])].sort((left, right) => left.localeCompare(right))])
      ),
    }));

  return { dates, rows };
}

export function toLocalDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
