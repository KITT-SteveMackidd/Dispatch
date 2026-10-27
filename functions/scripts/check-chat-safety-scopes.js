const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ID, assertLocalChatSafetyEnvironment, chatSafetyFixture, assertChatSafetyProfileMatches } = require('./chat-safety-test-common');

const CALLABLES = new Set(['acceptChatRules', 'getChatSafetyState', 'sendChatMessage', 'createChatUpload', 'submitChatReport', 'listModerationReports', 'moderateChatReport']);

async function run() {
  const runId = assertLocalChatSafetyEnvironment();
  process.env.METADATA_SERVER_DETECTION = 'none';
  const fixture = chatSafetyFixture(runId);
  const users = Object.fromEntries(fixture.users.map(user => [user.key, user]));
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
  const db = getFirestore(initializeApp({ projectId: PROJECT_ID }));
  const marker = db.collection('localChatSafetyRuns').doc(runId);
  const initial = (await marker.get()).data();
  assert.equal(initial?.state, 'ready');
  assert.ok(!initial?.scopeStartedAt, 'Use a fresh scope fixture; existing data is never reset.');
  for (const user of fixture.users) assertChatSafetyProfileMatches(user, (await db.collection('users').doc(user.uid).get()).data());
  const tokens = {};
  const results = [];
  const reports = {};
  const callableOrigin = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;
  const firestoreOrigin = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const storageOrigin = `http://127.0.0.1:9199/v0/b/${PROJECT_ID}.firebasestorage.app/o`;
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  for (const key of ['manager', 'reporter', 'reported', 'outsider']) {
    const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: users[key].email, password: fixture.password, returnSecureToken: true }),
    });
    assert.equal(response.status, 200); tokens[key] = (await response.json()).idToken;
  }
  async function call(key, name, data) {
    assert.ok(CALLABLES.has(name));
    const response = await fetch(`${callableOrigin}/${name}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[key]}` }, body: JSON.stringify({ data }),
    });
    const body = await response.json();
    if (response.status !== 200 || body.error) { const error = new Error(`${name}: ${body.error?.message || response.status}`); error.status = body.error?.status; throw error; }
    return body.result;
  }
  async function denied(fn) { await assert.rejects(fn, error => ['PERMISSION_DENIED', 'FAILED_PRECONDITION'].includes(error.status)); }
  const act = (key, reportId, action, clientRequestId) => call(key, 'moderateChatReport', { reportId, action, clientRequestId, note: 'Synthetic organization-scope verification.' });
  const grant = (threadId, name) => call('reported', 'createChatUpload', { threadId, name: `${name}.png`, mimeType: 'image/png', size: bytes.length });
  const send = threadId => call('reported', 'sendChatMessage', { threadId, text: 'Synthetic organization-scope message.', attachments: [] });
  async function step(name, fn) { await fn(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  async function upload(grant, expectedStatus) {
    const boundary = `scope-${runId}-${grant.grantId}`;
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name: grant.objectPath, contentType: 'image/png' })}\r\n--${boundary}\r\nContent-Type: image/png\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--`)]);
    const response = await fetch(`${storageOrigin}?name=${encodeURIComponent(grant.objectPath)}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Firebase ${tokens.reported}`, 'Content-Type': `multipart/related; boundary=${boundary}`, 'X-Goog-Upload-Protocol': 'multipart' }, body,
    });
    const result = await response.text(); assert.equal(response.status, expectedStatus, result);
  }
  async function patch(documentPath, fields, expectedStatus) {
    const mask = '?' + Object.keys(fields).map(field => `updateMask.fieldPaths=${field}`).join('&');
    const response = await fetch(`${firestoreOrigin}/${documentPath}${mask}`, {
      method: 'PATCH', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.reported}` }, body: JSON.stringify({ fields }),
    });
    const text = await response.text(); assert.equal(response.status, expectedStatus, text);
  }
  async function createCustom(orgId, peerId, label, expectedStatus) {
    const id = `custom:scope-${runId}-${label}`;
    await patch(`chatThreads/${id}`, { id: { stringValue: id }, organizationId: { stringValue: orgId }, kind: { stringValue: 'custom' }, title: { stringValue: 'Synthetic scoped custom chat' }, participants: { arrayValue: { values: [users.reported.uid, peerId].map(stringValue => ({ stringValue })) } } }, expectedStatus);
    return id;
  }
  async function transfer(key, fromOrg, toOrg) {
    const fromThread = db.collection('chatThreads').doc(`organization:${fromOrg}:all`);
    const toThread = db.collection('chatThreads').doc(`organization:${toOrg}:all`);
    const [fromSnapshot, toSnapshot] = await db.getAll(fromThread, toThread);
    const batch = db.batch();
    batch.update(db.collection('users').doc(users[key].uid), { organizationId: toOrg });
    batch.update(db.collection('organizations').doc(fromOrg), { workerIds: FieldValue.arrayRemove(users[key].uid) });
    batch.update(db.collection('organizations').doc(toOrg), { workerIds: FieldValue.arrayUnion(users[key].uid) });
    // Model the organization's chat roster as well as profile/accepted membership.
    // sendChatMessage correctly refuses stale participants from a different org.
    if (fromSnapshot.exists) batch.update(fromThread, { participants: FieldValue.arrayRemove(users[key].uid) });
    if (toSnapshot.exists) batch.update(toThread, { participants: FieldValue.arrayUnion(users[key].uid) });
    await batch.commit();
  }
  const profile = db.collection('users').doc(users.reported.uid);
  const privateState = db.collection('chatUserModerationState').doc(users.reported.uid);
  const orgA = fixture.organizationId;
  const orgB = fixture.otherOrganizationId;
  const threadA = fixture.threadIds.organization;
  const threadB = `organization:${orgB}:all`;
  await marker.update({ scopeStartedAt: Timestamp.now() });
  try {
    for (const key of ['reported', 'reporter']) await call(key, 'acceptChatRules', { version: '2026-10-27' });
    reports.a = (await call('reporter', 'submitChatReport', { threadId: threadA, kind: 'user', targetUserId: users.reported.uid, reason: 'other', clientRequestId: 'scope-report-organization-a' })).reportId;
    await step('verified prior local restriction can migrate and restore but a mismatched timestamp cannot', async () => {
      await act('manager', reports.a, 'suspend_user', 'scope-legacy-suspend');
      const restriction = { ...(await profile.get()).data().chatSuspension }; delete restriction.organizationId;
      await profile.update({ chatSuspension: { ...restriction, updatedAt: Timestamp.fromMillis(restriction.updatedAt.toMillis() - 1000) }, chatOrganizationSuspensions: FieldValue.delete() });
      await privateState.update({ organizations: FieldValue.delete() });
      await denied(() => act('manager', reports.a, 'restore_user', 'scope-legacy-mismatched-restore'));
      await profile.update({ chatSuspension: restriction });
      const queue = await call('manager', 'listModerationReports', { limit: 50 });
      assert.ok(queue.reports.find(report => report.id === reports.a).availableActions.includes('restore_user'));
      await act('manager', reports.a, 'restore_user', 'scope-legacy-proven-restore');
      assert.ok(!(await call('reported', 'getChatSafetyState', { threadId: threadA })).suspension);
      assert.ok((await send(threadA)).messageId);
    });
    await step('a restriction remains effective in its original organization', async () => {
      await act('manager', reports.a, 'suspend_user', 'scope-a-suspend');
      assert.ok((await call('reported', 'getChatSafetyState', { threadId: threadA })).suspension);
      await denied(() => send(threadA));
      await denied(() => grant(threadA, 'blocked-a'));
      await createCustom(orgA, users.manager.uid, 'blocked-a', 403);
    });
    await transfer('reported', orgA, orgB); await transfer('reporter', orgA, orgB);
    await db.collection('chatThreads').doc(threadB).create({ id: threadB, organizationId: orgB, kind: 'organization', title: 'Synthetic destination organization', participants: [users.outsider.uid, users.reporter.uid, users.reported.uid], updatedAt: Timestamp.now() });
    let allowedCustom;
    let pendingGrant;
    await step('moving to another organization permits its chat and actual Storage writes without clearing the original restriction', async () => {
      assert.ok(!(await call('reported', 'getChatSafetyState', { threadId: threadB })).suspension);
      assert.ok((await send(threadB)).messageId);
      await upload(await grant(threadB, 'allowed-b'), 200);
      pendingGrant = await grant(threadB, 'pending-b');
      allowedCustom = await createCustom(orgB, users.outsider.uid, 'allowed-b', 200);
      await patch(`chatThreads/${allowedCustom}`, { title: { stringValue: 'Scoped title edit allowed' } }, 200);
      assert.equal((await privateState.get()).data().organizations[orgA].active, true);
      await denied(() => send(threadA));
      await denied(() => act('manager', reports.a, 'restore_user', 'scope-absent-a-restore'));
      await denied(() => act('outsider', reports.a, 'restore_user', 'scope-b-cannot-restore-a'));
    });
    reports.b = (await call('reporter', 'submitChatReport', { threadId: threadB, kind: 'user', targetUserId: users.reported.uid, reason: 'other', clientRequestId: 'scope-report-organization-b' })).reportId;
    await step('a second organization can restrict its own chat and blocks a previously granted Storage upload', async () => {
      await act('outsider', reports.b, 'suspend_user', 'scope-b-suspend');
      await denied(() => send(threadB)); await denied(() => grant(threadB, 'blocked-b'));
      await upload(pendingGrant, 403);
      await createCustom(orgB, users.outsider.uid, 'blocked-b', 403);
      await patch(`chatThreads/${allowedCustom}`, { title: { stringValue: 'Blocked scoped title edit' } }, 403);
      const current = (await privateState.get()).data();
      assert.equal(current.organizations[orgA].active, true); assert.equal(current.organizations[orgB].active, true);
    });
    await transfer('reported', orgB, orgA);
    await step('returning to the first organization retains its restriction and restoration preserves the other organization restriction', async () => {
      assert.ok((await call('reported', 'getChatSafetyState', { threadId: threadA })).suspension);
      await denied(() => send(threadA));
      await denied(() => act('outsider', reports.b, 'restore_user', 'scope-absent-b-restore'));
      await act('manager', reports.a, 'restore_user', 'scope-a-restore');
      assert.ok((await send(threadA)).messageId);
      const current = (await privateState.get()).data();
      assert.equal(current.organizations[orgA].active, false); assert.equal(current.organizations[orgB].active, true);
    });
    await transfer('reported', orgA, orgB);
    await step('the second organization remains restricted until its own reviewer restores it', async () => {
      assert.ok((await call('reported', 'getChatSafetyState', { threadId: threadB })).suspension);
      await denied(() => send(threadB)); await upload(pendingGrant, 403);
      await act('outsider', reports.b, 'restore_user', 'scope-b-restore');
      assert.ok((await send(threadB)).messageId); await upload(pendingGrant, 200);
      await patch(`chatThreads/${allowedCustom}`, { title: { stringValue: 'Scoped title edit restored' } }, 200);
      assert.ok(!(await call('reported', 'getChatSafetyState', { threadId: threadB })).suspension);
    });
    await marker.update({ scopeState: 'passed', scopeCompletedAt: Timestamp.now() });
  } catch (error) {
    results.push({ name: 'failure', status: 'failed', message: error.message });
    await marker.update({ scopeState: 'failed', scopeCompletedAt: Timestamp.now() }); throw error;
  } finally {
    const outputDir = path.resolve(__dirname, '../../.local-data/chat-safety');
    fs.writeFileSync(path.join(outputDir, `${runId}-scope-results.json`), JSON.stringify({ runId, projectId: PROJECT_ID, reports, results }, null, 2));
  }
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
