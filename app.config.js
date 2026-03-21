const appJson = require('./app.json');

const config = { ...appJson.expo };

const projectId =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  process.env.EAS_PROJECT_ID ||
  '7d0f7257-64f9-443f-ba27-a75af5fbafaa';
const owner = process.env.EXPO_PUBLIC_EXPO_OWNER || process.env.EXPO_OWNER || 'smackidd';

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

config.plugins = Array.from(
  new Set([...(config.plugins || []), 'expo-web-browser'])
);

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

module.exports = {
  expo: config,
};
