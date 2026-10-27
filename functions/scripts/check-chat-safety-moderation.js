const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ID, assertLocalChatSafetyEnvironment, chatSafetyFixture, assertChatSafetyProfileMatches } = require('./chat-safety-test-common');

const CALLABLES = new Set(['acceptChatRules', 'sendChatMessage', 'createChatUpload', 'submitChatReport', 'listModerationReports', 'moderateChatReport', 'getChatReportAttachmentPreview']);

async function run() {
  const runId = assertLocalChatSafetyEnvironment();
  process.env.METADATA_SERVER_DETECTION = 'none';
  const fixture = chatSafetyFixture(runId);
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
  const { getAuth } = require('firebase-admin/auth');
  const { getStorage } = require('firebase-admin/storage');
  const app = initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.firebasestorage.app` });
  const db = getFirestore(app);
  const auth = getAuth(app);
  const bucket = getStorage(app).bucket();
  const marker = db.collection('localChatSafetyRuns').doc(runId);
  const state = (await marker.get()).data();
  assert.equal(state?.state, 'ready');
  assert.ok(!state?.moderationStartedAt, 'Use a fresh moderation fixture; existing reports and actions are never reset.');
  const users = Object.fromEntries(fixture.users.map(user => [user.key, user]));
  for (const user of fixture.users) assertChatSafetyProfileMatches(user, (await db.collection('users').doc(user.uid).get()).data());
  const tokens = {};
  const results = [];
  const downloadVerification = [];
  const reports = {};
  const functionOrigin = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;
  const firestoreOrigin = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const storageOrigin = `http://127.0.0.1:9199/v0/b/${PROJECT_ID}.firebasestorage.app/o`;
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  async function login(key) {
    const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: users[key].email, password: fixture.password, returnSecureToken: true }),
    });
    assert.equal(response.status, 200, `Local login failed for ${key}.`);
    tokens[key] = (await response.json()).idToken;
  }
  for (const key of Object.keys(users)) await login(key);
  async function call(key, name, data) {
    assert.ok(CALLABLES.has(name));
    const response = await fetch(`${functionOrigin}/${name}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${tokens[key]}` } : {}) }, body: JSON.stringify({ data }),
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`${name} is unavailable: HTTP ${response.status}`); }
    if (response.status !== 200 || body.error) {
      const error = new Error(`${name}: ${body.error?.message || response.status}`);
      error.status = body.error?.status || `HTTP_${response.status}`;
      throw error;
    }
    return body.result;
  }
  async function rejects(key, name, data, statuses) {
    await assert.rejects(() => call(key, name, data), error => {
      assert.ok(statuses.includes(error.status), `${error.message} (${error.status}); expected ${statuses.join('/')}`);
      return true;
    });
  }
  async function rest(key, documentPath, method = 'GET', fields) {
    const mask = fields ? '?' + Object.keys(fields).map(field => `updateMask.fieldPaths=${field}`).join('&') : '';
    const response = await fetch(`${firestoreOrigin}/${documentPath}${mask}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[key]}` },
      ...(fields ? { body: JSON.stringify({ fields }) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  const actionData = (reportId, action, clientRequestId, extra = {}) => ({ reportId, action, clientRequestId, note: 'Synthetic local moderation verification.', ...extra });
  const act = (key, reportId, action, clientRequestId, extra) => call(key, 'moderateChatReport', actionData(reportId, action, clientRequestId, extra));
  const submit = async (key, data) => (await call(key, 'submitChatReport', data)).reportId;
  const userReport = (threadId, targetUserId, clientRequestId) => ({ threadId, kind: 'user', targetUserId, reason: 'other', details: 'Synthetic local moderation fixture.', clientRequestId });
  async function step(name, fn) { await fn(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  async function queue(key, limit = 50, cursor) { return call(key, 'listModerationReports', { limit, ...(cursor ? { cursor } : {}) }); }
  async function attachmentMessage(label) {
    const grant = await call('reported', 'createChatUpload', { threadId: fixture.threadIds.direct, name: `${label}.png`, mimeType: 'image/png', size: imageBytes.length });
    const boundary = `moderation-${runId}-${label}`;
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name: grant.objectPath, contentType: 'image/png' })}\r\n--${boundary}\r\nContent-Type: image/png\r\n\r\n`), imageBytes, Buffer.from(`\r\n--${boundary}--`)]);
    const upload = await fetch(`${storageOrigin}?name=${encodeURIComponent(grant.objectPath)}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Firebase ${tokens.reported}`, 'Content-Type': `multipart/related; boundary=${boundary}`, 'X-Goog-Upload-Protocol': 'multipart' }, body,
    });
    const metadata = await upload.json();
    assert.equal(upload.status, 200, JSON.stringify(metadata));
    const url = `${storageOrigin}/${encodeURIComponent(grant.objectPath)}?alt=media&token=${encodeURIComponent(metadata.downloadTokens.split(',')[0])}`;
    const text = `Synthetic ${label} attachment message.`;
    const message = await call('reported', 'sendChatMessage', { threadId: fixture.threadIds.direct, text,
      attachments: [{ id: grant.objectPath, kind: 'image', name: `${label}.png`, mimeType: 'image/png', size: imageBytes.length, url }] });
    const download = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    assert.equal(download.status, 200);
    assert.equal((await download.arrayBuffer()).byteLength, imageBytes.length);
    return { ...grant, ...message, url, text };
  }
  async function assertAttachmentRevoked(attachment, phase) {
    assert.equal((await bucket.file(attachment.objectPath).exists())[0], false);
    const publicResponse = await fetch(attachment.url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    await publicResponse.body?.cancel();
    assert.ok([403, 404].includes(publicResponse.status));
    // Storage emulator rules deny a missing public-token object before checking existence.
    // An authenticated participant checks the same former URL and receives definitive 404.
    const authenticated = await fetch(attachment.url, { headers: { Authorization: `Firebase ${tokens.reporter}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    await authenticated.body?.cancel();
    assert.equal(authenticated.status, 404);
    downloadVerification.push({ phase, objectMissing: true, publicStatus: publicResponse.status, authenticatedStatus: authenticated.status });
  }

  // Read-only readiness probe precedes all additional fixture creation.
  await queue('manager');
  await marker.update({ moderationStartedAt: Timestamp.now() });
  let attachment;
  const eventId = `chat-safety-event-${runId}`;
  try {
    users.operatorPeer = { key: 'operatorPeer', uid: `chat-safety-operator-peer-${runId}`, email: `chat.safety.operatorpeer.${runId}@example.test`, displayName: 'Local Operator Peer', role: 'worker', organizationId: fixture.operatorOrganizationId };
    await auth.createUser({ uid: users.operatorPeer.uid, email: users.operatorPeer.email, displayName: users.operatorPeer.displayName, password: fixture.password, emailVerified: true });
    await db.collection('users').doc(users.operatorPeer.uid).create({ ...users.operatorPeer, canonicalEmail: users.operatorPeer.email, onboardingCompleted: true, pushTokens: [], createdAt: Timestamp.now() });
    await db.collection('organizations').doc(fixture.operatorOrganizationId).update({ workerIds: FieldValue.arrayUnion(users.operatorPeer.uid) });
    const operatorThreadId = `organization:${fixture.operatorOrganizationId}:all`;
    await db.collection('chatThreads').doc(operatorThreadId).create({ id: operatorThreadId, organizationId: fixture.operatorOrganizationId, kind: 'organization', title: 'Local operator conflict checks', participants: [users.operator.uid, users.operatorPeer.uid], updatedAt: Timestamp.now() });
    await login('operatorPeer');
    for (const key of ['reported', 'reporter']) await call(key, 'acceptChatRules', { version: '2026-10-27' });
    await db.collection('events').doc(eventId).create({ id: eventId, managerId: users.manager.uid, organizationId: fixture.organizationId,
      name: 'Local safety test event', location: 'Synthetic venue', startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString(),
      teamIds: [fixture.teamId], workerIds: [users.reported.uid], roles: [{ id: 'fixture-role', name: 'Stage', openSlots: 1, assignedWorkerIds: [users.reported.uid], waitlistWorkerIds: [], tasks: [{ id: 'fixture-task', name: 'Preserved event task', completedBy: [] }] }],
    });
    attachment = await attachmentMessage('remove');
    reports.remove = await submit('reporter', { threadId: fixture.threadIds.direct, kind: 'message', messageId: attachment.messageId, reason: 'other', clientRequestId: 'moderation-remove-report' });
    reports.managerTarget = await submit('reporter', userReport(fixture.threadIds.manager, users.manager.uid, 'moderation-manager-target'));
    reports.suspendFirst = await submit('reporter', userReport(fixture.threadIds.direct, users.reported.uid, 'moderation-suspend-first'));
    reports.suspendNewer = await submit('reporter', userReport(fixture.threadIds.direct, users.reported.uid, 'moderation-suspend-newer'));
    reports.managerReporter = await submit('manager', userReport(fixture.threadIds.organization, users.reported.uid, 'moderation-manager-reporter'));
    reports.managerForOperator = await submit('secondManager', userReport(fixture.threadIds.organization, users.manager.uid, 'moderation-operator-manager-target'));
    reports.operatorReporter = await submit('operator', userReport(operatorThreadId, users.operatorPeer.uid, 'moderation-operator-self-reporter'));
    reports.operatorTarget = await submit('operatorPeer', userReport(operatorThreadId, users.operator.uid, 'moderation-operator-self-target'));

    await step('moderation queue requires authority and excludes every self conflict', async () => {
      await rejects(null, 'listModerationReports', {}, ['UNAUTHENTICATED']);
      await rejects('reporter', 'listModerationReports', {}, ['PERMISSION_DENIED']);
      const managerQueue = await queue('manager');
      assert.ok(managerQueue.reports.some(report => report.id === reports.remove));
      const removalEntry = managerQueue.reports.find(report => report.id === reports.remove);
      assert.ok(!JSON.stringify(removalEntry).includes(attachment.url));
      assert.ok(removalEntry.evidence.message.attachments.every(item => !('url' in item) && !('id' in item)));
      for (const id of [reports.managerTarget, reports.managerForOperator, reports.managerReporter]) assert.ok(!managerQueue.reports.some(report => report.id === id));
      const operatorQueue = await queue('operator');
      assert.ok(operatorQueue.reports.some(report => report.id === reports.managerTarget));
      for (const id of [reports.operatorReporter, reports.operatorTarget]) assert.ok(!operatorQueue.reports.some(report => report.id === id));
      assert.ok(!(await queue('outsider')).reports.some(report => Object.values(reports).includes(report.id)));
    });
    await step('workers, unrelated managers and conflicted operators cannot moderate known report IDs', async () => {
      for (const key of ['reporter', 'reported', 'outsider']) await rejects(key, 'moderateChatReport', actionData(reports.remove, 'dismiss', `deny-${key}-report`), ['PERMISSION_DENIED']);
      for (const id of [reports.managerTarget, reports.managerReporter]) await rejects('manager', 'moderateChatReport', actionData(id, 'dismiss', `deny-manager-${id.slice(0, 12)}`), ['PERMISSION_DENIED']);
      for (const id of [reports.operatorReporter, reports.operatorTarget]) await rejects('operator', 'moderateChatReport', actionData(id, 'dismiss', `deny-operator-${id.slice(0, 12)}`), ['PERMISSION_DENIED']);
    });
    await step('queue cursors remain bound to caller and current authority scope', async () => {
      const page = await queue('manager', 1);
      assert.ok(page.nextCursor);
      await rejects('secondManager', 'listModerationReports', { limit: 1, cursor: page.nextCursor }, ['INVALID_ARGUMENT', 'PERMISSION_DENIED']);
      await rejects('operator', 'listModerationReports', { limit: 1, cursor: page.nextCursor }, ['INVALID_ARGUMENT', 'PERMISSION_DENIED']);
      const orgRef = db.collection('organizations').doc(fixture.organizationId);
      const profile = db.collection('users').doc(users.manager.uid);
      const demote = db.batch(); demote.update(profile, { role: 'worker' }); demote.update(orgRef, { managerIds: FieldValue.arrayRemove(users.manager.uid), workerIds: FieldValue.arrayUnion(users.manager.uid) }); await demote.commit();
      try { await rejects('manager', 'listModerationReports', { limit: 1, cursor: page.nextCursor }, ['PERMISSION_DENIED', 'INVALID_ARGUMENT']); }
      finally { const restore = db.batch(); restore.update(profile, { role: 'manager' }); restore.update(orgRef, { managerIds: FieldValue.arrayUnion(users.manager.uid), workerIds: FieldValue.arrayRemove(users.manager.uid) }); await restore.commit(); }
    });
    await step('second Manager and operator can handle reports about a Manager', async () => {
      assert.equal((await act('secondManager', reports.managerTarget, 'dismiss', 'second-manager-dismiss')).actionState, 'completed');
      assert.equal((await act('operator', reports.managerForOperator, 'dismiss', 'operator-manager-dismiss')).actionState, 'completed');
      await rejects('secondManager', 'moderateChatReport', actionData(reports.managerTarget, 'suspend_user', 'stale-report-revision', { expectedRevision: 0 }), ['FAILED_PRECONDITION']);
    });
    await step('operator cursor scope contracts after moderator claim removal and token refresh', async () => {
      const page = await queue('operator', 1);
      assert.ok(page.nextCursor);
      await auth.setCustomUserClaims(users.operator.uid, {});
      await login('operator');
      try {
        await rejects('operator', 'listModerationReports', { cursor: page.nextCursor, limit: 1 }, ['INVALID_ARGUMENT', 'PERMISSION_DENIED']);
        await rejects('operator', 'moderateChatReport', actionData(reports.remove, 'dismiss', 'revoked-operator-action'), ['PERMISSION_DENIED']);
      } finally { await auth.setCustomUserClaims(users.operator.uid, { dispatchModerator: true }); await login('operator'); }
    });
    await step('attachment previews require current reviewer authority and no self conflict', async () => {
      const preview = await call('manager', 'getChatReportAttachmentPreview', { reportId: reports.remove, attachmentIndex: 0 });
      assert.equal(preview.mimeType, 'image/png');
      assert.ok(preview.url.startsWith('http://127.0.0.1:9199/'));
      assert.equal((await fetch(preview.url, { redirect: 'error', signal: AbortSignal.timeout(15000) })).status, 200);
      for (const key of ['reporter', 'reported', 'outsider']) await rejects(key, 'getChatReportAttachmentPreview', { reportId: reports.remove, attachmentIndex: 0 }, ['PERMISSION_DENIED']);
      await rejects('manager', 'getChatReportAttachmentPreview', { reportId: reports.managerTarget, attachmentIndex: 0 }, ['PERMISSION_DENIED']);
      await rejects('operator', 'getChatReportAttachmentPreview', { reportId: reports.operatorTarget, attachmentIndex: 0 }, ['PERMISSION_DENIED']);
      await rejects('manager', 'getChatReportAttachmentPreview', { reportId: reports.remove, attachmentIndex: -1 }, ['INVALID_ARGUMENT']);
    });
    await step('message removal redacts content and preview and revokes the real attachment URL', async () => {
      const response = await act('manager', reports.remove, 'remove_message', 'manager-remove-message');
      assert.equal(response.actionState, 'completed');
      assert.equal(response.status, 'resolved');
      const message = (await db.collection('chatThreads').doc(fixture.threadIds.direct).collection('messages').doc(attachment.messageId).get()).data();
      assert.equal(message.moderationStatus, 'removed'); assert.equal(message.text, ''); assert.deepEqual(message.attachments, []);
      const thread = (await db.collection('chatThreads').doc(fixture.threadIds.direct).get()).data();
      assert.notEqual(thread.lastMessageText, attachment.text);
      await assertAttachmentRevoked(attachment, 'normal removal');
      await rejects('manager', 'getChatReportAttachmentPreview', { reportId: reports.remove, attachmentIndex: 0 }, ['NOT_FOUND', 'FAILED_PRECONDITION']);
      assert.ok(!JSON.stringify((await db.collection('chatSafetyReports').doc(reports.remove).get()).data()).includes(imageBytes.toString('base64')));
      assert.ok((await db.collection('chatSafetyReports').doc(reports.remove).get()).data().evidence.message.attachments.every(item => !('url' in item) && !('id' in item)));
      const auditRef = db.collection('chatSafetyReports').doc(reports.remove).collection('moderationAudit');
      const before = await auditRef.get();
      assert.ok(before.size > 0);
      assert.deepEqual(await act('manager', reports.remove, 'remove_message', 'manager-remove-message'), response);
      const after = await auditRef.get();
      assert.equal(after.size, before.size);
      assert.deepEqual(after.docs.map(doc => ({ id: doc.id, data: doc.data() })), before.docs.map(doc => ({ id: doc.id, data: doc.data() })));
    });
    await step('moderation audit and operation records are private and client-immutable', async () => {
      const audit = await db.collection('chatSafetyReports').doc(reports.remove).collection('moderationAudit').get();
      const auditId = audit.docs[0].id;
      for (const key of ['manager', 'reporter', 'reported', 'operator']) {
        assert.equal((await rest(key, `chatSafetyReports/${reports.remove}/moderationAudit/${auditId}`)).status, 403);
        assert.equal((await rest(key, `chatModerationOperations/${auditId}`)).status, 403);
      }
      assert.equal((await rest('manager', `chatSafetyReports/${reports.remove}/moderationAudit/${auditId}`, 'PATCH', { note: { stringValue: 'Forged audit edit' } })).status, 403);
      assert.equal((await rest('manager', `chatSafetyReports/${reports.remove}/moderationAudit/${auditId}`, 'DELETE')).status, 403);
    });
    await step('chat suspension blocks authoring while preserving event tasks and safety reports', async () => {
      assert.equal((await act('manager', reports.suspendFirst, 'suspend_user', 'manager-suspend-first')).actionState, 'completed');
      const profile = (await db.collection('users').doc(users.reported.uid).get()).data();
      assert.equal(profile.chatSuspension.active, true);
      assert.ok(!JSON.stringify(profile.chatSuspension).includes(reports.suspendFirst));
      assert.ok(!('sourceReportId' in profile.chatSuspension) && !('sourceOperationId' in profile.chatSuspension));
      const privateState = (await db.collection('chatUserModerationState').doc(users.reported.uid).get()).data();
      assert.equal(privateState.sourceReportId, reports.suspendFirst);
      assert.equal((await rest('reported', `chatUserModerationState/${users.reported.uid}`)).status, 403);
      await rejects('reported', 'sendChatMessage', { threadId: fixture.threadIds.direct, text: 'Blocked during suspension', attachments: [] }, ['PERMISSION_DENIED']);
      await rejects('reported', 'createChatUpload', { threadId: fixture.threadIds.direct, name: 'blocked.png', mimeType: 'image/png', size: imageBytes.length }, ['PERMISSION_DENIED']);
      const id = `custom:suspended-${runId}`;
      assert.equal((await rest('reported', `chatThreads/${id}`, 'PATCH', { id: { stringValue: id }, organizationId: { stringValue: fixture.organizationId }, kind: { stringValue: 'custom' }, title: { stringValue: 'Blocked suspended chat' }, participants: { arrayValue: { values: [users.reported.uid, users.reporter.uid].map(stringValue => ({ stringValue })) } } })).status, 403);
      assert.equal((await rest('reported', `chatThreads/${fixture.threadIds.custom}`, 'PATCH', { title: { stringValue: 'Blocked suspended rename' } })).status, 403);
      const event = await rest('reported', `events/${eventId}`); assert.equal(event.status, 200); assert.ok(JSON.stringify(event.body).includes('Preserved event task'));
      const safetyReport = await submit('reported', userReport(fixture.threadIds.direct, users.reporter.uid, 'suspended-user-safety-report'));
      assert.ok(safetyReport);
    });
    await step('an old restore cannot clear a newer report suspension', async () => {
      await rejects('manager', 'moderateChatReport', actionData(reports.suspendNewer, 'suspend_user', 'deny-replacing-first'), ['FAILED_PRECONDITION']);
      await act('manager', reports.suspendFirst, 'restore_user', 'manager-restore-first');
      await act('manager', reports.suspendNewer, 'suspend_user', 'manager-suspend-newer');
      await rejects('manager', 'moderateChatReport', actionData(reports.suspendFirst, 'restore_user', 'manager-stale-restore'), ['FAILED_PRECONDITION', 'ABORTED']);
      await rejects('manager', 'moderateChatReport', actionData(reports.suspendFirst, 'suspend_user', 'deny-replacing-newer'), ['FAILED_PRECONDITION']);
      assert.equal((await db.collection('chatUserModerationState').doc(users.reported.uid).get()).data().sourceReportId, reports.suspendNewer);
      await act('manager', reports.suspendNewer, 'restore_user', 'manager-current-restore');
      assert.ok((await db.collection('users').doc(users.reported.uid).get()).data().chatSuspension?.active !== true);
      assert.ok((await call('reported', 'sendChatMessage', { threadId: fixture.threadIds.direct, text: 'Restored authoring message.', attachments: [] })).messageId);
      assert.ok((await call('reported', 'createChatUpload', { threadId: fixture.threadIds.direct, name: 'restored.png', mimeType: 'image/png', size: imageBytes.length })).grantId);
      assert.equal((await rest('reported', `chatThreads/${fixture.threadIds.custom}`, 'PATCH', { title: { stringValue: 'Restored authoring title' } })).status, 200);
      const id = `custom:restored-${runId}`;
      assert.equal((await rest('reported', `chatThreads/${id}`, 'PATCH', { id: { stringValue: id }, organizationId: { stringValue: fixture.organizationId }, kind: { stringValue: 'custom' }, title: { stringValue: 'Restored chat creation' }, participants: { arrayValue: { values: [users.reported.uid, users.reporter.uid].map(stringValue => ({ stringValue })) } } })).status, 200);
    });
    await step('an uncorrelated active profile restriction cannot be overwritten', async () => {
      const ref = db.collection('users').doc(users.reported.uid);
      const previous = (await ref.get()).data().chatSuspension;
      await ref.update({ chatSuspension: { active: true, reason: 'Synthetic uncorrelated restriction' } });
      try { await rejects('manager', 'moderateChatReport', actionData(reports.suspendFirst, 'suspend_user', 'deny-uncorrelated-overwrite'), ['FAILED_PRECONDITION']); }
      finally { await ref.update({ chatSuspension: previous }); }
    });

    await step('cleanup failure stays pending and the same action retries without duplicate decisions', async () => {
      const pendingAttachment = await attachmentMessage('cleanup-retry');
      reports.cleanup = await submit('reporter', { threadId: fixture.threadIds.direct, kind: 'message', messageId: pendingAttachment.messageId, reason: 'other', clientRequestId: 'moderation-cleanup-report' });
      let injectedFailures = 0;
      const { createChatModerationService } = require('../lib/chat-safety-moderation');
      const faultService = createChatModerationService({
        getDb: () => db, getFieldValue: () => FieldValue, projectId: () => PROJECT_ID,
        emulatorOrigins: () => ['http://127.0.0.1:9199'],
        // The real factory still enforces its reviewer, organization and conflict checks.
        // This local-only callback limits the injected test to this exact fixture actor.
        assertAccountAllowed: async (tx, uid) => {
          assert.equal(uid, users.manager.uid);
          assertChatSafetyProfileMatches(users.manager, (await tx.get(db.collection('users').doc(uid))).data());
        },
        getBucket: () => ({ name: bucket.name, file: objectPath => {
          assert.equal(objectPath, pendingAttachment.objectPath);
          const file = bucket.file(objectPath);
          return { setMetadata: metadata => file.setMetadata(metadata), getMetadata: () => file.getMetadata(), delete: async options => {
            if (injectedFailures === 0) { injectedFailures++; throw new Error('Synthetic one-shot local Storage deletion failure'); }
            return file.delete(options);
          } };
        } }),
        fetchImpl: (url, options) => { assert.equal(new URL(url).origin, 'http://127.0.0.1:9199'); return fetch(url, options); },
      });
      const data = actionData(reports.cleanup, 'remove_message', 'manager-cleanup-retry');
      const failed = await faultService.moderate({ auth: { uid: users.manager.uid, token: {} }, data });
      assert.equal(injectedFailures, 1); assert.equal(failed.actionState, 'cleanup_pending'); assert.notEqual(failed.status, 'resolved');
      assert.equal((await bucket.file(pendingAttachment.objectPath).exists())[0], true);
      const report = (await db.collection('chatSafetyReports').doc(reports.cleanup).get()).data();
      assert.equal(report.status, 'under_review'); assert.equal(report.moderationAction.status, 'cleanup_pending');
      const message = (await db.collection('chatThreads').doc(fixture.threadIds.direct).collection('messages').doc(pendingAttachment.messageId).get()).data();
      assert.equal(message.moderationStatus, 'removed'); assert.equal(message.text, ''); assert.deepEqual(message.attachments, []);
      await rejects('manager', 'getChatReportAttachmentPreview', { reportId: reports.cleanup, attachmentIndex: 0 }, ['NOT_FOUND', 'FAILED_PRECONDITION']);
      await rejects('manager', 'moderateChatReport', actionData(reports.cleanup, 'dismiss', 'pending-cleanup-dismiss'), ['FAILED_PRECONDITION']);
      const auditRef = db.collection('chatSafetyReports').doc(reports.cleanup).collection('moderationAudit');
      const pendingAudit = await auditRef.get();
      const completed = await call('manager', 'moderateChatReport', data);
      assert.equal(completed.actionState, 'completed'); assert.equal(completed.status, 'resolved');
      await assertAttachmentRevoked(pendingAttachment, 'retried removal');
      const completedAudit = await auditRef.get();
      for (const previous of pendingAudit.docs) assert.deepEqual(completedAudit.docs.find(doc => doc.id === previous.id).data(), previous.data());
      assert.equal(completedAudit.docs.filter(doc => doc.data().action === 'remove_message').length, 1);
      assert.deepEqual(await call('manager', 'moderateChatReport', data), completed);
      assert.equal((await auditRef.get()).size, completedAudit.size);
    });
    // Account-deletion verification is a separate, explicitly local-library phase.
    await marker.update({ moderationState: 'core_passed', moderationCoreCompletedAt: Timestamp.now() });
  } catch (error) {
    results.push({ name: 'failure', status: 'failed', message: error.message });
    await marker.update({ moderationState: 'failed', moderationCompletedAt: Timestamp.now() });
    throw error;
  } finally {
    const outputDir = path.resolve(__dirname, '../../.local-data/chat-safety');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${runId}-moderation-results.json`), JSON.stringify({ runId, projectId: PROJECT_ID, reports, downloadVerification, results }, null, 2));
  }
}

if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
