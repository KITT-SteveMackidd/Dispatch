import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertStoreBetaConfiguration, getStoreBetaPolicyErrors } from '../config/store-beta-policy';

const isolatedEnv = {
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'dispatch-beta-fixture',
  EXPO_PUBLIC_FIREBASE_API_KEY: `AIza${'B'.repeat(35)}`,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'dispatch-beta-fixture.firebaseapp.com',
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'dispatch-beta-fixture.firebasestorage.app',
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
  EXPO_PUBLIC_FIREBASE_APP_ID: '1:123456789012:web:abcdef1234567890',
  EXPO_PUBLIC_USE_FIREBASE_EMULATORS: 'false',
  EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: 'appl_fixture',
  EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: 'goog_fixture',
};
const valid = {
  buildProfile: 'beta',
  env: isolatedEnv,
  androidGoogleServicesProjectId: 'dispatch-beta-fixture',
};

describe('store beta isolation policy', () => {
  it('accepts an isolated hosted beta configuration for both native stores', () => {
    expect(getStoreBetaPolicyErrors(valid)).toEqual([]);
  });

  it.each(['', 'demo-dispatch-billing', 'dispatch-eb63a'])('rejects unsafe Firebase project %s', (projectId) => {
    expect(getStoreBetaPolicyErrors({ ...valid, env: { ...isolatedEnv, EXPO_PUBLIC_FIREBASE_PROJECT_ID: projectId } })).not.toEqual([]);
  });

  it('rejects the current Expo Go harness configuration for a store beta', () => {
    const errors = getStoreBetaPolicyErrors({
      buildProfile: 'beta',
      env: {
        EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-dispatch-billing',
        EXPO_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
        EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: '192.168.1.45',
        EXPO_PUBLIC_REVENUECAT_TEST_API_KEY: 'test_fixture',
      },
      androidGoogleServicesProjectId: 'dispatch-eb63a',
    });
    expect(errors.some(error => error.includes('non-demo'))).toBe(true);
    expect(errors.some(error => error.includes('EMULATORS'))).toBe(true);
    expect(errors.some(error => error.includes('EMULATOR_HOST'))).toBe(true);
    expect(errors.some(error => error.includes('appl_'))).toBe(true);
    expect(errors.some(error => error.includes('goog_'))).toBe(true);
    expect(errors.some(error => error.includes('must match'))).toBe(true);
  });

  it.each(['true', '1', 'yes'])('fails closed for emulator mode %s', (mode) => {
    expect(getStoreBetaPolicyErrors({ ...valid, env: { ...isolatedEnv, EXPO_PUBLIC_USE_FIREBASE_EMULATORS: mode } })).not.toEqual([]);
  });

  it('rejects a lingering LAN host even when emulator mode is false', () => {
    expect(getStoreBetaPolicyErrors({ ...valid, env: { ...isolatedEnv, EXPO_PUBLIC_FIREBASE_EMULATOR_HOST: '192.168.1.45' } })).not.toEqual([]);
  });

  it.each(['', 'test_fixture', 'sk_fixture', 'goog_fixture', 'appl_'])('rejects an invalid Apple SDK key %s', (key) => {
    expect(getStoreBetaPolicyErrors({ ...valid, platform: 'ios', env: { ...isolatedEnv, EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: key } })).not.toEqual([]);
  });

  it.each(['', 'test_fixture', 'sk_fixture', 'appl_fixture', 'goog_'])('rejects an invalid Google SDK key %s', (key) => {
    expect(getStoreBetaPolicyErrors({ ...valid, platform: 'android', env: { ...isolatedEnv, EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: key } })).not.toEqual([]);
  });

  it('requires the selected Android services file to match the hosted beta project', () => {
    expect(getStoreBetaPolicyErrors({ ...valid, platform: 'android', androidGoogleServicesProjectId: 'dispatch-eb63a' })).not.toEqual([]);
    expect(getStoreBetaPolicyErrors({ ...valid, platform: 'android', androidGoogleServicesProjectId: undefined })).not.toEqual([]);
  });

  it('does not require Android configuration for an explicit iOS build', () => {
    expect(getStoreBetaPolicyErrors({ buildProfile: 'beta', platform: 'ios', env: { ...isolatedEnv, EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: undefined } })).toEqual([]);
  });

  it.each([
    'EXPO_PUBLIC_FIREBASE_API_KEY',
    'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
    'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    'EXPO_PUBLIC_FIREBASE_APP_ID',
  ])('requires complete beta Web app configuration: %s', (name) => {
    expect(getStoreBetaPolicyErrors({ ...valid, env: { ...isolatedEnv, [name]: undefined } })).not.toEqual([]);
  });

  it.each([
    ['EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'dispatch-eb63a.firebaseapp.com'],
    ['EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', 'dispatch-eb63a.appspot.com'],
    ['EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', 'dispatch-eb63a.firebasestorage.app'],
    ['EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', '94634534771'],
    ['EXPO_PUBLIC_FIREBASE_APP_ID', '1:94634534771:web:abcdef1234567890'],
  ])('rejects a production value in %s even with a beta project ID', (name, value) => {
    expect(getStoreBetaPolicyErrors({ ...valid, env: { ...isolatedEnv, [name]: value } })).not.toEqual([]);
  });

  it('rejects matching production app and sender IDs disguised by a beta project name', () => {
    expect(getStoreBetaPolicyErrors({ ...valid, env: {
      ...isolatedEnv,
      EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '94634534771',
      EXPO_PUBLIC_FIREBASE_APP_ID: '1:94634534771:web:abcdef1234567890',
    } }).some(error => error.includes('production Firebase app ID'))).toBe(true);
  });

  it.each(['demo-api-key', 'AIza', 'AIza invalid', 'not-a-firebase-key'])('rejects invalid or demo Firebase API key %s', (apiKey) => {
    expect(getStoreBetaPolicyErrors({ ...valid, env: { ...isolatedEnv, EXPO_PUBLIC_FIREBASE_API_KEY: apiKey } })).not.toEqual([]);
  });

  it.each(['dispatch-beta-fixture.appspot.com', 'dispatch-beta-fixture.firebasestorage.app'])('accepts the beta storage bucket format %s', (bucket) => {
    expect(getStoreBetaPolicyErrors({ ...valid, env: { ...isolatedEnv, EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: bucket } })).toEqual([]);
  });

  it('rejects an app ID belonging to a different project number', () => {
    expect(getStoreBetaPolicyErrors({ ...valid, env: { ...isolatedEnv, EXPO_PUBLIC_FIREBASE_APP_ID: '1:999999999999:web:abcdef1234567890' } })).not.toEqual([]);
  });

  it('requires a Web app ID, matching the mobile Firebase JavaScript client', () => {
    expect(getStoreBetaPolicyErrors({ ...valid, env: { ...isolatedEnv, EXPO_PUBLIC_FIREBASE_APP_ID: '1:123456789012:android:abcdef1234567890' } })).not.toEqual([]);
  });

  it.each([undefined, 'development', 'preview', 'production'])('leaves existing profile %s unchanged', (buildProfile) => {
    expect(getStoreBetaPolicyErrors({ buildProfile, env: {} })).toEqual([]);
    expect(() => assertStoreBetaConfiguration({ buildProfile, androidGoogleServicesFile: 'missing.json' })).not.toThrow();
  });

  it('rejects unexpected beta platforms', () => {
    expect(getStoreBetaPolicyErrors({ ...valid, platform: 'web' })).not.toEqual([]);
  });
});

describe('selected Android services file validation', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'dispatch-store-beta-'));
  const file = join(fixtureRoot, 'google-services.json');
  afterAll(() => { unlinkSync(file); rmdirSync(fixtureRoot); });

  it('reads the selected file rather than assuming its project', () => {
    writeFileSync(file, JSON.stringify({ project_info: { project_id: 'dispatch-beta-fixture' } }));
    expect(() => assertStoreBetaConfiguration({ ...valid, platform: 'android', projectRoot: fixtureRoot, androidGoogleServicesFile: './google-services.json' })).not.toThrow();
    writeFileSync(file, JSON.stringify({ project_info: { project_id: 'dispatch-eb63a' } }));
    expect(() => assertStoreBetaConfiguration({ ...valid, platform: 'android', projectRoot: fixtureRoot, androidGoogleServicesFile: './google-services.json' })).toThrow('must match');
  });

  it('fails closed without exposing malformed file contents', () => {
    writeFileSync(file, 'private-fixture-value');
    expect(() => assertStoreBetaConfiguration({ ...valid, platform: 'android', androidGoogleServicesFile: file })).toThrow('could not be read or parsed');
    expect(() => assertStoreBetaConfiguration({ ...valid, platform: 'android', androidGoogleServicesFile: file })).not.toThrow('private-fixture-value');
  });
});

describe('store beta release destination', () => {
  it('builds native store artifacts separately from production and drafts the Google internal release', () => {
    const eas = JSON.parse(readFileSync(join(process.cwd(), 'eas.json'), 'utf8'));
    expect(eas.build.beta).toMatchObject({ distribution: 'store', environment: 'preview', channel: 'beta', autoIncrement: true, ios: { image: 'sdk-58' }, android: { image: 'sdk-58', buildType: 'app-bundle' } });
    expect(eas.submit.beta).toEqual({ ios: { ascAppId: '6799206233' }, android: { track: 'internal', releaseStatus: 'draft' } });
    expect(eas.build.production.channel).toBe('production');
    expect(eas.build.preview.distribution).toBe('internal');
  });
});
