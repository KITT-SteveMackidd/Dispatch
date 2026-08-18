import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { removeUserPushToken, saveUserPushToken } from './dispatch';

let registeredDeviceToken: { userId: string; token: string } | null = null;
let currentDeviceToken: string | null = null;
let pushTokenSessionGeneration = 0;
let activePushTokenSession: { userId: string; generation: number } | null = null;

type PendingRegistration = {
  userId: string;
  promise: Promise<boolean>;
};

const pendingRegistrations = new Set<PendingRegistration>();

async function loadCurrentDevicePushToken() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  const expoToken = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const token = expoToken?.data?.trim() || null;
  if (token) currentDeviceToken = token;
  return token;
}

function isPushTokenSessionActive(userId: string, generation: number) {
  return activePushTokenSession?.userId === userId
    && activePushTokenSession.generation === generation;
}

function invalidatePushTokenSession(userId: string, generation?: number) {
  if (activePushTokenSession?.userId !== userId) return;
  if (generation !== undefined && activePushTokenSession.generation !== generation) return;
  activePushTokenSession = null;
}

export function beginPushTokenSession(userId: string) {
  const generation = ++pushTokenSessionGeneration;
  activePushTokenSession = { userId, generation };
  return generation;
}

export function endPushTokenSession(userId: string, generation: number) {
  invalidatePushTokenSession(userId, generation);
}

async function removePreviousRegisteredDeviceToken(userId: string, token: string) {
  const previousRegistration = registeredDeviceToken;
  if (
    previousRegistration
    && (previousRegistration.userId !== userId || previousRegistration.token !== token)
  ) {
    await removeUserPushToken(previousRegistration);
    if (
      registeredDeviceToken?.userId === previousRegistration.userId
      && registeredDeviceToken.token === previousRegistration.token
    ) {
      registeredDeviceToken = null;
    }
  }
}

export async function rememberRegisteredDeviceToken(userId: string, token: string) {
  currentDeviceToken = token;
  await removePreviousRegisteredDeviceToken(userId, token);
  registeredDeviceToken = { userId, token };
}

export async function registerCurrentDevicePushToken(params: {
  userId: string;
  generation: number;
  token: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
  permissionStatus: 'granted' | 'denied' | 'undetermined';
}) {
  if (!isPushTokenSessionActive(params.userId, params.generation)) return false;
  currentDeviceToken = params.token;

  const operation = (async () => {
    if (!isPushTokenSessionActive(params.userId, params.generation)) return false;

    await removePreviousRegisteredDeviceToken(params.userId, params.token);

    if (!isPushTokenSessionActive(params.userId, params.generation)) return false;

    await saveUserPushToken({
      userId: params.userId,
      token: params.token,
      platform: params.platform,
      permissionStatus: params.permissionStatus,
    });

    if (!isPushTokenSessionActive(params.userId, params.generation)) {
      await removeUserPushToken({ userId: params.userId, token: params.token });
      return false;
    }

    await rememberRegisteredDeviceToken(params.userId, params.token);

    if (!isPushTokenSessionActive(params.userId, params.generation)) {
      await removeUserPushToken({ userId: params.userId, token: params.token });
      if (
        registeredDeviceToken?.userId === params.userId
        && registeredDeviceToken.token === params.token
      ) {
        registeredDeviceToken = null;
      }
      return false;
    }

    return true;
  })();
  const pendingRegistration = { userId: params.userId, promise: operation };
  pendingRegistrations.add(pendingRegistration);

  try {
    return await operation;
  } finally {
    pendingRegistrations.delete(pendingRegistration);
  }
}

export async function unregisterCurrentDevicePushToken(userId: string) {
  invalidatePushTokenSession(userId);

  const pendingForUser = [...pendingRegistrations]
    .filter((registration) => registration.userId === userId)
    .map((registration) => registration.promise);
  if (pendingForUser.length) await Promise.allSettled(pendingForUser);

  const registration = registeredDeviceToken;
  const token = registration?.userId === userId
    ? registration.token
    : currentDeviceToken || await loadCurrentDevicePushToken();

  if (token) {
    await removeUserPushToken({ userId, token });
  }
  if (registration?.userId === userId) registeredDeviceToken = null;
}

export function forgetRegisteredDevicePushToken() {
  registeredDeviceToken = null;
  currentDeviceToken = null;
  activePushTokenSession = null;
  pushTokenSessionGeneration += 1;
}

export async function clearDispatchNotificationState() {
  await Promise.allSettled([
    Notifications.cancelAllScheduledNotificationsAsync(),
    Notifications.dismissAllNotificationsAsync(),
    Notifications.setBadgeCountAsync(0),
  ]);
}
