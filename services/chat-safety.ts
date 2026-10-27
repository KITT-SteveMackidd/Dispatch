import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../lib/firebase';

export const CHAT_RULES_VERSION = '2026-10-27';
export const CHAT_REPORT_REASONS = [
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate or discrimination' },
  { value: 'sexual', label: 'Sexual or exploitative content' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'privacy', label: 'Privacy or impersonation' },
  { value: 'spam', label: 'Spam or scams' },
  { value: 'illegal', label: 'Illegal content or activity' },
  { value: 'other', label: 'Another concern' },
] as const;
export type ChatReportReason = typeof CHAT_REPORT_REASONS[number]['value'];
export type ChatReportStatus = 'submitted' | 'under_review' | 'resolved' | 'dismissed';
export type ChatReportSummary = {
  id: string;
  kind: 'message' | 'user';
  targetDisplayName: string;
  reason: ChatReportReason;
  status: ChatReportStatus;
  createdAt: string;
  updatedAt?: string;
  resolutionSummary?: string;
};
export type SubmitChatReportInput = {
  threadId: string;
  kind: 'message' | 'user';
  messageId?: string;
  targetUserId?: string;
  reason: ChatReportReason;
  details?: string;
  clientRequestId: string;
};

export async function submitChatReport(params: SubmitChatReportInput) {
  return (await httpsCallable<SubmitChatReportInput, { reportId: string; status: ChatReportStatus; createdAt: string }>(functions, 'submitChatReport')(params)).data;
}

export async function listMyChatReports(params: { cursor?: string; limit?: number } = {}) {
  return (await httpsCallable<typeof params, { reports: ChatReportSummary[]; nextCursor?: string | null }>(functions, 'listMyChatReports')(params)).data;
}

export type ChatModerationAction = 'dismiss' | 'remove_message' | 'suspend_user' | 'restore_user';
export type ChatModerationReport = ChatReportSummary & {
  organizationId: string;
  targetUserId: string;
  reporterDisplayName: string;
  details: string;
  revision: number;
  evidence: {
    thread: { title: string; kind: string };
    message?: { id: string; senderId: string; text: string; attachments: { name: string; kind: string; mimeType?: string; size?: number }[] };
  };
  availableActions: ChatModerationAction[];
  actionState?: { action: ChatModerationAction; status: 'cleanup_pending' | 'completed'; message?: string };
};
export type ModerateChatReportInput = { reportId: string; action: ChatModerationAction; note: string; clientRequestId: string; expectedRevision?: number };
export type ModerateChatReportResult = { reportId: string; status: ChatReportStatus; revision: number; action: ChatModerationAction; actionState: 'completed' | 'cleanup_pending'; message?: string };

export async function listModerationReports(params: { cursor?: string; limit?: number } = {}) {
  return (await httpsCallable<typeof params, { reports: ChatModerationReport[]; nextCursor?: string | null }>(functions, 'listModerationReports')(params)).data;
}

export async function moderateChatReport(params: ModerateChatReportInput) {
  return (await httpsCallable<typeof params, ModerateChatReportResult>(functions, 'moderateChatReport')(params)).data;
}

export async function getChatReportAttachmentPreview(params: { reportId: string; attachmentIndex: number }) {
  return (await httpsCallable<typeof params, { url: string; name: string; mimeType: string }>(functions, 'getChatReportAttachmentPreview')(params)).data;
}

export const CHAT_RULES = [
  { title: 'Keep conversations respectful', text: 'Do not send threats, harassment, bullying, hate, sexual content, or content that exploits or endangers children. Do not impersonate others or share private information without permission.' },
  { title: 'Share appropriate work content', text: 'Use Dispatch chat for organization and event coordination. Only upload content you have permission to share. Do not send illegal content, scams, spam, or malicious links and files.' },
  { title: 'Control who can contact you', text: 'You can block a person to stop direct chat between you and hide their messages in shared chats. Blocking does not change organization membership, event assignments, or access to work information. You can unblock them in Chat safety.' },
  { title: 'Report concerns', text: 'Report a message or person from chat when something breaks these rules. Authorized reviewers may examine reported content and take action, including removing messages or restricting chat access. Your report is not shared with the person you report.' },
] as const;

