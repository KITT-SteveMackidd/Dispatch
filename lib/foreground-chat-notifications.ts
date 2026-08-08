import type { NotificationRouteData } from '@/services/notification-routing';

let activeChatThreadId: string | null = null;

export function setActiveChatThread(threadId: string | null) {
  activeChatThreadId = threadId?.trim() || null;
}

export function clearActiveChatThread(threadId: string) {
  if (activeChatThreadId === threadId) activeChatThreadId = null;
}

export function shouldPresentForegroundNotification(data?: NotificationRouteData) {
  return !(data?.kind === 'chat' && !!data.threadId && data.threadId === activeChatThreadId);
}
