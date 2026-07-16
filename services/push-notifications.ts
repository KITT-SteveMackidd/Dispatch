import { useEffect, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import {
  markChatNotificationSeen,
  markEventReminderScheduled,
  markRoleAssignmentNotificationPushSeen,
  markUserNotificationPushSeen,
  markUserNotificationsRead,
  saveUserPushToken,
  watchIncomingChatThreadHeads,
  watchUserNotifications,
  watchWorkerEvents,
  watchWorkerRoleAssignmentNotifications,
} from '@/services/dispatch';
import { NotificationRouteData, resolveChatRouteFromNotification } from '@/services/notification-routing';

let notificationHandlerConfigured = false;

function ensureNotificationHandler() {
  if (notificationHandlerConfigured) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
  notificationHandlerConfigured = true;
}

function parseDate(value?: { toDate?: () => Date } | Date | null) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().getTime();
  return 0;
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
  const seenChatUpdateRef = useRef<Record<string, number>>({});
  const seenUserNotificationIdsRef = useRef<Set<string>>(new Set());
  const scheduledUserNotificationIdsRef = useRef<Record<string, string>>({});
  const seenRoleNotificationIdsRef = useRef<Set<string>>(new Set());
  const scheduledEventReminderKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    scheduledEventReminderKeysRef.current = new Set(profile?.scheduledEventReminderKeys || []);
  }, [profile?.uid, profile?.scheduledEventReminderKeys]);

  useNotificationRouting(profile?.uid);

  useEffect(() => {
    if (!profile?.uid) return;
    ensureNotificationHandler();

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

    Notifications.setBadgeCountAsync(0).catch(() => undefined);

    const unsubChats = watchIncomingChatThreadHeads(profile.uid, (threads) => {
      threads.forEach((thread) => {
        const updatedAtMs = parseDate(thread.updatedAt);
        if (!updatedAtMs || thread.lastMessageSenderId === profile.uid || thread.pushSeenBy?.includes(profile.uid)) return;

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
               organizationId: thread.organizationId || undefined,
               threadTitle: thread.title || undefined,
               participantIds: thread.participants || [],
             } satisfies NotificationRouteData,
          },
          trigger: null,
        }).then(() => markChatNotificationSeen({ threadId: thread.id, userId: profile.uid }))
          .catch(() => undefined);
      });
    });

    const unsubUserNotifications = watchUserNotifications(profile.uid, (items) => {
      items.forEach((item) => {
        if (item.read) {
          seenUserNotificationIdsRef.current.add(item.id);
          const scheduledNotificationId = scheduledUserNotificationIdsRef.current[item.id];
          if (scheduledNotificationId) {
            Notifications.dismissNotificationAsync(scheduledNotificationId).catch(() => undefined);
            delete scheduledUserNotificationIdsRef.current[item.id];
          }
          return;
        }

        if (seenUserNotificationIdsRef.current.has(item.id) || item.pushSeenBy?.includes(profile.uid)) return;

        seenUserNotificationIdsRef.current.add(item.id);
        Notifications.scheduleNotificationAsync({
          content: {
            title: item.title || 'Dispatch notification',
            body: item.body || 'You have an update.',
            data: {
              kind: 'user_notification',
              relatedEventId: item.relatedEventId,
              userNotificationId: item.id,
            } satisfies NotificationRouteData,
          },
          trigger: null,
        }).then((scheduledNotificationId) => {
          if (item.kind === 'worker_team_invite') {
            scheduledUserNotificationIdsRef.current[item.id] = scheduledNotificationId;
            return markUserNotificationPushSeen({ notificationId: item.id, userId: profile.uid });
          }

          return Promise.all([
            markUserNotificationPushSeen({ notificationId: item.id, userId: profile.uid }),
            markUserNotificationsRead({ userId: profile.uid, notificationIds: [item.id] }),
            Notifications.setBadgeCountAsync(0),
          ]).then(() => undefined);
        }).catch(() => undefined);
      });
    });

    const unsubRoleAssignmentNotifications = watchWorkerRoleAssignmentNotifications(profile.uid, (items) => {
      items.forEach((item) => {
        if (seenRoleNotificationIdsRef.current.has(item.id) || item.pushSeenBy?.includes(profile.uid)) return;
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
        }).then(() => markRoleAssignmentNotificationPushSeen({ notificationId: item.id, userId: profile.uid }))
          .catch(() => undefined);
      });
    });

    let reminderQueue = Promise.resolve();
    const unsubEventReminders = profile.role === 'worker'
      ? watchWorkerEvents(profile.uid, (events) => {
          reminderQueue = reminderQueue.then(async () => {
            const now = Date.now();
            const desired = events.flatMap((event) => {
              const roleNames = (event.roles || [])
                .filter((role) => (role.assignedWorkerIds || []).includes(profile.uid))
                .map((role) => role.name);
              const startsAtMs = new Date(event.startsAt).getTime();
              if (!roleNames.length || !Number.isFinite(startsAtMs) || startsAtMs <= now) return [];
              const reminderKey = `event-two-hour:${event.id}:${event.startsAt}`;
              return [{ event, roleNames, startsAtMs, reminderKey }];
            });
            const desiredKeys = new Set(desired.map((item) => item.reminderKey));
            const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);

            await Promise.all(scheduled.map((notification) => {
              const data = notification.content.data as { dispatchReminderKey?: string } | undefined;
              if (!data?.dispatchReminderKey || desiredKeys.has(data.dispatchReminderKey)) return Promise.resolve();
              return Notifications.cancelScheduledNotificationAsync(notification.identifier).catch(() => undefined);
            }));

            for (const item of desired) {
              const alreadyScheduled = scheduled.some((notification) => {
                const data = notification.content.data as { dispatchReminderKey?: string } | undefined;
                return data?.dispatchReminderKey === item.reminderKey;
              });
              if (alreadyScheduled || scheduledEventReminderKeysRef.current.has(item.reminderKey)) continue;

              const reminderAtMs = item.startsAtMs - 2 * 60 * 60 * 1000;
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: `${item.event.name} starts in 2 hours`,
                  body: `${item.roleNames.join(', ')} at ${item.event.location || 'the event location'}.`,
                  data: {
                    kind: 'user_notification',
                    relatedEventId: item.event.id,
                    dispatchReminderKey: item.reminderKey,
                  } as NotificationRouteData & { dispatchReminderKey: string },
                },
                trigger: reminderAtMs > now
                  ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminderAtMs }
                  : null,
              });
              scheduledEventReminderKeysRef.current.add(item.reminderKey);
              await markEventReminderScheduled({ userId: profile.uid, reminderKey: item.reminderKey });
            }
          }).catch(() => undefined);
        })
      : () => undefined;

    return () => {
      unsubChats();
      unsubUserNotifications();
      unsubRoleAssignmentNotifications();
      unsubEventReminders();
    };
  }, [profile?.role, profile?.uid]);
}
