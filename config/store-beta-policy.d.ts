export type StoreBetaPolicyOptions = {
  buildProfile?: string;
  platform?: string;
  env?: Record<string, string | undefined>;
  androidGoogleServicesProjectId?: string;
};

/** Checks consistency, not API-key ownership; verify the complete config with the provisioned Firebase beta Web app. */
export function getStoreBetaPolicyErrors(options?: StoreBetaPolicyOptions): string[];
export function getStoreBetaMode(buildProfile?: string): 'standard' | 'customer_beta' | 'billing_qa';
export function assertStoreBetaConfiguration(options?: Omit<StoreBetaPolicyOptions, 'androidGoogleServicesProjectId'> & {
  projectRoot?: string;
  androidGoogleServicesFile?: string;
}): void;