export type ChatSafetyState = {
  enabled: boolean;
  termsVersion: string;
  acceptedTerms: boolean;
  blockedUsers: { uid: string; displayName: string }[];
  participants?: { uid: string; displayName: string }[];
  hiddenSenderIds: string[];
  canSend: boolean;
  sendDisabledReason?: string;
  canModerate: boolean;
  pendingReviewCount?: number;
  suspension?: { active?: boolean; reason: string } | null;
};

export async function getChatSafetyState(params: { threadId?: string } = {}) {
  return (await httpsCallable<typeof params, ChatSafetyState>(functions, 'getChatSafetyState')(params)).data;
}

export async function acceptChatRules(params: { version: string }) {
  await httpsCallable<typeof params, unknown>(functions, 'acceptChatRules')(params);
}

export async function setChatUserBlock(params: { targetUserId: string; blocked: boolean }) {
  await httpsCallable<typeof params, unknown>(functions, 'setChatUserBlock')(params);
}

export async function createChatUpload(params: { threadId: string; name: string; mimeType: string; size: number }) {
  return (await httpsCallable<typeof params, { objectPath: string; grantId: string }>(functions, 'createChatUpload')(params)).data;
}

export type ChatSafetySnapshot = {
  enabled: boolean;
  rolloutReady: boolean;
  loading: boolean;
  error: string | null;
  state: ChatSafetyState | null;
  canSend: boolean;
};

export const INITIAL_CHAT_SAFETY: ChatSafetySnapshot = {
  enabled: false, rolloutReady: false, loading: true, error: null, state: null, canSend: false,
};

/** No safety callable or private signal subscription is made before the server-owned rollout flag. */
export function subscribeToChatSafety(
  params: { userId: string; organizationId: string; threadId?: string },
  onChange: (snapshot: ChatSafetySnapshot) => void,
) {
  let active = true;
  let enabled = false;
  let rolloutReady = false;
  let generation = 0;
  let signalUnsubscribe: (() => void) | null = null;
  let current = INITIAL_CHAT_SAFETY;
  const publish = (patch: Partial<ChatSafetySnapshot>) => {
    if (!active) return;
    current = { ...current, ...patch };
    onChange(current);
  };
  const fail = (message: string) => publish({ loading: false, error: message, canSend: false });
  const refresh = async () => {
    if (!active || !rolloutReady || !enabled) return;
    const requestGeneration = ++generation;
    publish({ loading: true, error: null, canSend: false });
    try {
      const state = await getChatSafetyState(params.threadId ? { threadId: params.threadId } : {});
      if (!active || requestGeneration !== generation || !enabled) return;
      publish({ state, loading: false, error: null, canSend: state.enabled === true && state.canSend === true });
    } catch {
      if (!active || requestGeneration !== generation || !enabled) return;
      fail('Chat safety could not be checked. Refresh before sending a message.');
    }
  };
  onChange(current);
  const organizationUnsubscribe = onSnapshot(doc(db, 'organizations', params.organizationId), (snapshot) => {
    const nextEnabled = snapshot.exists() && snapshot.data().chatSafetyEnabled === true;
    const wasEnabled = enabled;
    enabled = nextEnabled;
    rolloutReady = true;
    if (!enabled) {
      ++generation;
      signalUnsubscribe?.();
      signalUnsubscribe = null;
      publish({ enabled: false, rolloutReady: true, loading: false, error: null, state: null, canSend: true });
      return;
    }
    publish({ enabled: true, rolloutReady: true });
    if (!wasEnabled || !signalUnsubscribe) {
      publish({ loading: true, canSend: false, state: null, error: null });
      signalUnsubscribe = onSnapshot(doc(db, 'users', params.userId, 'chatSafetyState', 'current'), () => {
        void refresh();
      }, () => {
        ++generation;
        fail('Chat safety updates are unavailable. Refresh before sending a message.');
      });
    } else {
      // Organization membership and reviewer permissions may change with the flag still on.
      void refresh();
    }
  }, () => {
    ++generation;
    rolloutReady = false;
    publish({ rolloutReady: false });
    fail('Chat safety settings could not be loaded. Please try again.');
  });

  return {
    refresh,
    unsubscribe: () => {
      active = false;
      ++generation;
      organizationUnsubscribe();
      signalUnsubscribe?.();
    },
  };
}
