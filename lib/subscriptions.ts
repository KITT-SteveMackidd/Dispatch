export type SubscriptionPlanId = 'free' | 'crew' | 'production' | 'organization' | 'enterprise';
export type SubscriptionBillingPeriod = 'monthly' | 'annual';
export type SubscriptionLifecycleStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'grace'
  | 'billing_retry'
  | 'expired'
  | 'revoked';
export type SubscriptionAccessMode = 'full' | 'read_only';
export type SubscriptionPlanChangeTiming = 'none' | 'immediate' | 'next_renewal' | 'contact_sales';

export type SubscriptionSeatReservation = {
  inviteHash: string;
  sourceInviteId: string | null;
  inviteKind: 'manager' | 'worker';
  expiresAtMs: number;
};

export type OrganizationBilling = {
  schemaVersion: 1;
  planId: SubscriptionPlanId;
  billingPeriod: SubscriptionBillingPeriod | null;
  status: SubscriptionLifecycleStatus;
  accessMode: SubscriptionAccessMode;
  seatLimit: number | null;
  seatReservations: Record<string, SubscriptionSeatReservation>;
  purchaserUserId: string | null;
  sourceStore: 'app_store' | 'play_store' | 'test_store' | 'rc_billing' | null;
  willRenew: boolean;
  pendingPlanId: SubscriptionPlanId | null;
  pendingBillingPeriod: SubscriptionBillingPeriod | null;
  pendingPlanEffectiveAt: { toDate?: () => Date } | Date | string | null;
  currentPeriodEndsAt?: { toDate?: () => Date } | Date | string | null;
  gracePeriodExpiresAt?: { toDate?: () => Date } | Date | string | null;
  productIdentifier?: string | null;
  managementURL?: string | null;
  lastRevenueCatEventAtMs?: number;
  lastRevenueCatEventId?: string;
  purchaseIntent?: {
    purchaserUserId: string;
    planId: SubscriptionPlanId;
    billingPeriod: SubscriptionBillingPeriod;
    packageIdentifier: string;
    changeTiming: SubscriptionPlanChangeTiming;
    createdAtMs: number;
  };
};

export type SubscriptionPlan = {
  id: SubscriptionPlanId;
  name: string;
  description: string;
  rank: number;
  memberCap: number | null;
  monthlyCadCents: number | null;
  annualCadCents: number | null;
  storePurchasable: boolean;
  revenueCatOfferingId: string | null;
  revenueCatPackageIds: Partial<Record<SubscriptionBillingPeriod, string>>;
  appleProductIds: Partial<Record<SubscriptionBillingPeriod, string>>;
  googleProductId: string | null;
  googleBasePlanIds: Partial<Record<SubscriptionBillingPeriod, string>>;
};

export const SUBSCRIPTION_GROUP_ID = 'dispatch_organization_access';
export const SUBSCRIPTION_TRIAL_ISO_PERIOD = 'P1M';

export function defaultOrganizationBilling(): OrganizationBilling {
  return {
    schemaVersion: 1,
    planId: 'free',
    billingPeriod: null,
    status: 'free',
    accessMode: 'full',
    seatLimit: 5,
    seatReservations: {},
    purchaserUserId: null,
    sourceStore: null,
    willRenew: false,
    pendingPlanId: null,
    pendingBillingPeriod: null,
    pendingPlanEffectiveAt: null,
    currentPeriodEndsAt: null,
    gracePeriodExpiresAt: null,
    productIdentifier: null,
    managementURL: null,
  };
}

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'For trial teams and very small crews.',
    rank: 0,
    memberCap: 5,
    monthlyCadCents: 0,
    annualCadCents: 0,
    storePurchasable: false,
    revenueCatOfferingId: null,
    revenueCatPackageIds: {},
    appleProductIds: {},
    googleProductId: null,
    googleBasePlanIds: {},
  },
  {
    id: 'crew',
    name: 'Crew',
    description: 'For small venues and volunteer crews.',
    rank: 1,
    memberCap: 20,
    monthlyCadCents: 1_999,
    annualCadCents: 19_999,
    storePurchasable: true,
    revenueCatOfferingId: 'dispatch_organization_plans_v1',
    revenueCatPackageIds: { monthly: 'crew_monthly', annual: 'crew_annual' },
    appleProductIds: {
      monthly: 'dispatch_crew_20_monthly',
      annual: 'dispatch_crew_20_annual',
    },
    googleProductId: 'dispatch_crew_20',
    googleBasePlanIds: { monthly: 'monthly', annual: 'annual' },
  },
  {
    id: 'production',
    name: 'Production',
    description: 'For festivals and production companies.',
    rank: 2,
    memberCap: 50,
    monthlyCadCents: 3_999,
    annualCadCents: 39_999,
    storePurchasable: true,
    revenueCatOfferingId: 'dispatch_organization_plans_v1',
    revenueCatPackageIds: { monthly: 'production_monthly', annual: 'production_annual' },
    appleProductIds: {
      monthly: 'dispatch_production_50_monthly',
      annual: 'dispatch_production_50_annual',
    },
    googleProductId: 'dispatch_production_50',
    googleBasePlanIds: { monthly: 'monthly', annual: 'annual' },
  },
  {
    id: 'organization',
    name: 'Organization',
    description: 'For multi-team event operations.',
    rank: 3,
    memberCap: 100,
    monthlyCadCents: 7_999,
    annualCadCents: 79_999,
    storePurchasable: true,
    revenueCatOfferingId: 'dispatch_organization_plans_v1',
    revenueCatPackageIds: { monthly: 'organization_monthly', annual: 'organization_annual' },
    appleProductIds: {
      monthly: 'dispatch_organization_100_monthly',
      annual: 'dispatch_organization_100_annual',
    },
    googleProductId: 'dispatch_organization_100',
    googleBasePlanIds: { monthly: 'monthly', annual: 'annual' },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For organizations with more than 100 people.',
    rank: 4,
    memberCap: null,
    monthlyCadCents: null,
    annualCadCents: null,
    storePurchasable: false,
    revenueCatOfferingId: null,
    revenueCatPackageIds: {},
    appleProductIds: {},
    googleProductId: null,
    googleBasePlanIds: {},
  },
];

