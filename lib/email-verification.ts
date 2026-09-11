import { getFunctions, httpsCallable } from 'firebase/functions';

export type DispatchEmailVerificationResult = {
  queued: boolean;
  alreadyVerified: boolean;
};

export async function requestDispatchEmailVerification(
  inviteToken?: string
): Promise<DispatchEmailVerificationResult> {
  const callable = httpsCallable<{ inviteToken?: string }, DispatchEmailVerificationResult>(
    getFunctions(undefined, 'us-central1'),
    'sendDispatchEmailVerification'
  );
  const normalizedInviteToken = inviteToken?.trim();
  const result = await callable(normalizedInviteToken ? { inviteToken: normalizedInviteToken } : {});
  return result.data;
}
