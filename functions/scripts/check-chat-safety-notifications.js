const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ID, assertLocalChatSafetyEnvironment, chatSafetyFixture, assertChatSafetyProfileMatches } = require('./chat-safety-test-common');

const CALLABLES = new Set(['getChatSafetyState', 'acceptChatRules', 'createChatUpload', 'sendChatMessage', 'submitChatReport', 'listModerationReports', 'moderateChatReport']);

async function run() {
  const runId = assertLocalChatSafetyEnvironment();
  process.env.METADATA_SERVER_DETECTION = 'none';
  const fixture = chatSafetyFixture(runId);
  const users = Object.fromEntries(fixture.users.map(user => [user.key, user]));
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
  const { getStorage } = require('firebase-admin/storage');
  const app = initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.firebasestorage.app` });
  const db = getFirestore(app);
  const bucket = getStorage(app).bucket();
  const marker = db.collection('localChatSafetyRuns').doc(runId);
  const markerData = (await marker.get()).data();
  assert.equal(markerData?.state, 'ready');
  assert.ok(!markerData?.notificationsStartedAt, 'Use a fresh notification fixture; existing data is never reset.');
  for (const user of fixture.users) {
    const profile = (await db.collection('users').doc(user.uid).get()).data();
    assertChatSafetyProfileMatches(user, profile);
    assert.deepEqual(profile.pushTokens, [], 'Synthetic users must have no external push tokens.');
  }
  const { createChatReviewNotificationService } = require('../lib/chat-review-notifications');
  const reviewNotifications = createChatReviewNotificationService({ getDb: () => db, getFieldValue: () => FieldValue, projectId: () => PROJECT_ID });
  const tokens = {};
  const results = [];
  const reports = {};
  const functionOrigin = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;
  const firestoreOrigin = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const storageOrigin = `http://127.0.0.1:9199/v0/b/${PROJECT_ID}.firebasestorage.app/o`;
  for (const user of fixture.users) {
    const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: fixture.password, returnSecureToken: true }),
    });
    assert.equal(response.status, 200); tokens[user.key] = (await response.json()).idToken;
  }
  async function call(key, name, data) {
    assert.ok(CALLABLES.has(name));
    const response = await fetch(`${functionOrigin}/${name}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${tokens[key]}` } : {}) }, body: JSON.stringify({ data }),
    });
    const body = await response.json();
    if (response.status !== 200 || body.error) {
      const error = new Error(`${name}: ${body.error?.message || response.status}`); error.status = body.error?.status; throw error;
    }
    return body.result;
  }
  const state = key => call(key, 'getChatSafetyState', {});
  const act = (key, reportId, action, clientRequestId) => call(key, 'moderateChatReport', { reportId, action, clientRequestId, note: 'Synthetic notification verification.' });
  const userPayload = (targetKey, clientRequestId) => ({ threadId: fixture.threadIds.organization, kind: 'user', targetUserId: users[targetKey].uid, reason: 'other', details: 'Private synthetic report detail.', clientRequestId });
  const submit = async (key, payload) => (await call(key, 'submitChatReport', payload)).reportId;
  const reportRef = reportId => db.collection('chatSafetyReports').doc(reportId);
  const signal = async key => ((await db.collection('users').doc(users[key].uid).collection('chatSafetyState').doc('current').get()).data()?.version || 0);
  const notices = async reportId => (await db.collection('chatReviewNotificationSources').where('reportId', '==', reportId).get()).docs;
  const delivery = (notificationId, key) => reviewNotifications.canDeliver({ notificationId, recipientId: users[key].uid });
  async function eventually(check, message) {
    const deadline = Date.now() + 15000;
    do { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 150)); } while (Date.now() < deadline);
    assert.fail(message);
  }
  async function assertRecipients(reportId, keys) {
    await eventually(async () => (await notices(reportId)).length === keys.length, 'Report notification trigger did not create expected recipients.');
    const sources = await notices(reportId);
    const actual = [];
    for (const source of sources) {
      const notice = (await db.collection('userNotifications').doc(source.id).get()).data();
      assert.ok(notice, 'Private notice marker must have a corresponding initial notice.'); actual.push(notice.userId);
    }
    assert.deepEqual(actual.sort(), keys.map(key => users[key].uid).sort());
    return sources;
  }
  async function rest(key, documentPath, method = 'GET', fields) {
    const mask = fields ? '?' + Object.keys(fields).map(field => `updateMask.fieldPaths=${field}`).join('&') : '';
    const response = await fetch(`${firestoreOrigin}/${documentPath}${mask}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[key]}` },
      ...(fields ? { body: JSON.stringify({ fields }) } : {}),
    });
    await response.body?.cancel(); return response.status;
  }
  async function denied(fn) { await assert.rejects(fn, error => ['PERMISSION_DENIED', 'FAILED_PRECONDITION'].includes(error.status)); }
  async function step(name, fn) { await fn(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  const firstPayload = userPayload('reported', 'notify-worker-report');
  let firstNotice;
  await marker.update({ notificationsStartedAt: Timestamp.now() });
  try {
    await step('new fixture begins with zero pending reviews and no external push registrations', async () => {
      for (const key of ['manager', 'secondManager', 'reporter', 'reported', 'outsider']) assert.equal((await state(key)).pendingReviewCount, 0);
      for (const user of fixture.users) assert.equal((await db.collection('pushDeliveries').where('userId', '==', user.uid).get()).size, 0);
    });
    await step('a report alerts only eligible Managers with generic private-safe content and live signals', async () => {
      const previous = { manager: await signal('manager'), secondManager: await signal('secondManager') };
      reports.first = await submit('reporter', firstPayload);
      const sources = await assertRecipients(reports.first, ['manager', 'secondManager']);
      for (const source of sources) {
        const notice = (await db.collection('userNotifications').doc(source.id).get()).data();
        assert.equal(notice.kind, 'chat_safety_report'); assert.equal(notice.read, false); assert.equal(notice.pushAuthorized, true);
        assert.ok(typeof notice.title === 'string' && typeof notice.body === 'string');
        const serialized = JSON.stringify(notice);
        for (const privateValue of [reports.first, users.reporter.uid, users.reported.uid, users.reporter.displayName, users.reported.displayName, firstPayload.details]) assert.ok(!serialized.includes(privateValue));
        if (notice.userId === users.manager.uid) firstNotice = source.id;
        assert.equal(await rest('manager', `chatReviewNotificationSources/${source.id}`), 403);
      }
      assert.equal(await rest('manager', `userNotifications/${firstNotice}`), 200);
      assert.equal(await rest('reporter', `userNotifications/${firstNotice}`), 403);
      assert.equal(await delivery(firstNotice, 'manager'), true);
      assert.equal(await delivery(firstNotice, 'secondManager'), false);
      for (const key of ['manager', 'secondManager']) {
        assert.equal((await state(key)).pendingReviewCount, 1);
        await eventually(async () => (await signal(key)) > previous[key], 'Manager live signal did not advance.');
      }
    });
    await step('submission and trigger retries do not duplicate notifications or reset read status', async () => {
      assert.equal(await submit('reporter', firstPayload), reports.first);
      assert.equal(await rest('manager', `userNotifications/${firstNotice}`, 'PATCH', { read: { booleanValue: true } }), 200);
      const report = (await reportRef(reports.first).get()).data();
      await reviewNotifications.handleReportWrite({ reportId: reports.first, before: null, after: report });
      await reviewNotifications.handleReportWrite({ reportId: reports.first, before: null, after: report });
      await assertRecipients(reports.first, ['manager', 'secondManager']);
      assert.equal((await db.collection('userNotifications').doc(firstNotice).get()).data().read, true);
      assert.equal((await state('manager')).pendingReviewCount, 1, 'Reading a notification does not resolve a report.');
      assert.equal(await delivery(firstNotice, 'manager'), true);
    });
    await step('resolving a report clears pending counts and suppresses stale notice delivery', async () => {
      const previous = await signal('secondManager');
      await act('manager', reports.first, 'dismiss', 'notify-dismiss-first');
      for (const key of ['manager', 'secondManager']) assert.equal((await state(key)).pendingReviewCount, 0);
      await eventually(async () => (await signal('secondManager')) > previous, 'Resolution did not refresh other eligible Managers.');
      assert.equal(await delivery(firstNotice, 'manager'), false);
    });
    await step('reporter and target Managers are excluded from notifications and pending counts', async () => {
      reports.managerTarget = await submit('reporter', userPayload('manager', 'notify-manager-target'));
      await assertRecipients(reports.managerTarget, ['secondManager']);
      reports.managerReporter = await submit('manager', userPayload('reported', 'notify-manager-reporter'));
      await assertRecipients(reports.managerReporter, ['secondManager']);
      reports.bothConflicted = await submit('secondManager', userPayload('manager', 'notify-both-conflicted'));
      const report = (await reportRef(reports.bothConflicted).get()).data();
      await reviewNotifications.handleReportWrite({ reportId: reports.bothConflicted, before: null, after: report });
      await assertRecipients(reports.bothConflicted, []);
      assert.equal((await state('manager')).pendingReviewCount, 0);
      assert.equal((await state('secondManager')).pendingReviewCount, 2);
      for (const key of ['reporter', 'reported', 'outsider']) assert.equal((await state(key)).pendingReviewCount, 0);
    });
    await step('pending attachment cleanup remains counted until the real removal retry completes', async () => {
      await call('reported', 'acceptChatRules', { version: '2026-10-27' });
      const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
      const grant = await call('reported', 'createChatUpload', { threadId: fixture.threadIds.direct, name: 'notification-cleanup.png', mimeType: 'image/png', size: bytes.length });
      const boundary = `notify-${runId}`;
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name: grant.objectPath, contentType: 'image/png' })}\r\n--${boundary}\r\nContent-Type: image/png\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--`)]);
      const upload = await fetch(`${storageOrigin}?name=${encodeURIComponent(grant.objectPath)}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Firebase ${tokens.reported}`, 'Content-Type': `multipart/related; boundary=${boundary}`, 'X-Goog-Upload-Protocol': 'multipart' }, body });
      assert.equal(upload.status, 200); const metadata = await upload.json();
      const url = `${storageOrigin}/${encodeURIComponent(grant.objectPath)}?alt=media&token=${encodeURIComponent(metadata.downloadTokens.split(',')[0])}`;
      const message = await call('reported', 'sendChatMessage', { threadId: fixture.threadIds.direct, text: 'Synthetic removal count verification.', attachments: [{ id: grant.objectPath, kind: 'image', name: 'notification-cleanup.png', mimeType: 'image/png', size: bytes.length, url }] });
      reports.cleanup = await submit('reporter', { threadId: fixture.threadIds.direct, kind: 'message', messageId: message.messageId, reason: 'other', clientRequestId: 'notify-cleanup-report' });
      await assertRecipients(reports.cleanup, ['manager', 'secondManager']);
      const { createChatModerationService } = require('../lib/chat-safety-moderation');
      const faultService = createChatModerationService({ getDb: () => db, getFieldValue: () => FieldValue, projectId: () => PROJECT_ID,
        emulatorOrigins: () => ['http://127.0.0.1:9199'],
        assertAccountAllowed: async (tx, uid) => { assert.equal(uid, users.manager.uid); assertChatSafetyProfileMatches(users.manager, (await tx.get(db.collection('users').doc(uid))).data()); },
        getBucket: () => ({ name: bucket.name, file: objectPath => { assert.equal(objectPath, grant.objectPath); const file = bucket.file(objectPath); return { setMetadata: value => file.setMetadata(value), getMetadata: () => file.getMetadata(), delete: async () => { throw new Error('Synthetic local notification cleanup failure'); } }; } }),
        fetchImpl: (value, options) => { assert.equal(new URL(value).origin, 'http://127.0.0.1:9199'); return fetch(value, options); },
      });
      const action = { reportId: reports.cleanup, action: 'remove_message', clientRequestId: 'notify-cleanup-retry', note: 'Synthetic notification cleanup verification.' };
      assert.equal((await faultService.moderate({ auth: { uid: users.manager.uid, token: {} }, data: action })).actionState, 'cleanup_pending');
      assert.equal((await state('manager')).pendingReviewCount, 1); assert.equal((await state('secondManager')).pendingReviewCount, 3);
      assert.equal((await call('manager', 'moderateChatReport', action)).actionState, 'completed');
      assert.equal((await state('manager')).pendingReviewCount, 0); assert.equal((await state('secondManager')).pendingReviewCount, 2);
      assert.equal((await bucket.file(grant.objectPath).exists())[0], false);
    });
    let roleNotice;
    await step('demotion removes existing review delivery and count authority and excludes new alerts', async () => {
      reports.role = await submit('reported', userPayload('reporter', 'notify-role-report'));
      const sources = await assertRecipients(reports.role, ['manager', 'secondManager']);
      for (const source of sources) if ((await db.collection('userNotifications').doc(source.id).get()).data().userId === users.manager.uid) roleNotice = source.id;
      assert.equal(await delivery(roleNotice, 'manager'), true);
      const batch = db.batch(); batch.update(db.collection('users').doc(users.manager.uid), { role: 'worker' }); batch.update(db.collection('organizations').doc(fixture.organizationId), { managerIds: FieldValue.arrayRemove(users.manager.uid), workerIds: FieldValue.arrayUnion(users.manager.uid) }); await batch.commit();
      assert.equal((await state('manager')).pendingReviewCount, 0); assert.equal(await delivery(roleNotice, 'manager'), false);
      await denied(() => call('manager', 'listModerationReports', {}));
      reports.demoted = await submit('reported', userPayload('reporter', 'notify-demoted-report'));
      await assertRecipients(reports.demoted, ['secondManager']);
      const restore = db.batch(); restore.update(db.collection('users').doc(users.manager.uid), { role: 'manager' }); restore.update(db.collection('organizations').doc(fixture.organizationId), { managerIds: FieldValue.arrayUnion(users.manager.uid), workerIds: FieldValue.arrayRemove(users.manager.uid) }); await restore.commit();
      assert.equal((await state('manager')).pendingReviewCount, 2); assert.equal(await delivery(roleNotice, 'manager'), true);
    });
    await step('roster removal and organization changes revoke stale delivery and exclude new report alerts', async () => {
      const orgRef = db.collection('organizations').doc(fixture.organizationId);
      await orgRef.update({ managerIds: FieldValue.arrayRemove(users.manager.uid) });
      await denied(() => state('manager')); assert.equal(await delivery(roleNotice, 'manager'), false);
      await denied(() => call('manager', 'listModerationReports', {}));
      reports.removed = await submit('reported', userPayload('reporter', 'notify-removed-report'));
      await assertRecipients(reports.removed, ['secondManager']);
      const move = db.batch(); move.update(db.collection('users').doc(users.manager.uid), { organizationId: fixture.otherOrganizationId }); move.update(db.collection('organizations').doc(fixture.otherOrganizationId), { managerIds: FieldValue.arrayUnion(users.manager.uid) }); await move.commit();
      assert.equal((await state('manager')).pendingReviewCount, 0); assert.equal(await delivery(roleNotice, 'manager'), false);
      const restore = db.batch(); restore.update(db.collection('users').doc(users.manager.uid), { organizationId: fixture.organizationId }); restore.update(db.collection('organizations').doc(fixture.otherOrganizationId), { managerIds: FieldValue.arrayRemove(users.manager.uid) }); restore.update(orgRef, { managerIds: FieldValue.arrayUnion(users.manager.uid) }); await restore.commit();
      assert.equal((await state('manager')).pendingReviewCount, 3);
    });
    await step('disabled rollout hides pending counts and denies new reports and old notice delivery', async () => {
      const batch = db.batch(); batch.update(db.collection('organizations').doc(fixture.organizationId), { chatSafetyEnabled: false }); batch.update(db.collection('organizationBilling').doc(fixture.organizationId), { chatSafetyEnabled: false }); await batch.commit();
      for (const key of ['manager', 'secondManager']) assert.equal((await state(key)).pendingReviewCount, 0);
      assert.equal(await delivery(roleNotice, 'manager'), false);
      await denied(() => submit('reported', userPayload('reporter', 'notify-flags-off-report')));
      const restore = db.batch(); restore.update(db.collection('organizations').doc(fixture.organizationId), { chatSafetyEnabled: true }); restore.update(db.collection('organizationBilling').doc(fixture.organizationId), { chatSafetyEnabled: true }); await restore.commit();
      assert.equal((await state('manager')).pendingReviewCount, 3); assert.equal((await state('secondManager')).pendingReviewCount, 5);
    });
    await step('all fixture notices remain generic and no synthetic push delivery is claimed', async () => {
      for (const user of fixture.users) {
        assert.deepEqual((await db.collection('users').doc(user.uid).get()).data().pushTokens, []);
        assert.equal((await db.collection('pushDeliveries').where('userId', '==', user.uid).get()).size, 0);
      }
      const notificationDocs = (await db.collection('userNotifications').where('organizationId', '==', fixture.organizationId).get()).docs;
      assert.ok(notificationDocs.length > 0);
      for (const doc of notificationDocs) assert.equal(doc.data().kind, 'chat_safety_report');
    });
    await marker.update({ notificationsState: 'passed', notificationsCompletedAt: Timestamp.now() });
  } catch (error) {
    results.push({ name: 'failure', status: 'failed', message: error.message });
    await marker.update({ notificationsState: 'failed', notificationsCompletedAt: Timestamp.now() }); throw error;
  } finally {
    const outputDir = path.resolve(__dirname, '../../.local-data/chat-safety');
    fs.writeFileSync(path.join(outputDir, `${runId}-notification-results.json`), JSON.stringify({ runId, projectId: PROJECT_ID, reports, boundary: 'Real emulator callables/rules/triggers; delivery predicate and fault-injected moderation factory execute against emulator data only. No push tokens or external push requests.', results }, null, 2));
  }
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
