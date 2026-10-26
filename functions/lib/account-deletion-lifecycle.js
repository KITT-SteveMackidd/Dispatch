const ACTIVE_DELETION_TOMBSTONE_STATES = new Set([
  'deleting',
  'ready_for_revenuecat_deletion',
  'ready_for_auth_deletion',
  'manual_revenuecat_review',
]);

function timestampMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function accountDeletionTombstoneIsActive(data, nowMs = Date.now()) {
  if (!data || typeof data !== 'object') return false;
  if (ACTIVE_DELETION_TOMBSTONE_STATES.has(data.status)) return true;
  const denyUntilMs = timestampMillis(data.denyUntil);
  return denyUntilMs === 0 || denyUntilMs > nowMs;
}

function accountDeletionLeaseIsActive(data, nowMs = Date.now()) {
  if (!data || typeof data !== 'object') return false;
  const leaseExpiresAtMs = timestampMillis(data.leaseExpiresAt);
  return leaseExpiresAtMs === 0 || leaseExpiresAtMs > nowMs;
}

function accountDeletionMutationIsAllowed({
  maintenanceLock,
  tombstone,
  userExists,
  nowMs = Date.now(),
}) {
  return userExists === true
    && !accountDeletionLeaseIsActive(maintenanceLock, nowMs)
    && !accountDeletionTombstoneIsActive(tombstone, nowMs);
}

function accountDeletionCleanupStatus({
  revenueCatCustomerDeleted,
  authUserDeleted,
  revenueCatDeletionPolicy = 'automatic',
  customerBeta = false,
}) {
  if (customerBeta && revenueCatDeletionPolicy === 'not_applicable_customer_beta') {
    return authUserDeleted ? 'completed' : 'ready_for_auth_deletion';
  }
  if (revenueCatDeletionPolicy !== 'automatic') return 'manual_revenuecat_review';
  if (!revenueCatCustomerDeleted) return 'ready_for_revenuecat_deletion';
  if (!authUserDeleted) return 'ready_for_auth_deletion';
  return 'completed';
}

module.exports = {
  ACTIVE_DELETION_TOMBSTONE_STATES,
  accountDeletionCleanupStatus,
  accountDeletionLeaseIsActive,
  accountDeletionMutationIsAllowed,
  accountDeletionTombstoneIsActive,
};
