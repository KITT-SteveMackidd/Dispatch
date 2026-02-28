import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, updateProfile } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { AppRole, UserProfile } from '@/types/dispatch';

type SessionContextType = {
  profile: UserProfile | null;
  authUser: User | null;
  loading: boolean;
  needsProfile: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (params: { email: string; password: string; displayName: string; role: AppRole }) => Promise<void>;
  saveProfile: (params: { displayName: string; role: AppRole }) => Promise<void>;
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
    await signInWithEmailAndPassword(auth, email.trim(), password);
  };

  const signUp = async (params: { email: string; password: string; displayName: string; role: AppRole }) => {
    const cred = await createUserWithEmailAndPassword(auth, params.email.trim(), params.password);
    await updateProfile(cred.user, { displayName: params.displayName.trim() });

    await setDoc(doc(db, 'users', cred.user.uid), {
      uid: cred.user.uid,
      displayName: params.displayName.trim(),
      role: params.role,
      email: params.email.trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    setProfile({ uid: cred.user.uid, displayName: params.displayName.trim(), role: params.role });
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

    setProfile({ uid: user.uid, displayName: params.displayName.trim(), role: params.role });
    setNeedsProfile(false);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setProfile(null);
    setNeedsProfile(false);
  };

  const value = useMemo(
    () => ({ profile, authUser, loading, needsProfile, signIn, signUp, saveProfile, signOut }),
    [profile, authUser, loading, needsProfile]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
