import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import { auth, db, firebaseConfigError } from '@/lib/firebase';
import { captureStartupIssue, markStartup } from '@/lib/sentry';
import { AppRole, UserProfile } from '@/types/dispatch';

type SessionContextType = {
  profile: UserProfile | null;
  authUser: User | null;
  loading: boolean;
  needsProfile: boolean;
  requiresEmailVerification: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (params: { idToken: string; accessToken?: string; role?: AppRole }) => Promise<void>;
  signInWithApple: (params: { idToken: string; displayName?: string; role?: AppRole }) => Promise<void>;
  signUp: (params: { email: string; password: string; displayName: string; role: AppRole }) => Promise<void>;
  saveProfile: (params: { displayName: string; role: AppRole; phoneNumber?: string }) => Promise<void>;
  refreshProfile: () => Promise<UserProfile | null>;
  sendPasswordReset: (email: string) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  refreshAuthUser: () => Promise<boolean>;
  revokeSession: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextType | undefined>(undefined);
const SESSION_STARTUP_TIMEOUT_MS = 8000;
const PROFILE_STARTUP_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}

async function loadProfile(uid: string): Promise<UserProfile | null> {
  if (firebaseConfigError) return null;
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<UserProfile>;
  const role = normalizeRole(data.role);
  if (!role) return null;
  return {
    uid,
    displayName: data.displayName || 'Dispatch User',
    role,
    organizationId: data.organizationId || null,
    organizationName: data.organizationName || null,
    email: data.email || null,
    canonicalEmail: data.canonicalEmail || null,
    phoneNumber: data.phoneNumber,
  };
}

function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() || '';
}

function canonicalizeEmail(email?: string | null) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.indexOf('@');
  if (atIndex <= 0) return normalized;

  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  const plusIndex = local.indexOf('+');
  return `${plusIndex >= 0 ? local.slice(0, plusIndex) : local}@${domain}`;
}

function normalizeRole(role?: string | null): AppRole | null {
  const value = role?.trim().toLowerCase();
  return value === 'manager' || value === 'worker' ? value : null;
}

function displayNameFromEmail(email?: string | null) {
  const local = normalizeEmail(email).split('@')[0];
  const withoutAlias = local.split('+')[0];
  const words = withoutAlias.split(/[._-]+/).filter(Boolean);
  if (!words.length) return '';
  return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(' ');
}

function cleanDisplayName(displayName?: string | null, email?: string | null) {
  const trimmed = displayName?.trim();
  if (trimmed && trimmed.toLowerCase() !== 'dispatch user') return trimmed;
  return displayNameFromEmail(email) || 'Dispatch User';
}

function getDispatchServices() {
  return require('@/services/dispatch') as typeof import('@/services/dispatch');
}

async function syncInviteLinking(userId: string, email?: string | null, role?: AppRole | null) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;

  if (role === 'worker') {
    const { acceptPendingWorkerInvitesForUser } = getDispatchServices();
    await acceptPendingWorkerInvitesForUser({ userId, email: normalizedEmail }).catch(() => null);
    return;
  }

  if (role === 'manager') {
    const { linkPendingManagerInvites } = getDispatchServices();
    await linkPendingManagerInvites({ userId, email: normalizedEmail }).catch(() => null);
    return;
  }

  const { acceptPendingInvitesForUser, linkPendingManagerInvites } = getDispatchServices();
  await acceptPendingInvitesForUser({ userId, email: normalizedEmail }).catch(() => null);
  await linkPendingManagerInvites({ userId, email: normalizedEmail }).catch(() => null);
}

