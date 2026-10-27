import { useEffect } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { firebaseEmulatorConfiguration } from '@/lib/firebase';
import { subscribeToChatSafety } from '@/services/chat-safety';
import { NotificationRouteData, resolveChatRouteFromNotification } from '@/services/notification-routing';
import {
  isNotificationForUser,
  isChatNotificationAllowed,
  isChatNotificationSafetyReady,
  setChatNotificationSafety,
  watchChatNotificationSafety,
  setActiveNotificationUser,
  shouldPresentForegroundNotification,
} from '@/lib/foreground-chat-notifications';
import {
  beginPushTokenSession,
  endPushTokenSession,
  registerCurrentDevicePushToken,
} from '@/services/push-token-session';

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

function useNotificationRouting(currentUserId?: string, currentOrganizationId?: string | null, currentRole?: string) {
  const router = useRouter();

  useEffect(() => {
    if (!currentUserId) return;
    let active = true;
    let pendingChat: NotificationRouteData | undefined;

    const go = (data?: NotificationRouteData) => {
      if (!active || !data || !isNotificationForUser(data, currentUserId)) return;

      if (data.kind === 'chat_safety_report') {
        if (!currentOrganizationId || data.organizationId !== currentOrganizationId) return;
        if (!isChatNotificationSafetyReady(currentUserId)) {
          pendingChat = data;
          return;
        }
        pendingChat = undefined;
        if (isChatNotificationAllowed(data, currentUserId)) router.push('/chat-moderation');
        return;
      }

      if (data.kind === 'chat') {
        if (!isChatNotificationSafetyReady(currentUserId)) {
          pendingChat = data;
          return;
        }
        pendingChat = undefined;
        if (!isChatNotificationAllowed(data, currentUserId)) return;
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
    const stopSafetyWatch = watchChatNotificationSafety(() => {
      if (pendingChat) go(pendingChat);
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) go(response.notification.request.content.data as NotificationRouteData);
    }).catch(() => undefined);

    return () => {
      active = false;
      pendingChat = undefined;
      stopSafetyWatch();
      responseSub.remove();
    };
  }, [currentUserId, currentOrganizationId, currentRole, router]);
}

export function usePushNotificationBridge() {
  const { profile, authUser } = useSession();
  const currentUserId = authUser?.uid === profile?.uid ? profile?.uid : undefined;

  useNotificationRouting(currentUserId, profile?.organizationId, profile?.role);

  useEffect(() => {
    ensureNotificationHandler();
    setActiveNotificationUser(currentUserId || null);
    const userId = currentUserId;
    const organizationId = profile?.organizationId;
    const safety = userId && organizationId
      ? subscribeToChatSafety({ userId, organizationId }, (state) => setChatNotificationSafety(userId, state, organizationId))
      : null;
    return () => {
      safety?.unsubscribe();
      setActiveNotificationUser(null);
    };
  }, [currentUserId, profile?.organizationId, profile?.role]);

  useEffect(() => {
    // Synthetic local accounts must never request or register real Expo tokens.
    if (!profile?.uid || firebaseEmulatorConfiguration.enabled) return;
    const userId = profile.uid;
    const pushTokenSessionGeneration = beginPushTokenSession(userId);

    let disposed = false;
    let tokenSubscription: Notifications.EventSubscription | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let registrationPromise: Promise<'registered' | 'denied' | 'retry' | 'stale'> | null = null;
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

          const registered = await registerCurrentDevicePushToken({
            userId,
            generation: pushTokenSessionGeneration,
            token: expoToken.data,
            platform: Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : 'unknown',
            permissionStatus: 'granted',
          });
          return registered ? 'registered' as const : 'stale' as const;
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
      endPushTokenSession(userId, pushTokenSessionGeneration);
      if (retryTimer) clearTimeout(retryTimer);
      appStateSubscription.remove();
      tokenSubscription?.remove();
    };
  }, [profile?.uid]);
}
