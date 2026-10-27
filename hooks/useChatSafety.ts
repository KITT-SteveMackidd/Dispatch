import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSession } from '@/context/session';
import {
  acceptChatRules, CHAT_RULES_VERSION, INITIAL_CHAT_SAFETY, setChatUserBlock, subscribeToChatSafety,
  type ChatSafetySnapshot,
} from '@/services/chat-safety';

export function useChatSafety(threadId?: string) {
  const { profile } = useSession();
  const userId = profile?.uid;
  const organizationId = profile?.organizationId;
  const scope = `${userId || ''}|${organizationId || ''}|${profile?.role || ''}|${threadId || ''}`;
  const [result, setResult] = useState<{ scope: string; snapshot: ChatSafetySnapshot }>({ scope: '', snapshot: INITIAL_CHAT_SAFETY });
  const subscriptionRef = useRef<ReturnType<typeof subscribeToChatSafety> | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!userId || !organizationId) {
      setResult({ scope, snapshot: { ...INITIAL_CHAT_SAFETY, loading: false, rolloutReady: true } });
      return;
    }
    const subscription = subscribeToChatSafety({ userId, organizationId, threadId }, (snapshot) => setResult({ scope, snapshot }));
    subscriptionRef.current = subscription;
    return () => {
      subscription.unsubscribe();
      if (subscriptionRef.current === subscription) subscriptionRef.current = null;
    };
  }, [userId, organizationId, threadId, scope, retry]);

  const snapshot = result.scope === scope ? result.snapshot : INITIAL_CHAT_SAFETY;
  const refresh = useCallback(async () => {
    // Restart listeners as well as requests so a failed listener can recover.
    setResult({ scope, snapshot: { ...INITIAL_CHAT_SAFETY, enabled: snapshot.enabled } });
    setRetry((value) => value + 1);
  }, [scope, snapshot.enabled]);
  useFocusEffect(useCallback(() => {
    void subscriptionRef.current?.refresh();
  }, [scope]));

  const acceptRules = useCallback(async () => {
    if (!snapshot.enabled) throw new Error('Chat safety is not available for this organization.');
    if (snapshot.state?.termsVersion !== CHAT_RULES_VERSION) throw new Error('Please update Dispatch to read the latest chat rules before accepting.');
    await acceptChatRules({ version: CHAT_RULES_VERSION });
    await subscriptionRef.current?.refresh();
  }, [snapshot.enabled, snapshot.state?.termsVersion]);
  const setUserBlocked = useCallback(async (targetUserId: string, blocked: boolean) => {
    if (!snapshot.enabled) throw new Error('Chat safety is not available for this organization.');
    await setChatUserBlock({ targetUserId, blocked });
    await subscriptionRef.current?.refresh();
  }, [snapshot.enabled]);

  return { ...snapshot, refresh, acceptRules, setUserBlocked };
}