export function getSubscriptionPlan(planId: SubscriptionPlanId): SubscriptionPlan {
  const plan = SUBSCRIPTION_PLANS.find((candidate) => candidate.id === planId);
  if (!plan) throw new Error(`Unknown Dispatch subscription plan: ${planId}`);
  return plan;
}

export function formatCadPrice(cents: number | null): string {
  if (cents === null) return 'Custom';
  if (cents === 0) return '$0';
  return `$${(cents / 100).toFixed(2)}`;
}

export function getSubscriptionVerificationMessage(
  billing: Pick<OrganizationBilling, 'planId' | 'status' | 'accessMode'>
): string {
  if (isLivePaidSubscription(billing)) return `${getSubscriptionPlan(billing.planId).name} subscription verified.`;
  if (billing.planId === 'free' && billing.status === 'free') {
    return billing.accessMode === 'full'
      ? 'No active paid subscription remains. Free plan verified: 5 seats. Organization changes are available.'
      : 'No active paid subscription remains. Free plan verified: 5 seats. Reduce members and pending invitations to 5, or upgrade, to restore organization changes.';
  }
  return 'No active paid subscription was verified. Review the current plan and access status above.';
}

export function getSubscriptionPlanChange(
  currentPlanId: SubscriptionPlanId,
  nextPlanId: SubscriptionPlanId,
  currentBillingPeriod?: SubscriptionBillingPeriod | null,
  nextBillingPeriod?: SubscriptionBillingPeriod | null,
  currentStatus: SubscriptionLifecycleStatus = currentPlanId === 'free' ? 'free' : 'active'
): SubscriptionPlanChangeTiming {
  const livePaidSubscription = currentPlanId !== 'free'
    && ['trialing', 'active', 'grace'].includes(currentStatus);
  if (!livePaidSubscription && nextPlanId !== 'free') {
    return nextPlanId === 'enterprise' ? 'contact_sales' : 'immediate';
  }
  if (currentPlanId === nextPlanId) {
    return currentBillingPeriod
      && nextBillingPeriod
      && currentBillingPeriod !== nextBillingPeriod
      ? 'next_renewal'
      : 'none';
  }

  const currentPlan = getSubscriptionPlan(currentPlanId);
  const nextPlan = getSubscriptionPlan(nextPlanId);
  if (!nextPlan.storePurchasable && nextPlan.id === 'enterprise') return 'contact_sales';
  return nextPlan.rank > currentPlan.rank ? 'immediate' : 'next_renewal';
}

export function isLivePaidSubscription(billing: Pick<OrganizationBilling, 'planId' | 'status'>) {
  return billing.planId !== 'free' && ['trialing', 'active', 'grace'].includes(billing.status);
}

