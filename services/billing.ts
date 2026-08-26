import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { defaultOrganizationBilling, type OrganizationBilling } from '@/lib/subscriptions';

export type TransferBillingManagerResult = {
  organizationId: string;
  previousBillingManagerId: string;
  billingManagerId: string;
};

export type SubscriptionChangePreflight = {
  organizationId: string;
  planId: 'crew' | 'production' | 'organization';
  billingPeriod: 'monthly' | 'annual';
  packageIdentifier: string;
  changeTiming: 'immediate' | 'next_renewal';
  currentProductIdentifier: string | null;
  currentSourceStore: 'app_store' | 'play_store' | 'test_store' | null;
};

export type RefreshedOrganizationBilling = {
  planId: string;
  billingPeriod: 'monthly' | 'annual' | null;
  status: string;
  accessMode: string;
  seatLimit: number | null;
  purchaserUserId: string | null;
  sourceStore: string | null;
  productIdentifier: string | null;
  willRenew: boolean;
  currentPeriodEndsAt: string | null;
  gracePeriodExpiresAt: string | null;
  pendingPlanId: string | null;
  pendingBillingPeriod: string | null;
  pendingPlanEffectiveAt: string | null;
  managementURL: string | null;
};

function getDispatchFunctions() {
  return getFunctions(undefined, 'us-central1');
}

export async function transferOrganizationBillingManager(targetManagerId: string) {
  const callable = httpsCallable<
    { targetManagerId: string },
    TransferBillingManagerResult
  >(getDispatchFunctions(), 'transferOrganizationBillingManager');
  const result = await callable({ targetManagerId });
  return result.data;
}

export async function prepareOrganizationSubscriptionChange(params: {
  planId: SubscriptionChangePreflight['planId'];
  billingPeriod: SubscriptionChangePreflight['billingPeriod'];
  purchaseStore: 'app_store' | 'play_store' | 'test_store';
}) {
  const callable = httpsCallable<typeof params, SubscriptionChangePreflight>(
    getDispatchFunctions(),
    'prepareOrganizationSubscriptionChange'
  );
  const result = await callable(params);
  return result.data;
}

export async function refreshOrganizationSubscription() {
  const callable = httpsCallable<Record<string, never>, RefreshedOrganizationBilling>(
    getDispatchFunctions(),
    'refreshOrganizationSubscription'
  );
  const result = await callable({});
  return result.data;
}

export async function prepareOrganizationSubscriptionRestore() {
  const callable = httpsCallable<Record<string, never>, { organizationId: string; restorePrepared: true }>(
    getDispatchFunctions(),
    'prepareOrganizationSubscriptionRestore'
  );
  const result = await callable({});
  return result.data;
}

export async function initializeOrganizationBilling() {
  const callable = httpsCallable<Record<string, never>, RefreshedOrganizationBilling>(
    getDispatchFunctions(),
    'initializeOrganizationBilling'
  );
  const result = await callable({});
  return result.data;
}

export async function removeOrganizationMember(targetUserId: string) {
  const callable = httpsCallable<
    { targetUserId: string },
    { removed: true; organizationId: string; targetUserId: string; targetRole: 'manager' | 'worker' }
  >(getDispatchFunctions(), 'removeOrganizationMember');
  const result = await callable({ targetUserId });
  return result.data;
}

export function watchOrganizationBilling(
  organizationId: string,
  onChange: (billing: OrganizationBilling) => void,
  onError?: (error: Error) => void
) {
  return onSnapshot(
    doc(db, 'organizationBilling', organizationId),
    (snapshot) => {
      onChange(snapshot.exists()
        ? { ...defaultOrganizationBilling(), ...snapshot.data() } as OrganizationBilling
        : defaultOrganizationBilling());
    },
    (error) => onError?.(error)
  );
}

export function billingErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message
    .replace(/^Firebase:\s*/i, '')
    .replace(/^FunctionsError:\s*/i, '')
    .replace(/^\[[^\]]+\]\s*/i, '')
    || 'Unable to update organization billing. Please try again.';
}
