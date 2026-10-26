// A complimentary beta is an environment policy, never a purchased entitlement.
// Keep this project ID aligned with Firestore/Storage rules and the build policy.
const CUSTOMER_BETA_PROJECT_ID = 'dispatch-customer-beta';
const CUSTOMER_BETA_POLICY_PATH = 'dispatchConfig/billing';

function isCustomerBetaProject(projectId) {
  return projectId === CUSTOMER_BETA_PROJECT_ID;
}

function getFunctionsRegion(projectId) {
  return isCustomerBetaProject(projectId) ? 'northamerica-northeast1' : 'us-central1';
}

function organizationHasManagerAuthority(organization) {
  return organization?.recoveryState !== 'orphaned_no_manager'
    && Array.isArray(organization?.managerIds)
    && organization.managerIds.some(id => typeof id === 'string' && id.trim());
}

function customerBetaPolicyEnabled({ projectId, policy } = {}) {
  return isCustomerBetaProject(projectId)
    && policy?.mode === 'customer_beta'
    && policy?.projectId === projectId;
}

module.exports = {
  CUSTOMER_BETA_PROJECT_ID,
  CUSTOMER_BETA_POLICY_PATH,
  customerBetaPolicyEnabled,
  getFunctionsRegion,
  isCustomerBetaProject,
  organizationHasManagerAuthority,
};
