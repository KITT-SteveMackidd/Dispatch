import { EventRole } from '@/types/dispatch';

export type WorkerRoleAction = 'accept' | 'join_waitlist' | 'waitlisted';

type RoleAvailability = Partial<Pick<EventRole, 'openSlots' | 'assignedWorkerIds' | 'waitlistWorkerIds'>>;

export type WorkerRoleAvailabilitySnapshot = {
  roleOpenSlots?: number;
  roleAssignedWorkerIds?: string[];
  roleWaitlistWorkerIds?: string[];
  roleEligibleWaitlistWorkerIds?: string[];
  roleWaitlistInviteWorkerIds?: string[];
  roleRemovedWorkerIds?: string[];
};

export type WorkerRoleNotificationSnapshot = WorkerRoleAvailabilitySnapshot & {
  eventId: string;
  roleId: string;
};

type WorkerRoleNotificationVisibilitySnapshot = WorkerRoleAvailabilitySnapshot & {
  action: 'assign' | 'remove';
  status: 'pending' | 'accepted' | 'declined' | 'waitlisted';
};

export function getAvailableRoleSlots(role: RoleAvailability): number {
  const storedOpenSlots = Math.max(0, Number(role.openSlots) || 0);
  if (storedOpenSlots > 0) return storedOpenSlots;
  return (role.assignedWorkerIds || []).length === 0 ? 1 : 0;
}

export function mergeWorkerRoleAvailability(
  role: EventRole,
  snapshot: WorkerRoleAvailabilitySnapshot
): EventRole {
  const assignedWorkerIds = snapshot.roleAssignedWorkerIds ?? role.assignedWorkerIds ?? [];
  const openSlots = getAvailableRoleSlots({
    openSlots: snapshot.roleOpenSlots ?? role.openSlots,
    assignedWorkerIds,
  });

  return {
    ...role,
    assignedWorkerIds,
    waitlistWorkerIds: snapshot.roleWaitlistWorkerIds ?? role.waitlistWorkerIds ?? [],
    eligibleWaitlistWorkerIds: snapshot.roleEligibleWaitlistWorkerIds ?? role.eligibleWaitlistWorkerIds ?? [],
    waitlistInviteWorkerIds: snapshot.roleWaitlistInviteWorkerIds ?? role.waitlistInviteWorkerIds ?? [],
    removedWorkerIds: snapshot.roleRemovedWorkerIds ?? role.removedWorkerIds ?? [],
    openSlots,
  };
}

export function getWorkerRoleAction(
  role: RoleAvailability,
  workerId: string
): WorkerRoleAction {
  if (getAvailableRoleSlots(role) > 0) return 'accept';
  if ((role.waitlistWorkerIds || []).includes(workerId)) return 'waitlisted';
  return 'join_waitlist';
}

export function getWorkerRoleActionFromNotification(
  snapshot: WorkerRoleAvailabilitySnapshot,
  workerId: string
): WorkerRoleAction {
  return getWorkerRoleAction({
    openSlots: snapshot.roleOpenSlots,
    assignedWorkerIds: snapshot.roleAssignedWorkerIds,
    waitlistWorkerIds: snapshot.roleWaitlistWorkerIds,
  }, workerId);
}

export function getWorkerVisibleRoles(roles: EventRole[], workerId: string, pendingRoleIds: Iterable<string> = []) {
  const pending = new Set(pendingRoleIds);
  return roles.filter((role) => (
    (role.assignedWorkerIds || []).includes(workerId)
    || (role.waitlistWorkerIds || []).includes(workerId)
    || (role.eligibleWaitlistWorkerIds || []).includes(workerId)
    || (role.waitlistInviteWorkerIds || []).includes(workerId)
    || pending.has(role.id)
  ));
}

export function isWorkerRoleNotificationVisible(
  notification: WorkerRoleNotificationVisibilitySnapshot,
  workerId: string
) {
  if ((notification.roleRemovedWorkerIds || []).includes(workerId)) return false;
  if (notification.action !== 'assign') return false;
  if (notification.status === 'pending') return true;
  if (notification.status !== 'declined' && notification.status !== 'waitlisted') return false;

  return [
    notification.roleWaitlistWorkerIds,
    notification.roleEligibleWaitlistWorkerIds,
    notification.roleWaitlistInviteWorkerIds,
  ].some((workerIds) => (workerIds || []).includes(workerId));
}

export function keepLatestWorkerRoleNotifications<T extends WorkerRoleNotificationSnapshot>(
  notifications: T[]
): T[] {
  const seenRoleKeys = new Set<string>();
  return notifications.filter((notification) => {
    const roleKey = `${notification.eventId}:${notification.roleId}`;
    if (seenRoleKeys.has(roleKey)) return false;
    seenRoleKeys.add(roleKey);
    return true;
  });
}