function assertFirebaseConfigured() {
  if (firebaseConfigError) {
    throw new Error(`${firebaseConfigError}. Rebuild the app with the required Firebase environment variables.`);
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsProfile, setNeedsProfile] = useState(false);

  const requiresEmailVerification = Boolean(authUser && !authUser.emailVerified);

  useEffect(() => {
    markStartup('session_effect_started', {
      firebaseConfigError: Boolean(firebaseConfigError),
    });

    if (firebaseConfigError) {
      captureStartupIssue('Dispatch Firebase config missing in build', {
        firebaseConfigError,
      });
      setAuthUser(null);
      setProfile(null);
      setNeedsProfile(false);
      setLoading(false);
      return;
    }

    let authStateReceived = false;
    const timeout = setTimeout(() => {
      if (authStateReceived) return;
      const currentUser = auth.currentUser;
      captureStartupIssue('Dispatch auth state startup timeout', {
        timeoutMs: SESSION_STARTUP_TIMEOUT_MS,
        hasCurrentUser: Boolean(currentUser),
      });
      setAuthUser(currentUser);
      setProfile(null);
      setNeedsProfile(Boolean(currentUser));
      setLoading(false);
    }, SESSION_STARTUP_TIMEOUT_MS);

    const unsub = onAuthStateChanged(auth, async (user) => {
      markStartup('auth_state_received', {
        hasUser: Boolean(user),
        emailVerified: Boolean(user?.emailVerified),
      });
      authStateReceived = true;
      clearTimeout(timeout);
      setAuthUser(user);

      if (!user) {
        setProfile(null);
        setNeedsProfile(false);
        setLoading(false);
        return;
      }

      try {
        markStartup('profile_load_started', { uid: user.uid });
        const p = await withTimeout(
          loadProfile(user.uid),
          PROFILE_STARTUP_TIMEOUT_MS,
          'Timed out loading profile.'
        );
        markStartup('profile_load_finished', {
          hasProfile: Boolean(p),
          role: p?.role,
          hasOrganization: Boolean(p?.organizationId),
        });
        setProfile(p);
        setNeedsProfile(!p);
      } catch (profileError) {
        captureStartupIssue('Dispatch profile startup load failed', {
          uid: user.uid,
          message: profileError instanceof Error ? profileError.message : String(profileError),
        });
        setProfile(null);
        setNeedsProfile(true);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(timeout);
      unsub();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    assertFirebaseConfigured();
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);

    if (!cred.user.emailVerified) {
      await firebaseSignOut(auth);
      throw new Error('Please verify your email address before signing in. Check your inbox for the verification link.');
    }

    let nextProfile = await loadProfile(cred.user.uid);
    await syncInviteLinking(cred.user.uid, cred.user.email || email, nextProfile?.role);
    nextProfile = await loadProfile(cred.user.uid);
    if (nextProfile) {
      setProfile(nextProfile);
      setNeedsProfile(false);
    }
  };

  const upsertProfile = async (params: { uid: string; displayName: string; role: AppRole; email?: string | null; phoneNumber?: string | null; merge?: boolean }) => {
    assertFirebaseConfigured();
    const normalizedEmail = normalizeEmail(params.email);
    const displayName = cleanDisplayName(params.displayName, normalizedEmail);
    await setDoc(
      doc(db, 'users', params.uid),
      {
        uid: params.uid,
        displayName,
        role: params.role,
        email: normalizedEmail || null,
        canonicalEmail: canonicalizeEmail(normalizedEmail) || null,
        phoneNumber: params.phoneNumber?.trim() || null,
        updatedAt: serverTimestamp(),
        ...(params.merge ? {} : { organizationId: null, organizationName: null, createdAt: serverTimestamp() }),
      },
      { merge: params.merge ?? true }
    );

    setNeedsProfile(false);

    await syncInviteLinking(params.uid, normalizedEmail, params.role);
    const nextProfile = await loadProfile(params.uid);
    setProfile(nextProfile || { uid: params.uid, displayName, role: params.role, organizationId: null, organizationName: null, email: normalizedEmail || null, canonicalEmail: canonicalizeEmail(normalizedEmail) || null, phoneNumber: params.phoneNumber?.trim() || undefined });
  };

  const signInWithGoogle = async (params: { idToken: string; accessToken?: string; role?: AppRole }) => {
    assertFirebaseConfigured();
    const credential = GoogleAuthProvider.credential(params.idToken, params.accessToken);
    const cred = await signInWithCredential(auth, credential);
    const additional = getAdditionalUserInfo(cred);

    const existing = await loadProfile(cred.user.uid);
    if (!existing && params.role) {
      await upsertProfile({
        uid: cred.user.uid,
        displayName: cleanDisplayName(cred.user.displayName, cred.user.email),
        role: params.role,
        email: cred.user.email,
        merge: false,
      });
      return;
    }

    await syncInviteLinking(cred.user.uid, cred.user.email, existing?.role);
    const nextProfile = await loadProfile(cred.user.uid);

    if (nextProfile) {
      setProfile(nextProfile);
      setNeedsProfile(false);
    } else {
      setNeedsProfile(true);
      if (additional?.isNewUser && !params.role) {
        setProfile(null);
      }
    }
  };

  const signInWithApple = async (params: { idToken: string; displayName?: string; role?: AppRole }) => {
    assertFirebaseConfigured();
    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({ idToken: params.idToken });
    const cred = await signInWithCredential(auth, credential);

    if (params.displayName) {
      await updateProfile(cred.user, { displayName: params.displayName });
    }

    const existing = await loadProfile(cred.user.uid);
    if (!existing && params.role) {
      await upsertProfile({
        uid: cred.user.uid,
        displayName: cleanDisplayName(params.displayName || cred.user.displayName, cred.user.email),
        role: params.role,
        email: cred.user.email,
        merge: false,
      });
      return;
    }

    await syncInviteLinking(cred.user.uid, cred.user.email, existing?.role);
    const nextProfile = await loadProfile(cred.user.uid);

    if (nextProfile) {
      setProfile(nextProfile);
      setNeedsProfile(false);
    } else {
      setNeedsProfile(true);
      setProfile(null);
    }
  };

  const signUp = async (params: { email: string; password: string; displayName: string; role: AppRole }) => {
    assertFirebaseConfigured();
    const normalizedEmail = params.email.trim();
    const trimmedName = params.displayName.trim();

    const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, params.password);
    await updateProfile(cred.user, { displayName: trimmedName });
    await sendEmailVerification(cred.user);

    await upsertProfile({
      uid: cred.user.uid,
      displayName: trimmedName,
      role: params.role,
      email: normalizedEmail,
      merge: false,
    });
  };

  const saveProfile = async (params: { displayName: string; role: AppRole; phoneNumber?: string }) => {
    assertFirebaseConfigured();
    if (!auth.currentUser) throw new Error('Not authenticated');
    const user = auth.currentUser;
    await updateProfile(user, { displayName: params.displayName.trim() });
    await setDoc(
      doc(db, 'users', user.uid),
      {
        uid: user.uid,
        displayName: params.displayName.trim(),
        role: params.role,
        email: normalizeEmail(user.email) || null,
        canonicalEmail: canonicalizeEmail(user.email) || null,
        phoneNumber: params.phoneNumber?.trim() || null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (params.role === 'worker') {
      const { acceptPendingWorkerInvitesForUser } = getDispatchServices();
      await acceptPendingWorkerInvitesForUser({ userId: user.uid, email: user.email || '' }).catch(() => null);
    } else {
      await syncInviteLinking(user.uid, user.email);
    }

    const nextProfile = await loadProfile(user.uid);
    setProfile(nextProfile || { uid: user.uid, displayName: params.displayName.trim(), role: params.role, organizationId: null, organizationName: null, phoneNumber: params.phoneNumber?.trim() || undefined });
    setNeedsProfile(false);
  };

  const refreshProfile = async () => {
    if (firebaseConfigError) return null;
    if (!auth.currentUser) return null;
    const nextProfile = await loadProfile(auth.currentUser.uid);
    setProfile(nextProfile);
    setNeedsProfile(!nextProfile);
    return nextProfile;
  };

  const sendPasswordReset = async (email: string) => {
    assertFirebaseConfigured();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) throw new Error('Email is required.');
    await sendPasswordResetEmail(auth, normalizedEmail);
  };

  const sendVerificationEmail = async () => {
    assertFirebaseConfigured();
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    await sendEmailVerification(user);
  };

  const refreshAuthUser = async () => {
    if (firebaseConfigError) return false;
    const user = auth.currentUser;
    if (!user) {
      setAuthUser(null);
      return false;
    }

    await user.reload();
    const refreshed = auth.currentUser;
    setAuthUser(refreshed);
    return Boolean(refreshed?.emailVerified);
  };

  const revokeSession = async () => {
    assertFirebaseConfigured();
    await firebaseSignOut(auth);
    setProfile(null);
    setNeedsProfile(false);
  };

  const signOut = async () => {
    assertFirebaseConfigured();
    await firebaseSignOut(auth);
    setProfile(null);
    setNeedsProfile(false);
  };

  const value = useMemo(
    () => ({
      profile,
      authUser,
      loading,
      needsProfile,
      requiresEmailVerification,
      signIn,
      signInWithGoogle,
      signInWithApple,
      signUp,
      saveProfile,
      refreshProfile,
      sendPasswordReset,
      sendVerificationEmail,
      refreshAuthUser,
      revokeSession,
      signOut,
    }),
    [profile, authUser, loading, needsProfile, requiresEmailVerification]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
