const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { HttpsError } = require('firebase-functions/v2/https');
const { defaultOrganizationBilling } = require('../lib/subscriptions');

function preflightHarness({ environment = 'sandbox', subscriber = {} } = {}) {
  const userId = 'billing-manager';
  const organizationId = 'test-organization';
  const documents = new Map([
    [`users/${userId}`, { uid: userId, role: 'manager', organizationId }],
    [`organizations/${organizationId}`, { billingManagerId: userId, managerIds: [userId], workerIds: [] }],
    [`organizationBilling/${organizationId}`, defaultOrganizationBilling(1)],
  ]);
  const deleted = Symbol('delete-field');
  const snapshot = (ref) => ({
    ref,
    id: ref.id,
    exists: documents.has(ref.path),
    data: () => documents.get(ref.path),
  });
  const db = {
    collection(name) {
      return {
        doc(id) {
          const ref = { path: `${name}/${id}`, id };
          ref.get = async () => snapshot(ref);
          return ref;
        },
        where(field, operator, value) {
          assert.equal(operator, '==');
          return {
            get: async () => ({
              docs: [...documents.entries()]
                .filter(([key, data]) => key.startsWith(`${name}/`) && data[field] === value)
                .map(([key]) => snapshot({ path: key, id: key.split('/').at(-1) })),
            }),
          };
        },
      };
    },
    getAll: async (...refs) => refs.map(snapshot),
    async runTransaction(callback) {
      const writes = [];
      const result = await callback({
        get: (ref) => ref.get(),
        getAll: (...refs) => db.getAll(...refs),
        set: (ref, data) => writes.push([ref, data]),
      });
      for (const [ref, data] of writes) {
        const next = { ...documents.get(ref.path), ...data };
        for (const [key, value] of Object.entries(next)) {
          if (value === deleted) delete next[key];
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
  const subscriberRequests = [];
  const mocks = {
    'firebase-functions/v1': legacyFunctions,
    'firebase-functions/v2': { setGlobalOptions() {}, logger: { info() {}, error() {}, warn() {} } },
    'firebase-functions/v2/core': { onInit() {} },
    'firebase-functions/v2/firestore': { onDocumentCreated: register, onDocumentUpdated: register },
    'firebase-functions/v2/https': { HttpsError, onCall: register, onRequest: register },
    'firebase-functions/v2/scheduler': { onSchedule: register },
    'firebase-functions/v2/storage': { onObjectFinalized: register },
    'firebase-functions/params': {
      defineSecret: () => ({ value: () => 'unit-test-secret' }),
      defineString: (name) => ({ value: () => name === 'REVENUECAT_EXPECTED_ENVIRONMENT' ? environment : '' }),
    },
    './lib/revenuecat': {
      ...requireEntry('./lib/revenuecat'),
      async fetchRevenueCatSubscriber(params) {
        subscriberRequests.push(params.appUserId);
        return subscriber;
      },
    },
  };
  const context = {
    exports: {},
    require: (name) => mocks[name] || requireEntry(name),
    process,
    Buffer,
    Error,
    URL,
    __db: db,
    __fieldValue: { serverTimestamp: () => new Date(0), delete: () => deleted },
  };
  // Run the actual exported handler with service boundaries mocked; the
  // preflight, environment validation, and billing projection remain real.
  vm.runInNewContext(
    `${readFileSync(entryPath, 'utf8')}\ndb = __db; FieldValue = __fieldValue;`,
    context,
    { filename: entryPath }
  );
  return {
    documents,
    subscriberRequests,
    refresh: (purchaseStore = 'test_store', uid = userId) => context.exports.refreshOrganizationSubscription({ auth: { uid }, data: { purchaseStore } }),
    restore: () => context.exports.prepareOrganizationSubscriptionRestore({ auth: { uid: userId }, data: { purchaseStore: 'test_store' } }),
    request: (planId, billingPeriod, purchaseStore = 'test_store') => context.exports.prepareOrganizationSubscriptionChange({
      auth: { uid: userId },
      data: { planId, billingPeriod, purchaseStore },
    }),
  };
}

for (const planId of ['crew', 'production', 'organization']) {
  for (const period of ['monthly', 'annual']) {
    test(`preflights ${planId} ${period} against the configured sandbox without granting paid access`, async () => {
      const harness = preflightHarness();
      const result = await harness.request(planId, period);
      assert.equal(result.packageIdentifier, `${planId}_${period}`);
      assert.equal(result.changeTiming, 'immediate');
      assert.deepEqual(harness.subscriberRequests, ['billing-manager']);
      const billing = harness.documents.get('organizationBilling/test-organization');
      assert.equal(billing.planId, 'free');
      assert.equal(billing.seatLimit, 5);
      assert.equal(billing.purchaseIntent.planId, planId);
      assert.equal(billing.purchaseIntent.billingPeriod, period);
    });
  }
}

test('purchase preflight rejects a sandbox entitlement when the server expects production', async () => {
  const harness = preflightHarness({
    environment: 'production',
    subscriber: {
      entitlements: { organization_access: { product_identifier: 'dispatch_crew_20_monthly', expires_date: '2099-02-01T00:00:00Z' } },
      subscriptions: { dispatch_crew_20_monthly: { store: 'TEST_STORE', is_sandbox: true, period_type: 'NORMAL' } },
    },
  });
  await assert.rejects(harness.request('crew', 'monthly', 'app_store'), {
    code: 'unavailable',
    message: /sandbox does not match expected production/,
  });
  const billing = harness.documents.get('organizationBilling/test-organization');
  assert.equal(billing.planId, 'free');
  assert.equal(billing.purchaseIntent, undefined);
});

function webSubscriber(planId = 'production', period = 'monthly', extra = {}) {
  const product = `dispatch_${planId}_${period}`;
  return {
    entitlements: { organization_access: { product_identifier: product, expires_date: '2099-02-01T00:00:00Z' } },
    subscriptions: { [product]: { store: 'rc_billing', is_sandbox: true, period_type: 'NORMAL', ...extra } },
  };
}

for (const planId of ['crew', 'production', 'organization']) {
  for (const period of ['monthly', 'annual']) {
    test(`mobile server verifies web ${planId} ${period} without a mobile purchase`, async () => {
      const harness = preflightHarness({ subscriber: webSubscriber(planId, period) });
      Object.assign(harness.documents.get('organizationBilling/test-organization'), {
        planId, billingPeriod: period, status: 'active', sourceStore: 'rc_billing', purchaserUserId: 'billing-manager',
      });
      const result = await harness.refresh();
      assert.equal(result.planId, planId);
      assert.equal(result.billingPeriod, period);
      assert.equal(result.sourceStore, 'rc_billing');
      assert.equal(result.seatLimit, { crew: 20, production: 50, organization: 100 }[planId]);
      const mapping = [...harness.documents].find(([key]) => key.startsWith('revenueCatCustomers/'))[1];
      assert.equal(mapping.purchaserUserId, 'billing-manager');
      assert.equal(mapping.organizationId, 'test-organization');
      assert.equal(mapping.state, 'active');
      await assert.rejects(harness.request('organization', period), { code: 'failed-precondition', message: /web app/ });
      await assert.rejects(harness.restore(), { code: 'failed-precondition', message: /original/ });
    });
  }
}

test('mobile discovers an existing web purchase even when the local billing projection is free', async () => {
  const harness = preflightHarness({ subscriber: webSubscriber() });
  await assert.rejects(harness.request('crew', 'monthly'), { code: 'failed-precondition', message: /web app/ });
  assert.equal(harness.documents.get('organizationBilling/test-organization').planId, 'free');
});

test('pending browser checkout blocks mobile purchase and restore before a receipt exists', async () => {
  const harness = preflightHarness();
  harness.documents.set('webBillingCheckout/test-organization', { state: 'prepared' });
  await assert.rejects(harness.request('crew', 'monthly'), { code: 'failed-precondition', message: /browser checkout/ });
  await assert.rejects(harness.restore(), { code: 'failed-precondition', message: /browser checkout/ });
});

test('cross-platform refresh rejects live payments in the sandbox harness', async () => {
  const harness = preflightHarness({ subscriber: webSubscriber('crew', 'monthly', { is_sandbox: false }) });
  await assert.rejects(harness.refresh(), { code: 'failed-precondition', message: /production does not match expected sandbox/ });
  assert.equal(harness.documents.get('organizationBilling/test-organization').planId, 'free');
});

test('mobile cannot claim a legacy web customer belonging to another organization', async () => {
  const { hashedDocumentId } = require('../lib/revenuecat');
  const harness = preflightHarness({ subscriber: webSubscriber() });
  harness.documents.set(`webBillingCustomers/${hashedDocumentId('billing-manager')}`, { uid: 'billing-manager', organizationId: 'other-organization' });
  await assert.rejects(harness.refresh(), { code: 'failed-precondition', message: /another organization/ });
});

test('only the Billing Manager can verify a cross-platform subscription', async () => {
  const harness = preflightHarness({ subscriber: webSubscriber() });
  harness.documents.set('users/other-manager', { role: 'manager', organizationId: 'test-organization' });
  await assert.rejects(harness.refresh('test_store', 'other-manager'), { code: 'permission-denied' });
});

test('web expiration returns mobile to Free and releases the shared purchaser mapping', async () => {
  const subscriber = webSubscriber();
  const harness = preflightHarness({ subscriber });
  await harness.refresh();
  subscriber.entitlements.organization_access.expires_date = '2020-01-01T00:00:00Z';
  const result = await harness.refresh();
  assert.equal(result.planId, 'free');
  assert.equal(result.seatLimit, 5);
  assert.equal(result.sourceStore, null);
  const mapping = [...harness.documents].find(([key]) => key.startsWith('revenueCatCustomers/'))[1];
  assert.equal(mapping.state, 'released');
  assert.equal(mapping.active, false);
});
