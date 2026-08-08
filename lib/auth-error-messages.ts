export type AuthAction = 'signin' | 'signup' | 'password-reset' | 'google' | 'apple';

type CodedError = {
  code?: unknown;
  message?: unknown;
};

function getAuthErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  const code = (error as CodedError).code;
  return typeof code === 'string' ? code.toLowerCase() : '';
}

export function getAuthErrorMessage(error: unknown, action: AuthAction) {
  const code = getAuthErrorCode(error);

  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Email or password is incorrect. Check both and try again, or reset your password.';
  }

  if (code === 'auth/email-already-in-use' || code === 'auth/account-exists-with-different-credential') {
    return 'An account already uses this email. Sign in instead, or reset your password if needed.';
  }

  if (code === 'auth/invalid-email') {
    return 'Enter a valid email address and try again.';
  }

  if (code === 'auth/weak-password') {
    return 'Choose a stronger password with at least six characters.';
  }

  if (code === 'auth/too-many-requests') {
    return 'Too many attempts were made. Wait a few minutes, then try again or reset your password.';
  }

  if (code === 'auth/network-request-failed') {
    return 'Dispatch could not reach the sign-in service. Check your connection and try again.';
  }

  if (code === 'auth/operation-not-allowed') {
    if (action === 'apple') {
      return 'Apple sign-in is temporarily unavailable. Try again, or use email sign-in.';
    }
    if (action === 'google') {
      return 'Google sign-in is temporarily unavailable. Try again, or use email sign-in.';
    }
    return 'This sign-in method is temporarily unavailable. Try another method.';
  }

  if (action === 'password-reset') {
    return 'The reset email could not be sent. Check the address and your connection, then try again.';
  }

  if (action === 'signup') {
    return 'The account could not be created. Check your details and try again.';
  }

  if (action === 'google') {
    return 'Google could not finish signing you in. Try again, or use email sign-in.';
  }

  if (action === 'apple') {
    return 'Apple could not finish signing you in. Try again, or use email sign-in.';
  }

  return 'Sign-in could not be completed. Check your details and try again.';
}
