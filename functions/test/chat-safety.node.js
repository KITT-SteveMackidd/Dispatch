const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatSafetyService, CHAT_TERMS_VERSION, rolloutEnabled, validateAttachmentUrl } = require('../lib/chat-safety');

function harness(enabled = true) {
  const docs = new Map([
    ['organizations/org', { chatSafetyEnabled: enabled, managerIds: ['manager'], workerIds: ['a', 'b'] }],
    ['organizationBilling/org', { chatSafetyEnabled: enabled, accessMode: 'full' }],
    ...['manager', 'a', 'b'].map(uid => [`users/${uid}`, { uid, organizationId: 'org', displayName: uid, chatRulesVersion: CHAT_TERMS_VERSION }]),
    ['users/outsider', { uid: 'outsider', organizationId: 'other' }],
    ['chatThreads/direct', { organizationId: 'org', participants: ['a', 'b'], kind: 'custom' }],
    ['chatThreads/group', { organizationId: 'org', participants: ['a', 'b', 'manager'], kind: 'organization' }],
  ]);
  const snap = ref => ({ id: ref.id, ref, exists: docs.has(ref.path), data: () => docs.get(ref.path) });
  const collection = path => ({
    path,
    doc: id => ({ id, path: `${path}/${id}`, collection: child => collection(`${path}/${id}/${child}`) }),
  });
  const tx = {
    get: async ref => ref.id ? snap(ref) : { docs: [...docs.keys()].filter(key => key.startsWith(`${ref.path}/`) && key.slice(ref.path.length + 1).indexOf('/') < 0).map(key => snap({ path: key, id: key.split('/').at(-1) })) },
    getAll: async (...refs) => refs.map(snap),
    create: (ref, data) => { assert.equal(docs.has(ref.path), false); docs.set(ref.path, data); },
    set: (ref, data) => docs.set(ref.path, { ...docs.get(ref.path), ...data }),
    update: (ref, data) => { assert.ok(docs.has(ref.path)); docs.set(ref.path, { ...docs.get(ref.path), ...data }); },
    delete: ref => docs.delete(ref.path),
  };
  const db = { collection, runTransaction: fn => fn(tx) };
  const bucket = { name: 'demo.appspot.com', file: () => ({ getMetadata: async () => [{ size: '9', contentType: 'application/pdf', metadata: { firebaseStorageDownloadTokens: 'valid-token' } }] }) };
  let billingChecks = 0;
  const service = createChatSafetyService({
    getDb: () => db, getFieldValue: () => ({ serverTimestamp: () => new Date(), increment: n => n }),
    getBucket: () => bucket, projectId: () => 'demo-dispatch-billing', emulatorOrigin: () => 'http://127.0.0.1:9199',
    assertAccountAllowed: async (_tx, uid) => { if (docs.get(`users/${uid}`)?.accountDeletionStartedAt) throw Error('deleting'); },
    assertOrganizationWritable: async () => { billingChecks++; if (docs.get('organizationBilling/org').accessMode !== 'full') throw Error('billing read only'); },
  });
  return { service, docs, tx, request: (uid, data = {}) => ({ auth: { uid, token: {} }, data }), billingChecks: () => billingChecks };
}

test('rollout requires matching server projections and fails closed for unsupported dedicated backend', () => {
  assert.equal(rolloutEnabled({}, {}, 'dispatch-eb63a'), false);
  assert.equal(rolloutEnabled({ chatSafetyEnabled: true }, { chatSafetyEnabled: true }, 'demo-dispatch-billing'), true);
  assert.throws(() => rolloutEnabled({ chatSafetyEnabled: true }, {}, 'demo-dispatch-billing'), /configured/);
  assert.throws(() => rolloutEnabled({}, { chatSafetyEnabled: true }, 'demo-dispatch-billing'), /configured/);
  assert.throws(() => rolloutEnabled({ chatSafetyEnabled: true }, { chatSafetyEnabled: true }, 'dispatch-customer-beta'), /not configured/);
});

test('flag-off send and delivery do not require consent or blocks', async () => {
  const h = harness(false);
  delete h.docs.get('users/a').chatRulesVersion;
  h.docs.set('users/b/chatBlocks/a', {});
  assert.equal((await h.service.prepareSend(h.tx, { id: 'direct', ...h.docs.get('chatThreads/direct') }, 'a', [])).enabled, false);
  assert.equal(await h.service.canDeliver({ threadId: 'direct', senderId: 'a', recipientId: 'b' }), true);
});

test('rules acceptance is current-version only, server-owned, and independent of billing access', async () => {
  const h = harness();
  delete h.docs.get('users/a').chatRulesVersion;
  h.docs.get('organizationBilling/org').accessMode = 'read_only';
  await assert.rejects(h.service.acceptRules(h.request('a', { version: 'old' })), /current/);
  await h.service.acceptRules(h.request('a', { version: CHAT_TERMS_VERSION }));
  assert.equal(h.docs.get('users/a').chatRulesVersion, CHAT_TERMS_VERSION);
  assert.ok(h.docs.has('users/a/chatSafetyState/current'));
  assert.equal(h.billingChecks(), 0);
});

