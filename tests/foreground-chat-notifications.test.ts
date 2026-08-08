import { afterEach, describe, expect, it } from 'vitest';
import { clearActiveChatThread, setActiveChatThread, shouldPresentForegroundNotification } from '../lib/foreground-chat-notifications';

afterEach(() => setActiveChatThread(null));

describe('foreground chat notification visibility', () => {
  it('suppresses a chat push for the thread currently on screen', () => {
    setActiveChatThread('dm:manager__worker');
    expect(shouldPresentForegroundNotification({ kind: 'chat', threadId: 'dm:manager__worker' })).toBe(false);
  });

  it('keeps other threads and operational alerts visible', () => {
    setActiveChatThread('dm:manager__worker');
    expect(shouldPresentForegroundNotification({ kind: 'chat', threadId: 'dm:manager__worker-2' })).toBe(true);
    expect(shouldPresentForegroundNotification({ kind: 'user_notification', relatedEventId: 'event-1' })).toBe(true);
  });

  it('clears only the matching screen registration', () => {
    setActiveChatThread('thread-new');
    clearActiveChatThread('thread-old');
    expect(shouldPresentForegroundNotification({ kind: 'chat', threadId: 'thread-new' })).toBe(false);
  });
});
