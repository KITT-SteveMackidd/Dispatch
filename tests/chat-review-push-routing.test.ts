import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSafetySnapshot } from '../services/chat-safety';
const mocks = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  safety: null as null | ((state: ChatSafetySnapshot) => void),
  response: null as null | ((value: unknown) => void),
  push: vi.fn(), last: vi.fn(),
}));
vi.mock('react', () => ({ useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect) }));
vi.mock('react-native', () => ({ Alert: {}, AppState: {}, Platform: { OS: 'ios' } }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(), getLastNotificationResponseAsync: mocks.last,
  addNotificationResponseReceivedListener: (callback: (value: unknown) => void) => { mocks.response = callback; return { remove: vi.fn() }; },
}));
vi.mock('@/context/session', () => ({ useSession: () => ({ authUser: { uid: 'manager' }, profile: { uid: 'manager', organizationId: 'org-a', role: 'manager' } }) }));
vi.mock('@/lib/firebase', () => ({ firebaseEmulatorConfiguration: { enabled: true } }));
vi.mock('@/services/chat-safety', () => ({ subscribeToChatSafety: (_params: unknown, callback: (state: ChatSafetySnapshot) => void) => { mocks.safety = callback; return { unsubscribe: vi.fn() }; } }));
vi.mock('@/services/push-token-session', () => ({ beginPushTokenSession: vi.fn(), endPushTokenSession: vi.fn(), registerCurrentDevicePushToken: vi.fn() }));
vi.mock('@/services/notification-routing', async () => import('../services/notification-routing'));
vi.mock('@/lib/foreground-chat-notifications', async () => import('../lib/foreground-chat-notifications'));

import { usePushNotificationBridge } from '../services/push-notifications';
import { setActiveNotificationUser } from '../lib/foreground-chat-notifications';

const ready: ChatSafetySnapshot = { enabled: true, rolloutReady: true, loading: false, error: null, canSend: true,
  state: { enabled: true, termsVersion: '2026-10-27', acceptedTerms: true, blockedUsers: [], hiddenSenderIds: [], canSend: true, canModerate: true, pendingReviewCount: 2 } };
const notice = { kind: 'chat_safety_report', organizationId: 'org-a', recipientUserId: 'manager', userNotificationId: 'generic-notice' };
const response = (data: unknown) => ({ notification: { request: { content: { data } } } });
let cleanup: (() => void)[] = [];
function mount() { usePushNotificationBridge(); cleanup = mocks.effects.map((effect) => effect()).filter((value): value is () => void => typeof value === 'function'); }

beforeEach(() => { mocks.effects.length = 0; mocks.safety = null; mocks.response = null; mocks.push.mockReset(); mocks.last.mockReset().mockResolvedValue(null); });
afterEach(() => { cleanup.forEach((stop) => stop()); cleanup = []; setActiveNotificationUser(null); });

describe('review notification tap routing', () => {
  it('waits for current reviewer authorization before routing a cold-start tap to the queue', async () => {
    mount();
    mocks.response!(response(notice));
    expect(mocks.push).not.toHaveBeenCalled();
    mocks.safety!(ready);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/chat-moderation');
  });

  it('never routes a wrong-recipient, wrong-organization or revoked-reviewer tap', () => {
    mount(); mocks.safety!(ready);
    mocks.response!(response({ ...notice, recipientUserId: 'other-manager' }));
    mocks.response!(response({ ...notice, organizationId: 'org-b' }));
    mocks.safety!({ ...ready, state: { ...ready.state!, canModerate: false } });
    mocks.response!(response(notice));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('ignores a delayed last-notification response after this account routing effect is disposed', async () => {
    let resolve!: (value: unknown) => void;
    mocks.last.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    mount(); mocks.safety!(ready);
    cleanup.forEach((stop) => stop()); cleanup = [];
    resolve(response(notice));
    await Promise.resolve(); await Promise.resolve();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
