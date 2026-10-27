import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  requestPermissions: vi.fn(), getToken: vi.fn(), register: vi.fn(), tokenListener: vi.fn(), beginSession: vi.fn(),
}));
vi.mock('react', () => ({ useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect) }));
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() }, AppState: { addEventListener: vi.fn() }, Platform: { OS: 'ios' } }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  addNotificationResponseReceivedListener: () => ({ remove: vi.fn() }),
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  requestPermissionsAsync: mocks.requestPermissions,
  getExpoPushTokenAsync: mocks.getToken,
  addPushTokenListener: mocks.tokenListener,
}));
vi.mock('@/context/session', () => ({ useSession: () => ({ profile: { uid: 'synthetic', organizationId: 'synthetic-org' } }) }));
vi.mock('@/lib/firebase', () => ({ firebaseEmulatorConfiguration: { enabled: true } }));
vi.mock('@/services/chat-safety', () => ({ subscribeToChatSafety: () => ({ unsubscribe: vi.fn() }) }));
vi.mock('@/services/push-token-session', () => ({ beginPushTokenSession: mocks.beginSession, endPushTokenSession: vi.fn(), registerCurrentDevicePushToken: mocks.register }));
vi.mock('@/services/notification-routing', async () => import('../services/notification-routing'));
vi.mock('@/lib/foreground-chat-notifications', async () => import('../lib/foreground-chat-notifications'));

import { usePushNotificationBridge } from '../services/push-notifications';

describe('synthetic emulator push isolation', () => {
  it('runs the bridge without permission prompts, Expo requests, registration, or token listeners', async () => {
    usePushNotificationBridge();
    const cleanup = mocks.effects.map((effect) => effect());
    await Promise.resolve();
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.tokenListener).not.toHaveBeenCalled();
    expect(mocks.beginSession).not.toHaveBeenCalled();
    cleanup.forEach((stop) => stop?.());
  });
});
