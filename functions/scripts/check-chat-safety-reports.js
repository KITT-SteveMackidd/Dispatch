const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ID, assertLocalChatSafetyEnvironment, chatSafetyFixture, assertChatSafetyProfileMatches } = require('./chat-safety-test-common');

const ALLOWED_REPORT_FIELDS = new Set(['id', 'kind', 'targetDisplayName', 'reason', 'status', 'createdAt', 'updatedAt', 'resolutionSummary']);
const CALLABLES = new Set(['submitChatReport', 'listMyChatReports', 'setChatUserBlock']);

async function run() {
  const runId = assertLocalChatSafetyEnvironment();
  process.env.METADATA_SERVER_DETECTION = 'none';
  const fixture = chatSafetyFixture(runId);
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
  const db = getFirestore(initializeApp({ projectId: PROJECT_ID }));
  const marker = db.collection('localChatSafetyRuns').doc(runId);
  const state = (await marker.get()).data();
  assert.equal(state?.state, 'ready');
  assert.ok(!state?.reportsStartedAt, 'Use a fresh isolated reporting fixture; existing reports are never reset.');
  const users = Object.fromEntries(fixture.users.map(user => [user.key, user]));
  const tokens = {};
  const results = [];
  const reports = [];
  const functionOrigin = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;
  const firestoreOrigin = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const profileRef = db.collection('users').doc(users.reporter.uid);
  assertChatSafetyProfileMatches(users.reporter, (await profileRef.get()).data());
  for (const user of fixture.users) {
    const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: fixture.password, returnSecureToken: true }),
    });
    assert.equal(response.status, 200, `Local login failed for ${user.key}.`);
    tokens[user.key] = (await response.json()).idToken;
  }
  async function call(key, name, data) {
    assert.ok(CALLABLES.has(name));
    const response = await fetch(`${functionOrigin}/${name}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
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
  async function firestore(key, documentPath, method = 'GET', fields) {
    const response = await fetch(`${firestoreOrigin}/${documentPath}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[key]}` },
      ...(fields ? { body: JSON.stringify({ fields }) } : {}),
    });
    return response.status;
  }
  async function step(name, fn) { await fn(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  const messagePayload = (clientRequestId, messageId = fixture.messageIds.reportable) => ({
    threadId: fixture.threadIds.direct, kind: 'message', messageId, reason: 'harassment', details: 'Synthetic local report details.', clientRequestId,
  });
  const initialList = await call('reporter', 'listMyChatReports', { limit: 2 });
  assert.deepEqual(initialList.reports, []);
  const source = (await db.collection('chatThreads').doc(fixture.threadIds.direct).collection('messages').doc(fixture.messageIds.reportable).get()).data();
  const syntheticMessageIds = {};
  for (const name of ['blocked', 'suspended', 'readonly', 'overlimit']) {
    const id = `report-fixture-${name}`;
    syntheticMessageIds[name] = id;
    await db.collection('chatThreads').doc(fixture.threadIds.direct).collection('messages').doc(id).create({
      ...source, text: `Synthetic ${name} reporting scenario.`, createdAt: Timestamp.now(),
    });
  }
  await marker.update({ reportsStartedAt: Timestamp.now() });
  let firstPayload;
  let firstResult;
  try {
    await step('report submission and history require authentication', async () => {
      await rejects(null, 'submitChatReport', messagePayload('no-auth-report'), ['UNAUTHENTICATED']);
      await rejects(null, 'listMyChatReports', {}, ['UNAUTHENTICATED']);
    });
    await step('report validation rejects invalid reason, oversized details and self-targeting', async () => {
      await rejects('reporter', 'submitChatReport', { ...messagePayload('bad-reason-report'), reason: 'not-a-reason' }, ['INVALID_ARGUMENT']);
      await rejects('reporter', 'submitChatReport', { ...messagePayload('too-long-details'), details: 'x'.repeat(2001) }, ['INVALID_ARGUMENT']);
      await rejects('reporter', 'submitChatReport', { ...messagePayload('self-user-report'), kind: 'user', messageId: undefined, targetUserId: users.reporter.uid }, ['INVALID_ARGUMENT', 'FAILED_PRECONDITION']);
    });
    await step('report submission rejects other organizations and unrelated targets', async () => {
      await rejects('outsider', 'submitChatReport', messagePayload('cross-org-report'), ['PERMISSION_DENIED']);
      await rejects('reporter', 'submitChatReport', { ...messagePayload('unrelated-target'), kind: 'user', messageId: undefined, targetUserId: users.outsider.uid }, ['PERMISSION_DENIED', 'INVALID_ARGUMENT']);
    });
    await step('unconsented reporting snapshots authoritative identity and message evidence', async () => {
      assert.ok(!(await profileRef.get()).data().chatRulesVersion);
      const forgedPayload = {
        ...messagePayload('evidence-forgery-report'), reporterId: users.outsider.uid, organizationId: fixture.otherOrganizationId,
        evidence: { text: 'FORGED_EVIDENCE_SHOULD_NOT_BE_STORED', senderId: users.manager.uid },
        snapshot: { text: 'FORGED_SNAPSHOT_SHOULD_NOT_BE_STORED' },
      };
      await rejects('reporter', 'submitChatReport', forgedPayload, ['INVALID_ARGUMENT']);
      firstPayload = messagePayload('evidence-forgery-report');
      firstResult = await call('reporter', 'submitChatReport', firstPayload);
      assert.equal(firstResult.status, 'submitted');
      assert.ok(firstResult.reportId && Number.isFinite(Date.parse(firstResult.createdAt)));
      reports.push(firstResult.reportId);
      const stored = (await db.collection('chatSafetyReports').doc(firstResult.reportId).get()).data();
      assert.equal(stored.reporterUserId, users.reporter.uid);
      assert.equal(stored.targetUserId, users.reported.uid);
      assert.equal(stored.organizationId, fixture.organizationId);
      assert.equal(stored.evidence.message.senderId, users.reported.uid);
      assert.equal(stored.evidence.message.text, source.text);
      const serialized = JSON.stringify(stored);
      assert.ok(serialized.includes(users.reporter.uid));
      assert.ok(serialized.includes(users.reported.uid));
      assert.ok(serialized.includes(fixture.organizationId));
      assert.ok(serialized.includes(source.text));
      assert.ok(!serialized.includes(users.outsider.uid));
      assert.ok(!serialized.includes(fixture.otherOrganizationId));
      assert.ok(!serialized.includes('FORGED_'));
    });
    await step('reporting remains available while the target is blocked', async () => {
      await call('reporter', 'setChatUserBlock', { targetUserId: users.reported.uid, blocked: true });
      const result = await call('reporter', 'submitChatReport', messagePayload('blocked-target-report', syntheticMessageIds.blocked));
      reports.push(result.reportId);
    });
    await step('reporting remains available while the reporter is suspended', async () => {
      await profileRef.update({ chatSuspension: { active: true, reason: 'Synthetic reporting access test' } });
      const result = await call('reporter', 'submitChatReport', messagePayload('suspended-user-report', syntheticMessageIds.suspended));
      reports.push(result.reportId);
    });
    await step('read-only billing does not prevent a new safety report', async () => {
      await db.collection('organizationBilling').doc(fixture.organizationId).update({ accessMode: 'read_only' });
      const result = await call('reporter', 'submitChatReport', messagePayload('readonly-billing-report', syntheticMessageIds.readonly));
      reports.push(result.reportId);
    });
    await step('a worker can report a Manager without exposing the report to that Manager', async () => {
      const result = await call('reporter', 'submitChatReport', { threadId: fixture.threadIds.manager, kind: 'user', targetUserId: users.manager.uid, reason: 'other', details: 'Synthetic Manager report.', clientRequestId: 'worker-reports-manager' });
      reports.push(result.reportId);
      assert.ok(!(await call('manager', 'listMyChatReports', {})).reports.some(report => report.id === result.reportId));
    });
    await step('hourly report limit rejects a sixth new report', async () => {
      await rejects('reporter', 'submitChatReport', messagePayload('sixth-report-hourly', syntheticMessageIds.overlimit), ['RESOURCE_EXHAUSTED']);
      assert.equal((await call('reporter', 'listMyChatReports', { limit: 50 })).reports.length, 5);
    });
    await step('exact retries remain idempotent at the limit and changed payloads are rejected', async () => {
      const limitsRef = db.collection('users').doc(users.reporter.uid).collection('chatReportLimits').doc('current');
      const before = (await limitsRef.get()).data();
      assert.deepEqual(await call('reporter', 'submitChatReport', firstPayload), firstResult);
      assert.deepEqual((await limitsRef.get()).data(), before);
      await rejects('reporter', 'submitChatReport', { ...firstPayload, details: 'Changed duplicate details' }, ['FAILED_PRECONDITION']);
    });
    await step('daily report limit rejects new reports even below the hourly limit', async () => {
      const now = Date.now();
      const limitsRef = db.collection('users').doc(users.secondManager.uid).collection('chatReportLimits').doc('current');
      // Emulate a fresh clock hour after twenty prior reports, only for this new synthetic account.
      await limitsRef.create({ hourStartMs: Math.floor(now / 3600000) * 3600000, dayStartMs: Math.floor(now / 86400000) * 86400000,
        hourCount: 0, dayCount: 20, updatedAt: Timestamp.fromMillis(now) });
      await rejects('secondManager', 'submitChatReport', { ...messagePayload('daily-limit-report'), threadId: fixture.threadIds.organization }, ['RESOURCE_EXHAUSTED']);
      assert.equal((await limitsRef.get()).data().dayCount, 20);
      assert.deepEqual((await call('secondManager', 'listMyChatReports', {})).reports, []);
    });
    await step('private report evidence, reporter identity and counters are not client-readable or writable', async () => {
      for (const key of ['reporter', 'reported', 'manager', 'operator', 'outsider']) {
        assert.equal(await firestore(key, `chatSafetyReports/${firstResult.reportId}`), 403, `${key} read private report`);
      }
      assert.equal(await firestore('reporter', `users/${users.reporter.uid}/chatReportLimits/current`), 403);
      assert.equal(await firestore('reported', `chatSafetyReports/${firstResult.reportId}`, 'PATCH', { status: { stringValue: 'resolved' } }), 403);
      assert.equal(await firestore('reporter', `chatSafetyReports/forged-${runId}`, 'PATCH', { reporterId: { stringValue: users.reporter.uid } }), 403);
      assert.equal(await firestore('reporter', `users/${users.reporter.uid}/chatReportLimits/current`, 'PATCH', { count: { integerValue: '0' } }), 403);
      assert.deepEqual((await call('reported', 'listMyChatReports', {})).reports, []);
    });
    await step('reporter history exposes only safe fields and paginates without duplicates', async () => {
      await db.collection('chatSafetyReports').doc(firstResult.reportId).update({ moderatorNotes: 'PRIVATE_MODERATOR_NOTE_SENTINEL' });
      const ids = [];
      let cursor;
      for (let pageNumber = 0; pageNumber < 6; pageNumber++) {
        const page = await call('reporter', 'listMyChatReports', { limit: 2, ...(cursor ? { cursor } : {}) });
        for (const report of page.reports) {
          assert.ok(Object.keys(report).every(key => ALLOWED_REPORT_FIELDS.has(key)), JSON.stringify(report));
          assert.ok(!JSON.stringify(report).includes('PRIVATE_MODERATOR_NOTE_SENTINEL'));
          ids.push(report.id);
        }
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      assert.equal(ids.length, 5);
      assert.equal(new Set(ids).size, 5);
      assert.deepEqual(new Set(ids), new Set(reports));
    });
    await step('history cursors cannot be transferred to another caller or fabricated', async () => {
      const firstPage = await call('reporter', 'listMyChatReports', { limit: 1 });
      assert.ok(firstPage.nextCursor);
      await rejects('reported', 'listMyChatReports', { limit: 1, cursor: firstPage.nextCursor }, ['INVALID_ARGUMENT', 'PERMISSION_DENIED']);
      await rejects('reporter', 'listMyChatReports', { cursor: 'fabricated-cursor' }, ['INVALID_ARGUMENT']);
      const managerReport = await call('manager', 'submitChatReport', { threadId: fixture.threadIds.organization, kind: 'user', targetUserId: users.reported.uid, reason: 'other', clientRequestId: firstPayload.clientRequestId });
      assert.notEqual(managerReport.reportId, firstResult.reportId);
      assert.ok(!(await call('manager', 'listMyChatReports', {})).reports.some(report => reports.includes(report.id)));
    });
    await step('reporters retain their own report history after leaving the organization', async () => {
      const batch = db.batch();
      batch.update(profileRef, { organizationId: null, organizationName: null });
      batch.update(db.collection('organizations').doc(fixture.organizationId), { workerIds: FieldValue.arrayRemove(users.reporter.uid) });
      await batch.commit();
      assert.equal((await call('reporter', 'listMyChatReports', { limit: 50 })).reports.length, 5);
      await rejects('reporter', 'submitChatReport', messagePayload('former-member-report'), ['PERMISSION_DENIED']);
    });
    await marker.update({ reportsState: 'passed', reportsCompletedAt: Timestamp.now() });
  } catch (error) {
    results.push({ name: 'failure', status: 'failed', message: error.message });
    await marker.update({ reportsState: 'failed', reportsCompletedAt: Timestamp.now() });
    throw error;
  } finally {
    const restore = db.batch();
    restore.update(profileRef, { chatSuspension: FieldValue.delete(), organizationId: fixture.organizationId, organizationName: fixture.organizationName });
    restore.update(db.collection('organizations').doc(fixture.organizationId), { workerIds: FieldValue.arrayUnion(users.reporter.uid) });
    restore.update(db.collection('organizationBilling').doc(fixture.organizationId), { accessMode: 'full' });
    await restore.commit();
    const outputDir = path.resolve(__dirname, '../../.local-data/chat-safety');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${runId}-report-results.json`), JSON.stringify({ runId, projectId: PROJECT_ID, results }, null, 2));
  }
}

if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
