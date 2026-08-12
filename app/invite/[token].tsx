import { useLocalSearchParams } from 'expo-router';

import { SecureInviteScreen } from '@/components/invite/SecureInviteScreen';

export default function InviteTokenScreen() {
  const { token } = useLocalSearchParams<{ token?: string | string[] }>();
  const tokenOrCode = Array.isArray(token) ? token[0] : token;
  return <SecureInviteScreen tokenOrCode={tokenOrCode?.trim() || 'missing-invitation'} />;
}
