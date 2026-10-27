import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), moderate: vi.fn(), preview: vi.fn() }));
vi.mock('../services/chat-safety', () => ({ listModerationReports: mocks.list, moderateChatReport: mocks.moderate, getChatReportAttachmentPreview: mocks.preview }));
import { createChatModerationSession, type ChatModerationSessionState } from '../services/chat-moderation-session';
import type { ChatModerationReport } from '../services/chat-safety';

const report: ChatModerationReport = {
  id: 'report-a', organizationId: 'org-a', kind: 'message', targetUserId: 'target', targetDisplayName: 'Target', reporterDisplayName: 'Reporter',
  reason: 'harassment', details: 'Private reported concern', status: 'submitted', createdAt: '2026-10-27T18:00:00Z', revision: 1,
  evidence: { thread: { title: 'Crew', kind: 'group' }, message: { id: 'message-a', senderId: 'target', text: 'Private evidence', attachments: [] } },
  availableActions: ['dismiss', 'remove_message', 'suspend_user'],
};
const completed = { reportId: report.id, status: 'resolved', revision: 2, action: 'remove_message', actionState: 'completed' };
function harness() {
  const states: ChatModerationSessionState[] = [];
  const session = createChatModerationSession((state) => states.push(state));
  return { session, states, current: () => states.at(-1)! };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe('moderation reviewer session isolation and actions', () => {
  beforeEach(() => {
    mocks.list.mockReset().mockResolvedValue({ reports: [report] });
    mocks.moderate.mockReset().mockResolvedValue(completed);
    mocks.preview.mockReset();
  });

  it('discards a private queue response after reviewer access is revoked or account scope changes', async () => {
    const request = deferred<{ reports: ChatModerationReport[] }>();
    mocks.list.mockReturnValueOnce(request.promise);
    const h = harness();
    const loading = h.session.load();
    h.session.dispose();
    const count = h.states.length;
    request.resolve({ reports: [report] });
    await loading;
    expect(h.states).toHaveLength(count);
    expect(h.current().reports).toEqual([]);
    await h.session.load();
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it('rejects actions absent from the server permissions and empty notes without calling the backend', async () => {
    const h = harness();
    await h.session.load();
    await h.session.act(report.id, 'restore_user', 'Restore');
    await h.session.act(report.id, 'dismiss', '   ');
    expect(mocks.moderate).not.toHaveBeenCalled();
    expect(h.current().reports[0].status).toBe('submitted');
  });

  it('keeps failed actions unresolved and reuses the exact request on retry', async () => {
    mocks.moderate.mockRejectedValueOnce(new Error('Network unavailable'));
    const h = harness();
    await h.session.load();
    await h.session.act(report.id, 'remove_message', 'Remove harassment');
    expect(h.current()).toMatchObject({ notice: null, error: 'Network unavailable', acting: false });
    expect(h.current().reports[0].status).toBe('submitted');
    await h.session.act(report.id, 'remove_message', 'Remove harassment');
    expect(mocks.moderate.mock.calls[1][0]).toEqual(mocks.moderate.mock.calls[0][0]);
    expect(mocks.moderate.mock.calls[0][0].expectedRevision).toBe(1);
  });

  it('shows pending cleanup, refreshes allowed actions, and retries with the original request and revision', async () => {
    const pending = { ...report, status: 'under_review', revision: 2, availableActions: ['remove_message'], actionState: { action: 'remove_message', status: 'cleanup_pending' } };
    mocks.moderate.mockResolvedValueOnce({ ...completed, status: 'under_review', actionState: 'cleanup_pending' });
    mocks.list.mockResolvedValueOnce({ reports: [report] }).mockResolvedValueOnce({ reports: [pending] });
    const h = harness();
    await h.session.load();
    await h.session.act(report.id, 'remove_message', 'Remove harassment');
    expect(h.current().notice).toContain('still pending');
    expect(h.current().reports[0]).toMatchObject({ status: 'under_review', availableActions: ['remove_message'] });
    expect(h.states.some((state) => state.notice === 'Review action completed.')).toBe(false);
    await h.session.act(report.id, 'remove_message', 'Remove harassment');
    expect(mocks.moderate.mock.calls[1][0]).toEqual(mocks.moderate.mock.calls[0][0]);
  });

  it('does not publish an in-flight action result into a later reviewer session', async () => {
    const response = deferred<typeof completed>();
    mocks.moderate.mockReturnValueOnce(response.promise);
    const h = harness();
    await h.session.load();
    const acting = h.session.act(report.id, 'remove_message', 'Remove harassment');
    h.session.dispose();
    const count = h.states.length;
    response.resolve(completed);
    await acting;
    expect(h.states).toHaveLength(count);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it('clears private evidence when the server rejects reviewer access', async () => {
    const h = harness();
    await h.session.load();
    mocks.moderate.mockRejectedValueOnce(Object.assign(new Error('Review access removed'), { code: 'functions/permission-denied' }));
    await h.session.act(report.id, 'dismiss', 'Reviewed');
    expect(h.current()).toMatchObject({ reports: [], nextCursor: null, notice: null, error: 'Review access removed' });
  });

  it('merges paginated reports without duplicating evidence records', async () => {
    mocks.list.mockResolvedValueOnce({ reports: [report], nextCursor: 'cursor-a' }).mockResolvedValueOnce({ reports: [{ ...report, revision: 2 }, { ...report, id: 'report-b' }] });
    const h = harness();
    await h.session.load();
    await h.session.load(h.current().nextCursor!);
    expect(mocks.list.mock.calls[1][0]).toEqual({ limit: 20, cursor: 'cursor-a' });
    expect(h.current().reports.map((item) => item.id)).toEqual(['report-a', 'report-b']);
    expect(h.current().reports[0].revision).toBe(2);
  });

  it('opens an attachment only after an explicit call and fresh server authorization', async () => {
    const withAttachment = { ...report, evidence: { ...report.evidence, message: { ...report.evidence.message!, attachments: [{ name: 'reported.png', kind: 'image' }] } } };
    mocks.list.mockResolvedValueOnce({ reports: [withAttachment] });
    mocks.preview.mockResolvedValueOnce({ url: 'https://firebasestorage.googleapis.com/authorized-object', name: 'reported.png', mimeType: 'image/png' });
    const open = vi.fn().mockResolvedValue(undefined);
    const h = harness();
    await h.session.load();
    expect(mocks.preview).not.toHaveBeenCalled();
    await h.session.previewAttachment(report.id, 0, () => true, open);
    expect(mocks.preview).toHaveBeenCalledWith({ reportId: report.id, attachmentIndex: 0 });
    expect(open).toHaveBeenCalledOnce();
    expect(h.current().reports[0].evidence.message?.attachments[0]).not.toHaveProperty('url');
  });

  it('never opens a delayed attachment after the review closes or reviewer permission changes', async () => {
    const withAttachment = { ...report, evidence: { ...report.evidence, message: { ...report.evidence.message!, attachments: [{ name: 'reported.png', kind: 'image' }] } } };
    mocks.list.mockResolvedValueOnce({ reports: [withAttachment] });
    const request = deferred<{ url: string; name: string; mimeType: string }>();
    mocks.preview.mockReturnValueOnce(request.promise);
    const open = vi.fn();
    const h = harness();
    await h.session.load();
    let visible = true;
    const pending = h.session.previewAttachment(report.id, 0, () => visible, open);
    visible = false;
    h.session.dispose();
    request.resolve({ url: 'https://firebasestorage.googleapis.com/authorized-object', name: 'reported.png', mimeType: 'image/png' });
    await pending;
    expect(open).not.toHaveBeenCalled();
  });
});
