import { describe, expect, it } from 'vitest';
import { resolveChatRouteFromNotification } from '../services/notification-routing';

describe('notification routing', () => {
  it('routes team broadcast threads to all chat', () => {
    const route = resolveChatRouteFromNotification({
      kind: 'chat',
      threadId: 'team:team-1:all',
      threadTitle: 'Box Office',
      participantIds: ['manager-1', 'worker-1'],
    }, 'u1');

    expect(route).toEqual({
      workerId: 'all:team-1',
      workerLabel: 'Box Office',
      teamId: 'team-1',
      teamName: 'Box Office',
      teamMemberIds: 'manager-1,worker-1',
      isTeamAll: '1',
      teamThreadId: 'team:team-1:all',
      teamThreadPath: 'All Team workers and organization managers',
    });
  });

  it('routes DM threads using non-current participant', () => {
    const route = resolveChatRouteFromNotification({
      kind: 'chat',
      threadId: 'team:team-1:dm:u1__u2',
      teamId: 'team-1',
    }, 'u1');

    expect(route).toEqual({
      workerId: 'u2',
      workerLabel: 'Teammate',
      teamId: 'team-1',
    });
  });

  it('routes a worker notification to the shared managers group', () => {
    const route = resolveChatRouteFromNotification({
      kind: 'chat',
      threadId: 'organization:org-1:managers:worker-1',
      organizationId: 'org-1',
      threadTitle: 'Casey Worker',
      participantIds: ['manager-1', 'manager-2', 'worker-1'],
    }, 'worker-1');

    expect(route).toEqual({
      workerId: 'worker-1',
      workerLabel: 'Managers',
      teamName: 'Managers',
      teamMemberIds: 'manager-1,manager-2,worker-1',
      isTeamAll: '1',
      teamThreadId: 'organization:org-1:managers:worker-1',
      teamThreadPath: 'Worker and all organization managers',
    });
  });

  it('falls back to sender id when thread parsing is not possible', () => {
    const route = resolveChatRouteFromNotification({ kind: 'chat', senderId: 'u9' }, 'u1');
    expect(route).toEqual({ workerId: 'u9', workerLabel: 'Teammate', teamId: undefined });
  });
});
