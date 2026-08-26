const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveBillingManagerId,
  validateBillingManagerTransfer,
} = require('../lib/billing-manager');

test('resolves explicit, creator, and deterministic legacy Billing Managers', () => {
  assert.equal(resolveBillingManagerId({
    managerIds: ['creator', 'billing'],
    createdBy: 'creator',
    billingManagerId: 'billing',
  }), 'billing');
  assert.equal(resolveBillingManagerId({ managerIds: ['manager-z', 'creator'], createdBy: 'creator' }), 'creator');
  assert.equal(resolveBillingManagerId({ managerIds: ['manager-z', 'manager-a'], createdBy: 'former' }), 'manager-a');
});

test('allows only the current Billing Manager to hand off to an active Manager', () => {
  const organization = {
    id: 'org-1',
    managerIds: ['billing', 'target'],
    billingManagerId: 'billing',
  };
  assert.deepEqual(validateBillingManagerTransfer({
    organization,
    callerId: 'billing',
    targetManagerId: 'target',
    targetUser: { role: 'manager', organizationId: 'org-1' },
  }), {
    ok: true,
    currentBillingManagerId: 'billing',
    targetManagerId: 'target',
  });

  assert.equal(validateBillingManagerTransfer({
    organization,
    callerId: 'target',
    targetManagerId: 'billing',
    targetUser: { role: 'manager', organizationId: 'org-1' },
  }).code, 'permission-denied');

  assert.equal(validateBillingManagerTransfer({
    organization,
    callerId: 'billing',
    targetManagerId: 'outsider',
    targetUser: { role: 'manager', organizationId: 'another-org' },
  }).code, 'failed-precondition');
});
