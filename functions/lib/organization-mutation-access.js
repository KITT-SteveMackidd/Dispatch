const { HttpsError } = require('firebase-functions/v2/https');

function assertOrganizationMutationAccess({ userId, organizationId, user, organization, billing }) {
  const memberIds = [...(organization?.managerIds || []), ...(organization?.workerIds || [])];
  if (!user || !organization || user.organizationId !== organizationId || !memberIds.includes(userId)) {
    throw new HttpsError('permission-denied', 'You are no longer an active member of this organization.');
  }
  if (!billing || billing.accessMode !== 'full') {
    throw new HttpsError('failed-precondition', 'This organization is read-only. Ask the Billing Manager to resolve billing or capacity.');
  }
}

module.exports = { assertOrganizationMutationAccess };
