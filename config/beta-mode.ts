import Constants from 'expo-constants';

export type DispatchBetaMode = 'standard' | 'customer_beta' | 'billing_qa';

/** Presentation only: complimentary access is authorized by the hosted backend. */
export function getDispatchBetaMode(): DispatchBetaMode {
  const mode = Constants.expoConfig?.extra?.dispatchBetaMode;
  return mode === 'customer_beta' || mode === 'billing_qa' ? mode : 'standard';
}

export function isCustomerBeta(): boolean {
  return getDispatchBetaMode() === 'customer_beta';
}

/** Existing Dispatch backend uses its deployed pre-subscription workflows. */
export function isExistingDispatchCustomerBeta(): boolean {
  return isCustomerBeta() && Constants.expoConfig?.extra?.dispatchBetaBackend === 'existing_dispatch';
}

