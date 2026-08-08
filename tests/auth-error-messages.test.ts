import { describe, expect, it } from 'vitest';
import { getAuthErrorMessage } from '../lib/auth-error-messages';

describe('getAuthErrorMessage', () => {
  it('does not reveal whether an account exists for invalid credentials', () => {
    expect(getAuthErrorMessage({ code: 'auth/invalid-credential' }, 'signin')).toBe(
      'Email or password is incorrect. Check both and try again, or reset your password.'
    );
    expect(getAuthErrorMessage({ code: 'auth/user-not-found' }, 'signin')).toBe(
      'Email or password is incorrect. Check both and try again, or reset your password.'
    );
  });

  it('directs an existing email back to sign in', () => {
    expect(getAuthErrorMessage({ code: 'auth/email-already-in-use' }, 'signup')).toBe(
      'An account already uses this email. Sign in instead, or reset your password if needed.'
    );
  });

  it('provides recoverable provider and network guidance', () => {
    expect(getAuthErrorMessage({ code: 'auth/operation-not-allowed' }, 'apple')).toContain('use email sign-in');
    expect(getAuthErrorMessage({ code: 'auth/network-request-failed' }, 'google')).toContain('Check your connection');
  });

  it('does not expose an unknown provider error message', () => {
    expect(getAuthErrorMessage(new Error('Firebase: internal detail'), 'google')).toBe(
      'Google could not finish signing you in. Try again, or use email sign-in.'
    );
  });
});
