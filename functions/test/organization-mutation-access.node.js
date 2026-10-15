const assert = require('node:assert/strict');
const test = require('node:test');
const { assertOrganizationMutationAccess } = require('../lib/organization-mutation-access');

const fixture = () => ({
  userId: 'worker',
  organizationId: 'org',
  user: { organizationId: 'org' },
  organization: { managerIds: ['manager'], workerIds: ['worker'] },
  billing: { accessMode: 'full' },
});

test('server chat and role actions require both current profile and accepted membership', () => {
  assert.doesNotThrow(() => assertOrganizationMutationAccess(fixture()));
  for (const patch of [
    { user: null },
    { organization: null },
    { user: { organizationId: 'other' } },
    { organization: { managerIds: ['manager'], workerIds: [] } },
  ]) {
    assert.throws(() => assertOrganizationMutationAccess({ ...fixture(), ...patch }), { code: 'permission-denied' });
  }
});

test('server chat and role actions fail closed for missing or read-only billing', () => {
  for (const billing of [null, {}, { accessMode: 'read_only' }]) {
    assert.throws(() => assertOrganizationMutationAccess({ ...fixture(), billing }), { code: 'failed-precondition' });
  }
});
