import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { watchIncomingChatThreadHeads, watchUserNotifications } from '@/services/dispatch';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

type NotificationRouteData = {
  kind?: 'chat' | 'user_notification';
  threadId?: string;
  senderId?: string;
  teamId?: string;
  relatedEventId?: string;
};

function parseDate(value?: { toDate?: () => Date } | Date | null) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().getTime();
  return 0;
}

function useNotificationRouting() {
  const router = useRouter();

  useEffect(() => {
    const go = (data?: NotificationRouteData) => {
      if (!data) return;

      if (data.kind === 'chat' && data.senderId) {
        router.push({
          pathname: '/chat/[workerId]',
          params: {
            workerId: data.senderId,
            workerLabel: 'Teammate',
            teamId: data.teamId,
          },
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

  useNotificationRouting();

  useEffect(() => {
    if (!profile?.uid) return;

    Notifications.requestPermissionsAsync().catch(() => undefined);
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

    return () => {
      unsubChats();
      unsubUserNotifications();
    };
  }, [profile?.uid]);
}
