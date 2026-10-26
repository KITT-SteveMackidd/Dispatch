const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { CUSTOMER_BETA_PROJECT_ID, customerBetaPolicyEnabled, getFunctionsRegion } = require('../lib/customer-beta-policy');
const { assertOrganizationMutationAccess } = require('../lib/organization-mutation-access');
const { accountDeletionCleanupStatus } = require('../lib/account-deletion-lifecycle');

test('complimentary access requires the exact dedicated project and trusted matching mode', () => {
  const policy = { mode: 'customer_beta', projectId: CUSTOMER_BETA_PROJECT_ID };
  assert.equal(customerBetaPolicyEnabled({ projectId: CUSTOMER_BETA_PROJECT_ID, policy }), true);
  for (const projectId of ['dispatch-eb63a', 'dispatch-billing-qa', 'demo-dispatch-billing', '', undefined]) {
    assert.equal(customerBetaPolicyEnabled({ projectId, policy: { ...policy, projectId } }), false);
  }
  assert.equal(customerBetaPolicyEnabled({ projectId: CUSTOMER_BETA_PROJECT_ID }), false);
  assert.equal(customerBetaPolicyEnabled({ projectId: CUSTOMER_BETA_PROJECT_ID, policy: { ...policy, mode: 'billing_qa' } }), false);
});

test('Firestore and Storage exact project constants cannot silently drift from backend policy', () => {
  for (const name of ['firestore.rules', 'storage.rules']) {
    const rules = readFileSync(path.join(__dirname, '../..', name), 'utf8');
    assert.ok(rules.includes(`request.auth.token.aud == '${CUSTOMER_BETA_PROJECT_ID}'`));
    assert.ok(rules.includes(".data.mode == 'customer_beta'"));
    assert.ok(rules.includes('.data.projectId == request.auth.token.aud'));
  }
});

test('only the dedicated customer project uses the Montreal Functions region', () => {
  assert.equal(getFunctionsRegion(CUSTOMER_BETA_PROJECT_ID), 'northamerica-northeast1');
  for (const projectId of ['dispatch-eb63a', 'dispatch-billing-qa', 'demo-dispatch-billing', '', undefined]) {
    assert.equal(getFunctionsRegion(projectId), 'us-central1');
  }
});

test('customer beta skips only subscription checks for server mutations', () => {
  const valid = {
    userId: 'worker', organizationId: 'org', user: { organizationId: 'org' },
    organization: { managerIds: ['manager'], workerIds: ['worker'] }, billing: null, customerBeta: true,
  };
  assert.doesNotThrow(() => assertOrganizationMutationAccess(valid));
  assert.throws(() => assertOrganizationMutationAccess({ ...valid, user: { organizationId: 'other' } }), { code: 'permission-denied' });
  assert.throws(() => assertOrganizationMutationAccess({ ...valid, organization: { workerIds: [] } }), { code: 'permission-denied' });
  assert.throws(() => assertOrganizationMutationAccess({ ...valid, customerBeta: false }), { code: 'failed-precondition' });
});

test('customer beta deletion completes without inventing a RevenueCat deletion', () => {
  const state = { customerBeta: true, revenueCatDeletionPolicy: 'not_applicable_customer_beta', revenueCatCustomerDeleted: false };
  assert.equal(accountDeletionCleanupStatus({ ...state, authUserDeleted: false }), 'ready_for_auth_deletion');
  assert.equal(accountDeletionCleanupStatus({ ...state, authUserDeleted: true }), 'completed');
  assert.equal(accountDeletionCleanupStatus({ ...state, customerBeta: false, authUserDeleted: true }), 'manual_revenuecat_review');
});

test('complimentary access never overrides orphaned organization recovery', () => {
  for (const organization of [
    { managerIds: [], workerIds: ['worker'] },
    { managerIds: ['stale-manager'], workerIds: ['worker'], recoveryState: 'orphaned_no_manager' },
  ]) {
    assert.throws(() => assertOrganizationMutationAccess({
      userId: 'worker', organizationId: 'org', user: { organizationId: 'org' },
      organization, billing: { accessMode: 'full' }, customerBeta: true,
    }), { code: 'failed-precondition' });
  }
});