export function assertSubscriptionUpgradeVerified(params: {
  billing: Pick<OrganizationBilling, 'planId' | 'billingPeriod' | 'status'>;
  planId: 'crew' | 'production' | 'organization';
  billingPeriod: SubscriptionBillingPeriod;
}) {
  if (
    params.billing.planId === params.planId
    && params.billing.billingPeriod === params.billingPeriod
    && isLivePaidSubscription(params.billing)
  ) return;

  const plan = getSubscriptionPlan(params.planId);
  throw new Error(
    `Checkout finished, but the ${plan.name} ${params.billingPeriod} subscription is not yet verified. Tap Verify current subscription to retry.`
  );
}

export function getSubscriptionAccessMode(params: {
  planId: SubscriptionPlanId;
  status: SubscriptionLifecycleStatus;
  seatUsage: number;
}): SubscriptionAccessMode {
  const memberCap = getSubscriptionPlan(params.planId).memberCap;
  const capacityFits = memberCap === null || params.seatUsage <= memberCap;
  if (params.status === 'trialing' || params.status === 'active' || params.status === 'grace') {
    return capacityFits ? 'full' : 'read_only';
  }

  if (params.status === 'free') {
    const freeCap = getSubscriptionPlan('free').memberCap ?? 0;
    return params.seatUsage <= freeCap ? 'full' : 'read_only';
  }

  return 'read_only';
}

export function evaluateSubscriptionCapacity(planId: SubscriptionPlanId, seatUsage: number) {
  const normalizedSeatUsage = Math.max(0, Math.floor(seatUsage));
  const memberCap = getSubscriptionPlan(planId).memberCap;
  if (memberCap === null) {
    return {
      memberCap,
      seatUsage: normalizedSeatUsage,
      remainingSeats: null,
      isAtLimit: false,
      isOverLimit: false,
      canReserveSeat: true,
    } as const;
  }

  return {
    memberCap,
    seatUsage: normalizedSeatUsage,
    remainingSeats: Math.max(0, memberCap - normalizedSeatUsage),
    isAtLimit: normalizedSeatUsage === memberCap,
    isOverLimit: normalizedSeatUsage > memberCap,
    canReserveSeat: normalizedSeatUsage < memberCap,
  } as const;
}

export function activeSubscriptionSeatReservations(
  reservations: OrganizationBilling['seatReservations'],
  nowMs = Date.now()
) {
  return Object.fromEntries(
    Object.entries(reservations || {}).filter(([, reservation]) => reservation.expiresAtMs > nowMs)
  );
}

export function getOrganizationSeatUsage(params: {
  managerIds: string[];
  workerIds?: string[];
  billing?: OrganizationBilling | null;
  nowMs?: number;
}) {
  const billing = params.billing || defaultOrganizationBilling();
  const acceptedMemberIds = [...new Set([
    ...(params.managerIds || []),
    ...(params.workerIds || []),
  ].filter(Boolean))];
  const reservations = activeSubscriptionSeatReservations(
    billing.seatReservations,
    params.nowMs
  );
  const acceptedSeats = acceptedMemberIds.length;
  const reservedSeats = Object.keys(reservations).length;
  const seatUsage = acceptedSeats + reservedSeats;
  const currentCap = getSubscriptionPlan(billing.planId).memberCap;
  const pendingCap = billing.pendingPlanId
    ? getSubscriptionPlan(billing.pendingPlanId).memberCap
    : null;
  const memberCap = pendingCap === null
    ? currentCap
    : currentCap === null
      ? pendingCap
      : Math.min(currentCap, pendingCap);
  const capacity = memberCap === null
    ? {
        memberCap,
        seatUsage,
        remainingSeats: null,
        isAtLimit: false,
        isOverLimit: false,
        canReserveSeat: true,
      }
    : {
        memberCap,
        seatUsage,
        remainingSeats: Math.max(0, memberCap - seatUsage),
        isAtLimit: seatUsage === memberCap,
        isOverLimit: seatUsage > memberCap,
        canReserveSeat: seatUsage < memberCap,
      };
  return { acceptedMemberIds, acceptedSeats, reservedSeats, reservations, ...capacity };
}

export function canDowngradeToPlan(nextPlanId: SubscriptionPlanId, seatUsage: number) {
  const nextPlan = getSubscriptionPlan(nextPlanId);
  return nextPlan.memberCap === null || seatUsage <= nextPlan.memberCap;
}

export function getAnnualSavingsPercent(planId: SubscriptionPlanId) {
  const plan = getSubscriptionPlan(planId);
  if (!plan.monthlyCadCents || !plan.annualCadCents) return 0;
  const monthlyAnnualized = plan.monthlyCadCents * 12;
  return Math.round((1 - plan.annualCadCents / monthlyAnnualized) * 1_000) / 10;
}
