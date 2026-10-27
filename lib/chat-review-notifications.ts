import type { ChatSafetySnapshot } from '../services/chat-safety';
import type { NotificationRouteData } from '../services/notification-routing';

export function hasCurrentChatReviewAccess(safety: ChatSafetySnapshot) {
  return safety.rolloutReady && safety.enabled && !safety.loading && !safety.error
    && safety.state?.enabled === true && safety.state.canModerate === true;
}

export function pendingChatReviewCount(safety: ChatSafetySnapshot) {
  if (!hasCurrentChatReviewAccess(safety)) return 0;
  const value = safety.state?.pendingReviewCount;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function chatReviewBadgeText(count: number) {
  return count > 99 ? '99+' : count > 0 ? String(count) : null;
}

export function canOpenChatReviewNotification(
  data: Pick<NotificationRouteData, 'kind' | 'recipientUserId' | 'organizationId'>,
  context: { userId?: string | null; organizationId?: string | null; safety: ChatSafetySnapshot },
) {
  return data.kind === 'chat_safety_report' && Boolean(context.userId && context.organizationId)
    && data.recipientUserId === context.userId && data.organizationId === context.organizationId
    && hasCurrentChatReviewAccess(context.safety);
}
