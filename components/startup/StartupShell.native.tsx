import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { StartupModules, StartupShellProps } from './StartupShell';

type LoadedStartupModules = StartupModules & {
  SessionProvider: typeof import('@/context/session').SessionProvider;
  AppThemeProvider: typeof import('@/context/theme').ThemeProvider;
};

function describeStartupError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function StartupShell({ children }: StartupShellProps) {
  const [modules, setModules] = useState<LoadedStartupModules | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setModules(null);
    setStartupError(null);
    const timeout = setTimeout(() => {
      if (active) {
        setStartupError('Startup modules took too long to load.');
      }
    }, 10000);

    async function loadStartupModules() {
      try {
        const [sessionModule, themeModule] = await Promise.all([
          import('@/context/session'),
          import('@/context/theme'),
        ]);

        if (!active) return;
        clearTimeout(timeout);
        setModules({
          SessionProvider: sessionModule.SessionProvider,
          AppThemeProvider: themeModule.ThemeProvider,
          useSession: sessionModule.useSession,
          useThemeMode: themeModule.useThemeMode,
        });
      } catch (error) {
        if (!active) return;
        clearTimeout(timeout);
        setStartupError(describeStartupError(error));
      }
    }

    loadStartupModules();

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [retryKey]);

  if (startupError) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Dispatch startup failed</Text>
          <Text selectable style={styles.message}>
            {startupError}
          </Text>
          <Pressable style={styles.button} onPress={() => setRetryKey((value) => value + 1)}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (!modules) {
    return (
      <View style={styles.screen}>
        <Text style={styles.brand}>Dispatch</Text>
        <Text style={styles.loading}>Starting...</Text>
      </View>
    );
  }

  const { SessionProvider, AppThemeProvider } = modules;

  return (
    <SessionProvider>
      <AppThemeProvider>{children(modules)}</AppThemeProvider>
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#061229',
    padding: 24,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  brand: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 8,
  },
  loading: {
    color: '#dbeafe',
    fontSize: 16,
    fontWeight: '700',
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
    fontWeight: '700',
    marginBottom: 24,
  },
  button: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#17bfc5',
    borderRadius: 10,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
});
