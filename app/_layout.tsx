import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { splashFullLogoSource } from '@/constants/branding';
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

const STARTUP_TIMEOUT_MS = 8000;

function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    Inter: require('../assets/fonts/Inter-Regular.ttf'),
    'Inter-SemiBold': require('../assets/fonts/Inter-SemiBold.ttf'),
    'Inter-Bold': require('../assets/fonts/Inter-Bold.ttf'),
    'Inter-ExtraBold': require('../assets/fonts/Inter-ExtraBold.ttf'),
    ...FontAwesome.font,
  });
  const [startupTimedOut, setStartupTimedOut] = useState(false);
  const [startupModules, setStartupModules] = useState<StartupModules | null>(null);
  const [startupError, setStartupError] = useState<Error | null>(null);

  useEffect(() => {
    markStartup('root_layout_mounted');
    const timeout = setTimeout(() => {
      setStartupTimedOut(true);
      captureStartupIssue('Dispatch startup font timeout', {
        timeoutMs: STARTUP_TIMEOUT_MS,
      });
    }, STARTUP_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, []);

  const appReady = loaded || startupTimedOut || Boolean(error);

  useEffect(() => {
    if (!appReady || startupModules || startupError) return;

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
  }, [appReady, startupModules, startupError]);

  if (!appReady) return <StartupSplash />;

  if (error || startupError) {
    return <ErrorBoundary error={error || startupError || new Error('Startup failed.')} retry={() => undefined} />;
  }

  if (!startupModules) {
    return <StartupSplash />;
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

  if (loading) return <StartupSplash />;

  return (
    <ThemeProvider value={resolvedThemeMode === 'dark' ? DarkTheme : DefaultTheme}>
      {authUser && profile?.uid && !requiresEmailVerification ? <PushNotificationBridge /> : null}
      {!authUser ? <Redirect href="/(auth)/signin" /> : null}
      {authUser && requiresEmailVerification ? <Redirect href="/(auth)/verify-email" /> : null}
      {authUser && !requiresEmailVerification && needsProfile && !profile ? <Redirect href="/(auth)/setup" /> : null}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/signin" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/signup" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/setup" options={{ title: 'Complete Profile' }} />
        <Stack.Screen name="(auth)/verify-email" options={{ title: 'Verify Email' }} />
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

function StartupSplash() {
  return (
    <View style={styles.startupSplash}>
      <Image source={splashFullLogoSource} style={styles.startupLogo} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  startupSplash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#061229',
  },
  startupLogo: {
    width: '100%',
    aspectRatio: 402 / 310,
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
