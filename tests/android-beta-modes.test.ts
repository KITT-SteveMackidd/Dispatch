import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { getStoreBetaMode, getStoreBetaPolicyErrors } from '../config/store-beta-policy';

function candidate(profile: 'android-customer-beta' | 'android-billing-qa') {
  const project = profile === 'android-customer-beta' ? 'dispatch-eb63a' : 'dispatch-billing-qa';
  const number = profile === 'android-customer-beta' ? '94634534771' : '123456789012';
  return {
    buildProfile: profile,
    platform: 'android',
    androidGoogleServicesProjectId: project,
    env: {
      EXPO_NO_DOTENV: '1',
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: project,
      EXPO_PUBLIC_FIREBASE_API_KEY: `AIza${'B'.repeat(35)}`,
      EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`,
      EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: `${project}.firebasestorage.app`,
      EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: number,
      EXPO_PUBLIC_FIREBASE_APP_ID: `1:${number}:web:abcdef1234567890`,
      EXPO_PUBLIC_USE_FIREBASE_EMULATORS: 'false',
      EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: profile === 'android-billing-qa' ? 'goog_fixture' : '',
    } as Record<string, string>,
  };
}

describe('Android beta build modes', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'dispatch-android-config-'));
  afterAll(() => {
    for (const profile of ['android-customer-beta', 'android-billing-qa']) rmSync(join(fixtureRoot, `${profile}.json`), { force: true });
    rmdirSync(fixtureRoot);
  });
  it('derives customer access mode from an explicit build profile only', () => {
    expect(getStoreBetaMode('android-customer-beta')).toBe('customer_beta');
    expect(getStoreBetaMode('android-billing-qa')).toBe('billing_qa');
    expect(getStoreBetaMode('preview')).toBe('standard');
    expect(getStoreBetaMode('production')).toBe('standard');
    expect(getStoreBetaMode()).toBe('standard');
  });

  it('allows customer beta without native payment keys while QA requires Google', () => {
    expect(getStoreBetaPolicyErrors(candidate('android-customer-beta'))).toEqual([]);
    const qa = candidate('android-billing-qa');
    expect(getStoreBetaPolicyErrors(qa)).toEqual([]);
    delete qa.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY;
    expect(getStoreBetaPolicyErrors(qa).some(error => error.includes('goog_'))).toBe(true);
  });

  it.each(['android-customer-beta', 'android-billing-qa'] as const)('%s rejects the wrong backend and local payment configuration', profile => {
    const value = candidate(profile);
    for (const [key, unsafe] of [
      ['EXPO_PUBLIC_FIREBASE_PROJECT_ID', profile === 'android-customer-beta' ? 'dispatch-customer-beta' : 'dispatch-eb63a'],
      ['EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'demo-dispatch-billing'],
      ['EXPO_PUBLIC_REVENUECAT_TEST_API_KEY', 'test_fixture'],
      ['EXPO_PUBLIC_USE_FIREBASE_EMULATORS', 'true'],
      ['EXPO_PUBLIC_FIREBASE_EMULATOR_HOST', '192.168.1.45'],
      ['EXPO_NO_DOTENV', ''],
    ]) {
      expect(getStoreBetaPolicyErrors({ ...value, env: { ...value.env, [key]: unsafe } })).not.toEqual([]);
    }
    expect(getStoreBetaPolicyErrors({ ...value, platform: 'ios' })).not.toEqual([]);
    expect(getStoreBetaPolicyErrors({ ...value, androidGoogleServicesProjectId: 'another-project' })).not.toEqual([]);
  });

  it('does not allow billing QA and customer beta to share a backend', () => {
    const customer = candidate('android-customer-beta');
    expect(getStoreBetaPolicyErrors({ ...customer, env: candidate('android-billing-qa').env }).some(error => error.includes('designated Firebase project'))).toBe(true);
  });

  it('rejects purchase keys in customer beta', () => {
    const customer = candidate('android-customer-beta');
    expect(getStoreBetaPolicyErrors({ ...customer, env: { ...customer.env, EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: 'goog_fixture' } }).some(error => error.includes('must not configure'))).toBe(true);
  });

  it('does not require an Apple key while EAS evaluates an Android-only profile', () => {
    expect(getStoreBetaPolicyErrors({ ...candidate('android-billing-qa'), platform: undefined })).toEqual([]);
  });

  it('keeps store artifacts and submission tracks distinct, draft and without production OTA', () => {
    const eas = JSON.parse(readFileSync('eas.json', 'utf8'));
    for (const profile of ['android-customer-beta', 'android-billing-qa']) {
      expect(eas.build[profile]).toMatchObject({ distribution: 'store', channel: profile, autoIncrement: true, android: { image: 'sdk-58', buildType: 'app-bundle' } });
      expect(eas.build[profile].env.EXPO_NO_DOTENV).toBe('1');
      expect(eas.build[profile].env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY).toBeUndefined();
      expect(eas.build[profile].env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID).toBe('disabled');
      expect(Object.values(eas.build[profile].env).every(value => value !== '')).toBe(true);
      // Missing hosted configuration deliberately blocks until provisioning is complete.
      expect(getStoreBetaPolicyErrors({ buildProfile: profile, platform: 'android', env: eas.build[profile].env })).not.toEqual([]);
    }
    expect(eas.submit['android-customer-beta'].android).toEqual({ track: 'alpha', releaseStatus: 'draft' });
    expect(eas.submit['android-billing-qa'].android).toEqual({ track: 'internal', releaseStatus: 'draft' });
  });

  it('rejects partially configured Google sign-in', () => {
    const value = candidate('android-customer-beta');
    expect(getStoreBetaPolicyErrors({ ...value, env: { ...value.env, EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: '123-test.apps.googleusercontent.com', EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'disabled' } }).some(error => error.includes('Google sign-in'))).toBe(true);
  });

  it.each(['android-customer-beta', 'android-billing-qa'] as const)('resolves %s manifest with no OTA and the matching backend services file', profile => {
    const value = candidate(profile);
    const projectNumber = value.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
    const file = join(fixtureRoot, `${profile}.json`);
    const services = {
      project_info: { project_id: value.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID, project_number: projectNumber },
      client: [{ client_info: { mobilesdk_app_id: `1:${projectNumber}:android:abcdef`, android_client_info: { package_name: 'com.smackidd.dispatch' } } }],
    };
    writeFileSync(file, JSON.stringify(services));
    const env = { ...process.env, ...value.env, EAS_BUILD_PROFILE: profile, EAS_BUILD_PLATFORM: 'android', BILLING_QA_GOOGLE_SERVICES_JSON: file, GOOGLE_SERVICES_JSON: profile === 'android-customer-beta' ? file : 'production-must-not-be-used.json' };
    const script = "const c=require('./app.config.js')({config:{android:{package:'com.smackidd.dispatch'}}});console.log(JSON.stringify({mode:c.extra.dispatchBetaMode,backend:c.extra.dispatchBetaBackend,updates:c.updates,services:c.android.googleServicesFile,projectId:c.extra.eas.projectId,slug:c.slug,links:c.android.intentFilters}));";
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' }));
    expect(result).toMatchObject({ mode: getStoreBetaMode(profile), updates: { enabled: false }, services: file });
    if (profile === 'android-customer-beta') {
      expect(result).toMatchObject({ projectId: '7d0f7257-64f9-443f-ba27-a75af5fbafaa', slug: 'dispatch', backend: 'existing_dispatch' });
      expect(result.links[0].data[0].host).toBe('dispatchcrewmanager.com');
    } else {
      expect(result.projectId).not.toBe('8ecbfda3-7884-434d-815a-90c8ca5dc253');
    }
    writeFileSync(file, JSON.stringify({ ...services, project_info: { ...services.project_info, project_number: '111111111111' } }));
    expect(() => execFileSync(process.execPath, ['-e', script], { env, stdio: 'pipe' })).toThrow();
  });
});
