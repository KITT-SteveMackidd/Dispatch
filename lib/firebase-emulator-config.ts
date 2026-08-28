export type FirebaseEmulatorConfiguration = {
  requested: boolean;
  enabled: boolean;
  host: string | null;
  projectId: string | null;
  error: string | null;
};

function clean(value?: string | null) {
  return value?.trim() || null;
}

export function selectFirebaseEmulatorConfiguration(params: {
  enabledValue?: string | null;
  hostValue?: string | null;
  projectId?: string | null;
  isDevelopment: boolean;
}): FirebaseEmulatorConfiguration {
  const requested = clean(params.enabledValue)?.toLowerCase() === 'true';
  const host = clean(params.hostValue);
  const projectId = clean(params.projectId);

  if (!requested) return { requested, enabled: false, host, projectId, error: null };
  if (!params.isDevelopment) {
    return {
      requested,
      enabled: false,
      host,
      projectId,
      error: 'Firebase emulators are restricted to local development builds.',
    };
  }
  if (!host) {
    return {
      requested,
      enabled: false,
      host,
      projectId,
      error: 'EXPO_PUBLIC_FIREBASE_EMULATOR_HOST is required when Firebase emulator mode is enabled.',
    };
  }
  if (!/^[A-Za-z0-9.-]+$/.test(host)) {
    return {
      requested,
      enabled: false,
      host,
      projectId,
      error: 'Firebase emulator host must be a hostname or IP address without a scheme, path, or port.',
    };
  }
  if (!projectId?.startsWith('demo-')) {
    return {
      requested,
      enabled: false,
      host,
      projectId,
      error: 'Firebase emulator mode requires a demo- project ID so it cannot fall through to live Firebase resources.',
    };
  }

  return { requested, enabled: true, host, projectId, error: null };
}
