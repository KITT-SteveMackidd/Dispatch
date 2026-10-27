const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatModerationService } = require('../lib/chat-safety-moderation');
const { createChatSafetyService } = require('../lib/chat-safety');
const { deleteDispatchUserData } = require('../lib/account-deletion');
const { MemoryFirestore, MemoryBucket, FieldValue } = require('./helpers/chat-safety-memory');

const first = 'a'.repeat(64), second = 'b'.repeat(64), conflict = 'c'.repeat(64), own = 'd'.repeat(64);
function harness() {
  const date = new Date('2026-10-27T20:00:00Z');
  const objectPath = `chatSafetyAttachments/${'a'.repeat(40)}/proof.png`;
  const url = `http://127.0.0.1:9199/v0/b/demo.firebasestorage.app/o/${encodeURIComponent(objectPath)}?alt=media&token=token`;
  const attachment = { id: objectPath, url, name: 'proof.png', kind: 'image', mimeType: 'image/png', size: 9 };
  const report = { organizationId: 'org', reporterUserId: 'reporter', reporterDisplayName: 'Reporter', targetUserId: 'target', targetDisplayName: 'Target', kind: 'message', threadId: 'group', messageId: 'message', reason: 'harassment', details: 'Private reporter text', status: 'submitted', createdAt: date, updatedAt: date,
    evidence: { thread: { title: 'Group', kind: 'organization' }, message: { text: 'Reported content', attachments: [attachment] } } };
  const db = new MemoryFirestore({
    ...Object.fromEntries(['manager', 'secondmanager', 'reporter', 'target'].map(uid => [`users/${uid}`, { uid, displayName: uid, role: uid.includes('manager') ? 'manager' : 'worker', organizationId: 'org' }])),
    'users/operator': { uid: 'operator', role: 'worker', organizationId: 'other' },
    'users/outsider': { uid: 'outsider', role: 'manager', organizationId: 'other' },
    'organizations/org': { name: 'Group', chatSafetyEnabled: true, managerIds: ['manager', 'secondmanager'], workerIds: ['reporter', 'target'] },
    'organizationBilling/org': { chatSafetyEnabled: true, accessMode: 'read_only' },
    'organizations/other': { chatSafetyEnabled: true, managerIds: ['outsider'], workerIds: ['operator'] },
    'organizationBilling/other': { chatSafetyEnabled: true },
    [`chatSafetyReports/${first}`]: report,
    [`chatSafetyReports/${second}`]: { ...report, details: 'Another report' },
    [`chatSafetyReports/${conflict}`]: { ...report, targetUserId: 'manager' },
    [`chatSafetyReports/${own}`]: { ...report, reporterUserId: 'manager' },
    'chatThreads/group': { organizationId: 'org', participants: ['reporter', 'target', 'manager', 'secondmanager'], kind: 'organization', lastMessageText: 'Reported content' },
    'chatThreads/group/messages/message': { senderId: 'target', text: 'Reported content', attachments: [attachment], createdAt: date },
    [`chatUploadGrants/${'a'.repeat(40)}`]: { ownerId: 'target', threadId: 'group', messageId: 'message', objectPath, usedAt: date },
  });
  const bucket = new MemoryBucket({ [objectPath]: { size: '9', contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: 'token' } } });
  const dependencies = { getDb: () => db, getFieldValue: () => FieldValue, getBucket: () => bucket, projectId: () => 'demo-dispatch-billing',
    assertAccountAllowed: async () => {}, emulatorOrigins: () => ['http://127.0.0.1:9199'], fetchImpl: bucket.fetch, documentIdField: () => '__name__' };
  const service = createChatModerationService(dependencies);
  const request = (uid, data = {}) => ({ auth: { uid, token: { dispatchModerator: uid === 'operator' } }, data });
  const action = (name, reportId = first, clientRequestId = `request-${name}`) => ({ reportId, action: name, note: 'Private moderator note', clientRequestId });
  return { db, bucket, service, request, action, dependencies, objectPath, url };
}

test('moderation queue enforces current authority, self conflicts and owner-scoped cursor', async () => {
  const h = harness();
  await assert.rejects(h.service.list(h.request('reporter')), error => error.code === 'permission-denied');
  assert.equal((await h.service.list(h.request('outsider'))).reports.length, 0);
  const page = await h.service.list(h.request('manager', { limit: 1 }));
  assert.equal(page.reports.length, 1);
  assert.ok([first, second].includes(page.reports[0].id));
  assert.ok(page.nextCursor);
  await assert.rejects(h.service.list(h.request('secondmanager', { cursor: page.nextCursor })), error => error.code === 'invalid-argument');
  for (const id of [conflict, own]) await assert.rejects(h.service.moderate(h.request('manager', h.action('dismiss', id))), error => error.code === 'permission-denied');
  h.db.documents.get(`chatSafetyReports/${conflict}`).targetUserId = 'operator';
  h.db.documents.get(`chatSafetyReports/${own}`).reporterUserId = 'operator';
  for (const id of [conflict, own]) await assert.rejects(h.service.moderate(h.request('operator', h.action('dismiss', id))), error => error.code === 'permission-denied');
});

