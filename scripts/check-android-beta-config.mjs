import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const profile = process.argv[2];
if (!['android-customer-beta', 'ios-customer-beta', 'android-billing-qa'].includes(profile)) {
  console.error('Choose android-customer-beta, ios-customer-beta or android-billing-qa.');
  process.exit(1);
}
const platform = profile === 'ios-customer-beta' ? 'ios' : 'android';
const eas = JSON.parse(readFileSync(path.join(repo, 'eas.json'), 'utf8'));
// Mirrors the explicit profile environment; never loads local dotenv files.
Object.assign(process.env, eas.build[profile].env, { EAS_BUILD_PROFILE: profile, EAS_BUILD_PLATFORM: platform });
try {
  const { expo } = JSON.parse(readFileSync(path.join(repo, 'app.json'), 'utf8'));
  const config = require('../app.config.js')({ config: expo });
  if (config.updates?.enabled !== false) throw new Error('Beta OTA updates must remain disabled.');
  const applicationId = platform === 'ios' ? config.ios.bundleIdentifier : config.android.package;
  if (applicationId !== 'com.smackidd.dispatch') throw new Error('Unexpected application identifier.');
  if (config.extra.dispatchBetaMode === 'customer_beta' && (config.extra.dispatchBetaBackend !== 'existing_dispatch' || config.extra.eas.projectId !== '7d0f7257-64f9-443f-ba27-a75af5fbafaa')) {
    throw new Error('Customer beta must use the existing Dispatch backend and Expo project.');
  }
  console.log(JSON.stringify({ profile, platform, mode: config.extra.dispatchBetaMode, firebaseProject: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID, sdk: require('expo/package.json').version, artifact: platform === 'ios' ? 'IPA' : 'AAB', destination: platform === 'ios' ? 'TestFlight' : eas.submit[profile].android.track, status: 'local_configuration_valid', hostedBackendVerified: false }, null, 2));
  console.log('Configuration consistency passed. Hosted backend, store products (QA only), signing and physical-device verification are separate release gates.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
