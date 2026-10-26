const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { HttpsError } = require('firebase-functions/v2/https');
const { defaultOrganizationBilling } = require('../lib/subscriptions');

function inviteHarness({ accepted = 5, billing = {}, pending = [], projectId = '', policy, callerRole = 'manager', stubAccountCleanup = false } = {}) {
  const userId = 'billing-manager';
  const organizationId = 'test-organization';
  const documents = new Map([
    [`users/${userId}`, { uid: userId, role: callerRole, organizationId }],
    [`organizations/${organizationId}`, {
      billingManagerId: userId,
      managerIds: [userId],
      workerIds: Array.from({ length: accepted - 1 }, (_, i) => `worker-${i}`),
    }],
    [`organizationBilling/${organizationId}`, { ...defaultOrganizationBilling(), ...billing }],
    ...pending.map((invite, i) => [`secureInvites/pending-${i}`, { organizationId, status: 'active', inviteKind: 'worker', ...invite }]),
  ]);
  if (policy) documents.set('dispatchConfig/billing', policy);
  const snapshot = (ref) => ({ ref, id: ref.id, exists: documents.has(ref.path), data: () => documents.get(ref.path) });
  const authDeletions = [];
  const providerRequests = [];
  const cleanupRequests = [];
  const storageDeletions = [];
  let serial = 0;
  const collection = (name, conditions = []) => ({
    doc(id = `generated-${++serial}`) {
      const ref = { path: `${name}/${id}`, id, parent: { id: name } };
      ref.get = async () => snapshot(ref);
      ref.set = async (data) => documents.set(ref.path, { ...documents.get(ref.path), ...data });
      ref.collection = (child) => collection(`${ref.path}/${child}`);
      return ref;
    },
    where(field, operator, value) {
      assert.ok(['==', 'array-contains'].includes(operator));
      return collection(name, [...conditions, [field, operator, value]]);
    },
    async get() {
      return {
        docs: [...documents.entries()]
          .filter(([key, data]) => key.startsWith(`${name}/`) && conditions.every(([field, operator, value]) => (
            operator === 'array-contains' ? Array.isArray(data[field]) && data[field].includes(value) : data[field] === value
          )))
          .map(([key]) => snapshot(collection(name).doc(key.slice(name.length + 1)))),
      };
    },
  });
  const db = {
    collection,
    getAll: async (...refs) => refs.map(snapshot),
    async runTransaction(callback) {
      const writes = [];
      const write = (ref, data) => writes.push([ref, data]);
      const result = await callback({
        get: (ref) => ref.get(),
        getAll: async (...refs) => refs.map(snapshot),
        set: write,
        create: (ref, data) => { assert.equal(documents.has(ref.path), false); write(ref, data); },
        update: write,
        delete: (ref) => writes.push([ref, { __deleteDocument: true }]),
      });
      for (const [ref, data] of writes) {
        if (data.__deleteDocument) { documents.delete(ref.path); continue; }
        const next = { ...documents.get(ref.path), ...data };
        for (const [key, value] of Object.entries(data)) {
          if (value?.__arrayUnion) next[key] = [...new Set([...(documents.get(ref.path)?.[key] || []), ...value.__arrayUnion])];
          if (value?.__deleteField) delete next[key];
        }
        documents.set(ref.path, next);
      }
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
  if (stubAccountCleanup) {
    mocks['./lib/account-deletion'] = {
      deleteDispatchUserData: async ({ authUser }) => { cleanupRequests.push(authUser.uid); return { cleaned: true }; },
    };
    mocks['./lib/revenuecat'] = {
      ...requireEntry('./lib/revenuecat'),
      fetchRevenueCatCustomerAliases: async () => { providerRequests.push('aliases'); throw new Error('Must not reach RevenueCat'); },
      fetchRevenueCatSubscriber: async () => { providerRequests.push('subscriber'); throw new Error('Must not reach RevenueCat'); },
    };
  }
  const context = {
    exports: {},
    require: (name) => mocks[name] || requireEntry(name),
    process: { env: { GCLOUD_PROJECT: projectId } },
    Buffer, Error, URL, Date,
    __db: db,
    __fieldValue: {
      serverTimestamp: () => new Date(0), arrayUnion: (...values) => ({ __arrayUnion: values }),
      delete: () => ({ __deleteField: true }), increment: (value) => value,
    },
    __adminAuth: {
      getUser: async (uid) => ({ uid, email: `${uid}@example.test`, displayName: uid, providerData: [] }),
      deleteUser: async (uid) => authDeletions.push(uid),
    },
    __storageBucket: { file: (name) => ({ delete: async () => storageDeletions.push(name) }) },
  };
  // Execute the real callable with in-memory service boundaries; no Firebase or mail access.
  vm.runInNewContext(`${readFileSync(entryPath, 'utf8')}\ndb = __db; FieldValue = __fieldValue; adminAuth = __adminAuth; storageBucket = __storageBucket;`, context, { filename: entryPath });
  return {
    documents,
    request: (inviteKind = 'worker', deliveryEmail = 'new@example.test') => context.exports.createDispatchInvite({
      auth: { uid: userId }, data: { inviteKind, deliveryEmail },
    }),
    claim: (tokenOrCode, uid = 'new-worker') => context.exports.claimDispatchInvite({ auth: { uid }, data: { tokenOrCode } }),
    handlers: context.exports,
    reminderMail: context.workerEventReminderMail,
    authDeletions, providerRequests, cleanupRequests, storageDeletions,
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

const betaPolicy = { mode: 'customer_beta', projectId: 'dispatch-customer-beta' };

for (const kind of ['worker', 'manager']) {
  test(`customer beta can invite and accept ${kind} number thirteen without a paid entitlement`, async () => {
    const harness = inviteHarness({ accepted: 12, billing: { accessMode: 'read_only' }, projectId: 'dispatch-customer-beta', policy: betaPolicy });
    const previousBilling = { ...harness.documents.get('organizationBilling/test-organization') };
    const invitation = await harness.request(kind);
    assert.equal(invitation.memberCap, null);
    assert.equal(invitation.deliveryQueued, false);
    assert.equal(invitation.deliveryChannel, 'share');
    assert.match(invitation.appLink, /^dispatch:\/\/invite\/[A-Za-z0-9_-]+$/);
    assert.equal([...harness.documents.keys()].some(key => key.startsWith('mail/')), false);
    const source = harness.documents.get(`${kind === 'worker' ? 'workerInvites' : 'managerInvites'}/${invitation.inviteId}`);
    assert.equal(source.appLink, invitation.appLink);
    assert.equal(source.deliveryChannel, 'share');
    assert.equal(source.emailDelivery, 'not_sent_customer_beta');
    assert.equal(source.status, kind === 'worker' ? 'created' : 'pending');
    assert.match(source.statusReason, /No email was sent/);
    if (kind === 'worker') {
      assert.equal(source.sendCount, 0);
      assert.equal(source.lastSentAt, null);
    }
    const result = await harness.claim(invitation.inviteCode, `new-${kind}`);
    assert.equal(result.organizationId, 'test-organization');
    assert.equal(harness.documents.get(`users/new-${kind}`).organizationId, 'test-organization');
    assert.equal(harness.documents.get(`users/new-${kind}`).role, kind);
    assert.deepEqual(harness.documents.get('organizationBilling/test-organization'), previousBilling);
  });
}

test('standard and billing QA invitations retain their existing email queue and website', async () => {
  for (const projectId of ['', 'dispatch-eb63a', 'dispatch-billing-qa']) {
    for (const kind of ['worker', 'manager']) {
      const harness = inviteHarness({ accepted: 1, projectId });
      const invitation = await harness.request(kind);
      assert.equal(invitation.deliveryQueued, true);
      assert.equal(invitation.deliveryChannel, 'email');
      assert.match(invitation.appLink, /^https:\/\/dispatchcrewmanager\.com\/invite\//);
      const mail = [...harness.documents.entries()].filter(([key]) => key.startsWith('mail/'));
      assert.equal(mail.length, 1);
      assert.equal(mail[0][1].dispatchInvite.appLink, invitation.appLink);
      assert.deepEqual(mail[0][1].to, ['new@example.test']);
    }
  }
});

test('customer verification callable cannot silently queue an undeliverable email', async () => {
  const harness = inviteHarness({ projectId: 'dispatch-customer-beta', policy: betaPolicy });
  const before = [...harness.documents.entries()];
  await assert.rejects(harness.handlers.sendDispatchEmailVerification({ auth: { uid: 'billing-manager' }, data: {} }), (error) => {
    assert.equal(error.code, 'failed-precondition');
    assert.match(error.message, /Use email verification in the customer beta app/);
    return true;
  });
  assert.deepEqual([...harness.documents.entries()], before);
});

test('customer event reminders do not create mail, while standard and QA keep email reminders', () => {
  const reminder = {
    event: { id: 'event', name: 'Show', startsAt: new Date(Date.now() + 86_400_000).toISOString() },
    role: { id: 'role', name: 'Lighting' }, workerId: 'worker', email: 'worker@example.test',
  };
  assert.equal(inviteHarness({ projectId: 'dispatch-customer-beta' }).reminderMail(reminder), null);
  for (const projectId of ['dispatch-eb63a', 'dispatch-billing-qa']) {
    const mail = inviteHarness({ projectId }).reminderMail(reminder);
    assert.equal(mail.to[0], 'worker@example.test');
    assert.equal(mail.dispatchEventReminder.appLink, 'https://dispatchcrewmanager.com');
  }
});

test('customer beta fails closed without the policy and retains manager authorization', async () => {
  const missing = inviteHarness({ accepted: 12, projectId: 'dispatch-customer-beta' });
  await assert.rejects(missing.request(), { code: 'failed-precondition' });
  const worker = inviteHarness({ projectId: 'dispatch-customer-beta', policy: betaPolicy, callerRole: 'worker' });
  await assert.rejects(worker.request(), { code: 'permission-denied' });
});

test('copying the policy into production or QA cannot bypass the Free capacity', async () => {
  for (const projectId of ['dispatch-eb63a', 'dispatch-billing-qa']) {
    const harness = inviteHarness({ projectId, policy: { ...betaPolicy, projectId } });
    await assert.rejects(harness.request(), { code: 'resource-exhausted' });
  }
});

test('customer beta rejects direct subscription lifecycle calls and webhook requests before provider access', async () => {
  const { handlers } = inviteHarness({ projectId: 'dispatch-customer-beta', policy: betaPolicy });
  for (const name of ['initializeOrganizationBilling', 'prepareOrganizationSubscriptionChange', 'prepareOrganizationSubscriptionRestore', 'refreshOrganizationSubscription', 'transferOrganizationBillingManager']) {
    await assert.rejects(handlers[name]({ auth: { uid: 'billing-manager' }, data: {} }), (error) => {
      assert.equal(error.code, 'failed-precondition');
      assert.match(error.message, /complimentary customer beta/);
      return true;
    });
  }
  let status;
  let body;
  const response = { status(value) { status = value; return this; }, send(value) { body = value; } };
  await handlers.revenueCatWebhook({ method: 'POST' }, response);
  assert.equal(status, 403);
  assert.match(body, /disabled/);
});

test('customer beta account deletion removes only the authenticated account without RevenueCat requests', async () => {
  const harness = inviteHarness({ projectId: 'dispatch-customer-beta', policy: betaPolicy, stubAccountCleanup: true });
  const result = await harness.handlers.deleteDispatchAccount({
    auth: { uid: 'billing-manager', token: { auth_time: Math.floor(Date.now() / 1000) } },
    data: { userId: 'another-user' },
  });
  assert.equal(result.deleted, true);
  assert.equal(result.authDeletionPending, false);
  assert.equal(result.remoteCleanupPending, false);
  assert.equal(result.revenueCatManualReviewRequired, false);
  assert.equal(result.revenueCatCustomerDeleted, false);
  assert.deepEqual(harness.providerRequests, []);
  assert.deepEqual(harness.authDeletions, ['billing-manager']);
  assert.deepEqual(harness.cleanupRequests, ['billing-manager']);
  assert.equal(harness.documents.get('accountDeletionTombstones/billing-manager').status, 'completed');
});

test('customer-beta member removal can replace the Billing Manager without provider access, but never removes the last Manager', async () => {
  const harness = inviteHarness({ projectId: 'dispatch-customer-beta', policy: betaPolicy, stubAccountCleanup: true, billing: { purchaserUserId: 'billing-manager' } });
  const organization = harness.documents.get('organizations/test-organization');
  organization.managerIds.push('second-manager');
  harness.documents.set('users/second-manager', { uid: 'second-manager', role: 'manager', organizationId: 'test-organization' });
  await harness.handlers.removeOrganizationMember({ auth: { uid: 'second-manager' }, data: { targetUserId: 'billing-manager' } });
  assert.equal(harness.documents.get('users/billing-manager').organizationId, null);
  assert.equal(harness.documents.get('organizations/test-organization').billingManagerId, 'second-manager');
  assert.deepEqual(harness.providerRequests, []);
  await assert.rejects(harness.handlers.removeOrganizationMember({
    auth: { uid: 'second-manager' }, data: { targetUserId: 'second-manager' },
  }), (error) => error.details?.reason === 'target-is-sole-manager');
});

test('customer account deletion remains available when complimentary access is missing or paused', async () => {
  for (const policy of [undefined, { ...betaPolicy, mode: 'paused' }]) {
    const harness = inviteHarness({ projectId: 'dispatch-customer-beta', policy, stubAccountCleanup: true });
    const result = await harness.handlers.deleteDispatchAccount({
      auth: { uid: 'billing-manager', token: { auth_time: Math.floor(Date.now() / 1000) } }, data: {},
    });
    assert.equal(result.deleted, true);
    assert.equal(result.remoteCleanupPending, false);
    assert.deepEqual(harness.providerRequests, []);
  }
});

test('customer Auth deletion recovery finishes without a manual RevenueCat review', async () => {
  const harness = inviteHarness({ projectId: 'dispatch-customer-beta', stubAccountCleanup: true });
  await harness.handlers.recoverDispatchAccountAfterAuthDeletion({
    uid: 'billing-manager', email: 'billing-manager@example.test', providerData: [],
  });
  const tombstone = harness.documents.get('accountDeletionTombstones/billing-manager');
  assert.equal(tombstone.status, 'completed');
  assert.equal(tombstone.revenueCatDeletionPolicy, 'not_applicable_customer_beta');
  assert.equal(tombstone.revenueCatManualReviewRequired, false);
  assert.deepEqual(harness.providerRequests, []);
  assert.deepEqual(harness.cleanupRequests, ['billing-manager']);
});

test('QA Auth deletion recovery retains manual RevenueCat review', async () => {
  const harness = inviteHarness({ projectId: 'dispatch-billing-qa', stubAccountCleanup: true });
  await harness.handlers.recoverDispatchAccountAfterAuthDeletion({
    uid: 'billing-manager', email: 'billing-manager@example.test', providerData: [],
  });
  const tombstone = harness.documents.get('accountDeletionTombstones/billing-manager');
  assert.equal(tombstone.status, 'manual_revenuecat_review');
  assert.equal(tombstone.revenueCatDeletionPolicy, 'manual_alias_review');
  assert.equal(tombstone.revenueCatManualReviewRequired, true);
});

test('customer orphan recovery blocks chat and event callables despite complimentary policy', async () => {
  const harness = inviteHarness({ projectId: 'dispatch-customer-beta', policy: betaPolicy });
  const org = harness.documents.get('organizations/test-organization');
  Object.assign(org, { managerIds: [], recoveryState: 'orphaned_no_manager', workerIds: ['worker-0'] });
  harness.documents.set('users/worker-0', { role: 'worker', organizationId: 'test-organization' });
  harness.documents.set('chatThreads/orphan-chat', { organizationId: 'test-organization', participants: ['worker-0'] });
  harness.documents.set('events/orphan-event', { organizationId: 'test-organization', roles: [], workerIds: ['worker-0'] });
  const before = [...harness.documents.entries()];
  for (const [name, data] of [
    ['sendChatMessage', { threadId: 'orphan-chat', text: 'Blocked', attachments: [] }],
    ['mutateWorkerEvent', { eventId: 'orphan-event', actionType: 'toggle_task_completion' }],
  ]) {
    await assert.rejects(harness.handlers[name]({ auth: { uid: 'worker-0' }, data }), (error) => {
      assert.equal(error.code, 'failed-precondition');
      assert.match(error.message, /no active Manager/);
      return true;
    });
  }
  assert.deepEqual([...harness.documents.entries()], before);
});

test('customer upload finalizer removes race uploads after the last Manager is gone', async () => {
  const harness = inviteHarness({ projectId: 'dispatch-customer-beta', policy: betaPolicy });
  harness.documents.set('users/worker-0', { role: 'worker', organizationId: 'test-organization' });
  harness.documents.set('chatThreads/orphan-chat', { organizationId: 'test-organization', participants: ['worker-0'] });
  const objectName = 'chatAttachments/orphan-chat/worker-0/race.txt';
  await harness.handlers.reapOrphanedDispatchStorageObject({ data: { name: objectName } });
  assert.deepEqual(harness.storageDeletions, []);
  Object.assign(harness.documents.get('organizations/test-organization'), { managerIds: [], recoveryState: 'orphaned_no_manager' });
  await harness.handlers.reapOrphanedDispatchStorageObject({ data: { name: objectName } });
  assert.deepEqual(harness.storageDeletions, [objectName]);
});

test('a managed customer organization can complete an assigned task without a role notification', async () => {
  const harness = inviteHarness({ projectId: 'dispatch-customer-beta', policy: betaPolicy });
  harness.documents.set('users/worker-0', { role: 'worker', organizationId: 'test-organization' });
  harness.documents.set('events/managed-event', {
    organizationId: 'test-organization', managerId: 'billing-manager', workerIds: ['worker-0'], revision: 0,
    roles: [{ id: 'role', name: 'Crew', assignedWorkerIds: ['worker-0'], waitlistWorkerIds: [], eligibleWaitlistWorkerIds: [], waitlistInviteWorkerIds: [], removedWorkerIds: [], openSlots: 0, tasks: [{ id: 'task', title: 'Test', completedBy: [] }] }],
  });
  await harness.handlers.mutateWorkerEvent({
    auth: { uid: 'worker-0' }, data: { eventId: 'managed-event', roleId: 'role', taskId: 'task', actionType: 'toggle_task_completion', complete: true },
  });
  assert.deepEqual(harness.documents.get('events/managed-event').roles[0].tasks[0].completedBy, ['worker-0']);
  assert.equal(harness.documents.get('events/managed-event').revision, 1);
});
