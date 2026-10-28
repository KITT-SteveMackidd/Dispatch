import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertStoreBetaConfiguration, getStoreBetaMode, getStoreBetaPolicyErrors } from '../config/store-beta-policy';

const eas = JSON.parse(readFileSync('eas.json', 'utf8'));
const iosProfile = eas.build['ios-customer-beta'];
const iosCandidate = { buildProfile: 'ios-customer-beta', platform: 'ios', env: iosProfile.env };

describe('customer beta across native platforms', () => {
  it('uses separate store profiles with the same payment-free existing backend', () => {
    expect(iosProfile).toMatchObject({ distribution: 'store', channel: 'ios-customer-beta', environment: 'preview', autoIncrement: true, ios: { image: 'sdk-58' } });
    expect(iosProfile.android).toBeUndefined();
    expect(iosProfile.ios.simulator).not.toBe(true);
    const { DISPATCH_GOOGLE_PLAY_SIGNING_SHA1, DISPATCH_GOOGLE_PLAY_ADDITIONAL_SHA1S, ...androidEnv } = eas.build['android-customer-beta'].env;
    expect(iosProfile.env).toEqual({
      ...androidEnv,
      EXPO_PUBLIC_EAS_BUILD_PROFILE: 'ios-customer-beta',
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'disabled',
      EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: 'disabled',
    });
    expect(DISPATCH_GOOGLE_PLAY_SIGNING_SHA1).toMatch(/^([A-F0-9]{2}:){19}[A-F0-9]{2}$/);
    expect(DISPATCH_GOOGLE_PLAY_ADDITIONAL_SHA1S.split(',')).toHaveLength(2);
    expect(eas.submit['ios-customer-beta']).toEqual({ ios: { ascAppId: '6799206233' } });
    expect(getStoreBetaMode('ios-customer-beta')).toBe('customer_beta');
    expect(getStoreBetaMode('beta')).toBe('standard');
  });

  it.each(['ios', undefined])('resolves the iOS profile before and after platform selection (%s)', platform => {
    expect(getStoreBetaPolicyErrors({ ...iosCandidate, platform })).toEqual([]);
    expect(() => assertStoreBetaConfiguration({ ...iosCandidate, platform, androidGoogleServicesFile: 'absent-android-config.json' })).not.toThrow();
  });

  it('rejects using either customer profile for the other platform', () => {
    expect(getStoreBetaPolicyErrors({ ...iosCandidate, platform: 'android', androidGoogleServicesProjectId: 'dispatch-eb63a' })).toContain('ios-customer-beta supports ios only.');
    expect(getStoreBetaPolicyErrors({ ...iosCandidate, buildProfile: 'android-customer-beta' })).toContain('android-customer-beta supports android only.');
  });

  it.each([
    ['EXPO_PUBLIC_REVENUECAT_TEST_API_KEY', 'test_fixture'],
    ['EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY', 'appl_fixture'],
    ['EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY', 'goog_fixture'],
    ['EXPO_PUBLIC_USE_FIREBASE_EMULATORS', 'true'],
    ['EXPO_PUBLIC_FIREBASE_EMULATOR_HOST', '192.168.1.45'],
    ['EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'demo-dispatch-billing'],
    ['EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'dispatch-customer-beta'],
    ['EXPO_NO_DOTENV', ''],
  ])('fails closed for inherited unsafe iOS setting %s=%s', (key, value) => {
    expect(getStoreBetaPolicyErrors({ ...iosCandidate, env: { ...iosProfile.env, [key]: value } })).not.toEqual([]);
  });

  it('checks the native iOS OAuth client rather than the Android client', () => {
    const enabled = { ...iosProfile.env, EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '123-web.apps.googleusercontent.com', EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '123-ios.apps.googleusercontent.com' };
    expect(getStoreBetaPolicyErrors({ ...iosCandidate, env: enabled })).toEqual([]);
    expect(getStoreBetaPolicyErrors({ ...iosCandidate, env: { ...enabled, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'disabled' } })).toContain('iOS Google sign-in requires both matching-project Web and iOS OAuth client IDs, or disabled for both.');
  });

  it('resolves the actual iOS manifest without OTA, native payments or a second Expo project', () => {
    const env = { ...process.env, ...iosProfile.env, EAS_BUILD_PROFILE: 'ios-customer-beta', EAS_BUILD_PLATFORM: 'ios', GOOGLE_SERVICES_JSON: 'absent-android-config.json' };
    const script = "const base=require('./app.json').expo;const c=require('./app.config.js')({config:base});console.log(JSON.stringify({name:c.name,mode:c.extra.dispatchBetaMode,backend:c.extra.dispatchBetaBackend,updates:c.updates,projectId:c.extra.eas.projectId,slug:c.slug,ios:c.ios}));";
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' }));
    expect(result).toMatchObject({ name: 'Dispatch Customer Beta', mode: 'customer_beta', backend: 'existing_dispatch', updates: { enabled: false }, projectId: '7d0f7257-64f9-443f-ba27-a75af5fbafaa', slug: 'dispatch', ios: { bundleIdentifier: 'com.smackidd.dispatch', runtimeVersion: 'dispatch-sdk58-rn088-billing-v1', usesAppleSignIn: true } });
    expect(result.updates.url).toBeUndefined();
    expect(result.ios.associatedDomains).toContain('applinks:dispatchcrewmanager.com');
  });
});
