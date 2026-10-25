const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { HttpsError } = require('firebase-functions/v2/https');
const { defaultOrganizationBilling } = require('../lib/subscriptions');

function inviteHarness({ accepted = 5, billing = {}, pending = [] } = {}) {
  const userId = 'billing-manager';
  const organizationId = 'test-organization';
  const documents = new Map([
    [`users/${userId}`, { uid: userId, role: 'manager', organizationId }],
    [`organizations/${organizationId}`, {
      billingManagerId: userId,
      managerIds: [userId],
      workerIds: Array.from({ length: accepted - 1 }, (_, i) => `worker-${i}`),
    }],
    [`organizationBilling/${organizationId}`, { ...defaultOrganizationBilling(), ...billing }],
    ...pending.map((invite, i) => [`secureInvites/pending-${i}`, { organizationId, status: 'active', inviteKind: 'worker', ...invite }]),
  ]);
  const snapshot = (ref) => ({ ref, id: ref.id, exists: documents.has(ref.path), data: () => documents.get(ref.path) });
  let serial = 0;
  const collection = (name, conditions = []) => ({
    doc(id = `generated-${++serial}`) {
      const ref = { path: `${name}/${id}`, id };
      ref.get = async () => snapshot(ref);
      return ref;
    },
    where(field, operator, value) {
      assert.equal(operator, '==');
      return collection(name, [...conditions, [field, value]]);
    },
    async get() {
      return {
        docs: [...documents.entries()]
          .filter(([key, data]) => key.startsWith(`${name}/`) && conditions.every(([field, value]) => data[field] === value))
          .map(([key]) => snapshot({ path: key, id: key.split('/').at(-1) })),
      };
    },
  });
  const db = {
    collection,
    async runTransaction(callback) {
      const writes = [];
      const write = (ref, data) => writes.push([ref, data]);
      const result = await callback({
        get: (ref) => ref.get(),
        getAll: async (...refs) => refs.map(snapshot),
        set: write,
        update: write,
      });
      for (const [ref, data] of writes) documents.set(ref.path, { ...documents.get(ref.path), ...data });
      return result;
    },
  };
  const entryPath = path.join(__dirname, '../index.js');
  const requireEntry = createRequire(entryPath);
  const register = (...args) => args.at(-1);
  const legacyFunctions = {
    runWith: () => legacyFunctions,
    region: () => legacyFunctions,
    auth: { user: () => ({ onDelete: register }) },
  };
  const mocks = {
    'firebase-functions/v1': legacyFunctions,
    'firebase-functions/v2': { setGlobalOptions() {}, logger: { info() {}, error() {}, warn() {} } },
    'firebase-functions/v2/core': { onInit() {} },
    'firebase-functions/v2/firestore': { onDocumentCreated: register, onDocumentUpdated: register },
    'firebase-functions/v2/https': { HttpsError, onCall: register, onRequest: register },
    'firebase-functions/v2/scheduler': { onSchedule: register },
    'firebase-functions/v2/storage': { onObjectFinalized: register },
    'firebase-functions/params': { defineSecret: () => ({ value: () => '' }), defineString: () => ({ value: () => '' }) },
  };
  const context = {
    exports: {},
    require: (name) => mocks[name] || requireEntry(name),
    process: { env: {} },
    Buffer, Error, URL, Date,
    __db: db,
    __fieldValue: { serverTimestamp: () => new Date(0) },
  };
  // Execute the real callable with in-memory service boundaries; no Firebase or mail access.
  vm.runInNewContext(`${readFileSync(entryPath, 'utf8')}\ndb = __db; FieldValue = __fieldValue;`, context, { filename: entryPath });
  return {
    documents,
    request: (inviteKind = 'worker', deliveryEmail = 'new@example.test') => context.exports.createDispatchInvite({
      auth: { uid: userId }, data: { inviteKind, deliveryEmail },
    }),
  };
}

for (const kind of ['worker', 'manager']) {
  test(`full organization rejects ${kind} invitation with authoritative upgrade details and no writes`, async () => {
    const harness = inviteHarness();
    const before = [...harness.documents.entries()];
    await assert.rejects(harness.request(kind), (error) => {
      assert.equal(error.code, 'resource-exhausted');
      assert.deepEqual(JSON.parse(JSON.stringify(error.details)), {
        reason: 'capacity-exceeded', planId: 'free', pendingPlanId: null,
        billingManagerId: 'billing-manager', memberCap: 5, seatUsage: 5, acceptedSeats: 5, reservedSeats: 0,
      });
      return true;
    });
    assert.deepEqual([...harness.documents.entries()], before);
  });
}

test('active pending invitations fill seats even when missing from the billing snapshot', async () => {
  const harness = inviteHarness({ accepted: 4, pending: [{ deliveryEmail: 'pending@example.test', expiresAt: new Date(Date.now() + 60_000) }] });
  await assert.rejects(harness.request(), (error) => {
    assert.equal(error.details.seatUsage, 5);
    assert.equal(error.details.acceptedSeats, 4);
    assert.equal(error.details.reservedSeats, 1);
    return true;
  });
});

test('the scheduled lower plan determines the rejection cap', async () => {
  const harness = inviteHarness({ accepted: 20, billing: { planId: 'production', status: 'active', pendingPlanId: 'crew', seatLimit: 50 } });
  await assert.rejects(harness.request(), (error) => {
    assert.equal(error.details.memberCap, 20);
    assert.equal(error.details.pendingPlanId, 'crew');
    assert.equal(error.details.planId, 'production');
    return true;
  });
});

test('read-only failures carry a distinct recovery reason and include pending seats', async () => {
  const harness = inviteHarness({ accepted: 4, billing: { accessMode: 'read_only' }, pending: [{ deliveryEmail: 'pending@example.test', expiresAt: new Date(Date.now() + 60_000) }] });
  const before = [...harness.documents.entries()];
  await assert.rejects(harness.request(), (error) => {
    assert.equal(error.code, 'failed-precondition');
    assert.equal(error.details.reason, 'organization-read-only');
    assert.equal(error.details.billingManagerId, 'billing-manager');
    assert.equal(error.details.seatUsage, 5);
    return true;
  });
  assert.deepEqual([...harness.documents.entries()], before);
});

test('a full organization can reissue a live invitation without reserving another seat', async () => {
  const harness = inviteHarness({ accepted: 4, pending: [{ deliveryEmail: 'pending@example.test', expiresAt: new Date(Date.now() + 60_000) }] });
  const result = await harness.request('worker', 'pending@example.test');
  assert.equal(result.deliveryQueued, true);
  assert.equal(result.seatUsage, 5);
  assert.equal(harness.documents.get('secureInvites/pending-0').status, 'revoked');
});

test('an expired reservation does not produce a paywall error', async () => {
  const harness = inviteHarness({ accepted: 4, pending: [{ deliveryEmail: 'expired@example.test', expiresAt: new Date(Date.now() - 60_000) }] });
  const result = await harness.request();
  assert.equal(result.deliveryQueued, true);
  assert.equal(result.seatUsage, 5);
});
