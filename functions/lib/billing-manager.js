function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function resolveBillingManagerId(organization = {}) {
  const managerIds = uniqueStrings(organization.managerIds);
  if (managerIds.includes(organization.billingManagerId)) return organization.billingManagerId;
  if (managerIds.includes(organization.createdBy)) return organization.createdBy;
  return managerIds.sort((left, right) => left.localeCompare(right))[0] || null;
}

function validateBillingManagerTransfer({ organization, callerId, targetManagerId, targetUser }) {
  const currentBillingManagerId = resolveBillingManagerId(organization);
  const managerIds = uniqueStrings(organization?.managerIds);

  if (!currentBillingManagerId || currentBillingManagerId !== callerId) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Only the current Billing Manager can transfer billing responsibility.',
    };
  }
  if (!targetManagerId || targetManagerId === callerId) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'Choose another active Manager as the new Billing Manager.',
    };
  }
  if (!managerIds.includes(targetManagerId)) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'The new Billing Manager must already be an active Manager in this organization.',
    };
  }
  if (
    !targetUser ||
    String(targetUser.role || '').toLowerCase() !== 'manager' ||
    targetUser.organizationId !== organization.id
  ) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'The selected account is not an active Manager in this organization.',
    };
  }

  return { ok: true, currentBillingManagerId, targetManagerId };
}

module.exports = {
  resolveBillingManagerId,
  validateBillingManagerTransfer,
};
