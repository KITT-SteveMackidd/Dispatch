import type { NotificationRouteData } from '@/services/notification-routing';
import type { ChatSafetySnapshot } from '../services/chat-safety';
import { canShowChatSenderContent } from './chat-safety-visibility';
import { canOpenChatReviewNotification } from './chat-review-notifications';

let activeChatThreadId: string | null = null;
let activeNotificationUserId: string | null = null;
let chatSafety: { userId: string; organizationId?: string; state: ChatSafetySnapshot } | null = null;
const chatSafetyListeners = new Set<() => void>();

export function setActiveChatThread(threadId: string | null) {
  activeChatThreadId = threadId?.trim() || null;
}

export function clearActiveChatThread(threadId: string) {
  if (activeChatThreadId === threadId) activeChatThreadId = null;
}

export function setActiveNotificationUser(userId: string | null) {
  const nextUserId = userId?.trim() || null;
  if (activeNotificationUserId !== nextUserId) chatSafety = null;
  activeNotificationUserId = nextUserId;
}

export function setChatNotificationSafety(userId: string, state: ChatSafetySnapshot | null, organizationId?: string) {
  if (activeNotificationUserId !== userId) return;
  chatSafety = state ? { userId, organizationId, state } : null;
  chatSafetyListeners.forEach((listener) => listener());
}

export function watchChatNotificationSafety(listener: () => void) {
  chatSafetyListeners.add(listener);
  return () => { chatSafetyListeners.delete(listener); };
}

export function isChatNotificationSafetyReady(userId: string) {
  return chatSafety?.userId === userId && chatSafety.state.rolloutReady && !chatSafety.state.loading && !chatSafety.state.error;
}

export function isChatNotificationAllowed(data: NotificationRouteData, userId: string) {
  if (data.kind === 'chat_safety_report') {
    return chatSafety?.userId === userId && canOpenChatReviewNotification(data, { userId, organizationId: chatSafety.organizationId, safety: chatSafety.state });
  }
  if (data.kind !== 'chat') return true;
  if (!chatSafety || chatSafety.userId !== userId) return false;
  return canShowChatSenderContent(data.senderId, chatSafety.state);
}

export function isNotificationForUser(data: NotificationRouteData | undefined, userId: string | null | undefined) {
  const recipientUserId = typeof data?.recipientUserId === 'string' ? data.recipientUserId.trim() : '';
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  return !!recipientUserId && !!normalizedUserId && recipientUserId === normalizedUserId;
}

export function shouldPresentForegroundNotification(data?: NotificationRouteData) {
  if (!isNotificationForUser(data, activeNotificationUserId)) return false;
  if (data && activeNotificationUserId && !isChatNotificationAllowed(data, activeNotificationUserId)) return false;
  return !(data?.kind === 'chat' && !!data.threadId && data.threadId === activeChatThreadId);
}
