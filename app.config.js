const projectId =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  process.env.EAS_PROJECT_ID ||
  '7d0f7257-64f9-443f-ba27-a75af5fbafaa';
const owner = process.env.EXPO_PUBLIC_EXPO_OWNER || process.env.EXPO_OWNER || 'smackidd';
const buildProfile = process.env.EAS_BUILD_PROFILE || process.env.EXPO_PUBLIC_EAS_BUILD_PROFILE;
const updatesEnabled = buildProfile === 'production';
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const shouldUploadSentrySourceMaps = Boolean(sentryOrg && sentryProject && sentryAuthToken);

module.exports = ({ config: baseConfig }) => {
  const config = { ...baseConfig };
  config.splash = {
    ...(config.splash || {}),
    image: './assets/images/dispatch-splash-full.png',
    resizeMode: config.splash?.resizeMode || 'contain',
    backgroundColor: '#061229',
  };

  if (owner) {
    config.owner = owner;
  }

  config.ios = {
    ...(config.ios || {}),
    bundleIdentifier: config.ios?.bundleIdentifier || 'com.smackidd.dispatch',
    infoPlist: {
      ...(config.ios?.infoPlist || {}),
      ITSAppUsesNonExemptEncryption:
        config.ios?.infoPlist?.ITSAppUsesNonExemptEncryption ?? false,
    },
  };

  config.android = {
    ...(config.android || {}),
    package: config.android?.package || 'com.smackidd.dispatch',
  };

  config.runtimeVersion = 'dispatch-sdk54-rn081-v1';

  const plugins = [...(config.plugins || [])];
  if (
    shouldUploadSentrySourceMaps &&
    !plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === '@sentry/react-native/expo')
  ) {
    plugins.push(['@sentry/react-native/expo', { organization: sentryOrg, project: sentryProject }]);
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-splash-screen')) {
    plugins.push([
      'expo-splash-screen',
      {
        image: './assets/images/dispatch-splash-full.png',
        imageWidth: 402,
        resizeMode: 'contain',
        backgroundColor: '#061229',
      },
    ]);
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-web-browser')) {
    plugins.push('expo-web-browser');
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-font')) {
    plugins.push('expo-font');
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-calendar')) {
    plugins.push([
      'expo-calendar',
      {
        calendarPermission: 'Dispatch needs calendar access to add event dates, times, and locations to your calendar.',
        remindersPermission: false,
      },
    ]);
  }
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
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    eas: {
      ...(config.extra?.eas || {}),
      ...(projectId ? { projectId } : {}),
    },
  };

  return config;
};
