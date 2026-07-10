import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
const buildProfile = process.env.EAS_BUILD_PROFILE || process.env.EXPO_PUBLIC_EAS_BUILD_PROFILE || 'local';
const release = `${Constants.expoConfig?.slug || 'dispatch'}@${Constants.expoConfig?.version || '0.0.0'}`;

export const isSentryEnabled = Boolean(dsn);

Sentry.init({
  dsn,
  enabled: isSentryEnabled,
  release,
  environment: buildProfile,
  tracesSampleRate: buildProfile === 'preview' ? 1.0 : 0.2,
  enableAutoSessionTracking: true,
  attachStacktrace: true,
});

const scope = Sentry.getGlobalScope();
scope.setTag('dispatch.build_profile', buildProfile);
scope.setTag('dispatch.runtime_version', String(Constants.expoConfig?.runtimeVersion || 'unknown'));
scope.setTag('expo.execution_environment', Constants.executionEnvironment);
scope.setTag('expo.update_id', Updates.updateId || 'embedded');
scope.setTag('expo.is_embedded_launch', String(Updates.isEmbeddedLaunch));

if (isSentryEnabled) {
  Sentry.captureException(new Error('Dispatch preview startup heartbeat'), {
    tags: {
      area: 'startup',
      kind: 'heartbeat',
    },
    extra: {
      buildProfile,
      release,
      executionEnvironment: Constants.executionEnvironment,
      updateId: Updates.updateId || 'embedded',
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    },
  });
  Sentry.flush().catch(() => undefined);
}

export function markStartup(step: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({
    category: 'dispatch.startup',
    level: 'info',
    message: step,
    data,
  });
}

export function captureStartupIssue(message: string, data?: Record<string, unknown>) {
  Sentry.captureException(new Error(message), {
    tags: {
      area: 'startup',
    },
    extra: data,
  });
}

export { Sentry };
