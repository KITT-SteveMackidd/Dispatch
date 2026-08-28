import { describe, expect, it } from 'vitest';
import { selectFirebaseEmulatorConfiguration } from '../lib/firebase-emulator-config';

describe('Firebase emulator configuration', () => {
  it('keeps normal builds disconnected when emulator mode is not requested', () => {
    expect(selectFirebaseEmulatorConfiguration({
      enabledValue: 'false',
      hostValue: undefined,
      projectId: 'dispatch-eb63a',
      isDevelopment: true,
    })).toMatchObject({ requested: false, enabled: false, error: null });
  });

  it('accepts a local demo project and LAN host in development', () => {
    expect(selectFirebaseEmulatorConfiguration({
      enabledValue: 'true',
      hostValue: '192.168.1.45',
      projectId: 'demo-dispatch-billing',
      isDevelopment: true,
    })).toEqual({
      requested: true,
      enabled: true,
      host: '192.168.1.45',
      projectId: 'demo-dispatch-billing',
      error: null,
    });
  });

  it('fails closed for a real Firebase project', () => {
    const result = selectFirebaseEmulatorConfiguration({
      enabledValue: 'true',
      hostValue: '127.0.0.1',
      projectId: 'dispatch-eb63a',
      isDevelopment: true,
    });
    expect(result.enabled).toBe(false);
    expect(result.error).toContain('demo- project ID');
  });

  it('fails closed outside development and for host strings containing URLs or ports', () => {
    expect(selectFirebaseEmulatorConfiguration({
      enabledValue: 'true',
      hostValue: '127.0.0.1',
      projectId: 'demo-dispatch-billing',
      isDevelopment: false,
    }).enabled).toBe(false);
    expect(selectFirebaseEmulatorConfiguration({
      enabledValue: 'true',
      hostValue: 'http://127.0.0.1:8080',
      projectId: 'demo-dispatch-billing',
      isDevelopment: true,
    }).error).toContain('without a scheme, path, or port');
  });
});
