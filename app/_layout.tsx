import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Redirect, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { SessionProvider, useSession } from '@/context/session';
import { ThemeProvider as AppThemeProvider, useThemeMode } from '@/context/theme';

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
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const STARTUP_TIMEOUT_MS = 8000;

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    Inter: require('../assets/fonts/Inter-Regular.ttf'),
    'Inter-SemiBold': require('../assets/fonts/Inter-SemiBold.ttf'),
    'Inter-Bold': require('../assets/fonts/Inter-Bold.ttf'),
    'Inter-ExtraBold': require('../assets/fonts/Inter-ExtraBold.ttf'),
    ...FontAwesome.font,
  });
  const [startupTimedOut, setStartupTimedOut] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setStartupTimedOut(true), STARTUP_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, []);

  const appReady = loaded || startupTimedOut || Boolean(error);

  useEffect(() => {
    if (appReady) SplashScreen.hideAsync().catch(() => undefined);
  }, [appReady]);

  if (!appReady) return null;

  if (error) {
    return <ErrorBoundary error={error} retry={() => undefined} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <AppThemeProvider>
          <RootNavigator />
        </AppThemeProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { resolvedThemeMode } = useThemeMode();
  const { authUser, profile, needsProfile, loading, requiresEmailVerification } = useSession();

  if (loading) return null;

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

function PushNotificationBridge() {
  const { usePushNotificationBridge } = require('@/services/push-notifications') as typeof import('@/services/push-notifications');
  usePushNotificationBridge();
  return null;
}

const styles = StyleSheet.create({
  errorScreen: {
    flex: 1,
    backgroundColor: '#f4f6ff',
  },
  errorContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    color: '#111827',
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
    color: '#374151',
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
