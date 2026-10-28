import { mkdtempSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertStoreBetaConfiguration, getStoreBetaPolicyErrors } from '../config/store-beta-policy';

const projectNumber = '94634534771';
const webClientId = `${projectNumber}-webfixture.apps.googleusercontent.com`;
const androidClientId = `${projectNumber}-playfixture.apps.googleusercontent.com`;
const playSha1 = '12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78';
const env = {
  EXPO_NO_DOTENV: '1',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'dispatch-eb63a',
  EXPO_PUBLIC_FIREBASE_API_KEY: `AIza${'B'.repeat(35)}`,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'dispatch-eb63a.firebaseapp.com',
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'dispatch-eb63a.appspot.com',
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: projectNumber,
  EXPO_PUBLIC_FIREBASE_APP_ID: `1:${projectNumber}:web:abcdef1234567890`,
  EXPO_PUBLIC_USE_FIREBASE_EMULATORS: 'false',
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: webClientId,
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: androidClientId,
  DISPATCH_GOOGLE_PLAY_SIGNING_SHA1: playSha1,
};

function servicesFixture() {
  return {
    project_info: { project_id: 'dispatch-eb63a', project_number: projectNumber },
    client: [{
      client_info: {
        mobilesdk_app_id: `1:${projectNumber}:android:abcdef1234567890`,
        android_client_info: { package_name: 'com.smackidd.dispatch' },
      },
      oauth_client: [
        { client_id: webClientId, client_type: 3 },
        {
          client_id: androidClientId,
          client_type: 1,
          android_info: { package_name: 'com.smackidd.dispatch', certificate_hash: playSha1.replace(/:/g, '').toLowerCase() },
        },
      ],
    }],
  };
}