test('block is owner-only same-organization, signals both parties, and stale unblock remains possible', async () => {
  const h = harness();
  await assert.rejects(h.service.setBlock(h.request('a', { targetUserId: 'a', blocked: true })), /another member/);
  await assert.rejects(h.service.setBlock(h.request('a', { targetUserId: 'outsider', blocked: true })), /organization/);
  await h.service.setBlock(h.request('a', { targetUserId: 'b', blocked: true }));
  assert.equal(h.docs.get('users/a/chatBlocks/b').targetUserId, 'b');
  assert.ok(h.docs.has('users/b/chatSafetyState/current'));
  h.docs.get('users/a').organizationId = null;
  h.docs.get('users/b').organizationId = 'other';
  await h.service.setBlock(h.request('a', { targetUserId: 'b', blocked: false }));
  assert.equal(h.docs.has('users/a/chatBlocks/b'), false);
});

test('blocking is reciprocal for any two-person chat and filters larger-group recipients', async () => {
  const h = harness();
  await h.service.setBlock(h.request('a', { targetUserId: 'b', blocked: true }));
  for (const uid of ['a', 'b']) {
    await assert.rejects(h.service.prepareSend(h.tx, { id: 'direct', ...h.docs.get('chatThreads/direct') }, uid, []), /blocking/);
  }
  const prepared = await h.service.prepareSend(h.tx, { id: 'group', ...h.docs.get('chatThreads/group') }, 'b', []);
  assert.deepEqual(prepared.recipientIds, ['manager']);
  assert.deepEqual((await h.service.getState(h.request('a', { threadId: 'group' }))).hiddenSenderIds, ['b']);
});

test('delivery rechecks a block, suspension and current membership after message creation', async () => {
  const h = harness();
  const delivery = { threadId: 'group', senderId: 'a', recipientId: 'b' };
  assert.equal(await h.service.canDeliver(delivery), true);
  h.docs.set('users/b/chatBlocks/a', {});
  assert.equal(await h.service.canDeliver(delivery), false);
  h.docs.delete('users/b/chatBlocks/a');
  h.docs.get('users/a').chatSuspension = { active: true };
  assert.equal(await h.service.canDeliver(delivery), false);
  delete h.docs.get('users/a').chatSuspension;
  h.docs.get('organizations/org').workerIds = ['a'];
  assert.equal(await h.service.canDeliver(delivery), false);
});

test('upload requires consent, writable organization, valid size/type and a grant owned by the sender', async () => {
  const h = harness();
  const input = { threadId: 'group', name: 'run.pdf', mimeType: 'application/pdf', size: 9 };
  delete h.docs.get('users/a').chatRulesVersion;
  await assert.rejects(h.service.createUpload(h.request('a', input)), /Accept/);
  h.docs.get('users/a').chatRulesVersion = CHAT_TERMS_VERSION;
  await assert.rejects(h.service.createUpload(h.request('a', { ...input, name: 'x'.repeat(121) })), /supported/);
  const grant = await h.service.createUpload(h.request('a', input));
  const attachment = { ...input, kind: 'file', id: grant.objectPath, url: `http://127.0.0.1:9199/v0/b/demo.appspot.com/o/${encodeURIComponent(grant.objectPath)}?alt=media&token=valid-token` };
  const thread = { id: 'group', ...h.docs.get('chatThreads/group') };
  assert.equal((await h.service.prepareSend(h.tx, thread, 'a', [attachment])).grantRefs.length, 1);
  await assert.rejects(h.service.prepareSend(h.tx, thread, 'b', [attachment]), /different/);
  await assert.rejects(h.service.prepareSend(h.tx, thread, 'a', [{ ...attachment, url: 'https://evil.example/run.pdf' }]), /secure Dispatch/);
  h.docs.get(`chatUploadGrants/${grant.grantId}`).usedAt = new Date();
  await assert.rejects(h.service.prepareSend(h.tx, thread, 'a', [attachment]), /expired/);
});

test('production URL validation rejects HTTP, arbitrary buckets, traversal, and incorrect object paths', () => {
  const objectPath = 'chatSafetyAttachments/abc/run.pdf';
  const url = `https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/${encodeURIComponent(objectPath)}?alt=media&token=t`;
  assert.equal(validateAttachmentUrl({ url, objectPath, bucket: 'demo.appspot.com' }), 't');
  assert.throws(() => validateAttachmentUrl({ url: url.replace('https:', 'http:'), objectPath, bucket: 'demo.appspot.com' }));
  assert.throws(() => validateAttachmentUrl({ url, objectPath: 'chatSafetyAttachments/abc/other.pdf', bucket: 'demo.appspot.com' }));
  assert.throws(() => validateAttachmentUrl({ url, objectPath, bucket: 'other.appspot.com' }));
});
