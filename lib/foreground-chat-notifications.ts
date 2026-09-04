import type { NotificationRouteData } from '@/services/notification-routing';

let activeChatThreadId: string | null = null;
let activeNotificationUserId: string | null = null;

export function setActiveChatThread(threadId: string | null) {
  activeChatThreadId = threadId?.trim() || null;
}

export function clearActiveChatThread(threadId: string) {
  if (activeChatThreadId === threadId) activeChatThreadId = null;
}

export function setActiveNotificationUser(userId: string | null) {
  activeNotificationUserId = userId?.trim() || null;
}

export function isNotificationForUser(data: NotificationRouteData | undefined, userId: string | null | undefined) {
  const recipientUserId = typeof data?.recipientUserId === 'string' ? data.recipientUserId.trim() : '';
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  return !!recipientUserId && !!normalizedUserId && recipientUserId === normalizedUserId;
}

export function shouldPresentForegroundNotification(data?: NotificationRouteData) {
  if (!isNotificationForUser(data, activeNotificationUserId)) return false;
  return !(data?.kind === 'chat' && !!data.threadId && data.threadId === activeChatThreadId);
}
