import { getFunctions, httpsCallable } from 'firebase/functions';

type RegisterDevicePushTokenInput = {
  token: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
  permissionStatus: 'granted' | 'denied' | 'undetermined';
};

export async function registerDevicePushTokenThroughServer(input: RegisterDevicePushTokenInput) {
  const registerDevicePushToken = httpsCallable<RegisterDevicePushTokenInput, { previousOwnersRemoved: number }>(
    getFunctions(undefined, 'us-central1'),
    'registerDevicePushToken'
  );
  await registerDevicePushToken(input);
}

export async function unregisterDevicePushTokenThroughServer(input: { token: string }) {
  const unregisterDevicePushToken = httpsCallable<{ token: string }, { ownersRemoved: number }>(
    getFunctions(undefined, 'us-central1'),
    'unregisterDevicePushToken'
  );
  await unregisterDevicePushToken(input);
}
