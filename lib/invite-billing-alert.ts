import { SUBSCRIPTION_PLANS } from './subscriptions';

export type InviteBillingAlert = {
  title: string;
  message: string;
  actionLabel: 'Upgrade' | 'View billing';
};

/** Only a structured invitation billing rejection should open the paywall. */
export function getInviteBillingAlert(
  error: unknown,
  context: { currentUserId: string; billingManagerId: string | null }
): InviteBillingAlert | null {
  if (!error || typeof error !== 'object') return null;
  const { code, details } = error as { code?: unknown; details?: unknown };
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const data = details as Record<string, unknown>;
  const capacityExceeded = (code === 'functions/resource-exhausted' || code === 'resource-exhausted')
    && data.reason === 'capacity-exceeded';
  const readOnly = (code === 'functions/failed-precondition' || code === 'failed-precondition')
    && data.reason === 'organization-read-only';
  if (!capacityExceeded && !readOnly) return null;

  // Prefer the server's role after a handoff over a potentially stale screen snapshot.
  const billingManagerId = Object.prototype.hasOwnProperty.call(data, 'billingManagerId')
    ? data.billingManagerId
    : context.billingManagerId;
  const isBillingManager = Boolean(context.currentUserId && billingManagerId === context.currentUserId);
  const hasCounts = typeof data.memberCap === 'number' && Number.isInteger(data.memberCap) && data.memberCap >= 0
    && typeof data.seatUsage === 'number' && Number.isInteger(data.seatUsage) && data.seatUsage >= 0;
  const seatMessage = hasCounts
    ? `${data.seatUsage} of ${data.memberCap} member seats are in use. `
    : '';
  const currentPlan = SUBSCRIPTION_PLANS.find((plan) => plan.id === data.planId);
  const pendingPlan = SUBSCRIPTION_PLANS.find((plan) => plan.id === data.pendingPlanId);
  const downgradeMessage = currentPlan && pendingPlan && pendingPlan.rank < currentPlan.rank
    ? `Your scheduled ${pendingPlan.name} downgrade limits new invitations to the lower seat cap. `
    : '';

  if (readOnly) {
    return {
      title: 'Organization is read-only',
      message: `New invitations are paused. ${seatMessage}${downgradeMessage}${isBillingManager
        ? 'Open Billing to resolve your subscription or free member seats before inviting another person.'
        : 'Ask your Billing Manager to resolve the subscription or free member seats. You can review the plan in Billing.'}`,
      actionLabel: 'View billing',
    };
  }

  return {
    title: 'No seats remaining',
    message: `${seatMessage}Accepted members and pending invitations both count toward your seat limit. ${downgradeMessage}${isBillingManager
      ? 'Upgrade your plan, remove a member, or cancel a pending invitation in Billing before inviting another person.'
      : 'Ask your Billing Manager to upgrade the plan or free a seat. You can review the plan and seat usage in Billing.'}`,
    actionLabel: isBillingManager ? 'Upgrade' : 'View billing',
  };
}
