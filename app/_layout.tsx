import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SessionProvider, useSession } from '@/context/session';
import { ThemeProvider as AppThemeProvider, useThemeMode } from '@/context/theme';
import { markStartup, Sentry } from '@/lib/sentry';

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
  initialRouteName: 'index',
};

function RootLayout() {
  useEffect(() => {
    markStartup('root_layout_mounted');
  }, []);

  return (
    <SessionProvider>
      <AppThemeProvider>
        <RootNavigator />
      </AppThemeProvider>
    </SessionProvider>
  );
}

function RootNavigator() {
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
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
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

const styles = StyleSheet.create({
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
