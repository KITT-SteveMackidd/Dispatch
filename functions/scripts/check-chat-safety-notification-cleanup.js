const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ID, assertLocalChatSafetyEnvironment, chatSafetyFixture, assertChatSafetyProfileMatches } = require('./chat-safety-test-common');

async function run() {
  const runId = assertLocalChatSafetyEnvironment();
  process.env.METADATA_SERVER_DETECTION = 'none';
  const fixture = chatSafetyFixture(runId);
  const users = Object.fromEntries(fixture.users.map(user => [user.key, user]));
  const outputDir = path.resolve(__dirname, '../../.local-data/chat-safety');
  const previous = JSON.parse(fs.readFileSync(path.join(outputDir, `${runId}-notification-results.json`), 'utf8'));
  assert.equal(previous.projectId, PROJECT_ID); assert.equal(previous.runId, runId);
  assert.equal(previous.results.length, 10); assert.ok(previous.results.every(result => result.status === 'passed'));
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
  const { getAuth } = require('firebase-admin/auth');
  const { getStorage } = require('firebase-admin/storage');
  const app = initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.firebasestorage.app` });
  const db = getFirestore(app), auth = getAuth(app), bucket = getStorage(app).bucket();
  const marker = db.collection('localChatSafetyRuns').doc(runId);
  const markerData = (await marker.get()).data();
  assert.equal(markerData.notificationsState, 'passed');
  const resumeFence = process.env.CHAT_SAFETY_RESUME_NOTIFICATION_FENCE === 'true';
  if (resumeFence) {
    assert.equal(markerData.notificationCleanupState, 'failed');
    const stopped = JSON.parse(fs.readFileSync(path.join(outputDir, `${runId}-notification-cleanup-results.json`), 'utf8'));
    assert.equal(stopped.results.length, 1);
    assert.equal(stopped.results[0].message, 'Missing expected rejection.');
    assert.ok(!stopped.fencedReportId && !stopped.deletionResult, 'Resume is only allowed after the initial fence check, before new reports or deletion.');
    fs.writeFileSync(path.join(outputDir, `${runId}-notification-cleanup-initial-fence-failure.json`), JSON.stringify(stopped, null, 2), { flag: 'wx' });
  } else assert.ok(!markerData.notificationCleanupStartedAt, 'This disposable-fixture cleanup cannot be restarted or reset.');
  for (const user of fixture.users) assertChatSafetyProfileMatches(user, (await db.collection('users').doc(user.uid).get()).data());
  const { createChatReviewNotificationService } = require('../lib/chat-review-notifications');
  const notificationService = createChatReviewNotificationService({ getDb: () => db, getFieldValue: () => FieldValue, projectId: () => PROJECT_ID });
  const tokens = {};
  for (const key of ['manager', 'secondManager', 'reporter']) {
    const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: users[key].email, password: fixture.password, returnSecureToken: true }),
    });
    assert.equal(response.status, 200); tokens[key] = (await response.json()).idToken;
  }
  async function call(key, name, data) {
    assert.ok(['getChatSafetyState', 'listModerationReports', 'moderateChatReport', 'submitChatReport'].includes(name));
    const response = await fetch(`http://127.0.0.1:5001/${PROJECT_ID}/us-central1/${name}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[key]}` }, body: JSON.stringify({ data }),
    });
    const body = await response.json();
    if (response.status !== 200 || body.error) { const error = new Error(`${name}: ${body.error?.message || response.status}`); error.status = body.error?.status; throw error; }
    return body.result;
  }
  async function eventually(check, message) {
    const deadline = Date.now() + 15000;
    do { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 150)); } while (Date.now() < deadline);
    assert.fail(message);
  }
  async function denied(fn) { await assert.rejects(fn, error => ['PERMISSION_DENIED', 'FAILED_PRECONDITION'].includes(error.status)); }
  const sources = () => db.collection('chatReviewNotificationSources').where('organizationId', '==', fixture.organizationId).get();
  const results = [];
  let deletionResult;
  let fencedReportId;
  let capturedSources;
  async function step(name, fn) { await fn(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  const profileRef = db.collection('users').doc(users.manager.uid);
  const signalRef = profileRef.collection('chatSafetyState').doc('current');
  const existing = (await sources()).docs.find(doc => doc.data().recipientUserId === users.manager.uid && doc.data().reportId === previous.reports.role);
  assert.ok(existing); assert.equal(await notificationService.canDeliver({ notificationId: existing.id, recipientId: users.manager.uid }), !resumeFence);
  if (resumeFence) assert.ok((await profileRef.get()).data().accountDeletionStartedAt);
  await marker.update(resumeFence ? { notificationCleanupResumedAt: Timestamp.now() } : { notificationCleanupStartedAt: Timestamp.now() });
  try {
    await step('a deletion fence removes pending count, review access and stale-notification delivery', async () => {
      const oldSignal = (await signalRef.get()).data()?.version || 0;
      if (!resumeFence) await profileRef.update({ accountDeletionStartedAt: Timestamp.now() });
      const state = await call('manager', 'getChatSafetyState', {});
      assert.equal(state.canModerate, false); assert.equal(state.pendingReviewCount, 0);
      await denied(() => call('manager', 'listModerationReports', {}));
      await denied(() => call('manager', 'moderateChatReport', { reportId: previous.reports.role, action: 'dismiss', note: 'Must reject deletion-fenced reviewer.', clientRequestId: 'fenced-reviewer-denied' }));
      assert.equal(await notificationService.canDeliver({ notificationId: existing.id, recipientId: users.manager.uid }), false);
      if (!resumeFence) await eventually(async () => ((await signalRef.get()).data()?.version || 0) > oldSignal, 'Deletion-fence change did not notify the active safety view.');
    });
    await step('new reports exclude a deletion-fenced Manager and still notify the eligible reviewer', async () => {
      const result = await call('reporter', 'submitChatReport', { threadId: fixture.threadIds.organization, kind: 'user', targetUserId: users.reported.uid, reason: 'other', details: 'Synthetic fence notification check.', clientRequestId: 'notify-deletion-fenced-manager' });
      fencedReportId = result.reportId;
      await eventually(async () => (await db.collection('chatReviewNotificationSources').where('reportId', '==', fencedReportId).get()).size === 1, 'Expected one eligible reviewer notice.');
      const created = (await db.collection('chatReviewNotificationSources').where('reportId', '==', fencedReportId).get()).docs;
      assert.equal(created[0].data().recipientUserId, users.secondManager.uid);
      assert.equal((await call('secondManager', 'getChatSafetyState', {})).pendingReviewCount, 6);
      capturedSources = (await sources()).docs;
      assert.ok(capturedSources.some(doc => doc.data().recipientUserId === users.manager.uid));
      assert.ok(capturedSources.some(doc => doc.data().reporterUserId === users.manager.uid));
      assert.ok(capturedSources.some(doc => doc.data().targetUserId === users.manager.uid));
    });
    await step('local data cleanup deletes private registry entries and matching generic notices for the deleted identity', async () => {
      const authUser = await auth.getUser(users.manager.uid);
      assert.equal(authUser.email, users.manager.email);
      assertChatSafetyProfileMatches(users.manager, (await profileRef.get()).data());
      const { deleteDispatchUserData } = require('../lib/account-deletion');
      deletionResult = await deleteDispatchUserData({ db, bucket, FieldValue, authUser });
      assert.equal((await profileRef.get()).exists, false);
      assert.equal((await auth.getUser(users.manager.uid)).email, users.manager.email, 'This local phase does not delete the Auth/provider account.');
      let deleted = 0, preserved = 0;
      for (const before of capturedSources) {
        const identityLinked = ['recipientUserId', 'reporterUserId', 'targetUserId'].some(field => before.data()[field] === users.manager.uid);
        const markerExists = (await before.ref.get()).exists;
        const noticeExists = (await db.collection('userNotifications').doc(before.id).get()).exists;
        if (identityLinked) { assert.equal(markerExists, false); assert.equal(noticeExists, false); deleted++; }
        else { assert.equal(markerExists, true); assert.equal(noticeExists, true); preserved++; }
      }
      assert.ok(deleted > 0 && preserved > 0);
      for (const after of (await sources()).docs) assert.ok(!JSON.stringify(after.data()).includes(users.manager.uid));
      assert.equal(await notificationService.canDeliver({ notificationId: existing.id, recipientId: users.manager.uid }), false);
    });
    await step('the surviving reviewer retains accurate pending counts and no push network was exercised', async () => {
      const state = await call('secondManager', 'getChatSafetyState', {});
      assert.equal(state.canModerate, true); assert.equal(state.pendingReviewCount, 4);
      const retained = (await sources()).docs.find(doc => doc.data().reportId === fencedReportId);
      assert.ok(retained); assert.equal(await notificationService.canDeliver({ notificationId: retained.id, recipientId: users.secondManager.uid }), true);
      for (const user of fixture.users) assert.equal((await db.collection('pushDeliveries').where('userId', '==', user.uid).get()).size, 0);
      assert.deepEqual((await db.collection('users').doc(users.secondManager.uid).get()).data().pushTokens, []);
    });
    await marker.update({ notificationCleanupState: 'passed', notificationCleanupCompletedAt: Timestamp.now() });
  } catch (error) {
    results.push({ name: 'failure', status: 'failed', message: error.message });
    await marker.update({ notificationCleanupState: 'failed', notificationCleanupCompletedAt: Timestamp.now() }); throw error;
  } finally {
    fs.writeFileSync(path.join(outputDir, `${runId}-notification-cleanup-results.json`), JSON.stringify({ runId, projectId: PROJECT_ID, resumedAfterFenceFix: resumeFence, fencedReportId, deletionResult,
      boundary: 'Direct local data-cleanup library only; public account deletion, Auth/provider deletion and RevenueCat are not exercised.', results }, null, 2));
  }
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
