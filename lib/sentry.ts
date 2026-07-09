import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import type { ComponentType } from 'react';

const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();

export const isSentryEnabled = Boolean(sentryDsn);

if (sentryDsn) {
  const update = Updates as typeof Updates & {
    channel?: string | null;
    updateId?: string | null;
    isEmbeddedLaunch?: boolean;
  };

  Sentry.init({
    dsn: sentryDsn,
    debug: false,
    environment: update.channel || process.env.EXPO_PUBLIC_APP_ENV || 'preview',
    release: `${Constants.expoConfig?.slug || 'dispatch'}@${Constants.expoConfig?.version || '1.0.0'}`,
    dist: Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode?.toString(),
    enableNative: true,
    enableNativeCrashHandling: true,
    beforeSend(event) {
      event.tags = {
        ...event.tags,
        expoUpdateId: update.updateId || 'embedded',
        expoIsEmbeddedLaunch: String(Boolean(update.isEmbeddedLaunch)),
      };
      return event;
    },
  });
}

export function captureStartupError(error: Error) {
  if (!isSentryEnabled) return;
  Sentry.captureException(error, {
    tags: {
      area: 'startup',
    },
  });
}

export function wrapWithSentry(Component: ComponentType<Record<string, unknown>>) {
  return isSentryEnabled ? Sentry.wrap(Component) : Component;
}
