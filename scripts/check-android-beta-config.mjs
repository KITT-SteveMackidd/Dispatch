import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const profile = process.argv[2];
if (!['android-customer-beta', 'android-billing-qa'].includes(profile)) {
  console.error('Choose android-customer-beta or android-billing-qa.');
  process.exit(1);
}
const eas = JSON.parse(readFileSync(path.join(repo, 'eas.json'), 'utf8'));
// Mirrors the explicit profile environment; never loads local dotenv files.
Object.assign(process.env, eas.build[profile].env, { EAS_BUILD_PROFILE: profile, EAS_BUILD_PLATFORM: 'android' });
try {
  const { expo } = JSON.parse(readFileSync(path.join(repo, 'app.json'), 'utf8'));
  const config = require('../app.config.js')({ config: expo });
  if (config.updates?.enabled !== false) throw new Error('Beta OTA updates must remain disabled.');
  if (config.android.package !== 'com.smackidd.dispatch') throw new Error('Unexpected Android package.');
  console.log(JSON.stringify({ profile, mode: config.extra.dispatchBetaMode, firebaseProject: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID, sdk: require('expo/package.json').version, artifact: 'AAB', track: eas.submit[profile].android.track, status: 'local_configuration_valid', hostedBackendVerified: false }, null, 2));
  console.log('Configuration consistency passed. Hosted backend, store products (QA only), signing and physical-device verification are separate release gates.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
