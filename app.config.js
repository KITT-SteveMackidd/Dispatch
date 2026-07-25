const projectId =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  process.env.EAS_PROJECT_ID ||
  '7d0f7257-64f9-443f-ba27-a75af5fbafaa';
const owner = process.env.EXPO_PUBLIC_EXPO_OWNER || process.env.EXPO_OWNER || 'smackidd';
const buildProfile = process.env.EAS_BUILD_PROFILE || process.env.EXPO_PUBLIC_EAS_BUILD_PROFILE;
const updatesEnabled = buildProfile === 'production' || buildProfile === 'preview';
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const googleIosUrlScheme = googleIosClientId
  ? `com.googleusercontent.apps.${googleIosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}`
  : null;

module.exports = ({ config: baseConfig }) => {
  const config = { ...baseConfig };
  config.newArchEnabled = true;
  config.splash = {
    ...(config.splash || {}),
    image: './assets/images/dispatch-splash-full.png',
    resizeMode: 'contain',
    backgroundColor: '#06132a',
  };

  if (owner) {
    config.owner = owner;
  }

  config.ios = {
    ...(config.ios || {}),
    bundleIdentifier: config.ios?.bundleIdentifier || 'com.smackidd.dispatch',
    usesAppleSignIn: true,
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

  config.runtimeVersion = 'dispatch-sdk54-rn081-newarch-delegate-v4';

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
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-apple-authentication')) {
    plugins.push('expo-apple-authentication');
  }
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-build-properties')) {
    plugins.push([
      'expo-build-properties',
      {
        ios: {
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
  if (!plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-notifications')) {
    plugins.push('expo-notifications');
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
    eas: {
      ...(config.extra?.eas || {}),
      ...(projectId ? { projectId } : {}),
    },
  };

  return config;
};
