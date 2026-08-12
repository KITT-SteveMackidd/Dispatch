import { getFunctions, httpsCallable } from 'firebase/functions';

export type SecureInviteKind = 'worker' | 'manager';

export type SecureInvitePreview = {
  inviteKind: SecureInviteKind;
  organizationName: string;
  teamName: string | null;
  deliveryEmailHint: string;
  status: 'active' | 'claimed' | 'expired' | 'revoked' | 'cancelled';
  canClaim: boolean;
  expiresAt: number | null;
};

export type CreateSecureInviteResult = {
  inviteId: string;
  inviteCode: string;
  appLink: string;
  expiresAt: string;
  deliveryQueued: boolean;
  reused: boolean;
};

export type ClaimSecureInviteResult = SecureInvitePreview & {
  claimed: true;
  organizationId: string;
  teamId: string | null;
};

function getDispatchFunctions() {
  return getFunctions(undefined, 'us-central1');
}

export async function createSecureDispatchInvite(params: {
  inviteKind: SecureInviteKind;
  deliveryEmail: string;
  teamId?: string;
}) {
  const callable = httpsCallable<typeof params, CreateSecureInviteResult>(
    getDispatchFunctions(),
    'createDispatchInvite'
  );
  const result = await callable(params);
  return result.data;
}

export async function getSecureDispatchInvite(tokenOrCode: string) {
  const callable = httpsCallable<{ tokenOrCode: string }, SecureInvitePreview>(
    getDispatchFunctions(),
    'getDispatchInvite'
  );
  const result = await callable({ tokenOrCode });
  return result.data;
}

export async function claimSecureDispatchInvite(tokenOrCode: string) {
  const callable = httpsCallable<{ tokenOrCode: string }, ClaimSecureInviteResult>(
    getDispatchFunctions(),
    'claimDispatchInvite'
  );
  const result = await callable({ tokenOrCode });
  return result.data;
}

export function secureInviteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message
    .replace(/^Firebase:\s*/i, '')
    .replace(/^FunctionsError:\s*/i, '')
    .replace(/^\[[^\]]+\]\s*/i, '')
    || 'Unable to process this Dispatch invitation. Please try again.';
}
