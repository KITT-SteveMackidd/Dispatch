import { describe, expect, it } from 'vitest';
import { optionalGoogleApiKey, optionalGoogleClientId } from '../lib/optional-google-config';

describe('explicitly disabled optional Google integrations', () => {
  it.each([undefined, '', 'disabled', '  disabled  ', 'CONFIGURE_AFTER_PROVISIONING'])('does not activate integrations for %s', value => {
    expect(optionalGoogleClientId(value)).toBeUndefined();
    expect(optionalGoogleApiKey(value)).toBeUndefined();
  });
  it('preserves configured OAuth and API keys', () => {
    expect(optionalGoogleClientId(' 123456789-example.apps.googleusercontent.com ')).toBe('123456789-example.apps.googleusercontent.com');
    const key = `AIza${'B'.repeat(35)}`;
    expect(optionalGoogleApiKey(key)).toBe(key);
  });
});
