import { httpsCallable } from 'firebase/functions';
import { sendEmailVerification } from 'firebase/auth';
import { isCustomerBeta } from '@/config/beta-mode';
import { auth, functions } from '@/lib/firebase';

export type DispatchEmailVerificationResult = {
  queued: boolean;
  alreadyVerified: boolean;
  transport?: 'dispatch-mail' | 'firebase-auth';
};

export async function requestDispatchEmailVerification(
  inviteToken?: string
): Promise<DispatchEmailVerificationResult> {
  if (isCustomerBeta()) {
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in before requesting a verification email.');
    if (user.emailVerified) return { queued: false, alreadyVerified: true, transport: 'firebase-auth' };
    // Use this Firebase project's default hosted action handler. Passing no
    // ActionCodeSettings avoids production return URLs and email extension setup.
    await sendEmailVerification(user);
    return { queued: true, alreadyVerified: false, transport: 'firebase-auth' };
  }
  const callable = httpsCallable<{ inviteToken?: string }, DispatchEmailVerificationResult>(
    functions,
    'sendDispatchEmailVerification'
  );
  const normalizedInviteToken = inviteToken?.trim();
  const result = await callable(normalizedInviteToken ? { inviteToken: normalizedInviteToken } : {});
  return { ...result.data, transport: 'dispatch-mail' };
}
