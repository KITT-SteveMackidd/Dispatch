import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/dispatch', () => ({
  removeUserPushToken: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: vi.fn(),
}));
vi.mock('expo-constants', () => ({
  default: {
    expoConfig: { extra: { eas: { projectId: 'dispatch-test-project' } } },
    easConfig: null,
  },
}));

import * as Notifications from 'expo-notifications';
import { removeUserPushToken } from '../services/dispatch';
import { forgetRegisteredDevicePushToken, rememberRegisteredDeviceToken, unregisterCurrentDevicePushToken } from '../services/push-token-session';

describe('push token session ownership', () => {
  beforeEach(() => {
    vi.mocked(removeUserPushToken).mockClear();
    vi.mocked(Notifications.getExpoPushTokenAsync).mockReset();
    vi.mocked(Notifications.getExpoPushTokenAsync).mockRejectedValue(new Error('No device token available'));
    forgetRegisteredDevicePushToken();
  });

  it('removes the current device token before its owner signs out', async () => {
    await rememberRegisteredDeviceToken('user-1', 'ExpoPushToken[device]');
    await unregisterCurrentDevicePushToken('user-1');
    expect(removeUserPushToken).toHaveBeenCalledWith({ userId: 'user-1', token: 'ExpoPushToken[device]' });
  });

  it('retrieves and removes the device token when in-memory ownership was lost after restart', async () => {
    vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({
      type: 'expo',
      data: 'ExpoPushToken[device]',
    });

    await unregisterCurrentDevicePushToken('user-1');

    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'dispatch-test-project' });
    expect(removeUserPushToken).toHaveBeenCalledWith({ userId: 'user-1', token: 'ExpoPushToken[device]' });
  });

  it('does not remove a token through a different account', async () => {
    await rememberRegisteredDeviceToken('user-1', 'ExpoPushToken[device]');
    await unregisterCurrentDevicePushToken('user-2');
    expect(removeUserPushToken).not.toHaveBeenCalled();
  });

  it('removes the previous account ownership before registering the device for another user', async () => {
    await rememberRegisteredDeviceToken('user-1', 'ExpoPushToken[device]');
    await rememberRegisteredDeviceToken('user-2', 'ExpoPushToken[device]');
    expect(removeUserPushToken).toHaveBeenCalledWith({ userId: 'user-1', token: 'ExpoPushToken[device]' });
  });

  it('removes a rotated token before remembering its replacement', async () => {
    await rememberRegisteredDeviceToken('user-1', 'ExpoPushToken[old]');
    await rememberRegisteredDeviceToken('user-1', 'ExpoPushToken[new]');
    expect(removeUserPushToken).toHaveBeenCalledWith({ userId: 'user-1', token: 'ExpoPushToken[old]' });
  });
});
