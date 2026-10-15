import { afterEach, describe, expect, it } from 'vitest';
import {
  clearActiveChatThread,
  isNotificationForUser,
  setActiveChatThread,
  setActiveNotificationUser,
  shouldPresentForegroundNotification,
} from '../lib/foreground-chat-notifications';

afterEach(() => {
  setActiveChatThread(null);
  setActiveNotificationUser(null);
});

describe('foreground chat notification visibility', () => {
  it('suppresses a chat push for the thread currently on screen', () => {
    setActiveNotificationUser('worker-1');
    setActiveChatThread('dm:manager__worker');
    expect(shouldPresentForegroundNotification({
      kind: 'chat',
      threadId: 'dm:manager__worker',
      recipientUserId: 'worker-1',
    })).toBe(false);
  });

  it('keeps other threads and operational alerts visible', () => {
    setActiveNotificationUser('worker-1');
    setActiveChatThread('dm:manager__worker');
    expect(shouldPresentForegroundNotification({ kind: 'chat', threadId: 'dm:manager__worker-2', recipientUserId: 'worker-1' })).toBe(true);
    expect(shouldPresentForegroundNotification({ kind: 'user_notification', relatedEventId: 'event-1', recipientUserId: 'worker-1' })).toBe(true);
  });

  it('clears only the matching screen registration', () => {
    setActiveNotificationUser('worker-1');
    setActiveChatThread('thread-new');
    clearActiveChatThread('thread-old');
    expect(shouldPresentForegroundNotification({ kind: 'chat', threadId: 'thread-new', recipientUserId: 'worker-1' })).toBe(false);
  });

  it('suppresses a notification addressed to the previously signed-in account', () => {
    setActiveNotificationUser('worker-2');
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
});
