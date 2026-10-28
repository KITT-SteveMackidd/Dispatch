const { readFileSync } = require('node:fs');
const path = require('node:path');

const PRODUCTION_FIREBASE_PROJECT = 'dispatch-eb63a';
// Public project metadata from the existing production google-services.json.
const PRODUCTION_FIREBASE_PROJECT_NUMBER = '94634534771';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSha1(value) {
  const fingerprint = clean(value);
  return /^(?:[a-fA-F0-9]{40}|(?:[a-fA-F0-9]{2}:){19}[a-fA-F0-9]{2})$/.test(fingerprint)
    ? fingerprint.replace(/:/g, '').toUpperCase()
    : '';
}

function additionalPlaySha1s(env) {
  const fingerprints = clean(env.DISPATCH_GOOGLE_PLAY_ADDITIONAL_SHA1S);
  return fingerprints ? fingerprints.split(',').map(normalizeSha1) : [];
}

function isAndroidCustomerGoogleEnabled(buildProfile, env) {
  return clean(buildProfile) === 'android-customer-beta' &&
    [env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID]
      .some(value => clean(value) && clean(value) !== 'disabled');
}

function isBetaProfile(buildProfile) {
  return ['beta', 'android-customer-beta', 'ios-customer-beta', 'android-billing-qa'].includes(clean(buildProfile));
}

function getStoreBetaMode(buildProfile) {
  if (['android-customer-beta', 'ios-customer-beta'].includes(clean(buildProfile))) return 'customer_beta';
  if (clean(buildProfile) === 'android-billing-qa') return 'billing_qa';
  return 'standard';
}