describe('Google Play customer beta OAuth configuration', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'dispatch-google-play-config-'));
  const file = join(fixtureRoot, 'google-services.json');
  const candidate = { buildProfile: 'android-customer-beta', platform: 'android', env, androidGoogleServicesProjectId: 'dispatch-eb63a' };
  const check = (overrideEnv: Record<string, string | undefined> = env) => assertStoreBetaConfiguration({
    ...candidate,
    env: overrideEnv,
    projectRoot: fixtureRoot,
    androidGoogleServicesFile: file,
  });
  afterAll(() => { rmSync(file, { force: true }); rmdirSync(fixtureRoot); });

  it('accepts a matching Play certificate in compact or colon-separated form', () => {
    writeFileSync(file, JSON.stringify(servicesFixture()));
    expect(() => check()).not.toThrow();
    expect(() => check({ ...env, DISPATCH_GOOGLE_PLAY_SIGNING_SHA1: playSha1.replace(/:/g, '').toLowerCase() })).not.toThrow();
    expect(getStoreBetaPolicyErrors(candidate)).toEqual([]);
  });

  it.each(['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', 'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID'])('rejects %s from another Firebase project', key => {
    expect(getStoreBetaPolicyErrors({ ...candidate, env: { ...env, [key]: '123456789012-other.apps.googleusercontent.com' } })).toContain(
      'Android customer beta Google OAuth client IDs must belong to the configured Firebase project number.'
    );
  });

  it.each([undefined, '', 'disabled', '12:34', 'x'.repeat(40), 'AB:'.repeat(20), 'AB'.repeat(32)])('rejects missing or malformed Play SHA-1 %s', fingerprint => {
    expect(getStoreBetaPolicyErrors({ ...candidate, env: { ...env, DISPATCH_GOOGLE_PLAY_SIGNING_SHA1: fingerprint } }).some(error => error.includes('verified Play app-signing SHA-1'))).toBe(true);
  });

  it('rejects a stale services file that contains only the Web client', () => {
    const services = servicesFixture();
    services.client[0].oauth_client = services.client[0].oauth_client.filter(client => client.client_type === 3);
    writeFileSync(file, JSON.stringify(services));
    expect(() => check()).toThrow('configured Android OAuth client');
  });

  it('rejects a Web client missing from the selected Android app', () => {
    const services = servicesFixture();
    services.client[0].oauth_client[0].client_id = `${projectNumber}-otherweb.apps.googleusercontent.com`;
    writeFileSync(file, JSON.stringify(services));
    expect(() => check()).toThrow('configured Web OAuth client');
  });

  it.each(['client', 'package', 'certificate', 'type'] as const)('rejects mismatched Android OAuth %s metadata', mismatch => {
    const services = servicesFixture();
    const android = services.client[0].oauth_client[1];
    if (mismatch === 'client') android.client_id = `${projectNumber}-otherandroid.apps.googleusercontent.com`;
    if (mismatch === 'package') android.android_info!.package_name = 'com.smackidd.other';
    if (mismatch === 'certificate') android.android_info!.certificate_hash = 'ab'.repeat(20);
    if (mismatch === 'type') android.client_type = 3;
    writeFileSync(file, JSON.stringify(services));
    expect(() => check()).toThrow('configured Android OAuth client');
  });

  it('requires all package, client and certificate fields on the same OAuth entry', () => {
    const services = servicesFixture();
    services.client[0].oauth_client[1].android_info!.certificate_hash = 'ab'.repeat(20);
    services.client[0].oauth_client.push({
      client_id: `${projectNumber}-otherandroid.apps.googleusercontent.com`,
      client_type: 1,
      android_info: { package_name: 'com.smackidd.dispatch', certificate_hash: playSha1 },
    });
    writeFileSync(file, JSON.stringify(services));
    expect(() => check()).toThrow('configured Android OAuth client');
  });

  it('checks the selected file project even when OAuth entries look valid', () => {
    const services = servicesFixture();
    services.project_info.project_id = 'another-project';
    writeFileSync(file, JSON.stringify(services));
    expect(() => check()).toThrow('must match EXPO_PUBLIC_FIREBASE_PROJECT_ID');
  });

  it('does not include file contents or credential values in failures', () => {
    const services = servicesFixture();
    services.client[0].oauth_client[1].client_id = 'private-fixture-value';
    writeFileSync(file, JSON.stringify(services));
    expect(() => check()).toThrow('configured Android OAuth client');
    expect(() => check()).not.toThrow('private-fixture-value');
  });

  it('accepts all additional Play signing certificates with matching Android clients', () => {
    const services = servicesFixture();
    const fingerprints = ['ab'.repeat(20), 'cd'.repeat(20)];
    fingerprints.forEach((fingerprint, index) => services.client[0].oauth_client.push({
      client_id: `${projectNumber}-hybrid${index}.apps.googleusercontent.com`,
      client_type: 1,
      android_info: { package_name: 'com.smackidd.dispatch', certificate_hash: fingerprint },
    }));
    writeFileSync(file, JSON.stringify(services));
    expect(() => check({ ...env, DISPATCH_GOOGLE_PLAY_ADDITIONAL_SHA1S: ` ${fingerprints[0]}, ${fingerprints[1].toUpperCase()} ` })).not.toThrow();
  });

  it.each(['not-a-sha1', `${'ab'.repeat(20)},`, `,${'ab'.repeat(20)}`, `${'ab'.repeat(20)}, ,${'cd'.repeat(20)}`])('rejects malformed additional fingerprint lists: %s', fingerprints => {
    expect(getStoreBetaPolicyErrors({ ...candidate, env: { ...env, DISPATCH_GOOGLE_PLAY_ADDITIONAL_SHA1S: fingerprints } }).some(error => error.includes('comma-separated SHA-1 fingerprints'))).toBe(true);
  });

  it('rejects a stale file missing one of the additional Play signing certificates', () => {
    const services = servicesFixture();
    services.client[0].oauth_client.push({
      client_id: `${projectNumber}-hybridfixture.apps.googleusercontent.com`,
      client_type: 1,
      android_info: { package_name: 'com.smackidd.dispatch', certificate_hash: 'ab'.repeat(20) },
    });
    writeFileSync(file, JSON.stringify(services));
    expect(() => check({ ...env, DISPATCH_GOOGLE_PLAY_ADDITIONAL_SHA1S: `${'ab'.repeat(20)},${'cd'.repeat(20)}` })).toThrow('every additional Play signing SHA-1');
  });

  it.each(['project', 'package', 'certificate', 'type'] as const)('rejects mismatched additional Android OAuth %s metadata', mismatch => {
    const services = servicesFixture();
    const additional = {
      client_id: `${projectNumber}-hybridfixture.apps.googleusercontent.com`,
      client_type: 1,
      android_info: { package_name: 'com.smackidd.dispatch', certificate_hash: 'ab'.repeat(20) },
    };
    if (mismatch === 'project') additional.client_id = '123456789012-hybridfixture.apps.googleusercontent.com';
    if (mismatch === 'package') additional.android_info.package_name = 'com.smackidd.other';
    if (mismatch === 'certificate') additional.android_info.certificate_hash = 'cd'.repeat(20);
    if (mismatch === 'type') additional.client_type = 3;
    services.client[0].oauth_client.push(additional);
    writeFileSync(file, JSON.stringify(services));
    expect(() => check({ ...env, DISPATCH_GOOGLE_PLAY_ADDITIONAL_SHA1S: 'ab'.repeat(20) })).toThrow('every additional Play signing SHA-1');
  });

  it('preserves disabled Google and iOS/local configurations without Play metadata', () => {
    const services = servicesFixture();
    services.client[0].oauth_client = [];
    writeFileSync(file, JSON.stringify(services));
    expect(() => check({ ...env, EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'disabled', EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: 'disabled', DISPATCH_GOOGLE_PLAY_SIGNING_SHA1: undefined })).not.toThrow();
    expect(() => assertStoreBetaConfiguration({ buildProfile: 'ios-customer-beta', platform: 'ios', env: { ...env, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: `${projectNumber}-iosfixture.apps.googleusercontent.com`, DISPATCH_GOOGLE_PLAY_SIGNING_SHA1: undefined }, androidGoogleServicesFile: 'absent.json' })).not.toThrow();
    expect(() => assertStoreBetaConfiguration({ buildProfile: 'development', env: {}, androidGoogleServicesFile: 'absent.json' })).not.toThrow();
  });
});
