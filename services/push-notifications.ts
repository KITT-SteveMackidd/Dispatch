import { useEffect } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import {
  saveUserPushToken,
} from '@/services/dispatch';
import { NotificationRouteData, resolveChatRouteFromNotification } from '@/services/notification-routing';
import { shouldPresentForegroundNotification } from '@/lib/foreground-chat-notifications';
import { rememberRegisteredDeviceToken } from '@/services/push-token-session';

let notificationHandlerConfigured = false;
const PUSH_REGISTRATION_RETRY_MS = 15_000;

async function configureAndroidNotificationChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('dispatch-default', {
    name: 'Dispatch Updates',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    enableVibrate: true,
    vibrationPattern: [0, 250, 250, 250],
  });
}

function ensureNotificationHandler() {
  if (notificationHandlerConfigured) return;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const shouldPresent = shouldPresentForegroundNotification(notification.request.content.data as NotificationRouteData);
      return {
        shouldShowAlert: shouldPresent,
        shouldShowBanner: shouldPresent,
        shouldShowList: shouldPresent,
        shouldPlaySound: shouldPresent,
        shouldSetBadge: shouldPresent,
      };
    },
  });
  notificationHandlerConfigured = true;
}

function useNotificationRouting(currentUserId?: string) {
  const router = useRouter();

  useEffect(() => {
    if (!currentUserId) return;

    const go = (data?: NotificationRouteData) => {
      if (!data) return;

      if (data.kind === 'chat') {
        const route = resolveChatRouteFromNotification(data, currentUserId);
        if (!route) return;
        router.push({
          pathname: '/chat/[workerId]',
          params: route,
        });
        return;
      }

      if (data.kind === 'user_notification') {
        if (data.relatedEventId) {
          router.push({ pathname: '/event/[id]', params: { id: data.relatedEventId } });
          return;
        }
        router.push('/(tabs)/profile');
      }
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      go(response.notification.request.content.data as NotificationRouteData);
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) go(response.notification.request.content.data as NotificationRouteData);
    }).catch(() => undefined);

    return () => {
      responseSub.remove();
    };
  }, [currentUserId, router]);
}

export function usePushNotificationBridge() {
  const { profile } = useSession();

  useNotificationRouting(profile?.uid);

  useEffect(() => {
    if (!profile?.uid) return;
    ensureNotificationHandler();

    let disposed = false;
    let tokenSubscription: Notifications.EventSubscription | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let registrationPromise: Promise<'registered' | 'denied' | 'retry'> | null = null;
    let permissionAlertShown = false;

    const registerPushToken = async () => {
      if (registrationPromise) return registrationPromise;

      registrationPromise = (async () => {
        try {
          await configureAndroidNotificationChannel();
          const permissions = await Notifications.requestPermissionsAsync();
          const status = permissions.status || 'undetermined';

          if (status !== 'granted') {
            if (!permissionAlertShown) {
              permissionAlertShown = true;
              Alert.alert('Notifications disabled', 'Enable notifications to receive event and chat alerts in real time.');
            }
            return 'denied' as const;
          }

          const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
          if (!projectId) throw new Error('The EAS project ID is missing from the app configuration.');

          const expoToken = await Notifications.getExpoPushTokenAsync({ projectId });
          if (!expoToken.data?.trim()) throw new Error('Expo did not return a push token for this device.');

          await saveUserPushToken({
            userId: profile.uid,
            token: expoToken.data,
            platform: Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : 'unknown',
            permissionStatus: 'granted',
          });
          await rememberRegisteredDeviceToken(profile.uid, expoToken.data);
          return 'registered' as const;
        } catch (error) {
          console.warn('Unable to register this device for Dispatch push notifications.', error);
          return 'retry' as const;
        }
      })().finally(() => {
        registrationPromise = null;
      });

      return registrationPromise;
    };

    const attemptRegistration = () => {
      registerPushToken().then((result) => {
        if (disposed || result !== 'retry') return;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(attemptRegistration, PUSH_REGISTRATION_RETRY_MS);
      }).catch(() => undefined);
    };

    attemptRegistration();
    tokenSubscription = Notifications.addPushTokenListener(() => attemptRegistration());
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') attemptRegistration();
    });

    Notifications.setBadgeCountAsync(0).catch(() => undefined);
    Notifications.getAllScheduledNotificationsAsync()
      .then((scheduled) => Promise.all(
        scheduled
          .filter((notification) => {
            const data = notification.content.data as { dispatchReminderKey?: string } | undefined;
            return !!data?.dispatchReminderKey;
          })
          .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier))
      ))
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      appStateSubscription.remove();
      tokenSubscription?.remove();
    };
  }, [profile?.uid]);
}
