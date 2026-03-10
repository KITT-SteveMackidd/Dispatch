import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { AppRole, UserProfile } from '@/types/dispatch';
import { acceptPendingInvitesForUser } from '@/services/dispatch';

type SessionContextType = {
  profile: UserProfile | null;
  authUser: User | null;
  loading: boolean;
  needsProfile: boolean;
  requiresEmailVerification: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (params: { email: string; password: string; displayName: string; role: AppRole }) => Promise<void>;
  saveProfile: (params: { displayName: string; role: AppRole }) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  refreshAuthUser: () => Promise<boolean>;
  revokeSession: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextType | undefined>(undefined);

async function loadProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<UserProfile>;
  if (!data.role) return null;
  return {
    uid,
    displayName: data.displayName || 'Dispatch User',
    role: data.role,
  };
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsProfile, setNeedsProfile] = useState(false);

  const requiresEmailVerification = Boolean(authUser && !authUser.emailVerified);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);

      if (!user) {
        setProfile(null);
        setNeedsProfile(false);
        setLoading(false);
        return;
      }

      try {
        const p = await loadProfile(user.uid);
        setProfile(p);
        setNeedsProfile(!p);
      } catch {
        setProfile(null);
        setNeedsProfile(true);
      } finally {
        setLoading(false);
      }
    });

    return unsub;
  }, []);

  const signIn = async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);

    if (!cred.user.emailVerified) {
      await firebaseSignOut(auth);
      throw new Error('Please verify your email address before signing in. Check your inbox for the verification link.');
    }

    await acceptPendingInvitesForUser({ userId: cred.user.uid, email: cred.user.email || email });
  };

  const signUp = async (params: { email: string; password: string; displayName: string; role: AppRole }) => {
    const normalizedEmail = params.email.trim();
    const trimmedName = params.displayName.trim();

    const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, params.password);
    await updateProfile(cred.user, { displayName: trimmedName });
    await sendEmailVerification(cred.user);

    await setDoc(doc(db, 'users', cred.user.uid), {
      uid: cred.user.uid,
      displayName: trimmedName,
      role: params.role,
      email: normalizedEmail,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await acceptPendingInvitesForUser({ userId: cred.user.uid, email: normalizedEmail });

    setProfile({ uid: cred.user.uid, displayName: trimmedName, role: params.role });
    setNeedsProfile(false);
  };

  const saveProfile = async (params: { displayName: string; role: AppRole }) => {
    if (!auth.currentUser) throw new Error('Not authenticated');
    const user = auth.currentUser;
    await updateProfile(user, { displayName: params.displayName.trim() });
    await setDoc(
      doc(db, 'users', user.uid),
      {
        uid: user.uid,
        displayName: params.displayName.trim(),
        role: params.role,
        email: user.email || null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (user.email) {
      await acceptPendingInvitesForUser({ userId: user.uid, email: user.email });
    }

    setProfile({ uid: user.uid, displayName: params.displayName.trim(), role: params.role });
    setNeedsProfile(false);
  };

  const sendPasswordReset = async (email: string) => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) throw new Error('Email is required.');
    await sendPasswordResetEmail(auth, normalizedEmail);
  };

  const sendVerificationEmail = async () => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    await sendEmailVerification(user);
  };

  const refreshAuthUser = async () => {
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
    // Session revocation is handled by Firebase Admin in backend tooling.
    // On client we provide an immediate local revoke by signing out.
    await firebaseSignOut(auth);
    setProfile(null);
    setNeedsProfile(false);
  };

  const signOut = async () => {
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
      signUp,
      saveProfile,
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
