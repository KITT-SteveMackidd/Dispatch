import { afterEach, describe, expect, it } from 'vitest';
import {
  clearActiveChatThread,
  isNotificationForUser,
  setActiveChatThread,
  setActiveNotificationUser,
  setChatNotificationSafety,
  isChatNotificationAllowed,
  shouldPresentForegroundNotification,
} from '../lib/foreground-chat-notifications';
import type { ChatSafetySnapshot } from '../services/chat-safety';

const safetyOff: ChatSafetySnapshot = { enabled: false, rolloutReady: true, loading: false, error: null, state: null, canSend: true };
function setKnownUser(userId: string) {
  setActiveNotificationUser(userId);
  setChatNotificationSafety(userId, safetyOff);
}

afterEach(() => {
  setActiveChatThread(null);
  setActiveNotificationUser(null);
});

describe('foreground chat notification visibility', () => {
  it('suppresses a chat push for the thread currently on screen', () => {
    setKnownUser('worker-1');
    setActiveChatThread('dm:manager__worker');
    expect(shouldPresentForegroundNotification({
      kind: 'chat',
      threadId: 'dm:manager__worker',
      recipientUserId: 'worker-1',
    })).toBe(false);
  });

  it('keeps other threads and operational alerts visible', () => {
    setKnownUser('worker-1');
    setActiveChatThread('dm:manager__worker');
    expect(shouldPresentForegroundNotification({ kind: 'chat', threadId: 'dm:manager__worker-2', recipientUserId: 'worker-1' })).toBe(true);
    expect(shouldPresentForegroundNotification({ kind: 'user_notification', relatedEventId: 'event-1', recipientUserId: 'worker-1' })).toBe(true);
  });

  it('clears only the matching screen registration', () => {
    setKnownUser('worker-1');
    setActiveChatThread('thread-new');
    clearActiveChatThread('thread-old');
    expect(shouldPresentForegroundNotification({ kind: 'chat', threadId: 'thread-new', recipientUserId: 'worker-1' })).toBe(false);
  });

  it('suppresses a notification addressed to the previously signed-in account', () => {
    setKnownUser('worker-2');
    expect(shouldPresentForegroundNotification({ kind: 'chat', threadId: 'thread-1', recipientUserId: 'worker-1' })).toBe(false);
  });

  it('suppresses all foreground notifications while signed out', () => {
    setActiveNotificationUser(null);
    expect(shouldPresentForegroundNotification({ kind: 'user_notification', recipientUserId: 'worker-1' })).toBe(false);
  });

  it('requires an exact recipient match before routing or displaying', () => {
    expect(isNotificationForUser({ recipientUserId: 'worker-1' }, 'worker-1')).toBe(true);
    expect(isNotificationForUser({ recipientUserId: 'worker-1' }, 'worker-2')).toBe(false);
    expect(isNotificationForUser({ kind: 'chat' }, 'worker-1')).toBe(false);
  });

  it('suppresses chat until safety is known without hiding operational notifications', () => {
    setActiveNotificationUser('worker-1');
    expect(shouldPresentForegroundNotification({ kind: 'chat', senderId: 'manager', recipientUserId: 'worker-1' })).toBe(false);
    expect(shouldPresentForegroundNotification({ kind: 'user_notification', recipientUserId: 'worker-1' })).toBe(true);
  });

  it('suppresses blocked sender popups and chat navigation while allowing other people', () => {
    setActiveNotificationUser('worker-1');
    setChatNotificationSafety('worker-1', {
      ...safetyOff, enabled: true,
      state: { enabled: true, termsVersion: '2026-10-27', acceptedTerms: true, blockedUsers: [], hiddenSenderIds: ['blocked'], canSend: true, canModerate: false },
    });
    const blocked = { kind: 'chat' as const, senderId: 'blocked', recipientUserId: 'worker-1' };
    expect(shouldPresentForegroundNotification(blocked)).toBe(false);
    expect(isChatNotificationAllowed(blocked, 'worker-1')).toBe(false);
    expect(shouldPresentForegroundNotification({ ...blocked, senderId: 'other' })).toBe(true);
    setChatNotificationSafety('worker-1', { ...safetyOff, enabled: true, loading: true });
    expect(shouldPresentForegroundNotification({ ...blocked, senderId: 'other' })).toBe(false);
  });

  it('only presents generic review notices for a verified reviewer in the exact organization', () => {
    setActiveNotificationUser('manager-1');
    const state: ChatSafetySnapshot = { ...safetyOff, enabled: true,
      state: { enabled: true, termsVersion: '2026-10-27', acceptedTerms: true, blockedUsers: [], hiddenSenderIds: [], canSend: true, canModerate: true, pendingReviewCount: 1 } };
    const notice = { kind: 'chat_safety_report' as const, organizationId: 'org-1', recipientUserId: 'manager-1' };
    expect(shouldPresentForegroundNotification(notice)).toBe(false);
    setChatNotificationSafety('manager-1', state, 'org-1');
    expect(shouldPresentForegroundNotification(notice)).toBe(true);
    expect(shouldPresentForegroundNotification({ ...notice, organizationId: 'org-2' })).toBe(false);
    setChatNotificationSafety('manager-1', { ...state, loading: true }, 'org-1');
    expect(shouldPresentForegroundNotification(notice)).toBe(false);
    setChatNotificationSafety('manager-1', { ...state, state: { ...state.state!, canModerate: false } }, 'org-1');
    expect(shouldPresentForegroundNotification(notice)).toBe(false);
  });
});
