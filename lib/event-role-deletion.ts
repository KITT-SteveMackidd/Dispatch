import type { DispatchEvent, EventRole } from '@/types/dispatch';

export function removeEventRoleAndRebuildWorkers(roles: EventRole[], roleId: string) {
  const nextRoles = roles.filter((role) => role.id !== roleId);
  const workerIds = [...new Set(nextRoles.flatMap((role) => [
    ...(role.assignedWorkerIds || []),
    ...(role.waitlistWorkerIds || []),
    ...(role.eligibleWaitlistWorkerIds || []),
    ...(role.waitlistInviteWorkerIds || []),
  ]).filter(Boolean))];
  return { roles: nextRoles, workerIds };
}

export function mergePersistedAndOptimisticEvents(persisted: DispatchEvent[], optimistic: DispatchEvent[]) {
  const persistedIds = new Set(persisted.map((event) => event.id));
  return [...persisted, ...optimistic.filter((event) => !persistedIds.has(event.id))];
}
