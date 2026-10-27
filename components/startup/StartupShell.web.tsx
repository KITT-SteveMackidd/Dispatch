import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { SessionProvider, useSession } from '@/context/session';
import { ThemeProvider as AppThemeProvider, useThemeMode } from '@/context/theme';
import type { StartupShellProps } from './StartupShell';
import { loadStartupFonts } from './startupFonts';

export function StartupShell({ children }: StartupShellProps) {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setFontsLoaded(false);
    setStartupError(null);
    const timeout = setTimeout(() => {
      if (active) setStartupError('Startup fonts took too long to load.');
    }, 10000);

    loadStartupFonts().then(() => {
      if (!active) return;
      clearTimeout(timeout);
      setStartupError(null);
      setFontsLoaded(true);
    }).catch((error: unknown) => {
      if (!active) return;
      clearTimeout(timeout);
      setStartupError(error instanceof Error ? error.message : String(error));
    });

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [retryKey]);

  if (startupError) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Dispatch startup failed</Text>
        <Text selectable style={styles.message}>{startupError}</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => setRetryKey((value) => value + 1)}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!fontsLoaded) {
    return (
      <View style={styles.screen}>
        <Image
          source={require('../../assets/images/dispatch-splash-full.png')}
          style={styles.splashImage}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <SessionProvider>
      <AppThemeProvider>{children({ useSession, useThemeMode })}</AppThemeProvider>
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#06132a',
    padding: 24,
  },
  splashImage: {
    width: '100%',
    maxWidth: 402,
    aspectRatio: 402 / 310,
  },
  title: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 12,
  },
  message: {
    color: '#fca5a5',
    fontSize: 16,
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#17bfc5',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
});
