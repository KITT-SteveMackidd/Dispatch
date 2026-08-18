import { describe, expect, it } from 'vitest';
import {
  getAvailableRoleSlots,
  getWorkerRoleAction,
  getWorkerRoleActionFromNotification,
  getWorkerVisibleRoles,
  isWorkerRoleNotificationVisible,
  keepLatestWorkerRoleNotifications,
  mergeWorkerRoleAvailability,
} from '../lib/worker-role-action';
import type { EventRole } from '../types/dispatch';

describe('getWorkerRoleAction', () => {
  it('offers Accept whenever the role has an open slot', () => {
    expect(getWorkerRoleAction({ openSlots: 1, assignedWorkerIds: [], waitlistWorkerIds: [] }, 'worker-1')).toBe('accept');
    expect(getWorkerRoleAction({ openSlots: 1, assignedWorkerIds: [], waitlistWorkerIds: ['worker-1'] }, 'worker-1')).toBe('accept');
  });

  it('offers Accept for an unfilled role when stored availability is missing or stale', () => {
    expect(getAvailableRoleSlots({ assignedWorkerIds: [] })).toBe(1);
    expect(getWorkerRoleAction({ openSlots: 0, assignedWorkerIds: [], waitlistWorkerIds: [] }, 'worker-1')).toBe('accept');
  });

  it('offers Join Waitlist when a full role has not been waitlisted', () => {
    expect(getWorkerRoleAction({ openSlots: 0, assignedWorkerIds: ['worker-2'], waitlistWorkerIds: [] }, 'worker-1')).toBe('join_waitlist');
  });

  it('shows Waitlisted when the worker is already waiting on a full role', () => {
    expect(getWorkerRoleAction({ openSlots: 0, assignedWorkerIds: ['worker-2'], waitlistWorkerIds: ['worker-1'] }, 'worker-1')).toBe('waitlisted');
  });

  it('overlays live invite state onto a stale cached Event role', () => {
    const staleRole: EventRole = {
      id: 'role-1',
      name: 'Box Office',
      assignedWorkerIds: ['former-worker'],
      waitlistWorkerIds: [],
      openSlots: 0,
      tasks: [],
    };

    const mergedRole = mergeWorkerRoleAvailability(staleRole, {
      roleOpenSlots: 1,
      roleAssignedWorkerIds: [],
      roleWaitlistWorkerIds: [],
    });

    expect(mergedRole.assignedWorkerIds).toEqual([]);
    expect(mergedRole.openSlots).toBe(1);
    expect(getWorkerRoleAction(mergedRole, 'worker-1')).toBe('accept');
  });

  it('uses the same notification availability for invite and Event-card actions', () => {
    const notification = {
      roleOpenSlots: 1,
      roleAssignedWorkerIds: [],
      roleWaitlistWorkerIds: [],
    };

    expect(getWorkerRoleActionFromNotification(notification, 'worker-1')).toBe('accept');
  });

  it('keeps the newest notification for each Event role', () => {
    const notifications = [
      { id: 'new', eventId: 'event-1', roleId: 'role-1', roleOpenSlots: 1 },
      { id: 'old', eventId: 'event-1', roleId: 'role-1', roleOpenSlots: 0 },
      { id: 'other', eventId: 'event-1', roleId: 'role-2', roleOpenSlots: 0 },
    ];

    expect(keepLatestWorkerRoleNotifications(notifications).map((item) => item.id))
      .toEqual(['new', 'other']);
  });

  it('shows only roles the worker is invited to, assigned to, or waitlisted for', () => {
    const roles = [
      { id: 'assigned', name: 'Assigned', assignedWorkerIds: ['worker-1'], openSlots: 0, tasks: [] },
      { id: 'pending', name: 'Pending', assignedWorkerIds: [], openSlots: 1, tasks: [] },
      { id: 'waitlisted', name: 'Waitlisted', assignedWorkerIds: ['worker-2'], waitlistWorkerIds: ['worker-1'], openSlots: 0, tasks: [] },
      { id: 'unrelated', name: 'Unrelated', assignedWorkerIds: ['worker-2'], openSlots: 0, tasks: [] },
    ] satisfies EventRole[];

    expect(getWorkerVisibleRoles(roles, 'worker-1', ['pending']).map((role) => role.id))
      .toEqual(['assigned', 'pending', 'waitlisted']);
  });
});

describe('isWorkerRoleNotificationVisible', () => {
  it('keeps pending, declined-eligible, and waitlisted role states visible', () => {
    expect(isWorkerRoleNotificationVisible({
      action: 'assign',
      status: 'pending',
    }, 'worker-1')).toBe(true);

    expect(isWorkerRoleNotificationVisible({
      action: 'assign',
      status: 'declined',
      roleEligibleWaitlistWorkerIds: ['worker-1'],
    }, 'worker-1')).toBe(true);

    expect(isWorkerRoleNotificationVisible({
      action: 'assign',
      status: 'waitlisted',
      roleWaitlistWorkerIds: ['worker-1'],
    }, 'worker-1')).toBe(true);
  });

  it('hides a backend-synced declined invite after every live role membership is removed', () => {
    expect(isWorkerRoleNotificationVisible({
      action: 'assign',
      status: 'declined',
      roleAssignedWorkerIds: [],
      roleWaitlistWorkerIds: [],
      roleEligibleWaitlistWorkerIds: [],
      roleWaitlistInviteWorkerIds: [],
    }, 'worker-1')).toBe(false);
  });

  it('lets a removal tombstone override a duplicate pending invite from another Manager', () => {
    const notifications = keepLatestWorkerRoleNotifications([
      {
        id: 'other-manager-pending',
        managerId: 'manager-2',
        eventId: 'event-1',
        roleId: 'role-1',
        action: 'assign' as const,
        status: 'pending' as const,
        roleRemovedWorkerIds: ['worker-1'],
      },
      {
        id: 'accepted-then-removed',
        managerId: 'manager-1',
        eventId: 'event-1',
        roleId: 'role-1',
        action: 'assign' as const,
        status: 'declined' as const,
        roleRemovedWorkerIds: ['worker-1'],
      },
    ]);

    expect(notifications.map((notification) => notification.id)).toEqual(['other-manager-pending']);
    expect(isWorkerRoleNotificationVisible(notifications[0], 'worker-1')).toBe(false);
  });

  it('shows a new pending invite after the Manager clears the removal tombstone', () => {
    expect(isWorkerRoleNotificationVisible({
      action: 'assign',
      status: 'pending',
      roleRemovedWorkerIds: [],
    }, 'worker-1')).toBe(true);
  });

  it('hides accepted and remove notifications from invite cards', () => {
    expect(isWorkerRoleNotificationVisible({
      action: 'assign',
      status: 'accepted',
    }, 'worker-1')).toBe(false);
    expect(isWorkerRoleNotificationVisible({
      action: 'remove',
      status: 'declined',
      roleEligibleWaitlistWorkerIds: ['worker-1'],
    }, 'worker-1')).toBe(false);
  });
});
