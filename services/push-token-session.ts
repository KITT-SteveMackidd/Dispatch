import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { removeUserPushToken } from './dispatch';

let registeredDeviceToken: { userId: string; token: string } | null = null;

async function loadCurrentDevicePushToken() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  const expoToken = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined).catch(() => null);
  return expoToken?.data?.trim() || null;
}

export async function rememberRegisteredDeviceToken(userId: string, token: string) {
  const previousRegistration = registeredDeviceToken;
  if (
    previousRegistration
    && (previousRegistration.userId !== userId || previousRegistration.token !== token)
  ) {
    await removeUserPushToken(previousRegistration);
  }
  registeredDeviceToken = { userId, token };
}

export async function unregisterCurrentDevicePushToken(userId: string) {
  const registration = registeredDeviceToken;
  const token = registration?.userId === userId
    ? registration.token
    : await loadCurrentDevicePushToken();

  if (token) {
    await removeUserPushToken({ userId, token });
  }
  if (registration?.userId === userId) registeredDeviceToken = null;
}

export function forgetRegisteredDevicePushToken() {
  registeredDeviceToken = null;
}

export async function clearDispatchNotificationState() {
  await Promise.allSettled([
    Notifications.cancelAllScheduledNotificationsAsync(),
    Notifications.dismissAllNotificationsAsync(),
    Notifications.setBadgeCountAsync(0),
  ]);
}
