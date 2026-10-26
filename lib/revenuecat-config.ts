export type RevenueCatRuntime = 'expo_go' | 'ios' | 'android' | 'web' | 'unsupported';

export type RevenueCatPublicKeys = {
  test?: string;
  apple?: string;
  google?: string;
  web?: string;
};

export type RevenueCatConfiguration =
  | {
      configured: true;
      runtime: RevenueCatRuntime;
      apiKey: string;
      preview: boolean;
    }
  | {
      configured: false;
      runtime: RevenueCatRuntime;
      preview: boolean;
      reason: 'missing_key' | 'invalid_key' | 'unsupported_platform' | 'test_key_in_release' | 'test_store_requires_emulators' | 'customer_beta_disabled';
      message: string;
    };

const EXPECTED_KEY_PREFIX: Partial<Record<RevenueCatRuntime, string>> = {
  expo_go: 'test_',
  ios: 'appl_',
  android: 'goog_',
  web: 'rcb_',
};

function clean(value?: string) {
  return value?.trim() || undefined;
}

export function selectRevenueCatConfiguration(params: {
  runtime: RevenueCatRuntime;
  keys: RevenueCatPublicKeys;
  isDevelopment: boolean;
  testStoreAllowed: boolean;
}): RevenueCatConfiguration {
  const preview = params.runtime === 'expo_go';
  const apiKey = clean(
    params.runtime === 'expo_go' ? params.keys.test
      : params.runtime === 'ios' ? params.keys.apple
        : params.runtime === 'android' ? params.keys.google
          : params.runtime === 'web' ? params.keys.web
            : undefined
  );
  const prefix = EXPECTED_KEY_PREFIX[params.runtime];

  if (!prefix) {
    return {
      configured: false,
      runtime: params.runtime,
      preview,
      reason: 'unsupported_platform',
      message: 'RevenueCat is unavailable on this platform.',
    };
  }
  if (!apiKey) {
    return {
      configured: false,
      runtime: params.runtime,
      preview,
      reason: 'missing_key',
      message: preview
        ? 'RevenueCat Test Store is not configured. Add EXPO_PUBLIC_REVENUECAT_TEST_API_KEY to simulate purchases in Expo Go.'
        : 'RevenueCat is not configured for this platform.',
    };
  }
  if (!params.isDevelopment && apiKey.startsWith('test_')) {
    return {
      configured: false,
      runtime: params.runtime,
      preview,
      reason: 'test_key_in_release',
      message: 'A RevenueCat Test Store key cannot be used in a release build.',
    };
  }
  if (!apiKey.startsWith(prefix) || apiKey.startsWith('sk_')) {
    return {
      configured: false,
      runtime: params.runtime,
      preview,
      reason: 'invalid_key',
      message: preview
        ? 'Expo Go requires a RevenueCat Test Store public key beginning with test_.'
        : `RevenueCat requires a public SDK key beginning with ${prefix} on this platform.`,
    };
  }
  if (preview && !params.testStoreAllowed) {
    return {
      configured: false,
      runtime: params.runtime,
      preview,
      reason: 'test_store_requires_emulators',
      message: 'RevenueCat Test Store is locked until the isolated demo-project Firebase emulators are enabled.',
    };
  }

  return { configured: true, runtime: params.runtime, apiKey, preview };
}
