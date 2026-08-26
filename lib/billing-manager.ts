import type { Organisation } from '@/types/dispatch';

type BillingManagerOrganization = Pick<
  Organisation,
  'managerIds' | 'createdBy' | 'billingManagerId'
>;

function activeManagerIds(organization: BillingManagerOrganization) {
  return [...new Set((organization.managerIds || []).filter(Boolean))];
}

/**
 * Resolves legacy organizations without silently changing their stored data.
 * The creator wins when still active; otherwise the stable lexical fallback
 * gives every client the same answer until an explicit handoff is persisted.
 */
export function resolveBillingManagerId(
  organization: BillingManagerOrganization
): string | null {
  const managerIds = activeManagerIds(organization);

  if (
    organization.billingManagerId &&
    managerIds.includes(organization.billingManagerId)
  ) {
    return organization.billingManagerId;
  }

  if (organization.createdBy && managerIds.includes(organization.createdBy)) {
    return organization.createdBy;
  }

  return managerIds.slice().sort((left, right) => left.localeCompare(right))[0] || null;
}

export function isOrganizationBillingManager(
  organization: BillingManagerOrganization,
  userId: string | null | undefined
) {
  return Boolean(userId && resolveBillingManagerId(organization) === userId);
}
