import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

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
  deliveryChannel?: 'share' | 'email';
  reused: boolean;
  seatUsage?: number;
  memberCap?: number | null;
};

export type ClaimSecureInviteResult = SecureInvitePreview & {
  claimed: true;
  organizationId: string;
  teamId: string | null;
};

export type PendingOrganizationInvite = {
  inviteId: string;
  inviteKind: SecureInviteKind;
  deliveryEmailHint: string;
  teamName: string | null;
  expiresAt: number;
};

export async function createSecureDispatchInvite(params: {
  inviteKind: SecureInviteKind;
  deliveryEmail: string;
  teamId?: string;
}) {
  const callable = httpsCallable<typeof params, CreateSecureInviteResult>(
    functions,
    'createDispatchInvite'
  );
  const result = await callable(params);
  return result.data;
}

export async function getSecureDispatchInvite(tokenOrCode: string) {
  const callable = httpsCallable<{ tokenOrCode: string }, SecureInvitePreview>(
    functions,
    'getDispatchInvite'
  );
  const result = await callable({ tokenOrCode });
  return result.data;
}

export async function claimSecureDispatchInvite(tokenOrCode: string) {
  const callable = httpsCallable<{ tokenOrCode: string }, ClaimSecureInviteResult>(
    functions,
    'claimDispatchInvite'
  );
  const result = await callable({ tokenOrCode });
  return result.data;
}

export async function cancelSecureDispatchInvite(inviteId: string) {
  const callable = httpsCallable<{ inviteId: string }, { cancelled: true; inviteId: string }>(
    functions,
    'cancelDispatchInvite'
  );
  const result = await callable({ inviteId });
  return result.data;
}

export async function adoptLegacyDispatchInvites() {
  const callable = httpsCallable<Record<string, never>, {
    adopted: boolean;
    organizationId?: string;
    role?: SecureInviteKind;
  }>(functions, 'adoptLegacyDispatchInvites');
  const result = await callable({});
  return result.data;
}

export async function listOrganizationPendingInvites() {
  const callable = httpsCallable<Record<string, never>, { invites: PendingOrganizationInvite[] }>(
    functions,
    'listOrganizationPendingInvites'
  );
  const result = await callable({});
  return result.data.invites;
}

export function secureInviteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message
    .replace(/^Firebase:\s*/i, '')
    .replace(/^FunctionsError:\s*/i, '')
    .replace(/^\[[^\]]+\]\s*/i, '')
    || 'Unable to process this Dispatch invitation. Please try again.';
}
