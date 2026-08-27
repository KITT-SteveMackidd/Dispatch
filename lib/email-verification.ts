import { getFunctions, httpsCallable } from 'firebase/functions';

export type DispatchEmailVerificationResult = {
  queued: boolean;
  alreadyVerified: boolean;
};

export async function requestDispatchEmailVerification(): Promise<DispatchEmailVerificationResult> {
  const callable = httpsCallable<void, DispatchEmailVerificationResult>(
    getFunctions(undefined, 'us-central1'),
    'sendDispatchEmailVerification'
  );
  const result = await callable();
  return result.data;
}
