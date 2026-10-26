import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

type ChatAttachmentInput = {
  id: string;
  kind: 'image' | 'file' | 'audio';
  name: string;
  mimeType?: string;
  size?: number;
  url: string;
};

type SendChatMessageResult = {
  messageId: string;
  recipientCount: number;
};

export async function sendChatMessageThroughServer(params: {
  threadId: string;
  text: string;
  attachments: ChatAttachmentInput[];
}) {
  const callable = httpsCallable<typeof params, SendChatMessageResult>(
    functions,
    'sendChatMessage'
  );
  const result = await callable(params);
  return result.data;
}

export async function addCustomChatParticipantsThroughServer(params: {
  threadId: string;
  participantIds: string[];
}) {
  const callable = httpsCallable<typeof params, { participantIds: string[] }>(
    functions,
    'addCustomChatParticipants'
  );
  const result = await callable(params);
  return result.data;
}
