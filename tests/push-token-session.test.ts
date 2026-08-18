import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/dispatch', () => ({
  removeUserPushToken: vi.fn().mockResolvedValue(undefined),
  saveUserPushToken: vi.fn().mockResolvedValue(undefined),
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
import { removeUserPushToken, saveUserPushToken } from '../services/dispatch';
import {
  beginPushTokenSession,
  endPushTokenSession,
  forgetRegisteredDevicePushToken,
  registerCurrentDevicePushToken,
  rememberRegisteredDeviceToken,
  unregisterCurrentDevicePushToken,
} from '../services/push-token-session';

describe('push token session ownership', () => {
  beforeEach(() => {
    vi.mocked(removeUserPushToken).mockReset();
    vi.mocked(removeUserPushToken).mockResolvedValue(undefined);
    vi.mocked(saveUserPushToken).mockReset();
    vi.mocked(saveUserPushToken).mockResolvedValue(undefined);
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

  it('removes this device token from the signed-out account even when memory still names another owner', async () => {
    await rememberRegisteredDeviceToken('user-1', 'ExpoPushToken[device]');
    await unregisterCurrentDevicePushToken('user-2');
    expect(removeUserPushToken).toHaveBeenCalledWith({ userId: 'user-2', token: 'ExpoPushToken[device]' });
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

  it('does not start a registration after its session was invalidated', async () => {
    const generation = beginPushTokenSession('user-1');
    endPushTokenSession('user-1', generation);

    const registered = await registerCurrentDevicePushToken({
      userId: 'user-1',
      generation,
      token: 'ExpoPushToken[device]',
      platform: 'ios',
      permissionStatus: 'granted',
    });

    expect(registered).toBe(false);
    expect(saveUserPushToken).not.toHaveBeenCalled();
  });

  it('drains and undoes a registration that was in flight when sign-out began', async () => {
    let finishSave: (() => void) | undefined;
    vi.mocked(saveUserPushToken).mockImplementation(() => new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    const generation = beginPushTokenSession('user-1');
    const registrationPromise = registerCurrentDevicePushToken({
      userId: 'user-1',
      generation,
      token: 'ExpoPushToken[device]',
      platform: 'ios',
      permissionStatus: 'granted',
    });

    const unregisterPromise = unregisterCurrentDevicePushToken('user-1');
    let unregisterSettled = false;
    void unregisterPromise.then(() => {
      unregisterSettled = true;
    });
    await Promise.resolve();
    expect(unregisterSettled).toBe(false);
    finishSave?.();

    await expect(registrationPromise).resolves.toBe(false);
    await expect(unregisterPromise).resolves.toBeUndefined();
    expect(removeUserPushToken).toHaveBeenCalledWith({ userId: 'user-1', token: 'ExpoPushToken[device]' });
  });

  it('surfaces token-removal failure instead of treating sign-out cleanup as successful', async () => {
    await rememberRegisteredDeviceToken('user-1', 'ExpoPushToken[device]');
    vi.mocked(removeUserPushToken).mockRejectedValueOnce(new Error('Firestore unavailable'));

    await expect(unregisterCurrentDevicePushToken('user-1')).rejects.toThrow('Firestore unavailable');
  });

  it('unregisters the signed-out account before registering the device to another account', async () => {
    const firstGeneration = beginPushTokenSession('user-1');
    await registerCurrentDevicePushToken({
      userId: 'user-1',
      generation: firstGeneration,
      token: 'ExpoPushToken[device]',
      platform: 'ios',
      permissionStatus: 'granted',
    });

    await unregisterCurrentDevicePushToken('user-1');
    forgetRegisteredDevicePushToken();

    const secondGeneration = beginPushTokenSession('user-2');
    await registerCurrentDevicePushToken({
      userId: 'user-2',
      generation: secondGeneration,
      token: 'ExpoPushToken[device]',
      platform: 'ios',
      permissionStatus: 'granted',
    });

    expect(removeUserPushToken).toHaveBeenCalledWith({ userId: 'user-1', token: 'ExpoPushToken[device]' });
    expect(saveUserPushToken).toHaveBeenNthCalledWith(2, {
      userId: 'user-2',
      token: 'ExpoPushToken[device]',
      platform: 'ios',
      permissionStatus: 'granted',
    });
  });

  it('removes a defensive previous owner before saving under a new account', async () => {
    const operations: string[] = [];
    vi.mocked(removeUserPushToken).mockImplementation(async ({ userId }) => {
      operations.push(`remove:${userId}`);
    });
    vi.mocked(saveUserPushToken).mockImplementation(async ({ userId }) => {
      operations.push(`save:${userId}`);
    });
    await rememberRegisteredDeviceToken('user-1', 'ExpoPushToken[device]');

    const generation = beginPushTokenSession('user-2');
    await registerCurrentDevicePushToken({
      userId: 'user-2',
      generation,
      token: 'ExpoPushToken[device]',
      platform: 'ios',
      permissionStatus: 'granted',
    });

    expect(operations).toEqual(['remove:user-1', 'save:user-2']);
  });

  it('does not save a new-account token when defensive previous-owner cleanup fails', async () => {
    await rememberRegisteredDeviceToken('user-1', 'ExpoPushToken[device]');
    vi.mocked(removeUserPushToken).mockRejectedValueOnce(new Error('Previous owner cleanup denied'));
    const generation = beginPushTokenSession('user-2');

    await expect(registerCurrentDevicePushToken({
      userId: 'user-2',
      generation,
      token: 'ExpoPushToken[device]',
      platform: 'ios',
      permissionStatus: 'granted',
    })).rejects.toThrow('Previous owner cleanup denied');

    expect(saveUserPushToken).not.toHaveBeenCalled();
  });
});
