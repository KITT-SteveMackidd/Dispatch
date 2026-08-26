const assert = require('node:assert/strict');
const test = require('node:test');
const {
  accountDeletionCleanupStatus,
  accountDeletionLeaseIsActive,
  accountDeletionMutationIsAllowed,
  accountDeletionTombstoneIsActive,
} = require('../lib/account-deletion-lifecycle');

test('account deletion fences incomplete cleanup and recently completed tokens', () => {
  const now = Date.parse('2030-01-01T00:00:00.000Z');
  assert.equal(accountDeletionTombstoneIsActive({ status: 'deleting' }, now), true);
  assert.equal(accountDeletionTombstoneIsActive({ status: 'ready_for_revenuecat_deletion' }, now), true);
  assert.equal(accountDeletionTombstoneIsActive({ status: 'ready_for_auth_deletion' }, now), true);
  assert.equal(accountDeletionTombstoneIsActive({ status: 'manual_revenuecat_review' }, now), true);
  assert.equal(accountDeletionTombstoneIsActive({
    status: 'completed',
    denyUntil: new Date(now + 1_000),
  }, now), true);
  assert.equal(accountDeletionTombstoneIsActive({
    status: 'completed',
    denyUntil: new Date(now - 1),
  }, now), false);
});

test('remote cleanup advances through RevenueCat and Auth retry states', () => {
  assert.equal(accountDeletionCleanupStatus({
    revenueCatCustomerDeleted: false,
    authUserDeleted: false,
  }), 'ready_for_revenuecat_deletion');
  assert.equal(accountDeletionCleanupStatus({
    revenueCatCustomerDeleted: true,
    authUserDeleted: false,
  }), 'ready_for_auth_deletion');
  assert.equal(accountDeletionCleanupStatus({
    revenueCatCustomerDeleted: true,
    authUserDeleted: true,
  }), 'completed');
  assert.equal(accountDeletionCleanupStatus({
    revenueCatCustomerDeleted: false,
    authUserDeleted: true,
    revenueCatDeletionPolicy: 'manual_alias_review',
  }), 'manual_revenuecat_review');
});

test('account deletion leases fail closed and expired leases release mutations', () => {
  const now = Date.parse('2030-01-01T00:00:00.000Z');
  assert.equal(accountDeletionLeaseIsActive({ leaseExpiresAt: new Date(now + 1_000) }, now), true);
  assert.equal(accountDeletionLeaseIsActive({ leaseExpiresAt: new Date(now - 1) }, now), false);
  assert.equal(accountDeletionLeaseIsActive({}, now), true);
  assert.equal(accountDeletionLeaseIsActive(null, now), false);
});

test('background mutations require a live user with no deletion fence', () => {
  const now = Date.parse('2030-01-01T00:00:00.000Z');
  const allowed = {
    maintenanceLock: null,
    tombstone: null,
    userExists: true,
    nowMs: now,
  };
  assert.equal(accountDeletionMutationIsAllowed(allowed), true);
  assert.equal(accountDeletionMutationIsAllowed({
    ...allowed,
    maintenanceLock: { leaseExpiresAt: new Date(now + 1_000) },
  }), false);
  assert.equal(accountDeletionMutationIsAllowed({
    ...allowed,
    tombstone: { status: 'deleting' },
  }), false);
  assert.equal(accountDeletionMutationIsAllowed({ ...allowed, userExists: false }), false);
});
