import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { UserProfile } from '@/types/dispatch';

const KEY = 'dispatch.user.v1';

type SessionContextType = {
  profile: UserProfile | null;
  loading: boolean;
  setProfile: (p: UserProfile) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfileState] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) setProfileState(JSON.parse(raw));
      setLoading(false);
    })();
  }, []);

  const setProfile = async (p: UserProfile) => {
    setProfileState(p);
    await AsyncStorage.setItem(KEY, JSON.stringify(p));
  };

  const signOut = async () => {
    setProfileState(null);
    await AsyncStorage.removeItem(KEY);
  };

  const value = useMemo(() => ({ profile, loading, setProfile, signOut }), [profile, loading]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
