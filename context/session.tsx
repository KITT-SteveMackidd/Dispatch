import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
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
import {
  clearDispatchNotificationState,
  forgetRegisteredDevicePushToken,
  unregisterCurrentDevicePushToken,
} from '@/services/push-token-session';
import { shouldLinkPendingWorkerInvites } from '@/lib/chat-list-membership';
import { requestDispatchAccountDeletion } from '@/lib/account-deletion';
import { canonicalizeEmail, normalizeEmail } from '@/lib/email-identity';
import { requestDispatchEmailVerification } from '@/lib/email-verification';

type AppleAuthenticationModule = typeof import('expo-apple-authentication');
type CryptoModule = typeof import('expo-crypto');

type SessionContextType = {
  profile: UserProfile | null;
  authUser: User | null;
  loading: boolean;
  needsProfile: boolean;
  needsOnboarding: boolean;
  requiresEmailVerification: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (params: { idToken: string; accessToken?: string; displayName?: string; mode: SocialAuthMode }) => Promise<SocialAuthResult>;
  signInWithApple: (params: { idToken: string; rawNonce: string; displayName?: string; mode: SocialAuthMode }) => Promise<SocialAuthResult>;
  signUp: (params: { email: string; password: string; displayName: string }) => Promise<VerificationEmailDelivery>;
  saveProfile: (params: { displayName: string; role: AppRole; phoneNumber?: string; onboardingCompleted?: boolean }) => Promise<void>;
  completeOnboarding: () => Promise<UserProfile | null>;
  refreshProfile: () => Promise<UserProfile | null>;
  sendPasswordReset: (email: string) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  refreshAuthUser: () => Promise<boolean>;
  revokeSession: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  signOut: () => Promise<void>;
};

type SocialAuthMode = 'signin' | 'signup';

export type VerificationEmailDelivery = {
  queued: boolean;
  transport: 'dispatch-mail' | 'firebase-auth' | 'none';
  errorMessage?: string;
};

export type SocialAuthResult = {
  needsRoleSelection: boolean;
  displayName: string;
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

function describeVerificationDeliveryError(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown email delivery error');
}

function isVerificationCooldownError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return code.includes('resource-exhausted');
}

async function deliverVerificationEmail(user: User): Promise<VerificationEmailDelivery> {
  let dispatchMailError = '';
  try {
    const result = await requestDispatchEmailVerification();
    if (result.queued || result.alreadyVerified) {
      return { queued: true, transport: 'dispatch-mail' };
    }
  } catch (error) {
    if (isVerificationCooldownError(error)) {
      return {
        queued: false,
        transport: 'none',
        errorMessage: describeVerificationDeliveryError(error),
      };
    }
    dispatchMailError = describeVerificationDeliveryError(error);
  }

  try {
    await sendEmailVerification(user);
    return { queued: true, transport: 'firebase-auth' };
  } catch (error) {
    const firebaseAuthError = describeVerificationDeliveryError(error);
    return {
      queued: false,
      transport: 'none',
      errorMessage: `Dispatch email delivery failed (${dispatchMailError || 'mail service unavailable'}). Firebase delivery also failed (${firebaseAuthError}).`,
    };
  }
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
    onboardingCompleted: data.onboardingCompleted !== false,
    organizationId: data.organizationId || null,
    organizationName: data.organizationName || null,
    email: data.email || null,
    canonicalEmail: data.canonicalEmail || null,
    phoneNumber: data.phoneNumber,
    scheduledEventReminderKeys: data.scheduledEventReminderKeys || [],
  };
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

function usesAppleSignIn(user: User) {
  return user.providerData.some((provider) => provider.providerId === 'apple.com');
}