test('moderation is idempotent, rejects stale revisions, and keeps notes and correlation private', async () => {
  const h = harness();
  const input = { ...h.action('suspend_user'), expectedRevision: 0 };
  const result = await h.service.moderate(h.request('manager', input));
  assert.equal(result.status, 'resolved');
  assert.deepEqual(await h.service.moderate(h.request('manager', input)), result);
  assert.equal([...h.db.documents.keys()].filter(path => path.startsWith(`chatSafetyReports/${first}/moderationAudit/`)).length, 1);
  const profile = h.db.documents.get('users/target').chatSuspension;
  assert.equal(profile.active, true);
  assert.equal(profile.reason, 'Chat access suspended.');
  assert.equal(profile.sourceReportId, undefined);
  assert.equal(profile.note, undefined);
  assert.equal(h.db.documents.get('chatUserModerationState/target').sourceReportId, first);
  await assert.rejects(h.service.moderate(h.request('manager', { ...input, note: 'Changed' })), error => error.code === 'failed-precondition');
  await assert.rejects(h.service.moderate(h.request('manager', { ...h.action('restore_user'), expectedRevision: 0 })), error => error.code === 'failed-precondition');
});

test('a reviewer cannot replace a conflicted active restriction and restore an older report', async () => {
  const h = harness();
  h.db.documents.get(`chatSafetyReports/${second}`).reporterUserId = 'manager';
  await h.service.moderate(h.request('secondmanager', h.action('suspend_user', second)));
  await assert.rejects(h.service.moderate(h.request('manager', h.action('suspend_user', first))), error => error.code === 'failed-precondition');
  await assert.rejects(h.service.moderate(h.request('manager', h.action('restore_user', first))), error => error.code === 'failed-precondition');
  assert.equal(h.db.documents.get('chatUserModerationState/target').sourceReportId, second);
  await h.service.moderate(h.request('secondmanager', h.action('restore_user', second)));
  await h.service.moderate(h.request('manager', h.action('suspend_user', first, 'new-suspension')));
  await assert.rejects(h.service.moderate(h.request('secondmanager', h.action('restore_user', second, 'old-restore-request'))), error => error.code === 'failed-precondition');
});

test('suspend and restore refuse a member who moved to another organization', async () => {
  const h = harness();
  await h.service.moderate(h.request('manager', h.action('suspend_user')));
  h.db.documents.get('users/target').organizationId = 'other';
  await assert.rejects(h.service.moderate(h.request('operator', h.action('restore_user'))), error => error.code === 'failed-precondition');
  await assert.rejects(h.service.moderate(h.request('operator', h.action('suspend_user', second))), error => error.code === 'failed-precondition');
});

test('removal hides content immediately, retries failed deletion, and verifies both absence and inaccessible URL', async () => {
  const h = harness();
  h.bucket.failDeletes = 1;
  const input = { ...h.action('remove_message'), expectedRevision: 0 };
  const pending = await h.service.moderate(h.request('manager', input));
  assert.equal(pending.actionState, 'cleanup_pending');
  assert.equal(h.db.documents.get(`chatSafetyReports/${first}`).status, 'under_review');
  const message = h.db.documents.get('chatThreads/group/messages/message');
  assert.equal(message.text, ''); assert.deepEqual(message.attachments, []); assert.equal(message.moderationStatus, 'removed');
  assert.ok(h.bucket.files.has(h.objectPath));
  await assert.rejects(h.service.preview(h.request('manager', { reportId: first, attachmentIndex: 0 })), error => error.code === 'not-found');
  h.bucket.forcePublicStatus = 200;
  assert.equal((await h.service.moderate(h.request('manager', input))).actionState, 'cleanup_pending');
  assert.equal(h.bucket.files.has(h.objectPath), false);
  h.bucket.forcePublicStatus = null;
  const complete = await h.service.moderate(h.request('manager', input));
  assert.equal(complete.status, 'resolved'); assert.equal(complete.actionState, 'completed');
  assert.deepEqual(await h.service.moderate(h.request('manager', input)), complete);
  assert.equal((await h.bucket.fetch(h.url)).status, 403);
  assert.equal(h.db.documents.get(`chatSafetyReports/${first}`).evidence.message.attachments[0].url, undefined);
});

