import { describe, expect, it } from 'vitest';
import { buildLateTaskNotificationTargets } from '../lib/task-notification-targets';

describe('buildLateTaskNotificationTargets', () => {
  it('targets every organization Manager exactly once and preserves the creator legacy ID', () => {
    expect(buildLateTaskNotificationTargets({
      eventManagerId: 'manager-1',
      organizationManagerIds: ['manager-2', 'manager-1', 'manager-2'],
      eventId: 'event-1',
      roleId: 'role-1',
      taskId: 'task-1',
    })).toEqual([
      { managerId: 'manager-1', notificationId: 'behind_schedule__event-1__role-1__task-1' },
      { managerId: 'manager-2', notificationId: 'behind_schedule__event-1__role-1__task-1__manager-2' },
    ]);
  });
});
