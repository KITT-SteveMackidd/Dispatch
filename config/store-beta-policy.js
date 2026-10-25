const { readFileSync } = require('node:fs');
const path = require('node:path');

const PRODUCTION_FIREBASE_PROJECT = 'dispatch-eb63a';
// Public project metadata from the existing production google-services.json.
const PRODUCTION_FIREBASE_PROJECT_NUMBER = '94634534771';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isBetaProfile(buildProfile) {
  return clean(buildProfile) === 'beta';
}

/**
 * Validate only store beta builds; local Expo Go and other profiles are unchanged.
 * This checks configuration consistency, not API-key ownership. Provisioning must
 * compare every value with the hosted beta project's authoritative Firebase Web
 * app configuration, verify the API key belongs to that project, and verify the
 * deployed beta backend before allowing a store upload.
 */
function getStoreBetaPolicyErrors({ buildProfile, platform, env = {}, androidGoogleServicesProjectId } = {}) {
  if (!isBetaProfile(buildProfile)) return [];

  const errors = [];
  const targetPlatform = clean(platform);
  const firebaseProjectId = clean(env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  if (!firebaseProjectId || firebaseProjectId.toLowerCase().startsWith('demo-')) {
    errors.push('Store beta requires a hosted, non-demo EXPO_PUBLIC_FIREBASE_PROJECT_ID.');
  } else if (firebaseProjectId.toLowerCase() === PRODUCTION_FIREBASE_PROJECT) {
    errors.push('Store beta cannot use the production Firebase project dispatch-eb63a.');
  } else if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(firebaseProjectId)) {
    errors.push('Store beta requires a valid hosted Firebase project ID.');
  }

  const authDomain = clean(env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN);
  if (!firebaseProjectId || authDomain !== `${firebaseProjectId}.firebaseapp.com`) {
    errors.push('Store beta EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN must be the beta project\'s standard firebaseapp.com domain.');
  }
  const storageBucket = clean(env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET);
  if (!firebaseProjectId || ![`${firebaseProjectId}.appspot.com`, `${firebaseProjectId}.firebasestorage.app`].includes(storageBucket)) {
    errors.push('Store beta EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET must be the beta project\'s appspot.com or firebasestorage.app bucket.');
  }
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(clean(env.EXPO_PUBLIC_FIREBASE_API_KEY))) {
    errors.push('Store beta requires a valid non-demo EXPO_PUBLIC_FIREBASE_API_KEY from the beta Firebase Web app configuration.');
  }
  const senderId = clean(env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID);
  if (!/^[1-9]\d+$/.test(senderId)) {
    errors.push('Store beta requires a numeric EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID.');
  }
  const appIdMatch = /^1:([1-9]\d+):web:[a-f0-9]{6,64}$/.exec(clean(env.EXPO_PUBLIC_FIREBASE_APP_ID));
  if (!appIdMatch || appIdMatch[1] !== senderId) {
    errors.push('Store beta requires a Firebase Web EXPO_PUBLIC_FIREBASE_APP_ID matching EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID.');
  }
  if (senderId === PRODUCTION_FIREBASE_PROJECT_NUMBER || appIdMatch?.[1] === PRODUCTION_FIREBASE_PROJECT_NUMBER) {
    errors.push('Store beta cannot use the production Firebase app ID or messaging sender ID.');
  }

  const emulatorMode = clean(env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS).toLowerCase();
  if (emulatorMode && emulatorMode !== 'false') {
    errors.push('Store beta must disable EXPO_PUBLIC_USE_FIREBASE_EMULATORS.');
  }
  for (const name of [
    'EXPO_PUBLIC_FIREBASE_EMULATOR_HOST',
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
    'FUNCTIONS_EMULATOR_HOST',
  ]) {
    if (clean(env[name])) errors.push(`Store beta must not set ${name}.`);
  }

  if (targetPlatform && !['ios', 'android'].includes(targetPlatform)) {
    errors.push('Store beta supports only the ios and android build platforms.');
  }
  // EAS may evaluate app config before choosing a platform. Validate both in
  // that case rather than silently omitting one platform's release gates.
  if (!targetPlatform || targetPlatform === 'ios') {
    if (!/^appl_\S+$/.test(clean(env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY))) {
      errors.push('Store beta iOS requires EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY with an appl_ public SDK key.');
    }
  }
  if (!targetPlatform || targetPlatform === 'android') {
    if (!/^goog_\S+$/.test(clean(env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY))) {
      errors.push('Store beta Android requires EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY with a goog_ public SDK key.');
    }
    const googleProjectId = clean(androidGoogleServicesProjectId);
    if (!googleProjectId) {
      errors.push('Store beta Android requires a readable google-services.json with project_info.project_id.');
    } else if (googleProjectId !== firebaseProjectId) {
      errors.push('Store beta Android google-services.json must match EXPO_PUBLIC_FIREBASE_PROJECT_ID.');
    }
  }
  return errors;
}

/** Read the exact Android file selected by app.config.js before validating it. */
function assertStoreBetaConfiguration({
  buildProfile,
  platform,
  env = process.env,
  projectRoot = process.cwd(),
  androidGoogleServicesFile,
} = {}) {
  if (!isBetaProfile(buildProfile)) return;

  let androidGoogleServicesProjectId;
  const needsAndroid = !clean(platform) || clean(platform) === 'android';
  if (needsAndroid && clean(androidGoogleServicesFile)) {
    try {
      const googleServices = JSON.parse(readFileSync(path.resolve(projectRoot, androidGoogleServicesFile), 'utf8'));
      androidGoogleServicesProjectId = googleServices?.project_info?.project_id;
    } catch {
      // Do not echo file contents or credentials in a build error.
      throw new Error('Store beta blocked: the selected Android google-services.json could not be read or parsed.');
    }
  }
  const errors = getStoreBetaPolicyErrors({ buildProfile, platform, env, androidGoogleServicesProjectId });
  if (errors.length) throw new Error(`Store beta blocked:\n- ${errors.join('\n- ')}`);
}

module.exports = { getStoreBetaPolicyErrors, assertStoreBetaConfiguration };
