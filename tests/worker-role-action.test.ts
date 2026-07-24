import { describe, expect, it } from 'vitest';
import {
  getAvailableRoleSlots,
  getWorkerRoleAction,
  getWorkerRoleActionFromNotification,
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
});
