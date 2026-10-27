/** "disabled" is an explicit EAS override; empty env values are invalid in eas.json. */
export function optionalGoogleClientId(value?: string): string | undefined {
  const clientId = value?.trim();
  return clientId && /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) ? clientId : undefined;
}

export function optionalGoogleApiKey(value?: string): string | undefined {
  const key = value?.trim();
  return key && /^AIza[A-Za-z0-9_-]{35}$/.test(key) ? key : undefined;
}

/** This SDK uses a Web client ID for Firebase ID tokens, including on Android. */
export function nativeGoogleSignInBlocker(config: {
  platform: string;
  isExpoGo: boolean;
  webClientId?: string;
  iosClientId?: string;
}): 'expo-go' | 'configuration' | 'unsupported-platform' | null {
  if (config.platform !== 'android' && config.platform !== 'ios') return 'unsupported-platform';
  if (config.isExpoGo) return 'expo-go';
  if (!optionalGoogleClientId(config.webClientId)) return 'configuration';
  if (config.platform === 'ios' && !optionalGoogleClientId(config.iosClientId)) return 'configuration';
  return null;
}
