import { getFunctions, httpsCallable } from 'firebase/functions';

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
    getFunctions(undefined, 'us-central1'),
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
    getFunctions(undefined, 'us-central1'),
    'addCustomChatParticipants'
  );
  const result = await callable(params);
  return result.data;
}
