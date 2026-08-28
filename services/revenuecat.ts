import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Linking, Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';
import {
  selectRevenueCatConfiguration,
  type RevenueCatConfiguration,
  type RevenueCatRuntime,
} from '@/lib/revenuecat-config';
import { firebaseEmulatorConfiguration } from '@/lib/firebase';
import {
  SUBSCRIPTION_PLANS,
  type SubscriptionBillingPeriod,
  type SubscriptionPlanChangeTiming,
  type SubscriptionPlanId,
} from '@/lib/subscriptions';

export const REVENUECAT_ENTITLEMENT_ID = 'organization_access';
export const REVENUECAT_OFFERING_ID = 'dispatch_organization_plans_v1';
export type RevenueCatPurchaseStore = 'app_store' | 'play_store' | 'test_store';

export type DispatchRevenueCatPackage = {
  planId: Exclude<SubscriptionPlanId, 'free' | 'enterprise'>;
  billingPeriod: SubscriptionBillingPeriod;
  packageIdentifier: string;
  revenueCatPackage: PurchasesPackage;
};

let revenueCatOperationTail: Promise<void> = Promise.resolve();
const blockedRevenueCatUserIds = new Set<string>();

function serializeRevenueCatOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = revenueCatOperationTail.then(operation, operation);
  revenueCatOperationTail = result.then(() => undefined, () => undefined);
  return result;
}

function assertRevenueCatIdentityAllowed(firebaseUid: string) {
  if (blockedRevenueCatUserIds.has(firebaseUid)) {
    throw new Error('RevenueCat access is locked while this Dispatch account is being deleted.');
  }
}

function runtime(): RevenueCatRuntime {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return 'expo_go';
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web') return 'web';
  return 'unsupported';
}

export function getRevenueCatPurchaseStore(): RevenueCatPurchaseStore | null {
  const currentRuntime = runtime();
  if (currentRuntime === 'expo_go') return 'test_store';
  if (currentRuntime === 'ios') return 'app_store';
  if (currentRuntime === 'android') return 'play_store';
  return null;
}

export function getRevenueCatConfiguration(): RevenueCatConfiguration {
  return selectRevenueCatConfiguration({
    runtime: runtime(),
    keys: {
      test: process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY,
      apple: process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY,
      google: process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY,
      web: process.env.EXPO_PUBLIC_REVENUECAT_WEB_API_KEY,
    },
    isDevelopment: __DEV__,
    testStoreAllowed: firebaseEmulatorConfiguration.enabled,
  });
}

async function identifyRevenueCatUserUnlocked(firebaseUid: string) {
  const configuration = getRevenueCatConfiguration();
  if (!configuration.configured) return { ...configuration, customerInfo: null };

  assertRevenueCatIdentityAllowed(firebaseUid);
  await Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO);
  if (!(await Purchases.isConfigured())) {
    assertRevenueCatIdentityAllowed(firebaseUid);
    Purchases.configure({ apiKey: configuration.apiKey, appUserID: firebaseUid });
  } else if ((await Purchases.getAppUserID()) !== firebaseUid) {
    assertRevenueCatIdentityAllowed(firebaseUid);
    await Purchases.logIn(firebaseUid);
  }

  const customerInfo = await Purchases.getCustomerInfo();
  return { ...configuration, customerInfo };
}

export async function identifyRevenueCatUser(firebaseUid: string) {
  return serializeRevenueCatOperation(() => identifyRevenueCatUserUnlocked(firebaseUid));
}

export async function logOutDispatchRevenueCatUser(expectedFirebaseUid?: string) {
  if (expectedFirebaseUid) blockedRevenueCatUserIds.add(expectedFirebaseUid);
  return serializeRevenueCatOperation(async () => {
    const configuration = getRevenueCatConfiguration();
    if (!configuration.configured || !(await Purchases.isConfigured())) return false;
    const currentAppUserId = await Purchases.getAppUserID();
    if (expectedFirebaseUid && currentAppUserId !== expectedFirebaseUid) return true;
    await Purchases.logOut();
    const anonymousAppUserId = await Purchases.getAppUserID();
    if (expectedFirebaseUid && anonymousAppUserId === expectedFirebaseUid) {
      throw new Error('RevenueCat did not release this account identity. Account deletion was not started; try again.');
    }
    return true;
  });
}

