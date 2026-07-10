import { initializeApp, getApps } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';

const env = (key: string) => process.env[key]?.trim();

const firebaseConfigKeys = {
  apiKey: 'EXPO_PUBLIC_FIREBASE_API_KEY',
  authDomain: 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket: 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'EXPO_PUBLIC_FIREBASE_APP_ID',
} as const;

const firebaseConfig: Record<keyof typeof firebaseConfigKeys, string | undefined> = {
  apiKey: env(firebaseConfigKeys.apiKey),
  authDomain: env(firebaseConfigKeys.authDomain),
  projectId: env(firebaseConfigKeys.projectId),
  storageBucket: env(firebaseConfigKeys.storageBucket),
  messagingSenderId: env(firebaseConfigKeys.messagingSenderId),
  appId: env(firebaseConfigKeys.appId),
};

const missingFirebaseConfigKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => firebaseConfigKeys[key as keyof typeof firebaseConfigKeys]);

export const firebaseConfigError = missingFirebaseConfigKeys.length
  ? `Missing Firebase configuration: ${missingFirebaseConfigKeys.join(', ')}`
  : null;

const app: FirebaseApp | null = firebaseConfigError
  ? null
  : getApps().length
    ? getApps()[0]
    : initializeApp(firebaseConfig);
const storageBucketUrl = firebaseConfig.storageBucket ? `gs://${firebaseConfig.storageBucket}` : undefined;

export const auth = app ? getAuth(app) : (null as unknown as Auth);
export const db = app ? getFirestore(app) : (null as unknown as Firestore);
export const storage = app ? getStorage(app, storageBucketUrl) : (null as unknown as FirebaseStorage);