test('a new authorized reviewer can retry pending cleanup without changing the original action', async () => {
  const h = harness(); h.bucket.failDeletes = 1;
  await h.service.moderate(h.request('manager', h.action('remove_message')));
  const result = await h.service.moderate(h.request('secondmanager', h.action('remove_message', first, 'different-retry-id')));
  assert.equal(result.actionState, 'completed');
  assert.equal([...h.db.documents.values()].filter(value => value.status === 'alias').length, 1);
});

test('unsafe legacy attachments never stop redaction or cause an external fetch or foreign object deletion', async () => {
  for (const potentialOwned of [false, true]) {
    const h = harness();
    const attachment = { id: potentialOwned ? 'chatSafetyAttachments/unverified/file.png' : 'external-resource', url: 'https://outside.example/harmful.png', name: 'legacy.png', kind: 'image' };
    h.db.documents.get('chatThreads/group/messages/message').attachments = [attachment];
    h.db.documents.get(`chatSafetyReports/${first}`).evidence.message.attachments = [attachment];
    const result = await h.service.moderate(h.request('manager', h.action('remove_message')));
    assert.equal(h.db.documents.get('chatThreads/group/messages/message').moderationStatus, 'removed');
    assert.equal(result.actionState, potentialOwned ? 'cleanup_pending' : 'completed');
    assert.equal(h.bucket.requests.length, 0);
    assert.ok(h.bucket.files.has(h.objectPath));
    if (!potentialOwned) assert.equal(h.db.documents.get(`chatSafetyReports/${first}`).externalReferencesRemoved, 1);
  }
});

test('attachment preview reauthorizes and validates actual stored metadata without exposing URLs in lists', async () => {
  const h = harness();
  const preview = await h.service.preview(h.request('manager', { reportId: first, attachmentIndex: 0 }));
  assert.equal(preview.url, h.url);
  assert.equal((await h.service.list(h.request('manager'))).reports[0].evidence.message.attachments[0].url, undefined);
  await assert.rejects(h.service.preview(h.request('target', { reportId: first, attachmentIndex: 0 })), error => error.code === 'permission-denied');
  h.bucket.files.get(h.objectPath).size = '10';
  await assert.rejects(h.service.preview(h.request('operator', { reportId: first, attachmentIndex: 0 })), error => error.code === 'failed-precondition');
});

test('queued chat delivery checks current message removal before exposing original text', async () => {
  const h = harness();
  const safety = createChatSafetyService({ ...h.dependencies, assertOrganizationWritable: async () => {} });
  const delivery = { threadId: 'group', messageId: 'message', senderId: 'target', recipientId: 'reporter' };
  assert.equal(await safety.canDeliver(delivery), true);
  h.db.documents.get('chatThreads/group/messages/message').moderationStatus = 'removed';
  assert.equal(await safety.canDeliver(delivery), false);
});

test('organization restrictions survive A to B to A without locking a different organization or replacing either source', async () => {
  const h = harness();
  await h.service.moderate(h.request('manager', h.action('suspend_user')));
  const target = h.db.documents.get('users/target');
  target.chatRulesVersion = '2026-10-27';
  target.organizationId = 'other';
  h.db.documents.get('organizations/other').workerIds.push('target');
  h.db.documents.get('organizationBilling/other').accessMode = 'full';
  h.db.documents.set('chatThreads/other', { organizationId: 'other', participants: ['target', 'outsider', 'operator'] });
  const safety = createChatSafetyService({ ...h.dependencies, assertOrganizationWritable: async () => {} });
  assert.equal((await safety.getState(h.request('target', { threadId: 'other' }))).canSend, true);
  await safety.createUpload(h.request('target', { threadId: 'other', name: 'test.png', mimeType: 'image/png', size: 9 }));
  const reportB = 'e'.repeat(64);
  h.db.documents.set(`chatSafetyReports/${reportB}`, { ...h.db.documents.get(`chatSafetyReports/${second}`),
    organizationId: 'other', reporterUserId: 'operator', kind: 'user', threadId: 'other', messageId: null });
  await h.service.moderate(h.request('outsider', h.action('suspend_user', reportB, 'suspend-other-org')));
  assert.equal((await safety.getState(h.request('target', { threadId: 'other' }))).canSend, false);
  // B is the last-action projection, but A's active private entry must still
  // keep its anonymized restoration source when A's reporter deletes account.
  await deleteDispatchUserData({ db: h.db, bucket: h.bucket, FieldValue, authUser: { uid: 'reporter', providerData: [] } });
  assert.equal(h.db.documents.get(`chatSafetyReports/${first}`).reporterUserId, null);
  assert.equal(h.db.documents.get('chatUserModerationState/target').organizations.org.active, true);
  h.db.documents.get('users/target').organizationId = 'org';
  h.db.documents.get('organizations/org').workerIds.push('target');
  h.db.documents.get('organizationBilling/org').accessMode = 'full';
  assert.equal((await safety.getState(h.request('target', { threadId: 'group' }))).canSend, false);
  await h.service.moderate(h.request('manager', h.action('restore_user')));
  assert.equal((await safety.getState(h.request('target', { threadId: 'group' }))).canSend, true);
  h.db.documents.get('users/target').organizationId = 'other';
  assert.equal((await safety.getState(h.request('target', { threadId: 'other' }))).canSend, false);
  await h.service.moderate(h.request('outsider', h.action('restore_user', reportB, 'restore-other-org')));
  assert.equal((await safety.getState(h.request('target', { threadId: 'other' }))).canSend, true);
  h.db.documents.get('users/target').chatSuspension = { active: true, reason: 'Legacy unscoped restriction' };
  assert.equal((await safety.getState(h.request('target', { threadId: 'other' }))).canSend, false);
  await assert.rejects(safety.createUpload(h.request('target', { threadId: 'other', name: 'test.png', mimeType: 'image/png', size: 9 })), /suspended/);
});

