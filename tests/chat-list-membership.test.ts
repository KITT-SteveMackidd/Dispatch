import { describe, expect, it } from 'vitest';
import {
  buildCurrentManagerIds,
  buildManagerChatParticipants,
  getVisibleManagerChatWorkerIds,
  shouldLinkPendingWorkerInvites,
} from '../lib/chat-list-membership';

describe('Teams chat-list membership', () => {
  const members = [
    { uid: 'manager-1', role: 'manager' as const },
    { uid: 'former-manager', role: 'worker' as const },
    { uid: 'worker-1', role: 'worker' as const },
  ];

  it('excludes a role-changed Worker from the active manager roster', () => {
    expect(buildCurrentManagerIds(members, { uid: 'former-manager', role: 'worker' }))
      .toEqual(['manager-1']);
  });

  it('shows a Worker only their own chat with current managers', () => {
    const managerIds = buildCurrentManagerIds(members, { uid: 'former-manager', role: 'worker' });
    expect(getVisibleManagerChatWorkerIds(['former-manager', 'worker-1'], { uid: 'former-manager', role: 'worker' }))
      .toEqual(['former-manager']);
    expect(buildManagerChatParticipants('former-manager', managerIds))
      .toEqual(['former-manager', 'manager-1']);
  });

  it('does not revive old team invites when Manager changes to Worker', () => {
    expect(shouldLinkPendingWorkerInvites('manager', 'worker')).toBe(false);
    expect(shouldLinkPendingWorkerInvites(null, 'worker')).toBe(true);
    expect(shouldLinkPendingWorkerInvites('worker', 'worker')).toBe(true);
  });
});
