import { initializeApp, getApps } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { firebaseFunctionsRegion } from './firebase-region';
import type { Functions } from 'firebase/functions';
import { selectFirebaseEmulatorConfiguration } from './firebase-emulator-config';

const cleanEnv = (value?: string) => value?.trim();

const firebaseConfigKeys = {
  apiKey: 'EXPO_PUBLIC_FIREBASE_API_KEY',
  authDomain: 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket: 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'EXPO_PUBLIC_FIREBASE_APP_ID',
} as const;

const firebaseConfig: Record<keyof typeof firebaseConfigKeys, string | undefined> = {
  apiKey: cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_API_KEY),
  authDomain: cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN),
  projectId: cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID),
  storageBucket: cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  appId: cleanEnv(process.env.EXPO_PUBLIC_FIREBASE_APP_ID),
};

const missingFirebaseConfigKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => firebaseConfigKeys[key as keyof typeof firebaseConfigKeys]);

const missingFirebaseConfigError = missingFirebaseConfigKeys.length
  ? `Missing Firebase configuration: ${missingFirebaseConfigKeys.join(', ')}`
  : null;

const isDevelopmentRuntime = typeof __DEV__ !== 'undefined' && __DEV__;
const selectedFirebaseEmulatorConfiguration = selectFirebaseEmulatorConfiguration({
  enabledValue: process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS,
  hostValue: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST,
  projectId: firebaseConfig.projectId,
  isDevelopment: isDevelopmentRuntime,
});
const firebaseEmulatorHost = selectedFirebaseEmulatorConfiguration.host;
const firebaseEmulatorConfigError = selectedFirebaseEmulatorConfiguration.error;

export const firebaseConfigWarnings = [
  firebaseConfig.appId && !firebaseConfig.appId.includes(':web:')
    ? 'Firebase App ID does not look like a Web app ID. Use the Firebase Web app config for EXPO_PUBLIC_FIREBASE_APP_ID.'
    : null,
].filter(Boolean) as string[];

function describeFirebaseError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

let firebaseStartupError = missingFirebaseConfigError || firebaseEmulatorConfigError;
let app: FirebaseApp | null = null;

if (!firebaseStartupError) {
  try {
    const existingApp = getApps()[0];
    if (existingApp && existingApp.options.projectId !== firebaseConfig.projectId) {
      throw new Error(
        `Firebase was already initialized for ${existingApp.options.projectId || 'an unknown project'}; fully restart the app before switching to ${firebaseConfig.projectId}.`
      );
    }
    app = existingApp || initializeApp(firebaseConfig);
  } catch (error) {
    firebaseStartupError = `Firebase initialization failed: ${describeFirebaseError(error)}`;
  }
}

const storageBucketUrl = firebaseConfig.storageBucket ? `gs://${firebaseConfig.storageBucket}` : undefined;

function initializeFirebaseService<T>(serviceName: string, factory: (firebaseApp: FirebaseApp) => T): T | null {
  if (!app || firebaseStartupError) return null;

  try {
    return factory(app);
  } catch (error) {
    firebaseStartupError = `${serviceName} initialization failed: ${describeFirebaseError(error)}`;
    return null;
  }
}

const authInstance = initializeFirebaseService('Firebase Auth', (firebaseApp) => getAuth(firebaseApp));
const dbInstance = initializeFirebaseService('Firestore', (firebaseApp) => getFirestore(firebaseApp));
const storageInstance = initializeFirebaseService('Firebase Storage', (firebaseApp) =>
  getStorage(firebaseApp, storageBucketUrl)
);
const functionsInstance = initializeFirebaseService('Firebase Functions', (firebaseApp) =>
  getFunctions(firebaseApp, firebaseFunctionsRegion(firebaseConfig.projectId))
);

type DispatchFirebaseGlobal = typeof globalThis & {
  __dispatchFirebaseEmulatorsConnected?: boolean;
};

const dispatchFirebaseGlobal = globalThis as DispatchFirebaseGlobal;
if (
  !firebaseStartupError
  && selectedFirebaseEmulatorConfiguration.enabled
  && firebaseEmulatorHost
  && authInstance
  && dbInstance
  && storageInstance
  && functionsInstance
  && !dispatchFirebaseGlobal.__dispatchFirebaseEmulatorsConnected
) {
  try {
    connectAuthEmulator(authInstance, `http://${firebaseEmulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(dbInstance, firebaseEmulatorHost, 8080);
    connectStorageEmulator(storageInstance, firebaseEmulatorHost, 9199);
    connectFunctionsEmulator(functionsInstance, firebaseEmulatorHost, 5001);
    dispatchFirebaseGlobal.__dispatchFirebaseEmulatorsConnected = true;
  } catch (error) {
    firebaseStartupError = `Firebase emulator connection failed: ${describeFirebaseError(error)}`;
  }
}

export const firebaseConfigError = firebaseStartupError;
export const firebaseEmulatorConfiguration = Object.freeze({
  enabled: selectedFirebaseEmulatorConfiguration.enabled && !firebaseStartupError,
  host: firebaseEmulatorHost || null,
  projectId: firebaseConfig.projectId || null,
});
export const auth = authInstance as unknown as Auth;
export const db = dbInstance as unknown as Firestore;
export const storage = storageInstance as unknown as FirebaseStorage;
export const functions = functionsInstance as unknown as Functions;
