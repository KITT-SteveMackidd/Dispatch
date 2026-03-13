import { describe, expect, it } from 'vitest';
import { resolveChatRouteFromNotification } from '../services/notification-routing';

describe('notification routing', () => {
  it('routes team broadcast threads to all chat', () => {
    const route = resolveChatRouteFromNotification({
      kind: 'chat',
      threadId: 'team:team-1:all',
    }, 'u1');

    expect(route).toEqual({
      workerId: 'all:team-1',
      workerLabel: 'All',
      teamId: 'team-1',
      isTeamAll: '1',
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

  it('falls back to sender id when thread parsing is not possible', () => {
    const route = resolveChatRouteFromNotification({ kind: 'chat', senderId: 'u9' }, 'u1');
    expect(route).toEqual({ workerId: 'u9', workerLabel: 'Teammate', teamId: undefined });
  });
});
