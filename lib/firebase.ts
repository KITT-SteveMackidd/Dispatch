import { initializeApp, getApps } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';

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

export const firebaseConfigWarnings = [
  firebaseConfig.appId && !firebaseConfig.appId.includes(':web:')
    ? 'Firebase App ID does not look like a Web app ID. Use the Firebase Web app config for EXPO_PUBLIC_FIREBASE_APP_ID.'
    : null,
].filter(Boolean) as string[];

function describeFirebaseError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

let firebaseStartupError = missingFirebaseConfigError;
let app: FirebaseApp | null = null;

if (!firebaseStartupError) {
  try {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
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

export const firebaseConfigError = firebaseStartupError;
export const auth = authInstance as unknown as Auth;
export const db = dbInstance as unknown as Firestore;
export const storage = storageInstance as unknown as FirebaseStorage;
