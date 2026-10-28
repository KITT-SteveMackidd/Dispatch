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

  it('guides an authenticated Google user without a Dispatch profile to Create Account', () => {
    expect(getAuthErrorMessage({ code: 'dispatch/google-profile-not-found', message: 'Internal profile lookup details' }, 'google')).toBe(
      'No Dispatch profile was found for this Google account. Use Create Account first.'
    );
  });

  it('does not infer missing profiles from arbitrary backend message text', () => {
    expect(getAuthErrorMessage(new Error('No Dispatch profile was found for this Google account. Use Create Account first.'), 'google')).toBe(
      'Google could not finish signing you in. Try again, or use email sign-in.'
    );
    expect(getAuthErrorMessage({ code: 'dispatch/google-profile-not-found' }, 'signin')).toBe(
      'Sign-in could not be completed. Check your details and try again.'
    );
  });
});
