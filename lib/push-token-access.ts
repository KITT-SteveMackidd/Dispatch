import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

type RegisterDevicePushTokenInput = {
  token: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
  permissionStatus: 'granted' | 'denied' | 'undetermined';
};

export async function registerDevicePushTokenThroughServer(input: RegisterDevicePushTokenInput) {
  const registerDevicePushToken = httpsCallable<RegisterDevicePushTokenInput, { previousOwnersRemoved: number }>(
    functions,
    'registerDevicePushToken'
  );
  await registerDevicePushToken(input);
}

export async function unregisterDevicePushTokenThroughServer(input: { token: string }) {
  const unregisterDevicePushToken = httpsCallable<{ token: string }, { ownersRemoved: number }>(
    functions,
    'unregisterDevicePushToken'
  );
  await unregisterDevicePushToken(input);
}
