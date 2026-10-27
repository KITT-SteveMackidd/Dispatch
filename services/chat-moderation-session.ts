import {
  listModerationReports, moderateChatReport, getChatReportAttachmentPreview,
  type ChatModerationAction, type ChatModerationReport, type ModerateChatReportInput,
} from './chat-safety';

export type ChatModerationSessionState = {
  reports: ChatModerationReport[];
  nextCursor: string | null;
  loading: boolean;
  acting: boolean;
  error: string | null;
  notice: string | null;
};
export const EMPTY_MODERATION_SESSION: ChatModerationSessionState = {
  reports: [], nextCursor: null, loading: false, acting: false, error: null, notice: null,
};
function accessDenied(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return code.endsWith('permission-denied') || code.endsWith('unauthenticated');
}

/** A session belongs to one verified reviewer scope. Dispose it as soon as that scope changes. */
export function createChatModerationSession(onChange: (state: ChatModerationSessionState) => void) {
  let active = true;
  let generation = 0;
  let state = EMPTY_MODERATION_SESSION;
  const retries = new Map<string, ModerateChatReportInput>();
  const publish = (patch: Partial<ChatModerationSessionState>) => {
    if (!active) return;
    state = { ...state, ...patch };
    onChange(state);
  };
  const load = async (cursor?: string) => {
    if (!active || state.acting) return;
    const request = ++generation;
    publish({ reports: cursor ? state.reports : [], nextCursor: cursor || null, loading: true, error: null });
    try {
      const result = await listModerationReports({ limit: 20, ...(cursor ? { cursor } : {}) });
      if (!active || request !== generation) return;
      publish({ reports: [...new Map([...(cursor ? state.reports : []), ...result.reports].map((report) => [report.id, report])).values()], nextCursor: result.nextCursor || null, loading: false });
    } catch (error) {
      if (!active || request !== generation) return;
      publish({ loading: false, ...(accessDenied(error) ? { reports: [], nextCursor: null, notice: null } : {}), error: error instanceof Error ? error.message : 'Reports could not be loaded. Please try again.' });
    }
  };
  const act = async (reportId: string, action: ChatModerationAction, note: string) => {
    if (!active || state.acting || state.loading) return;
    const report = state.reports.find((item) => item.id === reportId);
    const trimmedNote = note.trim();
    if (!report?.availableActions.includes(action)) {
      publish({ error: 'This action is no longer available. Refresh the queue.' });
      return;
    }
    if (!trimmedNote || trimmedNote.length > 2000) {
      publish({ error: 'Add a review note between 1 and 2,000 characters.' });
      return;
    }
    const key = JSON.stringify([reportId, action, trimmedNote]);
    const payload = retries.get(key) || {
      reportId, action, note: trimmedNote, expectedRevision: report.revision,
      clientRequestId: `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`,
    };
    retries.set(key, payload);
    const request = ++generation;
    publish({ acting: true, error: null, notice: null });
    try {
      const result = await moderateChatReport(payload);
      if (!active || request !== generation) return;
      const pending = result.actionState === 'cleanup_pending';
      publish({
        acting: false,
        reports: state.reports.map((item) => item.id !== reportId ? item : {
          ...item, status: result.status, revision: result.revision,
          actionState: { action: result.action, status: result.actionState, message: result.message },
          availableActions: [],
        }),
        notice: pending ? 'Attachment cleanup is still pending. Retry the removal to finish this action.' : 'Review action completed.',
      });
      if (!pending) {
        retries.delete(key);
      }
      await load();
    } catch (error) {
      if (!active || request !== generation) return;
      publish({ acting: false, ...(accessDenied(error) ? { reports: [], nextCursor: null, notice: null } : {}), error: error instanceof Error ? error.message : 'The review action could not be completed. Please try again.' });
    }
  };
  const previewAttachment = async (reportId: string, attachmentIndex: number, isCurrent: () => boolean, openURL: (url: string) => Promise<unknown>) => {
    if (!active || !isCurrent()) return;
    const report = state.reports.find((item) => item.id === reportId);
    if (!report?.evidence.message?.attachments[attachmentIndex] || !report.availableActions.includes('remove_message') || report.actionState?.action === 'remove_message') {
      throw new Error('This attachment is no longer available for review. Refresh the queue.');
    }
    const preview = await getChatReportAttachmentPreview({ reportId, attachmentIndex });
    if (!active || !isCurrent()) return;
    await openURL(preview.url);
  };
  return {
    load, act, previewAttachment,
    dispose: () => { active = false; ++generation; retries.clear(); },
  };
}
