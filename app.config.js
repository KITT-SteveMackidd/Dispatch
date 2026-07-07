const projectId =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  process.env.EAS_PROJECT_ID ||
  '7d0f7257-64f9-443f-ba27-a75af5fbafaa';
const owner = process.env.EXPO_PUBLIC_EXPO_OWNER || process.env.EXPO_OWNER || 'smackidd';

module.exports = ({ config: baseConfig }) => {
  const config = { ...baseConfig };

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

  config.runtimeVersion = {
    policy: 'appVersion',
  };

  const plugins = [...(config.plugins || [])];
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

  config.updates = {
    ...(config.updates || {}),
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    ...(projectId ? { url: `https://u.expo.dev/${projectId}` } : {}),
  };

  config.extra = {
    ...(config.extra || {}),
    eas: {
      ...(config.extra?.eas || {}),
      ...(projectId ? { projectId } : {}),
    },
  };

  return config;
};
