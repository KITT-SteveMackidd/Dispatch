import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
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

    const registerPushToken = async () => {
      const permissions = await Notifications.requestPermissionsAsync().catch(() => null);
      const status = permissions?.status || 'undetermined';

      if (status !== 'granted') {
        Alert.alert('Notifications disabled', 'Enable notifications to receive event and chat alerts in real time.');
        return false;
      }

      const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
      const expoToken = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined).catch(() => null);
      if (!expoToken?.data) return false;

      await saveUserPushToken({
        userId: profile.uid,
        token: expoToken.data,
        platform: Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : 'unknown',
        permissionStatus: 'granted',
      }).catch(() => undefined);
      await rememberRegisteredDeviceToken(profile.uid, expoToken.data);
      return true;
    };

    registerPushToken().then((registered) => {
      if (!registered || disposed) return;
      tokenSubscription = Notifications.addPushTokenListener(() => {
        registerPushToken().catch(() => undefined);
      });
    }).catch(() => undefined);

    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('dispatch-default', {
        name: 'Dispatch Updates',
        importance: Notifications.AndroidImportance.DEFAULT,
      }).catch(() => undefined);
    }

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
      tokenSubscription?.remove();
    };
  }, [profile?.uid]);
}
