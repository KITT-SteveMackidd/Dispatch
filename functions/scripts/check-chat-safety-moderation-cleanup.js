const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ID, assertLocalChatSafetyEnvironment, chatSafetyFixture, assertChatSafetyProfileMatches } = require('./chat-safety-test-common');

// This phase exercises the data-cleanup library directly against synthetic emulator
// records. It intentionally does not call account deletion, RevenueCat, or Auth deletion.
const CALLABLES = new Set(['sendChatMessage', 'submitChatReport', 'setChatUserBlock', 'listModerationReports', 'moderateChatReport']);

async function run() {
  const runId = assertLocalChatSafetyEnvironment();
  process.env.METADATA_SERVER_DETECTION = 'none';
  const fixture = chatSafetyFixture(runId);
  const users = Object.fromEntries(fixture.users.map(user => [user.key, user]));
  const outputDir = path.resolve(__dirname, '../../.local-data/chat-safety');
  const core = JSON.parse(fs.readFileSync(path.join(outputDir, `${runId}-moderation-results.json`), 'utf8'));
  assert.equal(core.runId, runId);
  assert.equal(core.projectId, PROJECT_ID);
  assert.equal(core.results.length, 12);
  assert.ok(core.results.every(result => result.status === 'passed'));
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
  assert.equal(state?.moderationState, 'core_passed');
  assert.ok(!state?.moderationCleanupStartedAt, 'Cleanup is destructive only to this disposable fixture and cannot be restarted or reset.');
  for (const user of fixture.users) assertChatSafetyProfileMatches(user, (await db.collection('users').doc(user.uid).get()).data());
  const tokens = {};
  const results = [];
  let activeReportId;
  let deletionResult;
  const callableOrigin = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;
  const firestoreOrigin = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  for (const key of ['manager', 'secondManager', 'reporter', 'reported']) {
    const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: users[key].email, password: fixture.password, returnSecureToken: true }),
    });
    assert.equal(response.status, 200, `Local login failed for ${key}.`);
    tokens[key] = (await response.json()).idToken;
  }
  async function call(key, name, data) {
    assert.ok(CALLABLES.has(name));
    const response = await fetch(`${callableOrigin}/${name}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[key]}` }, body: JSON.stringify({ data }),
    });
    const body = await response.json();
    if (response.status !== 200 || body.error) {
      const error = new Error(`${name}: ${body.error?.message || response.status}`);
      error.status = body.error?.status || `HTTP_${response.status}`;
      throw error;
    }
    return body.result;
  }
  const act = (reportId, action, clientRequestId) => call('secondManager', 'moderateChatReport', {
    reportId, action, clientRequestId, note: 'Synthetic local account-data cleanup verification.',
  });
  async function step(name, fn) { await fn(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  const auditRef = reportId => db.collection('chatSafetyReports').doc(reportId).collection('moderationAudit');
  const reportRef = reportId => db.collection('chatSafetyReports').doc(reportId);
  let managerAudits;
  let managerOperations;
  let targetOperations;
  let managerCursors;
  const targetReportIds = [core.reports.managerTarget, core.reports.managerForOperator];
  await marker.update({ moderationCleanupStartedAt: Timestamp.now() });
  try {
    await step('cleanup fixture has active enforcement, private history and an incoming block', async () => {
      const message = await call('reported', 'sendChatMessage', {
        threadId: fixture.threadIds.organization, text: 'Synthetic evidence retained only while enforcement requires it.', attachments: [],
      });
      activeReportId = (await call('manager', 'submitChatReport', {
        threadId: fixture.threadIds.organization, kind: 'message', messageId: message.messageId, reason: 'other',
        details: 'Synthetic private reporter details to remove.', clientRequestId: 'cleanup-enforcement-report',
      })).reportId;
      await act(activeReportId, 'suspend_user', 'cleanup-suspend-reported');
      await act(core.reports.managerTarget, 'suspend_user', 'cleanup-suspend-manager');
      await call('reporter', 'setChatUserBlock', { targetUserId: users.manager.uid, blocked: true });
      await call('manager', 'listModerationReports', { limit: 1 });
      managerAudits = [];
      for (const reportId of Object.values(core.reports)) {
        for (const doc of (await auditRef(reportId).get()).docs) if (doc.data().actorUserId === users.manager.uid) managerAudits.push({ ref: doc.ref, reportId });
      }
      managerOperations = (await db.collection('chatModerationOperations').where('actorUserId', '==', users.manager.uid).get()).docs;
      targetOperations = (await db.collection('chatModerationOperations').where('targetUserId', '==', users.manager.uid).get()).docs;
      managerCursors = (await db.collection('chatModerationCursors').where('ownerId', '==', users.manager.uid).get()).docs;
      assert.ok(managerAudits.length > 0 && managerOperations.length > 0 && targetOperations.length > 0 && managerCursors.length > 0);
      for (const doc of [...managerOperations, ...targetOperations]) assert.equal(doc.data().organizationId, fixture.organizationId);
      assert.equal((await db.collection('chatUserModerationState').doc(users.reported.uid).get()).data().sourceReportId, activeReportId);
      assert.equal((await db.collection('chatUserModerationState').doc(users.manager.uid).get()).data().sourceReportId, core.reports.managerTarget);
    });
    await step('local data cleanup removes only the disposable Manager identity and preserves the organization', async () => {
      const target = await auth.getUser(users.manager.uid);
      assert.equal(target.uid, users.manager.uid);
      assert.equal(target.email, users.manager.email);
      assertChatSafetyProfileMatches(users.manager, (await db.collection('users').doc(target.uid).get()).data());
      await db.collection('users').doc(target.uid).update({ accountDeletionStartedAt: Timestamp.now() });
      const { deleteDispatchUserData } = require('../lib/account-deletion');
      deletionResult = await deleteDispatchUserData({ db, bucket, FieldValue, authUser: target });
      assert.equal((await db.collection('users').doc(target.uid).get()).exists, false);
      assert.equal((await auth.getUser(target.uid)).email, users.manager.email, 'Provider/Auth deletion is intentionally outside this local data-cleanup test.');
      const organization = (await db.collection('organizations').doc(fixture.organizationId).get()).data();
      assert.ok(organization.managerIds.includes(users.secondManager.uid));
      assert.ok(!organization.managerIds.includes(target.uid));
      assert.ok(!organization.workerIds.includes(target.uid));
      assert.equal(deletionResult.organizationsDeleted, 0);
    });
    await step('target deletion recursively removes private reports, audits, operations and restriction correlation', async () => {
      for (const reportId of targetReportIds) {
        assert.equal((await reportRef(reportId).get()).exists, false);
        assert.equal((await auditRef(reportId).get()).size, 0);
      }
      for (const doc of targetOperations) assert.equal((await doc.ref.get()).exists, false);
      assert.equal((await db.collection('chatUserModerationState').doc(users.manager.uid).get()).exists, false);
    });
    await step('reporter deletion retains only anonymous evidence needed to restore an active restriction', async () => {
      const report = (await reportRef(activeReportId).get()).data();
      assert.equal(report.reporterUserId, null);
      assert.equal(report.reporterDisplayName, 'Former member');
      assert.equal(report.reporterDeleted, true);
      assert.equal(report.details, '');
      assert.equal(report.evidence.thread.title, 'Chat');
      assert.equal(report.evidence.message.text, '');
      assert.deepEqual(report.evidence.message.attachments, []);
      assert.equal(report.targetUserId, users.reported.uid);
      assert.equal((await db.collection('users').doc(users.reported.uid).get()).data().chatSuspension.active, true);
      assert.equal((await db.collection('chatUserModerationState').doc(users.reported.uid).get()).data().sourceReportId, activeReportId);
      const audit = await auditRef(activeReportId).get();
      assert.ok(audit.size > 0);
      assert.ok(audit.docs.every(doc => doc.data().note === 'Removed with reporter account.'));
      assert.equal((await reportRef(core.reports.managerReporter).get()).exists, false, 'Inactive reports by the deleted reporter are removed.');
    });
    await step('deleted reviewer notes, operations, owned cursors and incoming blocks are removed or anonymized', async () => {
      let survivingAuditCount = 0;
      for (const previous of managerAudits) {
        const current = await previous.ref.get();
        if (!current.exists) continue;
        survivingAuditCount++;
        assert.ok(!('actorUserId' in current.data()));
        assert.equal(current.data().actorDeleted, true);
        assert.equal(current.data().note, 'Removed with moderator account.');
      }
      assert.ok(survivingAuditCount > 0);
      let survivingOperationCount = 0;
      for (const previous of managerOperations) {
        const current = await previous.ref.get();
        if (!current.exists) continue;
        survivingOperationCount++;
        assert.equal(current.data().actorUserId, null);
        assert.equal(current.data().actorDeleted, true);
      }
      assert.ok(survivingOperationCount > 0);
      for (const previous of managerCursors) assert.equal((await previous.ref.get()).exists, false);
      for (const reportId of [...targetReportIds, core.reports.managerReporter]) assert.equal((await db.collection('chatModerationCursors').where('reportId', '==', reportId).get()).size, 0);
      assert.equal((await db.collection('users').doc(users.reporter.uid).collection('chatBlocks').doc(users.manager.uid).get()).exists, false);
    });
    await step('surviving reviewer restores anonymous active report and worker event/task access remains available', async () => {
      const queue = await call('secondManager', 'listModerationReports', { limit: 50 });
      assert.ok(queue.reports.some(report => report.id === activeReportId && report.availableActions.includes('restore_user')));
      const restored = await act(activeReportId, 'restore_user', 'cleanup-restore-anonymous-report');
      assert.equal(restored.actionState, 'completed');
      assert.ok((await db.collection('users').doc(users.reported.uid).get()).data().chatSuspension?.active !== true);
      assert.ok((await call('reported', 'sendChatMessage', { threadId: fixture.threadIds.direct, text: 'Authoring works after anonymous-report restoration.', attachments: [] })).messageId);
      const response = await fetch(`${firestoreOrigin}/events/chat-safety-event-${runId}`, {
        redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${tokens.reported}` },
      });
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes('Preserved event task'));
    });
    await step('stale token from deleted Manager loses moderation authority', async () => {
      await assert.rejects(() => call('manager', 'listModerationReports', {}), error => ['PERMISSION_DENIED', 'FAILED_PRECONDITION', 'NOT_FOUND'].includes(error.status));
      await assert.rejects(() => call('manager', 'moderateChatReport', {
        reportId: core.reports.remove, action: 'dismiss', note: 'Denied deleted-actor action.', clientRequestId: 'deleted-manager-denial',
      }), error => ['PERMISSION_DENIED', 'FAILED_PRECONDITION', 'NOT_FOUND'].includes(error.status));
    });
    await marker.update({ moderationState: 'passed', moderationCleanupState: 'passed', moderationCompletedAt: Timestamp.now() });
  } catch (error) {
    results.push({ name: 'failure', status: 'failed', message: error.message });
    await marker.update({ moderationCleanupState: 'failed', moderationCleanupCompletedAt: Timestamp.now() });
    throw error;
  } finally {
    fs.writeFileSync(path.join(outputDir, `${runId}-moderation-cleanup-results.json`), JSON.stringify({
      runId, projectId: PROJECT_ID, boundary: 'Direct local data-cleanup library only. Public account-deletion callable, RevenueCat and Auth/provider deletion are not exercised.',
      activeReportId, deletionResult, results,
    }, null, 2));
  }
}

if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
