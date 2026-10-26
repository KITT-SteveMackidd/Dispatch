import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, firebaseEmulatorConfiguration, functions } from '@/lib/firebase';
import { defaultOrganizationBilling, type OrganizationBilling } from '@/lib/subscriptions';
import { isCustomerBeta } from '@/config/beta-mode';

export const CUSTOMER_BETA_BILLING_DISABLED_MESSAGE = 'Subscriptions are disabled during the complimentary customer beta.';

function assertBillingLifecycleEnabled() {
  if (isCustomerBeta()) throw new Error(CUSTOMER_BETA_BILLING_DISABLED_MESSAGE);
}

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
  currentSourceStore: OrganizationBilling['sourceStore'];
};

export type RefreshedOrganizationBilling = {
  planId: OrganizationBilling['planId'];
  billingPeriod: 'monthly' | 'annual' | null;
  status: OrganizationBilling['status'];
  accessMode: OrganizationBilling['accessMode'];
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

export type SubscriptionPurchaseStore = 'app_store' | 'play_store' | 'test_store';

function assertRevenueCatStoreIsolation(purchaseStore: SubscriptionPurchaseStore) {
  assertBillingLifecycleEnabled();
  if (purchaseStore === 'test_store' && !firebaseEmulatorConfiguration.enabled) {
    throw new Error('RevenueCat Test Store billing is restricted to the isolated local Firebase emulator environment.');
  }
}

export async function transferOrganizationBillingManager(targetManagerId: string) {
  assertBillingLifecycleEnabled();
  const callable = httpsCallable<
    { targetManagerId: string },
    TransferBillingManagerResult
  >(functions, 'transferOrganizationBillingManager');
  const result = await callable({ targetManagerId });
  return result.data;
}

export async function prepareOrganizationSubscriptionChange(params: {
  planId: SubscriptionChangePreflight['planId'];
  billingPeriod: SubscriptionChangePreflight['billingPeriod'];
  purchaseStore: SubscriptionPurchaseStore;
}) {
  assertRevenueCatStoreIsolation(params.purchaseStore);
  const callable = httpsCallable<typeof params, SubscriptionChangePreflight>(
    functions,
    'prepareOrganizationSubscriptionChange'
  );
  const result = await callable(params);
  return result.data;
}

export async function refreshOrganizationSubscription(purchaseStore: SubscriptionPurchaseStore) {
  assertRevenueCatStoreIsolation(purchaseStore);
  const callable = httpsCallable<{ purchaseStore: SubscriptionPurchaseStore }, RefreshedOrganizationBilling>(
    functions,
    'refreshOrganizationSubscription'
  );
  const result = await callable({ purchaseStore });
  return result.data;
}

export async function prepareOrganizationSubscriptionRestore(purchaseStore: SubscriptionPurchaseStore) {
  assertRevenueCatStoreIsolation(purchaseStore);
  const callable = httpsCallable<{ purchaseStore: SubscriptionPurchaseStore }, { organizationId: string; restorePrepared: true }>(
    functions,
    'prepareOrganizationSubscriptionRestore'
  );
  const result = await callable({ purchaseStore });
  return result.data;
}

export async function initializeOrganizationBilling() {
  assertBillingLifecycleEnabled();
  const callable = httpsCallable<Record<string, never>, RefreshedOrganizationBilling>(
    functions,
    'initializeOrganizationBilling'
  );
  const result = await callable({});
  return result.data;
}

export async function removeOrganizationMember(targetUserId: string) {
  const callable = httpsCallable<
    { targetUserId: string },
    { removed: true; organizationId: string; targetUserId: string; targetRole: 'manager' | 'worker' }
  >(functions, 'removeOrganizationMember');
  const result = await callable({ targetUserId });
  return result.data;
}

export function watchOrganizationBilling(
  organizationId: string,
  onChange: (billing: OrganizationBilling) => void,
  onError?: (error: Error) => void
) {
  assertBillingLifecycleEnabled();
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
