import { describe, expect, it } from 'vitest';
import { canShowChatSenderContent } from '../lib/chat-safety-visibility';
import type { ChatSafetySnapshot } from '../services/chat-safety';

const ready: ChatSafetySnapshot = {
  enabled: true, rolloutReady: true, loading: false, error: null, canSend: true,
  state: { enabled: true, termsVersion: '2026-10-27', acceptedTerms: true, blockedUsers: [], hiddenSenderIds: ['blocked'], canSend: true, canModerate: false },
};
describe('chat preview privacy', () => {
  it('hides blocked and unidentified senders but keeps other conversation content visible', () => {
    expect(canShowChatSenderContent('blocked', ready)).toBe(false);
    expect(canShowChatSenderContent(undefined, ready)).toBe(false);
    expect(canShowChatSenderContent('other', ready)).toBe(true);
  });
  it('never flashes previous content while loading or after an access-check failure', () => {
    expect(canShowChatSenderContent('other', { ...ready, loading: true })).toBe(false);
    expect(canShowChatSenderContent('other', { ...ready, error: 'offline' })).toBe(false);
    expect(canShowChatSenderContent('other', { ...ready, rolloutReady: false })).toBe(false);
    expect(canShowChatSenderContent('other', { ...ready, state: null })).toBe(false);
  });
  it('preserves existing previews only after the organization rollout is confirmed off', () => {
    expect(canShowChatSenderContent(undefined, { ...ready, enabled: false, state: null })).toBe(true);
    expect(canShowChatSenderContent('other', { ...ready, enabled: false, rolloutReady: false, state: null })).toBe(false);
  });
});
