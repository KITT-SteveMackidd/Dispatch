const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ID, assertLocalChatSafetyEnvironment, chatSafetyFixture } = require('./chat-safety-test-common');

const RULES_VERSION = '2026-10-27';
const FUNCTION_ORIGIN = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;
const FIRESTORE_ORIGIN = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const STORAGE_ORIGIN = `http://127.0.0.1:9199/v0/b/${PROJECT_ID}.firebasestorage.app/o`;
const CALLABLES = new Set(['getChatSafetyState', 'acceptChatRules', 'setChatUserBlock', 'createChatUpload', 'sendChatMessage']);
const CORE_SCENARIOS = [
  'authentication and cross-organization thread authority',
  'posting and upload grants require current rules acceptance',
  'client consent and safety-flag tampering are denied',
  'direct message writes cannot bypass the callable',
  'self-block and cross-organization blocking are rejected',
  'a direct block prevents contact in both directions',
  'group recipients and unread counts exclude the blocker',
  'an explicit empty recipient list stays empty',
  'unblocking restores direct messaging',
];
const ATTACHMENT_SCENARIOS = [
  'legacy attachment uploads are denied for the enabled organization',
  'arbitrary attachment URLs cannot be sent',
  'upload grants are bound to the caller and thread',
];

async function requestJson(url, options = {}) {
  if (!url.startsWith('http://127.0.0.1:')) throw new Error('Local test request attempted a non-loopback origin.');
  let response;
  try {
    response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
  } catch (error) {
    throw new Error(`Local emulator request failed at ${new URL(url).origin}: ${error.cause?.code || error.message}`);
  }
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 200) }; }
  return { status: response.status, body };
}

