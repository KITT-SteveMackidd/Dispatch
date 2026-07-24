import { EventRole } from '@/types/dispatch';

export type WorkerRoleAction = 'accept' | 'join_waitlist' | 'waitlisted';

type RoleAvailability = Partial<Pick<EventRole, 'openSlots' | 'assignedWorkerIds' | 'waitlistWorkerIds'>>;

export type WorkerRoleAvailabilitySnapshot = {
  roleOpenSlots?: number;
  roleAssignedWorkerIds?: string[];
  roleWaitlistWorkerIds?: string[];
  roleEligibleWaitlistWorkerIds?: string[];
  roleWaitlistInviteWorkerIds?: string[];
};

export type WorkerRoleNotificationSnapshot = WorkerRoleAvailabilitySnapshot & {
  eventId: string;
  roleId: string;
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
