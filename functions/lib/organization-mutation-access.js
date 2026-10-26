const { HttpsError } = require('firebase-functions/v2/https');
const { organizationHasManagerAuthority } = require('./customer-beta-policy');

function assertCustomerBetaOrganizationWritable(organization) {
  if (!organizationHasManagerAuthority(organization)) {
    throw new HttpsError('failed-precondition', 'This organization is read-only because it has no active Manager. Contact support to recover organization access.');
  }
}

function assertOrganizationMutationAccess({ userId, organizationId, user, organization, billing, customerBeta = false }) {
  const memberIds = [...(organization?.managerIds || []), ...(organization?.workerIds || [])];
  if (!user || !organization || user.organizationId !== organizationId || !memberIds.includes(userId)) {
    throw new HttpsError('permission-denied', 'You are no longer an active member of this organization.');
  }
  if (customerBeta) assertCustomerBetaOrganizationWritable(organization);
  if (!customerBeta && (!billing || billing.accessMode !== 'full')) {
    throw new HttpsError('failed-precondition', 'This organization is read-only. Ask the Billing Manager to resolve billing or capacity.');
  }
}

module.exports = { assertOrganizationMutationAccess, assertCustomerBetaOrganizationWritable };
