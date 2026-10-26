/** "disabled" is an explicit EAS override; empty env values are invalid in eas.json. */
export function optionalGoogleClientId(value?: string): string | undefined {
  const clientId = value?.trim();
  return clientId && /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) ? clientId : undefined;
}

export function optionalGoogleApiKey(value?: string): string | undefined {
  const key = value?.trim();
  return key && /^AIza[A-Za-z0-9_-]{35}$/.test(key) ? key : undefined;
}
