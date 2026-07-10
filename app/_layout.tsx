import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { captureStartupIssue, markStartup, Sentry } from '@/lib/sentry';

type SessionModule = typeof import('@/context/session');
type ThemeModule = typeof import('@/context/theme');
type StartupModules = {
  session: SessionModule;
  theme: ThemeModule;
};

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <View style={styles.errorScreen}>
      <ScrollView contentContainerStyle={styles.errorContent}>
        <Text style={styles.errorTitle}>Dispatch hit a startup error</Text>
        <Text selectable style={styles.errorMessage}>{error.message || 'Something went wrong.'}</Text>
        {error.stack ? <Text selectable style={styles.errorStack}>{error.stack}</Text> : null}
        <Pressable style={styles.errorButton} onPress={retry}>
          <Text style={styles.errorButtonText}>Try again</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

export const unstable_settings = {
  initialRouteName: '(auth)/signin',
};

function RootLayout() {
  const [startupModules, setStartupModules] = useState<StartupModules | null>(null);
  const [startupError, setStartupError] = useState<Error | null>(null);

  useEffect(() => {
    markStartup('root_layout_mounted');
    try {
      markStartup('loading_startup_modules');
      setStartupModules({
        session: require('@/context/session') as SessionModule,
        theme: require('@/context/theme') as ThemeModule,
      });
      markStartup('startup_modules_loaded');
    } catch (moduleError) {
      captureStartupIssue('Dispatch startup module load failed', {
        message: moduleError instanceof Error ? moduleError.message : String(moduleError),
      });
      setStartupError(moduleError instanceof Error ? moduleError : new Error('Unable to load startup modules.'));
    }
  }, []);

  if (startupError) {
    return <ErrorBoundary error={startupError} retry={() => undefined} />;
  }

  if (!startupModules) {
    return <BootScreen />;
  }

  return <LoadedApp modules={startupModules} />;
}

function LoadedApp({ modules }: { modules: StartupModules }) {
  const { SessionProvider } = modules.session;
  const { ThemeProvider: AppThemeProvider } = modules.theme;

  useEffect(() => {
    markStartup('render_loaded_app');
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <AppThemeProvider>
          <RootNavigator modules={modules} />
        </AppThemeProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator({ modules }: { modules: StartupModules }) {
  const { useSession } = modules.session;
  const { useThemeMode } = modules.theme;
  const { resolvedThemeMode } = useThemeMode();
  const { authUser, profile, needsProfile, loading, requiresEmailVerification } = useSession();

  useEffect(() => {
    markStartup('root_navigator_state', {
      hasAuthUser: Boolean(authUser),
      hasProfile: Boolean(profile),
      needsProfile,
      loading,
      requiresEmailVerification,
    });
  }, [authUser, profile, needsProfile, loading, requiresEmailVerification]);

  return (
    <ThemeProvider value={resolvedThemeMode === 'dark' ? DarkTheme : DefaultTheme}>
      {authUser && profile?.uid && !requiresEmailVerification ? <PushNotificationBridge /> : null}
      {loading || !authUser ? <Redirect href="/(auth)/signin" /> : null}
      {!loading && authUser && requiresEmailVerification ? <Redirect href="/(auth)/verify-email" /> : null}
      {!loading && authUser && !requiresEmailVerification && needsProfile && !profile ? <Redirect href="/(auth)/setup" /> : null}
      <Stack>
        <Stack.Screen name="(auth)/signin" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/signup" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/setup" options={{ title: 'Complete Profile' }} />
        <Stack.Screen name="(auth)/verify-email" options={{ title: 'Verify Email' }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="account-settings" options={{ title: 'Account Settings' }} />
        <Stack.Screen name="team/[teamId]" options={{ title: 'Team' }} />
        <Stack.Screen name="chat/[workerId]" options={{ headerShown: false }} />
        <Stack.Screen name="event/[id]" options={{ presentation: 'modal', title: 'Event Details' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default Sentry.wrap(RootLayout);

function PushNotificationBridge() {
  const { usePushNotificationBridge } = require('@/services/push-notifications') as typeof import('@/services/push-notifications');
  usePushNotificationBridge();
  return null;
}

function BootScreen() {
  return (
    <View style={styles.bootScreen}>
      <Text style={styles.bootTitle}>Dispatch</Text>
      <Text style={styles.bootText}>Starting...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bootScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#061229',
    padding: 24,
  },
  bootTitle: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 8,
  },
  bootText: {
    color: '#dbeafe',
    fontSize: 16,
    fontWeight: '700',
  },
  errorScreen: {
    flex: 1,
    backgroundColor: '#061229',
  },
  errorContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 12,
  },
  errorMessage: {
    color: '#b42318',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
  },
  errorStack: {
    color: '#dbeafe',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 24,
  },
  errorButton: {
    alignItems: 'center',
    backgroundColor: '#17bfc5',
    borderRadius: 10,
    paddingVertical: 14,
  },
  errorButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
});