async function run() {
  const runId = assertLocalChatSafetyEnvironment();
  process.env.METADATA_SERVER_DETECTION = 'none';
  const fixture = chatSafetyFixture(runId);
  const { initializeApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, Timestamp } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore(app);
  const auth = getAuth(app);
  const marker = db.collection('localChatSafetyRuns').doc(runId);
  const markerSnapshot = await marker.get();
  assert.equal(markerSnapshot.data()?.state, 'ready', 'Seed a fresh ready chat-safety fixture first.');
  const resumeAttachments = process.env.CHAT_SAFETY_RESUME_ATTACHMENTS === 'true';
  const outputDir = path.resolve(__dirname, '../../.local-data/chat-safety');
  const resultsPath = path.join(outputDir, `${runId}-results.json`);
  if (resumeAttachments) assert.equal(markerSnapshot.data()?.e2eState, 'failed', 'Only a failed attachment phase may be resumed.');
  else assert.ok(!markerSnapshot.data()?.e2eStartedAt, 'Use a fresh run ID; this test intentionally does not reset prior test state.');
  const users = Object.fromEntries(fixture.users.map((user) => [user.key, user]));
  const tokens = {};
  const results = [];
  if (resumeAttachments) {
    const previous = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    assert.equal(previous.runId, runId);
    assert.equal(previous.projectId, PROJECT_ID);
    const passed = previous.results.filter((result) => result.status === 'passed');
    assert.ok(passed.length >= CORE_SCENARIOS.length && passed.length < CORE_SCENARIOS.length + ATTACHMENT_SCENARIOS.length);
    assert.deepEqual(passed.map((result) => result.name), [...CORE_SCENARIOS, ...ATTACHMENT_SCENARIOS].slice(0, passed.length),
      'All core scenarios must have passed in order before resuming an incomplete attachment phase.');
    results.push(...passed);
  }
  const mainKeys = ['manager', 'secondManager', 'reporter', 'reported'];
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

  for (const user of fixture.users) {
    const profile = (await db.collection('users').doc(user.uid).get()).data();
    assert.equal(profile?.organizationId, user.organizationId);
    assert.equal((profile?.pushTokens || []).length, 0, 'Synthetic fixtures must not have external push tokens.');
    const login = await requestJson('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: fixture.password, returnSecureToken: true }),
    });
    assert.equal(login.status, 200, `Local login failed for ${user.key}.`);
    tokens[user.key] = login.body.idToken;
  }
  assert.equal((await auth.getUser(users.operator.uid)).customClaims?.dispatchModerator, true);
  for (const collection of ['organizations', 'organizationBilling']) {
    assert.equal((await db.collection(collection).doc(fixture.organizationId).get()).data()?.chatSafetyEnabled, true);
  }

  async function call(key, name, data) {
    assert.ok(CALLABLES.has(name), 'Only the declared local chat-safety callables may be exercised.');
    const result = await requestJson(`${FUNCTION_ORIGIN}/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${tokens[key]}` } : {}) },
      body: JSON.stringify({ data }),
    });
    if (result.body.error || result.status !== 200) {
      const error = new Error(`${name}: ${result.body.error?.message || result.body.message || result.status}`);
      error.status = result.body.error?.status || `HTTP_${result.status}`;
      throw error;
    }
    return result.body.result;
  }
  async function rejectsCall(key, name, data, statuses) {
    await assert.rejects(() => call(key, name, data), (error) => {
      assert.ok(statuses.includes(error.status), `Expected ${statuses.join('/')} but received ${error.status}: ${error.message}`);
      return true;
    });
  }
  const send = (key, threadId, text) => call(key, 'sendChatMessage', { threadId, text, attachments: [] });
  async function step(name, fn) {
    if (resumeAttachments && results.some((result) => result.name === name && result.status === 'passed')) {
      console.log(`RETAIN PASS ${name}`);
      return;
    }
    await fn();
    results.push({ name, status: 'passed' });
    console.log(`PASS ${name}`);
  }
  async function clientWrite(key, documentPath, fields) {
    return requestJson(`${FIRESTORE_ORIGIN}/${documentPath}?${Object.keys(fields).map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&')}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[key]}` },
      body: JSON.stringify({ fields }),
    });
  }
  const expectDenied = (result) => assert.equal(result.status, 403, `Expected permission denial, got ${result.status}: ${JSON.stringify(result.body)}`);
  async function upload(key, objectPath, bytes) {
    const boundary = `dispatch-chat-safety-${runId}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name: objectPath, contentType: 'image/png' })}\r\n--${boundary}\r\nContent-Type: image/png\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    return requestJson(`${STORAGE_ORIGIN}?name=${encodeURIComponent(objectPath)}`, {
      method: 'POST', headers: { Authorization: `Firebase ${tokens[key]}`, 'Content-Type': `multipart/related; boundary=${boundary}`, 'X-Goog-Upload-Protocol': 'multipart' }, body,
    });
  }

  // Probe the new API before claiming a run, so a not-yet-reloaded emulator can be retried safely.
  await call('reporter', 'getChatSafetyState', { threadId: fixture.threadIds.direct });
  await marker.update(resumeAttachments ? { e2eResumedAt: Timestamp.now() } : { e2eStartedAt: Timestamp.now() });
  try {
    if (!resumeAttachments) {
    await step('authentication and cross-organization thread authority', async () => {
      await rejectsCall(null, 'getChatSafetyState', {}, ['UNAUTHENTICATED']);
      await rejectsCall('outsider', 'getChatSafetyState', { threadId: fixture.threadIds.direct }, ['PERMISSION_DENIED']);
    });
    await step('posting and upload grants require current rules acceptance', async () => {
      await rejectsCall('reporter', 'sendChatMessage', { threadId: fixture.threadIds.direct, text: 'No consent test', attachments: [] }, ['FAILED_PRECONDITION']);
      await rejectsCall('reporter', 'createChatUpload', { threadId: fixture.threadIds.direct, name: 'sample.png', mimeType: 'image/png', size: 68 }, ['FAILED_PRECONDITION']);
      await rejectsCall('reporter', 'acceptChatRules', { version: '2025-01-01' }, ['INVALID_ARGUMENT', 'FAILED_PRECONDITION']);
      // Simulate an existing account with an older accepted version, only inside this isolated fixture.
      await db.collection('users').doc(users.reporter.uid).update({ chatRulesVersion: '2025-01-01', chatRulesAcceptedAt: Timestamp.now() });
      await rejectsCall('reporter', 'sendChatMessage', { threadId: fixture.threadIds.direct, text: 'Outdated consent test', attachments: [] }, ['FAILED_PRECONDITION']);
      for (const key of mainKeys) await call(key, 'acceptChatRules', { version: RULES_VERSION });
      assert.equal((await db.collection('users').doc(users.reporter.uid).get()).data()?.chatRulesVersion, RULES_VERSION);
    });
    await step('client consent and safety-flag tampering are denied', async () => {
      expectDenied(await clientWrite('reporter', `users/${users.reporter.uid}`, { chatRulesVersion: { stringValue: 'forged' } }));
      expectDenied(await clientWrite('reporter', `users/${users.reporter.uid}/chatSafetyState/current`, { version: { integerValue: '999' } }));
      expectDenied(await clientWrite('manager', `organizations/${fixture.organizationId}`, { chatSafetyEnabled: { booleanValue: false } }));
      expectDenied(await clientWrite('manager', `organizationBilling/${fixture.organizationId}`, { chatSafetyEnabled: { booleanValue: false } }));
    });
    await step('direct message writes cannot bypass the callable', async () => {
      expectDenied(await clientWrite('reporter', `chatThreads/${fixture.threadIds.direct}/messages/forged-client-message`, {
        threadId: { stringValue: fixture.threadIds.direct }, senderId: { stringValue: users.reporter.uid },
        recipientIds: { arrayValue: { values: [{ stringValue: users.reported.uid }] } },
        text: { stringValue: 'Direct write bypass test' }, createdAt: { timestampValue: new Date().toISOString() }, attachments: { arrayValue: { values: [] } },
      }));
    });
    await step('self-block and cross-organization blocking are rejected', async () => {
      await rejectsCall('reporter', 'setChatUserBlock', { targetUserId: users.reporter.uid, blocked: true }, ['INVALID_ARGUMENT', 'FAILED_PRECONDITION']);
      await rejectsCall('reporter', 'setChatUserBlock', { targetUserId: users.outsider.uid, blocked: true }, ['PERMISSION_DENIED', 'INVALID_ARGUMENT']);
    });
    await step('a direct block prevents contact in both directions', async () => {
      await call('reporter', 'setChatUserBlock', { targetUserId: users.reported.uid, blocked: true });
      assert.ok((await db.collection('users').doc(users.reporter.uid).collection('chatBlocks').doc(users.reported.uid).get()).exists);
      for (const threadId of [fixture.threadIds.direct, fixture.threadIds.custom]) {
        for (const key of ['reporter', 'reported']) {
          await rejectsCall(key, 'sendChatMessage', { threadId, text: 'Blocked direct message test', attachments: [] }, ['PERMISSION_DENIED', 'FAILED_PRECONDITION']);
        }
      }
    });
    await step('group recipients and unread counts exclude the blocker', async () => {
      const sent = await send('reported', fixture.threadIds.organization, 'Synthetic group message with one blocker.');
      const message = (await db.collection('chatThreads').doc(fixture.threadIds.organization).collection('messages').doc(sent.messageId).get()).data();
      assert.equal(sent.recipientCount, 2);
      assert.ok(!message.recipientIds.includes(users.reporter.uid));
      const unread = await db.collection('chatUnread').doc(`${users.reporter.uid}__${fixture.threadIds.organization}`).get();
      assert.equal(unread.data()?.unreadCount || 0, 0);
    });
    await step('an explicit empty recipient list stays empty', async () => {
      for (const key of ['manager', 'secondManager']) await call(key, 'setChatUserBlock', { targetUserId: users.reported.uid, blocked: true });
      const sent = await send('reported', fixture.threadIds.organization, 'Synthetic group message with no eligible recipients.');
      const message = (await db.collection('chatThreads').doc(fixture.threadIds.organization).collection('messages').doc(sent.messageId).get()).data();
      assert.equal(sent.recipientCount, 0);
      assert.deepEqual(message.recipientIds, []);
      for (const key of ['manager', 'secondManager', 'reporter']) await call(key, 'setChatUserBlock', { targetUserId: users.reported.uid, blocked: false });
    });
    await step('unblocking restores direct messaging', async () => {
      const sent = await send('reporter', fixture.threadIds.direct, 'Synthetic direct message after unblocking.');
      assert.equal(sent.recipientCount, 1);
    });
    }
    await step('legacy attachment uploads are denied for the enabled organization', async () => {
      const objectPath = `chatAttachments/${fixture.threadIds.direct}/${users.reporter.uid}/legacy-test.png`;
      expectDenied(await upload('reporter', objectPath, imageBytes));
    });
    await step('arbitrary attachment URLs cannot be sent', async () => {
      await rejectsCall('reporter', 'sendChatMessage', {
        threadId: fixture.threadIds.direct, text: '', attachments: [{ id: 'forged-object', kind: 'image', name: 'forged.png', mimeType: 'image/png', size: 68, url: 'https://example.invalid/forged.png' }],
      }, ['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'FAILED_PRECONDITION']);
    });
    await step('upload grants are bound to the caller and thread', async () => {
      const grant = await call('reporter', 'createChatUpload', { threadId: fixture.threadIds.direct, name: 'sample.png', mimeType: 'image/png', size: imageBytes.length });
      assert.ok(grant.grantId && grant.objectPath);
      const stored = (await db.collection('chatUploadGrants').doc(grant.grantId).get()).data();
      assert.equal(stored?.ownerId, users.reporter.uid);
      assert.equal(stored?.threadId, fixture.threadIds.direct);
      assert.equal(stored?.objectPath, grant.objectPath);
      await rejectsCall('outsider', 'createChatUpload', { threadId: fixture.threadIds.direct, name: 'sample.png', mimeType: 'image/png', size: 68 }, ['PERMISSION_DENIED', 'FAILED_PRECONDITION']);
      expectDenied(await upload('reported', grant.objectPath, imageBytes));
      const uploaded = await upload('reporter', grant.objectPath, imageBytes);
      assert.equal(uploaded.status, 200, `Authorized upload failed: ${JSON.stringify(uploaded.body)}`);
      assert.ok(uploaded.body.downloadTokens, 'Local upload must return a download token.');
      const url = `${STORAGE_ORIGIN}/${encodeURIComponent(grant.objectPath)}?alt=media&token=${encodeURIComponent(uploaded.body.downloadTokens.split(',')[0])}`;
      const sent = await call('reporter', 'sendChatMessage', {
        threadId: fixture.threadIds.direct, text: 'Synthetic attachment after consent.',
        attachments: [{ id: grant.objectPath, kind: 'image', name: 'sample.png', mimeType: 'image/png', size: imageBytes.length, url }],
      });
      assert.ok(sent.messageId);
    });
    await marker.update({ e2eState: 'passed', e2eCompletedAt: Timestamp.now() });
  } catch (error) {
    results.push({ name: 'failure', status: 'failed', message: error.message });
    await marker.update({ e2eState: 'failed', e2eCompletedAt: Timestamp.now() });
    throw error;
  } finally {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(resultsPath, JSON.stringify({ runId, projectId: PROJECT_ID, results }, null, 2));
  }
  console.log(`Local chat-safety checks passed (${results.length} scenarios). This does not verify a hosted release or physical-device UI.`);
}

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
