const MAX_CHAT_TEXT_LENGTH = 4000;
const MAX_CHAT_ATTACHMENTS = 10;
const MAX_CHAT_PARTICIPANTS = 200;

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function normalizeAttachment(value, allowHttpAttachments = false) {
  if (!value || typeof value !== 'object') throw new Error('A chat attachment is invalid.');
  const kind = ['image', 'file', 'audio'].includes(value.kind) ? value.kind : null;
  const id = typeof value.id === 'string' ? value.id.trim().slice(0, 1024) : '';
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 240) : '';
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  if (!kind || !id || !name || !(url.startsWith('https://') || (allowHttpAttachments && url.startsWith('http://'))) || url.length > 4096) {
    throw new Error('A chat attachment is invalid.');
  }

  const attachment = { id, kind, name, url };
  if (typeof value.mimeType === 'string' && value.mimeType.trim()) {
    attachment.mimeType = value.mimeType.trim().slice(0, 160);
  }
  const size = Number(value.size);
  if (Number.isFinite(size) && size >= 0) attachment.size = size;
  return attachment;
}

function buildChatMessageMutation({ thread, senderId, senderName, text, attachments, allowHttpAttachments = false }) {
  const participants = uniqueStrings(thread?.participants);
  if (!participants.includes(senderId)) throw new Error('You are not a member of this chat.');
  if (participants.length > MAX_CHAT_PARTICIPANTS) throw new Error('This chat has too many participants.');

  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (normalizedText.length > MAX_CHAT_TEXT_LENGTH) throw new Error('Chat messages must be 4,000 characters or fewer.');
  if (!Array.isArray(attachments)) throw new Error('Chat attachments are invalid.');
  if (attachments.length > MAX_CHAT_ATTACHMENTS) throw new Error('A message can include up to 10 attachments.');
  const normalizedAttachments = attachments.map(value => normalizeAttachment(value, allowHttpAttachments));
  if (!normalizedText && normalizedAttachments.length === 0) throw new Error('Enter a message or add an attachment.');

  const recipientIds = participants.filter((participantId) => participantId !== senderId);
  const summary = normalizedText || `Sent ${normalizedAttachments.length} attachment${normalizedAttachments.length === 1 ? '' : 's'}`;
  const normalizedSenderName = typeof senderName === 'string' && senderName.trim()
    ? senderName.trim().slice(0, 160)
    : null;

  return {
    recipientIds,
    message: {
      threadId: thread.id,
      teamId: typeof thread.teamId === 'string' && thread.teamId.trim() ? thread.teamId.trim() : null,
      senderId,
      senderName: normalizedSenderName,
      recipientIds,
      text: normalizedText,
      attachments: normalizedAttachments,
    },
    threadPatch: {
      pushSeenBy: [senderId],
      lastMessageText: summary,
      lastMessageSenderId: senderId,
    },
  };
}

module.exports = {
  MAX_CHAT_PARTICIPANTS,
  buildChatMessageMutation,
  uniqueStrings,
};
