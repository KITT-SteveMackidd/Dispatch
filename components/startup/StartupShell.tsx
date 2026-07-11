import type { ReactNode } from 'react';

import type { useSession as useSessionHook } from '@/context/session';
import type { useThemeMode as useThemeModeHook } from '@/context/theme';

export type StartupModules = {
  useSession: typeof useSessionHook;
  useThemeMode: typeof useThemeModeHook;
};

export type StartupShellProps = {
  children: (modules: StartupModules) => ReactNode;
};

export declare function StartupShell(props: StartupShellProps): ReactNode;
