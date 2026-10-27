import type { ChatSafetySnapshot } from '../services/chat-safety';

/** Shared by previews and foreground pushes so hidden messages cannot leak through another surface. */
export function canShowChatSenderContent(senderId: string | undefined, safety: ChatSafetySnapshot) {
  if (!safety.rolloutReady || safety.error) return false;
  if (!safety.enabled) return true;
  if (safety.loading || !safety.state?.enabled || !senderId) return false;
  return !safety.state.hiddenSenderIds.includes(senderId);
}
