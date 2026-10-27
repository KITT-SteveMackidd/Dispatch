import { describe, expect, it } from 'vitest';
import { nativeGoogleSignInBlocker, optionalGoogleApiKey, optionalGoogleClientId } from '../lib/optional-google-config';

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

describe('native Google sign-in readiness', () => {
  const webClientId = '123456789-web.apps.googleusercontent.com';
  const iosClientId = '123456789-ios.apps.googleusercontent.com';

  it.each(['ios', 'android'])('keeps the native SDK out of Expo Go on %s', platform => {
    expect(nativeGoogleSignInBlocker({ platform, isExpoGo: true, webClientId, iosClientId })).toBe('expo-go');
  });
  it.each(['ios', 'android'])('explains explicitly disabled beta configuration on %s', platform => {
    expect(nativeGoogleSignInBlocker({ platform, isExpoGo: false, webClientId: 'disabled', iosClientId: 'disabled' })).toBe('configuration');
  });
  it('uses the Web client ID for Android ID tokens', () => {
    expect(nativeGoogleSignInBlocker({ platform: 'android', isExpoGo: false, webClientId })).toBeNull();
  });
  it('requires both Web and iOS client IDs on iOS', () => {
    expect(nativeGoogleSignInBlocker({ platform: 'ios', isExpoGo: false, webClientId })).toBe('configuration');
    expect(nativeGoogleSignInBlocker({ platform: 'ios', isExpoGo: false, webClientId, iosClientId })).toBeNull();
  });
  it('never attempts the native module in a web browser', () => {
    expect(nativeGoogleSignInBlocker({ platform: 'web', isExpoGo: false, webClientId })).toBe('unsupported-platform');
  });
});