test('a reviewer role change immediately revokes actions even with a valid earlier queue', async () => {
  const h = harness();
  assert.ok((await h.service.list(h.request('manager'))).reports.length > 0);
  h.db.documents.get('users/manager').role = 'worker';
  await assert.rejects(h.service.moderate(h.request('manager', h.action('dismiss'))), error => error.code === 'permission-denied');
});

test('a deletion-marked reviewer loses list, action and preview access even with an operator claim', async () => {
  for (const uid of ['manager', 'operator']) {
    const h = harness();
    assert.ok((await h.service.list(h.request(uid))).reports.length > 0);
    h.db.documents.get(`users/${uid}`).accountDeletionStartedAt = new Date();
    await assert.rejects(h.service.list(h.request(uid)), error => error.code === 'permission-denied');
    await assert.rejects(h.service.moderate(h.request(uid, h.action('dismiss'))), error => error.code === 'permission-denied');
    await assert.rejects(h.service.preview(h.request(uid, { reportId: first, attachmentIndex: 0 })), error => error.code === 'permission-denied');
  }
});

test('a verified earlier local unscoped suspension can be restored without unlocking unknown legacy restrictions', async () => {
  const h = harness();
  await h.service.moderate(h.request('manager', h.action('suspend_user')));
  const target = h.db.documents.get('users/target');
  delete target.chatSuspension.organizationId;
  delete target.chatOrganizationSuspensions;
  delete h.db.documents.get('chatUserModerationState/target').organizations;
  const report = (await h.service.list(h.request('manager'))).reports.find(value => value.id === first);
  assert.ok(report.availableActions.includes('restore_user'));
  await h.service.moderate(h.request('manager', h.action('restore_user')));
  assert.equal(h.db.documents.get('users/target').chatSuspension.active, false);
  await h.service.moderate(h.request('manager', h.action('suspend_user', first, 'another-suspension')));
  h.db.documents.get('users/target').chatSuspension = { active: true, reason: 'Unknown legacy restriction', updatedAt: new Date(0) };
  await assert.rejects(h.service.moderate(h.request('manager', h.action('restore_user', first, 'unknown-legacy-restore'))), error => error.code === 'failed-precondition');
});

test('reporter deletion keeps only anonymized active enforcement and permits authorized restoration', async () => {
  const h = harness();
  await h.service.moderate(h.request('manager', h.action('suspend_user')));
  await deleteDispatchUserData({ db: h.db, bucket: h.bucket, FieldValue, authUser: { uid: 'reporter', providerData: [] } });
  const report = h.db.documents.get(`chatSafetyReports/${first}`);
  assert.equal(report.reporterUserId, null); assert.equal(report.reporterDisplayName, 'Former member');
  assert.equal(report.details, ''); assert.equal(report.evidence.message.text, '');
  assert.equal(h.db.documents.get('users/target').chatSuspension.active, true);
  assert.equal(h.db.documents.has(`chatSafetyReports/${second}`), false);
  await h.service.moderate(h.request('secondmanager', h.action('restore_user')));
  assert.equal(h.db.documents.get('users/target').chatSuspension.active, false);
  await deleteDispatchUserData({ db: h.db, bucket: h.bucket, FieldValue, authUser: { uid: 'target', providerData: [] } });
  assert.equal(h.db.documents.has(`chatSafetyReports/${first}`), false);
  assert.equal([...h.db.documents.keys()].some(path => path.startsWith(`chatSafetyReports/${first}/`)), false);
  assert.equal(h.db.documents.has('chatUserModerationState/target'), false);
});