// EAS also resolves configuration before EAS_BUILD_PLATFORM is populated.
function profilePlatform(buildProfile) {
  if (clean(buildProfile) === 'ios-customer-beta') return 'ios';
  if (['android-customer-beta', 'android-billing-qa'].includes(clean(buildProfile))) return 'android';
  return '';
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
  const mode = getStoreBetaMode(buildProfile);
  const expectedPlatform = profilePlatform(buildProfile);
  const targetPlatform = clean(platform) || expectedPlatform;
  const firebaseProjectId = clean(env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
  if (mode !== 'standard') {
    // Explicit user direction: complimentary customer beta uses existing Dispatch.
    // Payment QA remains isolated and must never use this exception.
    const expectedProject = mode === 'customer_beta' ? PRODUCTION_FIREBASE_PROJECT : 'dispatch-billing-qa';
    if (firebaseProjectId !== expectedProject) errors.push(`${buildProfile} requires its designated Firebase project ${expectedProject}.`);
    if (targetPlatform !== expectedPlatform) errors.push(`${buildProfile} supports ${expectedPlatform} only.`);
    if (clean(env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY)) errors.push('Store builds must not contain a RevenueCat Test Store key.');
    if (clean(env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS) !== 'false') errors.push('Store builds must explicitly set EXPO_PUBLIC_USE_FIREBASE_EMULATORS=false.');
    if (clean(env.EXPO_NO_DOTENV) !== '1') errors.push('Store builds must set EXPO_NO_DOTENV=1 to exclude local sandbox credentials.');
    if (mode === 'customer_beta' && (clean(env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY) || clean(env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY))) {
      errors.push('Customer beta must not configure native RevenueCat purchase keys.');
    }
    const googlePlatformName = expectedPlatform === 'ios' ? 'iOS' : 'Android';
    const googleNativeId = expectedPlatform === 'ios' ? env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID : env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
    const googleIds = [env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, googleNativeId].map(clean);
    if (googleIds.some(id => id && id !== 'disabled') && !googleIds.every(id => /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(id))) {
      errors.push(`${googlePlatformName} Google sign-in requires both matching-project Web and ${googlePlatformName} OAuth client IDs, or disabled for both.`);
    }
  }
  if (!firebaseProjectId || firebaseProjectId.toLowerCase().startsWith('demo-')) {
    errors.push('Store beta requires a hosted, non-demo EXPO_PUBLIC_FIREBASE_PROJECT_ID.');
  } else if (mode !== 'customer_beta' && firebaseProjectId.toLowerCase() === PRODUCTION_FIREBASE_PROJECT) {
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
  if (mode !== 'customer_beta' && (senderId === PRODUCTION_FIREBASE_PROJECT_NUMBER || appIdMatch?.[1] === PRODUCTION_FIREBASE_PROJECT_NUMBER)) {
    errors.push('Store beta cannot use the production Firebase app ID or messaging sender ID.');
  }
  if (mode === 'customer_beta' && senderId !== PRODUCTION_FIREBASE_PROJECT_NUMBER) {
    errors.push('Customer beta must use the existing Dispatch Firebase project number.');
  }
  if (isAndroidCustomerGoogleEnabled(buildProfile, env)) {
    const clientProject = /^([1-9]\d*)-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/;
    const googleIds = [env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID];
    if (!googleIds.every(value => clientProject.exec(clean(value))?.[1] === senderId)) {
      errors.push('Android customer beta Google OAuth client IDs must belong to the configured Firebase project number.');
    }
    if (!normalizeSha1(env.DISPATCH_GOOGLE_PLAY_SIGNING_SHA1)) {
      errors.push('Android customer beta Google sign-in requires DISPATCH_GOOGLE_PLAY_SIGNING_SHA1 with the verified Play app-signing SHA-1 fingerprint.');
    }
    if (additionalPlaySha1s(env).some(fingerprint => !fingerprint)) {
      errors.push('DISPATCH_GOOGLE_PLAY_ADDITIONAL_SHA1S must contain only comma-separated SHA-1 fingerprints for the additional Play signing certificates.');
    }
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
  if (mode === 'standard' && (!targetPlatform || targetPlatform === 'ios')) {
    if (!/^appl_\S+$/.test(clean(env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY))) {
      errors.push('Store beta iOS requires EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY with an appl_ public SDK key.');
    }
  }
  if (!targetPlatform || targetPlatform === 'android') {
    if (mode !== 'customer_beta' && !/^goog_\S+$/.test(clean(env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY))) {
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
  let androidGoogleServices;
  const targetPlatform = clean(platform) || profilePlatform(buildProfile);
  const needsAndroid = !targetPlatform || targetPlatform === 'android';
  if (needsAndroid && clean(androidGoogleServicesFile)) {
    try {
      const googleServices = JSON.parse(readFileSync(path.resolve(projectRoot, androidGoogleServicesFile), 'utf8'));
      androidGoogleServices = googleServices;
      androidGoogleServicesProjectId = googleServices?.project_info?.project_id;
      if (getStoreBetaMode(buildProfile) !== 'standard') {
        if (String(googleServices?.project_info?.project_number || '') !== clean(env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID)) {
          throw new Error('android-project-number-mismatch');
        }
        const appClient = googleServices?.client?.find(client => client?.client_info?.android_client_info?.package_name === 'com.smackidd.dispatch');
        if (!appClient || !clean(appClient.client_info?.mobilesdk_app_id).startsWith(`1:${googleServices.project_info.project_number}:android:`)) {
          throw new Error('android-package-mismatch');
        }
      }
    } catch (error) {
      // Do not echo file contents or credentials in a build error.
      if (error.message === 'android-project-number-mismatch') throw new Error('Store beta blocked: Android services project number must match the Firebase sender ID.');
      if (error.message === 'android-package-mismatch') throw new Error('Store beta blocked: Android services must include com.smackidd.dispatch from the same Firebase project.');
      throw new Error('Store beta blocked: the selected Android google-services.json could not be read or parsed.');
    }
  }
  const errors = getStoreBetaPolicyErrors({ buildProfile, platform, env, androidGoogleServicesProjectId });
  if (errors.length) throw new Error(`Store beta blocked:\n- ${errors.join('\n- ')}`);

  // OAuth works only for the installed app's package and signing certificate.
  // Check the selected file, including EAS file variables, rather than trusting
  // well-formed IDs or an older checked-in Firebase configuration.
  if (needsAndroid && isAndroidCustomerGoogleEnabled(buildProfile, env)) {
    const appClient = androidGoogleServices?.client?.find(client => client?.client_info?.android_client_info?.package_name === 'com.smackidd.dispatch');
    const oauthClients = Array.isArray(appClient?.oauth_client) ? appClient.oauth_client : [];
    const webClient = oauthClients.find(client => client?.client_type === 3 && client.client_id === clean(env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID));
    if (!webClient) {
      throw new Error('Store beta blocked: selected google-services.json must include the configured Web OAuth client for the Dispatch Android app. Refresh the Firebase services file.');
    }
    const androidClient = oauthClients.find(client => client?.client_type === 1 &&
      client.client_id === clean(env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID) &&
      client.android_info?.package_name === 'com.smackidd.dispatch' &&
      normalizeSha1(client.android_info?.certificate_hash) === normalizeSha1(env.DISPATCH_GOOGLE_PLAY_SIGNING_SHA1));
    if (!androidClient) {
      throw new Error('Store beta blocked: selected google-services.json must include the configured Android OAuth client for com.smackidd.dispatch and the verified Play app-signing SHA-1. Register the Play certificate and refresh the Firebase services file.');
    }
    const clientProject = /^([1-9]\d*)-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/;
    for (const fingerprint of additionalPlaySha1s(env)) {
      const additionalClient = oauthClients.find(client => client?.client_type === 1 &&
        clientProject.exec(clean(client.client_id))?.[1] === clean(env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID) &&
        client.android_info?.package_name === 'com.smackidd.dispatch' &&
        normalizeSha1(client.android_info?.certificate_hash) === fingerprint);
      if (!additionalClient) {
        throw new Error('Store beta blocked: selected google-services.json must include a same-project Android OAuth client for com.smackidd.dispatch and every additional Play signing SHA-1. Register all Play certificates and refresh the Firebase services file.');
      }
    }
  }
}

module.exports = { getStoreBetaPolicyErrors, assertStoreBetaConfiguration, getStoreBetaMode };
