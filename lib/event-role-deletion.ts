import type { DispatchEvent, EventRole } from '@/types/dispatch';

export function rebuildEventWorkerIds(roles: EventRole[]) {
  return [...new Set(roles.flatMap((role) => [
    ...(role.assignedWorkerIds || []),
    ...(role.waitlistWorkerIds || []),
    ...(role.eligibleWaitlistWorkerIds || []),
    ...(role.waitlistInviteWorkerIds || []),
  ]).filter(Boolean))];
}

export function removeEventRoleAndRebuildWorkers(roles: EventRole[], roleId: string) {
  const nextRoles = roles.filter((role) => role.id !== roleId);
  const workerIds = rebuildEventWorkerIds(nextRoles);
  return { roles: nextRoles, workerIds };
}

export function removeWorkerFromEventRoleAndRebuildWorkers(
  roles: EventRole[],
  roleId: string,
  workerId: string
) {
  let waitlistWorkerIdsToNotify: string[] = [];
  const nextRoles = roles.map((role) => {
    if (role.id !== roleId) return role;

    const waitlistWorkerIds = (role.waitlistWorkerIds || []).filter((id) => id !== workerId);
    waitlistWorkerIdsToNotify = waitlistWorkerIds;

    return {
      ...role,
      assignedWorkerIds: (role.assignedWorkerIds || []).filter((id) => id !== workerId),
      waitlistWorkerIds,
      eligibleWaitlistWorkerIds: (role.eligibleWaitlistWorkerIds || []).filter((id) => id !== workerId),
      waitlistInviteWorkerIds: [...new Set([
        ...(role.waitlistInviteWorkerIds || []).filter((id) => id !== workerId),
        ...waitlistWorkerIds,
      ])],
      removedWorkerIds: [...new Set([...(role.removedWorkerIds || []), workerId])],
      openSlots: (role.openSlots || 0) + 1,
    };
  });

  return {
    roles: nextRoles,
    workerIds: rebuildEventWorkerIds(nextRoles),
    waitlistWorkerIdsToNotify,
  };
}

export function clearWorkerEventRoleRemoval(
  roles: EventRole[],
  roleId: string,
  workerId: string
) {
  const nextRoles = roles.map((role) => (
    role.id === roleId
      ? {
          ...role,
          removedWorkerIds: (role.removedWorkerIds || []).filter((id) => id !== workerId),
        }
      : role
  ));

  return {
    roles: nextRoles,
    workerIds: rebuildEventWorkerIds(nextRoles),
  };
}

export function mergePersistedAndOptimisticEvents(persisted: DispatchEvent[], optimistic: DispatchEvent[]) {
  const persistedIds = new Set(persisted.map((event) => event.id));
  return [...persisted, ...optimistic.filter((event) => !persistedIds.has(event.id))];
}
