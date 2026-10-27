const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ID, assertLocalChatSafetyEnvironment, chatSafetyFixture, assertChatSafetyProfileMatches } = require('./chat-safety-test-common');

async function run() {
  const runId = assertLocalChatSafetyEnvironment();
  process.env.METADATA_SERVER_DETECTION = 'none';
  const fixture = chatSafetyFixture(runId);
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
  const db = getFirestore(initializeApp({ projectId: PROJECT_ID }));
  const marker = db.collection('localChatSafetyRuns').doc(runId);
  const prior = (await marker.get()).data();
  assert.equal(prior?.state, 'ready');
  assert.ok(!prior?.authoringStartedAt && !prior?.e2eStartedAt, 'Use a fresh isolated fixture for authoring state transitions.');
  const users = Object.fromEntries(fixture.users.map((user) => [user.key, user]));
  const profileRef = db.collection('users').doc(users.reporter.uid);
  assertChatSafetyProfileMatches(users.reporter, (await profileRef.get()).data());
  const origin = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const results = [];
  const login = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: users.reporter.email, password: fixture.password, returnSecureToken: true }),
  });
  assert.equal(login.status, 200);
  const token = (await login.json()).idToken;
  const list = values => ({ arrayValue: { values: values.map(stringValue => ({ stringValue })) } });
  async function patch(threadId, fields) {
    const response = await fetch(`${origin}/chatThreads/${threadId}?${Object.keys(fields).map(field => `updateMask.fieldPaths=${field}`).join('&')}`, {
      method: 'PATCH', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ fields }),
    });
    return { status: response.status, body: await response.json() };
  }
  async function create(suffix) {
    const id = `custom:chat-authoring-${runId}-${suffix}`;
    return patch(id, { id: { stringValue: id }, organizationId: { stringValue: fixture.organizationId },
      title: { stringValue: `Synthetic ${suffix} chat` }, kind: { stringValue: 'custom' },
      participants: list([users.reporter.uid, users.reported.uid]), createdBy: { stringValue: users.reporter.uid },
      updatedAt: { timestampValue: new Date().toISOString() },
    });
  }
  const expectStatus = (response, status) => assert.equal(response.status, status, JSON.stringify(response.body));
  async function check(name, fn) { await fn(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  const rename = title => patch(fixture.threadIds.custom, { title: { stringValue: title } });
  const leaveThreads = {};
  for (const state of ['unconsented', 'suspended']) {
    const id = `custom:chat-authoring-leave-${runId}-${state}`;
    leaveThreads[state] = id;
    await db.collection('chatThreads').doc(id).create({ id, organizationId: fixture.organizationId, kind: 'custom', title: 'Synthetic safety exit',
      participants: [users.reporter.uid, users.reported.uid], createdBy: users.reporter.uid, updatedAt: Timestamp.now() });
  }
  await marker.update({ authoringStartedAt: Timestamp.now() });
  try {
    await check('no consent denies thread create and rename', async () => {
      expectStatus(await create('no-consent'), 403); expectStatus(await rename('Blocked no-consent rename'), 403);
    });
    await check('unconsented users may acknowledge messages and leave their custom chat', async () => {
      expectStatus(await patch(leaveThreads.unconsented, { pushSeenBy: list([users.reporter.uid]) }), 200);
      expectStatus(await patch(leaveThreads.unconsented, { participants: list([users.reported.uid]), updatedAt: { timestampValue: new Date().toISOString() } }), 200);
    });
    await check('old consent denies thread create and rename', async () => {
      await profileRef.update({ chatRulesVersion: '2025-01-01', chatRulesAcceptedAt: Timestamp.now() });
      expectStatus(await create('old-consent'), 403); expectStatus(await rename('Blocked old-consent rename'), 403);
    });
    await check('current API-accepted consent allows thread create and rename', async () => {
      const response = await fetch(`http://127.0.0.1:5001/${PROJECT_ID}/us-central1/acceptChatRules`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ data: { version: '2026-10-27' } }),
      });
      assert.equal(response.status, 200, await response.text());
      expectStatus(await create('current-consent'), 200); expectStatus(await rename('Accepted rules title'), 200);
    });
    await check('active suspension denies thread create and rename', async () => {
      await profileRef.update({ chatSuspension: { active: true, reason: 'Synthetic local authoring test' } });
      expectStatus(await create('active-suspension'), 403); expectStatus(await rename('Blocked suspended rename'), 403);
    });
    await check('suspended users may acknowledge messages and leave their custom chat', async () => {
      expectStatus(await patch(leaveThreads.suspended, { pushSeenBy: list([users.reporter.uid]) }), 200);
      expectStatus(await patch(leaveThreads.suspended, { participants: list([users.reported.uid]), updatedAt: { timestampValue: new Date().toISOString() } }), 200);
    });
    await check('future-expiring suspension still denies authoring', async () => {
      await profileRef.update({ chatSuspension: { active: true, expiresAt: Timestamp.fromMillis(Date.now() + 600000) } });
      expectStatus(await create('future-suspension'), 403); expectStatus(await rename('Blocked future-suspension rename'), 403);
    });
    await check('expired suspension permits current-consent authoring', async () => {
      await profileRef.update({ chatSuspension: { active: true, expiresAt: Timestamp.fromMillis(Date.now() - 60000) } });
      expectStatus(await create('expired-suspension'), 200); expectStatus(await rename('Expired suspension title'), 200);
    });
    await marker.update({ authoringState: 'passed', authoringCompletedAt: Timestamp.now() });
  } catch (error) {
    results.push({ name: 'failure', status: 'failed', message: error.message });
    await marker.update({ authoringState: 'failed', authoringCompletedAt: Timestamp.now() });
    throw error;
  } finally {
    // This fixture-only transition is part of the test, not a reset of any existing QA/user data.
    await profileRef.update({ chatSuspension: FieldValue.delete() });
    const outputDir = path.resolve(__dirname, '../../.local-data/chat-safety');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${runId}-authoring-results.json`), JSON.stringify({ runId, projectId: PROJECT_ID, results }, null, 2));
  }
}

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
