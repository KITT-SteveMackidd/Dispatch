import { Redirect, useLocalSearchParams } from 'expo-router';

import { SecureInviteScreen } from '@/components/invite/SecureInviteScreen';

export default function InviteTokenScreen() {
  const { token, direct } = useLocalSearchParams<{
    token?: string | string[];
    direct?: string | string[];
  }>();
  const tokenOrCode = Array.isArray(token) ? token[0] : token;
  const directValue = Array.isArray(direct) ? direct[0] : direct;
  const normalizedToken = tokenOrCode?.trim() || 'missing-invitation';

  if (directValue === '1') {
    return <SecureInviteScreen tokenOrCode={normalizedToken} />;
  }

  return (
    <Redirect
      href={{
        pathname: '/(auth)/setup',
        params: { inviteToken: normalizedToken },
      }}
    />
  );
}
