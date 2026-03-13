import { useEffect, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { saveUserPushToken, watchIncomingChatThreadHeads, watchUserNotifications, watchWorkerRoleAssignmentNotifications } from '@/services/dispatch';
import { NotificationRouteData, resolveChatRouteFromNotification } from '@/services/notification-routing';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function parseDate(value?: { toDate?: () => Date } | Date | null) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().getTime();
  return 0;
}

function useNotificationRouting(currentUserId?: string) {
  const router = useRouter();

  useEffect(() => {
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
  }, [router]);
}

export function usePushNotificationBridge() {
  const { profile } = useSession();
  const seenChatUpdateRef = useRef<Record<string, number>>({});
  const seenUserNotificationIdsRef = useRef<Set<string>>(new Set());
  const seenRoleNotificationIdsRef = useRef<Set<string>>(new Set());

  useNotificationRouting(profile?.uid);

  useEffect(() => {
    if (!profile?.uid) return;

    (async () => {
      const permissions = await Notifications.requestPermissionsAsync().catch(() => null);
      const status = permissions?.status || 'undetermined';

      if (status !== 'granted') {
        Alert.alert('Notifications disabled', 'Enable notifications to receive event and chat alerts in real time.');
        return;
      }

      const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
      const expoToken = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined).catch(() => null);
      if (!expoToken?.data) return;

      await saveUserPushToken({
        userId: profile.uid,
        token: expoToken.data,
        platform: Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : 'unknown',
        permissionStatus: 'granted',
      }).catch(() => undefined);
    })();

    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('dispatch-default', {
        name: 'Dispatch Updates',
        importance: Notifications.AndroidImportance.DEFAULT,
      }).catch(() => undefined);
    }

    const unsubChats = watchIncomingChatThreadHeads(profile.uid, (threads) => {
      threads.forEach((thread) => {
        const updatedAtMs = parseDate(thread.updatedAt);
        if (!updatedAtMs || thread.lastMessageSenderId === profile.uid) return;

        const prevSeen = seenChatUpdateRef.current[thread.id] || 0;
        if (updatedAtMs <= prevSeen) return;
        seenChatUpdateRef.current[thread.id] = updatedAtMs;

        Notifications.scheduleNotificationAsync({
          content: {
            title: 'New chat message',
            body: thread.lastMessageText || 'You have a new message.',
            data: {
              kind: 'chat',
              threadId: thread.id,
              senderId: thread.lastMessageSenderId,
              teamId: thread.teamId || undefined,
            } satisfies NotificationRouteData,
          },
          trigger: null,
        }).catch(() => undefined);
      });
    });

    const unsubUserNotifications = watchUserNotifications(profile.uid, (items) => {
      items.forEach((item) => {
        if (item.read || seenUserNotificationIdsRef.current.has(item.id)) return;

        seenUserNotificationIdsRef.current.add(item.id);
        Notifications.scheduleNotificationAsync({
          content: {
            title: item.title || 'Dispatch notification',
            body: item.body || 'You have an update.',
            data: {
              kind: 'user_notification',
              relatedEventId: item.relatedEventId,
            } satisfies NotificationRouteData,
          },
          trigger: null,
        }).catch(() => undefined);
      });
    });

    const unsubRoleAssignmentNotifications = watchWorkerRoleAssignmentNotifications(profile.uid, (items) => {
      items.forEach((item) => {
        if (seenRoleNotificationIdsRef.current.has(item.id)) return;
        seenRoleNotificationIdsRef.current.add(item.id);

        const roleLabel = item.roleName?.trim() || 'assigned role';
        const actionLabel = item.action === 'assign' ? 'New role invite' : 'Role update';
        const body = item.statusReason?.trim()
          || `${item.eventName || 'Event'}: ${item.action === 'assign' ? `You were invited to ${roleLabel}.` : `You were removed from ${roleLabel}.`}`;

        Notifications.scheduleNotificationAsync({
          content: {
            title: actionLabel,
            body,
            data: {
              kind: 'user_notification',
              relatedEventId: item.eventId,
            } satisfies NotificationRouteData,
          },
          trigger: null,
        }).catch(() => undefined);
      });
    });

    return () => {
      unsubChats();
      unsubUserNotifications();
      unsubRoleAssignmentNotifications();
    };
  }, [profile?.uid]);
}
