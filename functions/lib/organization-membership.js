const { resolveBillingManagerId } = require('./billing-manager');

function normalizedId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueSortedIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizedId)
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function uniqueIdsInOrder(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizedId)
    .filter(Boolean))];
}

function normalizedMemberRole(value) {
  const role = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return role === 'manager' || role === 'worker' ? role : null;
}

function failure(code, reason, message) {
  return { ok: false, code, reason, message };
}

/**
 * Produces the organization-array update for removing one active member.
 *
 * `verifiedLivePaidPurchaserId` must come from an authoritative RevenueCat
 * verification performed by the transaction caller. This pure helper does not
 * infer whether a locally stored purchaser reference is still live.
 */
function planOrganizationMemberRemoval({
  organization = {},
  callerId,
  targetUserId,
  targetUser,
  verifiedLivePaidPurchaserId = null,
  customerBeta = false,
} = {}) {
  const normalizedCallerId = normalizedId(callerId);
  const normalizedTargetUserId = normalizedId(targetUserId);
  const organizationId = normalizedId(organization?.id);
  const currentBillingManagerId = resolveBillingManagerId(organization);

  if (customerBeta && !uniqueSortedIds(organization.managerIds).includes(normalizedCallerId)) {
    return failure('permission-denied', 'caller-not-manager', 'Only an active organization Manager can remove a member.');
  }
  if (!customerBeta && (!normalizedCallerId || currentBillingManagerId !== normalizedCallerId)) {
    return failure(
      'permission-denied',
      'caller-not-billing-manager',
      'Only the current Billing Manager can remove an organization member.'
    );
  }

  const targetProfileId = normalizedId(targetUser?.uid || targetUser?.id);
  const targetOrganizationId = normalizedId(targetUser?.organizationId);
  const targetRole = normalizedMemberRole(targetUser?.role);
  const managerIds = uniqueSortedIds(organization?.managerIds);
  const workerIds = uniqueSortedIds(organization?.workerIds);
  if (
    !normalizedTargetUserId
    || !targetProfileId
    || targetProfileId !== normalizedTargetUserId
    || !organizationId
    || targetOrganizationId !== organizationId
    || !targetRole
  ) {
    return failure(
      'failed-precondition',
      'target-not-active-member',
      'The selected account is not an active member of this organization.'
    );
  }

  if ((targetRole === 'manager' && managerIds.length === 1)
    || (customerBeta && managerIds.filter((id) => id !== normalizedTargetUserId).length === 0)) {
    return failure(
      'failed-precondition',
      'target-is-sole-manager',
      'The organization must retain at least one active Manager.'
    );
  }

  if (!customerBeta && normalizedTargetUserId === currentBillingManagerId) {
    return failure(
      'failed-precondition',
      'target-is-billing-manager',
      'Transfer the Billing Manager role before removing this Manager.'
    );
  }

  if (
    !customerBeta && normalizedId(verifiedLivePaidPurchaserId)
    && normalizedId(verifiedLivePaidPurchaserId) === normalizedTargetUserId
  ) {
    return failure(
      'failed-precondition',
      'target-is-live-paid-purchaser',
      'The verified live store purchaser cannot be removed until paid access ends.'
    );
  }

  const nextManagerIds = managerIds.filter((userId) => userId !== normalizedTargetUserId);
  const nextWorkerIds = workerIds.filter((userId) => userId !== normalizedTargetUserId);
  const organizationUpdate = {
    managerIds: nextManagerIds,
    workerIds: nextWorkerIds,
    ...(customerBeta && normalizedTargetUserId === currentBillingManagerId
      ? { billingManagerId: nextManagerIds[0] }
      : {}),
  };

  return {
    ok: true,
    currentBillingManagerId,
    callerId: normalizedCallerId,
    targetUserId: normalizedTargetUserId,
    targetRole,
    target: {
      userId: normalizedTargetUserId,
      role: targetRole,
      organizationId,
    },
    managerIds: nextManagerIds,
    workerIds: nextWorkerIds,
    organizationUpdate,
    nextOrganization: {
      ...organization,
      ...organizationUpdate,
    },
  };
}

function removeOrganizationMemberFromChatThread(thread = {}, targetUserId) {
  const normalizedTargetUserId = normalizedId(targetUserId);
  return {
    participants: uniqueIdsInOrder(thread?.participants)
      .filter((userId) => userId !== normalizedTargetUserId),
    pushSeenBy: uniqueIdsInOrder(thread?.pushSeenBy)
      .filter((userId) => userId !== normalizedTargetUserId),
  };
}

module.exports = {
  planOrganizationMemberRemoval,
  removeOrganizationMemberFromChatThread,
};
