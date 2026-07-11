import { SessionProvider, useSession } from '@/context/session';
import { ThemeProvider as AppThemeProvider, useThemeMode } from '@/context/theme';
import type { StartupShellProps } from './StartupShell';

export function StartupShell({ children }: StartupShellProps) {
  return (
    <SessionProvider>
      <AppThemeProvider>{children({ useSession, useThemeMode })}</AppThemeProvider>
    </SessionProvider>
  );
}
