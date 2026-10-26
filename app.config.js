const { assertStoreBetaConfiguration, getStoreBetaMode } = require('./config/store-beta-policy');

const buildProfile = process.env.EAS_BUILD_PROFILE || process.env.EXPO_PUBLIC_EAS_BUILD_PROFILE;
const dispatchBetaMode = getStoreBetaMode(buildProfile);
const projectId = dispatchBetaMode === 'customer_beta'
  ? '8ecbfda3-7884-434d-815a-90c8ca5dc253'
  :
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  process.env.EAS_PROJECT_ID ||
  '7d0f7257-64f9-443f-ba27-a75af5fbafaa';
const owner = process.env.EXPO_PUBLIC_EXPO_OWNER || process.env.EXPO_OWNER || 'smackidd';
const betaGoogleServicesFile = dispatchBetaMode === 'customer_beta'
  ? process.env.CUSTOMER_BETA_GOOGLE_SERVICES_JSON
  : dispatchBetaMode === 'billing_qa' ? process.env.BILLING_QA_GOOGLE_SERVICES_JSON : undefined;
const updatesEnabled = buildProfile === 'production' || buildProfile === 'preview';
const googleIosClientId = /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '')
  ? process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID : undefined;
const googleIosUrlScheme = googleIosClientId
  ? `com.googleusercontent.apps.${googleIosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}`
  : null;

module.exports = ({ config: baseConfig }) => {
  const config = { ...baseConfig };

  if (dispatchBetaMode === 'customer_beta') {
    config.name = 'Dispatch Customer Beta';
    config.slug = 'dispatch-customer-beta';
  }

  if (owner) {
    config.owner = owner;
  }

  config.ios = {
    ...(config.ios || {}),
    bundleIdentifier: config.ios?.bundleIdentifier || 'com.smackidd.dispatch',
    runtimeVersion: 'dispatch-sdk58-rn088-billing-v1',
    usesAppleSignIn: true,
    associatedDomains: [
      ...new Set([
        ...(config.ios?.associatedDomains || []),
        'applinks:dispatchcrewmanager.com',
        'applinks:www.dispatchcrewmanager.com',
      ]),
    ],
    infoPlist: {
      ...(config.ios?.infoPlist || {}),
      ITSAppUsesNonExemptEncryption:
        config.ios?.infoPlist?.ITSAppUsesNonExemptEncryption ?? false,
    },
  };

  config.android = {
    ...(config.android || {}),
    package: config.android?.package || 'com.smackidd.dispatch',
    googleServicesFile: dispatchBetaMode !== 'standard'
      ? betaGoogleServicesFile
      : process.env.GOOGLE_SERVICES_JSON || config.android?.googleServicesFile || './google-services.json',
    intentFilters: dispatchBetaMode === 'customer_beta' ? [] : [
      ...(config.android?.intentFilters || []),
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'https',
            host: 'dispatchcrewmanager.com',
            pathPrefix: '/invite',
          },
          {
            scheme: 'https',
            host: 'www.dispatchcrewmanager.com',
            pathPrefix: '/invite',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  };

  assertStoreBetaConfiguration({
    buildProfile,
    platform: process.env.EAS_BUILD_PLATFORM,
    env: process.env,
    projectRoot: __dirname,
    androidGoogleServicesFile: config.android.googleServicesFile,
  });

  config.runtimeVersion = 'dispatch-sdk58-rn088-billing-v1';

  const plugins = [...(config.plugins || [])];
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-splash-screen')) {
    plugins.push([
      'expo-splash-screen',
      {
        image: './assets/images/dispatch-splash-full.png',
        imageWidth: 402,
        resizeMode: 'contain',
        backgroundColor: '#06132a',
        dark: {
          image: './assets/images/dispatch-splash-full.png',
          backgroundColor: '#06132a',
        },
      },
    ]);
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-web-browser')) {
    plugins.push('expo-web-browser');
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-font')) {
    plugins.push('expo-font');
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-sharing')) {
    plugins.push('expo-sharing');
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-status-bar')) {
    plugins.push('expo-status-bar');
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-apple-authentication')) {
    plugins.push('expo-apple-authentication');
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-build-properties')) {
    plugins.push([
      'expo-build-properties',
      {
        ios: {
          buildReactNativeFromSource: true,
          extraPods: [
            { name: 'GoogleUtilities', modular_headers: true },
            { name: 'RecaptchaInterop', modular_headers: true },
          ],
        },
      },
    ]);
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-image-picker')) {
    plugins.push([
      'expo-image-picker',
      {
        photosPermission: 'Dispatch needs access to your photo library so you can attach images to chats and events.',
        cameraPermission: 'Dispatch needs camera access so you can take and attach photos to chats.',
        microphonePermission: false,
      },
    ]);
  }
  if (
    googleIosUrlScheme &&
    !plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === '@react-native-google-signin/google-signin')
  ) {
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: googleIosUrlScheme },
    ]);
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-calendar')) {
    plugins.push([
      'expo-calendar',
      {
        calendarPermission: 'Dispatch needs calendar access to add event dates, times, and locations to your calendar.',
        remindersPermission: 'Dispatch needs reminders access when you choose to add or manage an event reminder.',
      },
    ]);
  }
  const notificationsPluginIndex = plugins.findIndex(
    (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-notifications'
  );
  const existingNotificationsPlugin = notificationsPluginIndex >= 0 ? plugins[notificationsPluginIndex] : null;
  const existingNotificationsOptions = Array.isArray(existingNotificationsPlugin)
    ? existingNotificationsPlugin[1] || {}
    : {};
  const notificationsPlugin = [
    'expo-notifications',
    {
      ...existingNotificationsOptions,
      color: '#0EC3C9',
      defaultChannel: 'dispatch-default',
    },
  ];
  if (notificationsPluginIndex >= 0) plugins[notificationsPluginIndex] = notificationsPlugin;
  else plugins.push(notificationsPlugin);
  config.plugins = plugins;

  config.updates = updatesEnabled
    ? {
        ...(config.updates || {}),
        enabled: true,
        checkAutomatically: 'ON_LOAD',
        fallbackToCacheTimeout: 0,
        ...(projectId ? { url: `https://u.expo.dev/${projectId}` } : {}),
      }
    : { enabled: false };

  config.extra = {
    ...(config.extra || {}),
    dispatchBetaMode,
    privacyPolicyUrl: 'https://dispatchcrewmanager.com/privacy',
    supportUrl: 'https://dispatchcrewmanager.com/support',
    eas: {
      ...(config.extra?.eas || {}),
      ...(projectId ? { projectId } : {}),
    },
  };

  return config;
};