async function loadDispatchRevenueCatOfferingUnlocked(firebaseUid: string) {
  const identity = await identifyRevenueCatUserUnlocked(firebaseUid);
  if (!identity.configured) return { identity, offering: null, packages: [] as DispatchRevenueCatPackage[] };

  const offerings = await Purchases.getOfferings();
  const offering = offerings.all[REVENUECAT_OFFERING_ID] || null;
  const packages = offering ? mapOfferingPackages(offering) : [];
  return { identity, offering, packages };
}

export async function loadDispatchRevenueCatOffering(firebaseUid: string) {
  return serializeRevenueCatOperation(() => loadDispatchRevenueCatOfferingUnlocked(firebaseUid));
}

function mapOfferingPackages(offering: PurchasesOffering) {
  const planPackages = SUBSCRIPTION_PLANS.flatMap((plan) => {
    if (plan.id === 'free' || plan.id === 'enterprise') return [];
    return (['monthly', 'annual'] as const).map((billingPeriod) => ({
      planId: plan.id as DispatchRevenueCatPackage['planId'],
      billingPeriod,
      packageIdentifier: plan.revenueCatPackageIds[billingPeriod],
    }));
  });

  return planPackages.flatMap((definition) => {
    const packageIdentifier = definition.packageIdentifier;
    if (!packageIdentifier) return [];
    const revenueCatPackage = offering.availablePackages.find(
      (candidate) => candidate.identifier === packageIdentifier
    );
    return revenueCatPackage
      ? [{ ...definition, packageIdentifier, revenueCatPackage } satisfies DispatchRevenueCatPackage]
      : [];
  });
}

export async function purchaseDispatchRevenueCatPackage(params: {
  firebaseUid: string;
  billingManagerId: string;
  packageIdentifier: string;
  changeTiming: SubscriptionPlanChangeTiming;
  currentProductIdentifier?: string | null;
  currentSourceStore?: RevenueCatPurchaseStore | null;
}) {
  return serializeRevenueCatOperation(async () => {
    if (params.firebaseUid !== params.billingManagerId) {
      throw new Error('Only the organization Billing Manager can purchase or change a plan.');
    }
    const { identity, packages } = await loadDispatchRevenueCatOfferingUnlocked(params.firebaseUid);
    if (!identity.configured) throw new Error(identity.message);
    const selectedPackage = packages.find((item) => item.packageIdentifier === params.packageIdentifier);
    if (!selectedPackage) throw new Error('This subscription option is unavailable in the current RevenueCat offering.');

    if (
      params.currentProductIdentifier
      && params.currentSourceStore
      && params.currentSourceStore !== getRevenueCatPurchaseStore()
    ) {
      throw new Error('Plan changes must be completed on the original Apple or Google store account and device.');
    }
    const productChangeInfo = Platform.OS === 'android'
      && params.currentSourceStore === 'play_store'
      && params.currentProductIdentifier
      ? {
          oldProductIdentifier: params.currentProductIdentifier.split(':')[0],
          replacementMode: params.changeTiming === 'immediate'
            ? Purchases.STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE
            : Purchases.STORE_REPLACEMENT_MODE.DEFERRED,
        }
      : null;
    return Purchases.purchasePackage(selectedPackage.revenueCatPackage, null, productChangeInfo);
  });
}

export async function restoreDispatchPurchases(params: {
  firebaseUid: string;
  billingManagerId: string;
}) {
  return serializeRevenueCatOperation(async () => {
    if (params.firebaseUid !== params.billingManagerId) {
      throw new Error('Only the organization Billing Manager can restore purchases.');
    }
    const identity = await identifyRevenueCatUserUnlocked(params.firebaseUid);
    if (!identity.configured) throw new Error(identity.message);
    return Purchases.restorePurchases();
  });
}

export async function openDispatchSubscriptionManagement(verifiedManagementURL?: string | null) {
  return serializeRevenueCatOperation(async () => {
    const configuration = getRevenueCatConfiguration();
    if (!verifiedManagementURL && !configuration.configured) {
      throw new Error('Store subscription management is unavailable until RevenueCat is configured. Expo Go can use only a Test Store Preview API key.');
    }
    const managementURL = verifiedManagementURL || (await Purchases.getCustomerInfo()).managementURL;
    if (!managementURL) {
      throw new Error('Store subscription management is unavailable in Expo Go. Use a native billing build when that phase is approved.');
    }
    await Linking.openURL(managementURL);
  });
}

export function revenueCatErrorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'userCancelled' in error && error.userCancelled) {
    return 'Purchase cancelled. No verified plan change was applied.';
  }
  return error instanceof Error ? error.message : 'RevenueCat could not complete this request.';
}
