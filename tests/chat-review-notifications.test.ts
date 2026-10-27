import { describe, expect, it } from 'vitest';
import { canOpenChatReviewNotification, chatReviewBadgeText, pendingChatReviewCount } from '../lib/chat-review-notifications';
import type { ChatSafetySnapshot } from '../services/chat-safety';

const reviewer: ChatSafetySnapshot = {
  enabled: true, rolloutReady: true, loading: false, error: null, canSend: true,
  state: { enabled: true, termsVersion: '2026-10-27', acceptedTerms: true, blockedUsers: [], hiddenSenderIds: [], canSend: true, canModerate: true, pendingReviewCount: 4 },
};
const notification = { kind: 'chat_safety_report' as const, organizationId: 'org-a', recipientUserId: 'manager-a' };
const context = { userId: 'manager-a', organizationId: 'org-a', safety: reviewer };

describe('pending moderation count and notification scope', () => {
  it('only shows the server pending count after reviewer access is verified', () => {
    expect(pendingChatReviewCount(reviewer)).toBe(4);
    for (const safety of [
      { ...reviewer, enabled: false }, { ...reviewer, rolloutReady: false },
      { ...reviewer, loading: true }, { ...reviewer, error: 'offline' },
      { ...reviewer, state: null }, { ...reviewer, state: { ...reviewer.state!, canModerate: false } },
    ]) expect(pendingChatReviewCount(safety)).toBe(0);
  });

  it('hides zero or invalid counts and caps the visible badge without losing the accessible total', () => {
    expect(chatReviewBadgeText(0)).toBe(null);
    expect(chatReviewBadgeText(1)).toBe('1');
    expect(chatReviewBadgeText(99)).toBe('99');
    const count = pendingChatReviewCount({ ...reviewer, state: { ...reviewer.state!, pendingReviewCount: 120 } });
    expect(count).toBe(120);
    expect(chatReviewBadgeText(count)).toBe('99+');
    for (const pendingReviewCount of [undefined, -1, NaN, Infinity]) {
      expect(pendingChatReviewCount({ ...reviewer, state: { ...reviewer.state!, pendingReviewCount } })).toBe(0);
    }
  });

  it('routes only the exact current recipient and organization with confirmed reviewer permission', () => {
    expect(canOpenChatReviewNotification(notification, context)).toBe(true);
    expect(canOpenChatReviewNotification(notification, { ...context, userId: 'manager-b' })).toBe(false);
    expect(canOpenChatReviewNotification(notification, { ...context, organizationId: 'org-b' })).toBe(false);
    expect(canOpenChatReviewNotification({ ...notification, organizationId: undefined }, context)).toBe(false);
    expect(canOpenChatReviewNotification(notification, { ...context, safety: { ...reviewer, loading: true } })).toBe(false);
    expect(canOpenChatReviewNotification(notification, { ...context, safety: { ...reviewer, state: { ...reviewer.state!, canModerate: false } } })).toBe(false);
  });

  it('allows a generic historical notification to open an authorized queue after its pending count reaches zero', () => {
    const resolved = { ...reviewer, state: { ...reviewer.state!, pendingReviewCount: 0 } };
    expect(pendingChatReviewCount(resolved)).toBe(0);
    expect(canOpenChatReviewNotification(notification, { ...context, safety: resolved })).toBe(true);
  });
});