async function getAppleDeletionAuthorizationCode(user: User) {
  if (!usesAppleSignIn(user)) return undefined;
  if (Platform.OS !== 'ios') {
    throw new Error('Sign in with Apple account deletion must be confirmed on an iPhone or iPad.');
  }

  const AppleAuthentication = require('expo-apple-authentication') as AppleAuthenticationModule;
  const Crypto = require('expo-crypto') as CryptoModule;
  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) throw new Error('Apple authentication is not available on this device.');

  try {
    const rawNonce = Crypto.randomUUID();
    const nonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    const result = await AppleAuthentication.signInAsync({ nonce });
    if (!result.identityToken || !result.authorizationCode) {
      throw new Error('Apple did not return the authorization needed to delete this account.');
    }

    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({ idToken: result.identityToken, rawNonce });
    await reauthenticateWithCredential(user, credential);
    await user.getIdToken(true);
    return result.authorizationCode;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_REQUEST_CANCELED') {
      throw new Error('Account deletion was cancelled. Nothing was deleted.');
    }
    throw error;
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsProfile, setNeedsProfile] = useState(false);

  const requiresEmailVerification = Boolean(authUser && !emailVerified);

  useEffect(() => {
    markStartup('session_effect_started', {
      firebaseConfigError: Boolean(firebaseConfigError),
    });

    if (firebaseConfigError) {
      captureStartupIssue('Dispatch Firebase config missing in build', {
        firebaseConfigError,
      });
      setAuthUser(null);
      setEmailVerified(false);
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
      setEmailVerified(Boolean(currentUser?.emailVerified));
      setProfile(null);
      setNeedsProfile(Boolean(currentUser));
      setLoading(false);
    }, SESSION_STARTUP_TIMEOUT_MS);

    let unsub: () => void = () => undefined;

    try {
      unsub = onAuthStateChanged(auth, async (user) => {
        markStartup('auth_state_received', {
          hasUser: Boolean(user),
          emailVerified: Boolean(user?.emailVerified),
        });
        authStateReceived = true;
        clearTimeout(timeout);
        setAuthUser(user);
        setEmailVerified(Boolean(user?.emailVerified));

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
    } catch (authSubscriptionError) {
      clearTimeout(timeout);
      captureStartupIssue('Dispatch auth subscription failed during startup', {
        message: authSubscriptionError instanceof Error ? authSubscriptionError.message : String(authSubscriptionError),
      });
      setAuthUser(null);
      setEmailVerified(false);
      setProfile(null);
      setNeedsProfile(false);
      setLoading(false);
    }

    return () => {
      clearTimeout(timeout);
      unsub();
    };
  }, []);

  useEffect(() => {
    if (firebaseConfigError || !authUser) return undefined;

    try {
      return onSnapshot(
        doc(db, 'users', authUser.uid),
        (snap) => {
          if (!snap.exists()) {
            setProfile(null);
            setNeedsProfile(true);
            return;
          }

          const data = snap.data() as Partial<UserProfile>;
          const role = normalizeRole(data.role);
          if (!role) {
            setProfile(null);
            setNeedsProfile(true);
            return;
          }

          setProfile({
            uid: authUser.uid,
            displayName: data.displayName || 'Dispatch User',
            role,
            onboardingCompleted: data.onboardingCompleted !== false,
            organizationId: data.organizationId || null,
            organizationName: data.organizationName || null,
            email: data.email || null,
            canonicalEmail: data.canonicalEmail || null,
            phoneNumber: data.phoneNumber,
            scheduledEventReminderKeys: data.scheduledEventReminderKeys || [],
          });
          setNeedsProfile(false);
        },
        () => {
          setProfile(null);
          setNeedsProfile(true);
        }
      );
    } catch (profileSubscriptionError) {
      captureStartupIssue('Dispatch profile subscription failed', {
        message: profileSubscriptionError instanceof Error ? profileSubscriptionError.message : String(profileSubscriptionError),
      });
      setProfile(null);
      setNeedsProfile(true);
      return undefined;
    }
  }, [authUser]);

  const signOutExistingUserBeforeCredential = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    await unregisterCurrentDevicePushToken(currentUser.uid);
    await firebaseSignOut(auth);
    forgetRegisteredDevicePushToken();
    setAuthUser(null);
    setEmailVerified(false);
    setProfile(null);
    setNeedsProfile(false);
  };

  const signIn = async (email: string, password: string) => {
    assertFirebaseConfigured();
    await signOutExistingUserBeforeCredential();
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

  const signInWithGoogle = async (params: { idToken: string; accessToken?: string; displayName?: string; mode: SocialAuthMode }): Promise<SocialAuthResult> => {
    assertFirebaseConfigured();
    await signOutExistingUserBeforeCredential();
    const credential = GoogleAuthProvider.credential(params.idToken, params.accessToken);
    const cred = await signInWithCredential(auth, credential);
    const displayName = cleanDisplayName(params.displayName || cred.user.displayName, cred.user.email);

    const existing = await loadProfile(cred.user.uid);
    if (!existing && params.mode === 'signup') {
      setProfile(null);
      setNeedsProfile(true);
      return { needsRoleSelection: true, displayName };
    }

    await syncInviteLinking(cred.user.uid, cred.user.email, existing?.role);
    const nextProfile = await loadProfile(cred.user.uid);

    if (nextProfile) {
      setProfile(nextProfile);
      setNeedsProfile(false);
      return { needsRoleSelection: false, displayName: nextProfile.displayName };
    } else {
      await firebaseSignOut(auth);
      setProfile(null);
      setNeedsProfile(false);
      throw new Error('No Dispatch profile was found for this Google account. Use Create Account first.');
    }
  };

  const signInWithApple = async (params: { idToken: string; rawNonce: string; displayName?: string; mode: SocialAuthMode }): Promise<SocialAuthResult> => {
    assertFirebaseConfigured();
    await signOutExistingUserBeforeCredential();
    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({ idToken: params.idToken, rawNonce: params.rawNonce });
    const cred = await signInWithCredential(auth, credential);

    if (params.displayName) {
      await updateProfile(cred.user, { displayName: params.displayName });
    }

    const displayName = cleanDisplayName(params.displayName || cred.user.displayName, cred.user.email);

    const existing = await loadProfile(cred.user.uid);
    if (!existing && params.mode === 'signup') {
      setProfile(null);
      setNeedsProfile(true);
      return { needsRoleSelection: true, displayName };
    }

    await syncInviteLinking(cred.user.uid, cred.user.email, existing?.role);
    const nextProfile = await loadProfile(cred.user.uid);

    if (nextProfile) {
      setProfile(nextProfile);
      setNeedsProfile(false);
      return { needsRoleSelection: false, displayName: nextProfile.displayName };
    } else {
      await firebaseSignOut(auth);
      setProfile(null);
      setNeedsProfile(false);
      throw new Error('No Dispatch profile was found for this Apple account. Use Create Account first.');
    }
  };

  const signUp = async (params: { email: string; password: string; displayName: string }) => {
    assertFirebaseConfigured();
    await signOutExistingUserBeforeCredential();
    const normalizedEmail = params.email.trim();
    const trimmedName = params.displayName.trim();

    const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, params.password);
    await updateProfile(cred.user, { displayName: trimmedName });
    return deliverVerificationEmail(cred.user);
  };

  const saveProfile = async (params: { displayName: string; role: AppRole; phoneNumber?: string; onboardingCompleted?: boolean }) => {
    assertFirebaseConfigured();
    if (!auth.currentUser) throw new Error('Not authenticated');
    const user = auth.currentUser;
    const previousRole = profile?.role || null;
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
        ...(params.onboardingCompleted === undefined
          ? {}
          : params.onboardingCompleted
            ? { onboardingCompleted: true, onboardingCompletedAt: serverTimestamp() }
            : { onboardingCompleted: false, onboardingStartedAt: serverTimestamp() }),
      },
      { merge: true }
    );

    if (params.role === 'worker') {
      if (shouldLinkPendingWorkerInvites(previousRole, params.role)) {
        const { acceptPendingWorkerInvitesForUser } = getDispatchServices();
        await acceptPendingWorkerInvitesForUser({ userId: user.uid, email: user.email || '' }).catch(() => null);
      }
    } else {
      await syncInviteLinking(user.uid, user.email, 'manager');
    }

    const nextProfile = await loadProfile(user.uid);
    setProfile(nextProfile || {
      uid: user.uid,
      displayName: params.displayName.trim(),
      role: params.role,
      onboardingCompleted: params.onboardingCompleted ?? true,
      organizationId: null,
      organizationName: null,
      email: normalizeEmail(user.email) || null,
      canonicalEmail: canonicalizeEmail(user.email) || null,
      phoneNumber: params.phoneNumber?.trim() || undefined,
    });
    setNeedsProfile(false);
  };

  const completeOnboarding = async () => {
    assertFirebaseConfigured();
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    await setDoc(
      doc(db, 'users', user.uid),
      {
        onboardingCompleted: true,
        onboardingCompletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    const nextProfile = await loadProfile(user.uid);
    setProfile(nextProfile);
    setNeedsProfile(!nextProfile);
    return nextProfile;
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
    const delivery = await deliverVerificationEmail(user);
    if (!delivery.queued) {
      throw new Error(delivery.errorMessage || 'Unable to send the verification email. Please try again.');
    }
  };

  const refreshAuthUser = async () => {
    if (firebaseConfigError) return false;
    const user = auth.currentUser;
    if (!user) {
      setAuthUser(null);
      setEmailVerified(false);
      return false;
    }

    await user.reload();
    const refreshed = auth.currentUser;
    const isVerified = Boolean(refreshed?.emailVerified);
    if (isVerified) {
      await refreshed?.getIdToken(true);
    }
    setAuthUser(refreshed);
    setEmailVerified(isVerified);
    return isVerified;
  };

  const revokeSession = async () => {
    assertFirebaseConfigured();
    if (auth.currentUser) await unregisterCurrentDevicePushToken(auth.currentUser.uid);
    await firebaseSignOut(auth);
    forgetRegisteredDevicePushToken();
    setEmailVerified(false);
    setProfile(null);
    setNeedsProfile(false);
  };

  const deleteAccount = async () => {
    assertFirebaseConfigured();
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const appleAuthorizationCode = await getAppleDeletionAuthorizationCode(user);
    if (!appleAuthorizationCode) await user.getIdToken(true);
    await requestDispatchAccountDeletion({
      appleAuthorizationCode,
      firebaseApiKey: auth.app.options.apiKey,
    });
    await clearDispatchNotificationState();
    await firebaseSignOut(auth).catch(() => undefined);
    forgetRegisteredDevicePushToken();
    setAuthUser(null);
    setEmailVerified(false);
    setProfile(null);
    setNeedsProfile(false);
  };

  const signOut = async () => {
    assertFirebaseConfigured();
    if (auth.currentUser) await unregisterCurrentDevicePushToken(auth.currentUser.uid);
    await firebaseSignOut(auth);
    forgetRegisteredDevicePushToken();
    setEmailVerified(false);
    setProfile(null);
    setNeedsProfile(false);
  };

  const needsOnboarding = Boolean(authUser && (!profile || profile.onboardingCompleted === false));

  const value = useMemo(
    () => ({
      profile,
      authUser,
      loading,
      needsProfile,
      needsOnboarding,
      requiresEmailVerification,
      signIn,
      signInWithGoogle,
      signInWithApple,
      signUp,
      saveProfile,
      completeOnboarding,
      refreshProfile,
      sendPasswordReset,
      sendVerificationEmail,
      refreshAuthUser,
      revokeSession,
      deleteAccount,
      signOut,
    }),
    [profile, authUser, loading, needsProfile, needsOnboarding, requiresEmailVerification]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
