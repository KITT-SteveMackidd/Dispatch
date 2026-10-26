import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

function loadSource(relative: string, mocks: Record<string, unknown>) {
  const filename = join(process.cwd(), relative);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unexpected runtime import ${name}`);
  }, module, module.exports);
  return module.exports;
}

function harness(customerBeta: boolean, signedIn = true, existingBackend = false) {
  const user = { uid: 'beta-user', email: 'beta@example.test', emailVerified: false };
  const auth = { currentUser: signedIn ? user : null };
  const sendEmailVerification = vi.fn().mockResolvedValue(undefined);
  const invokeCallable = vi.fn().mockResolvedValue({ data: { queued: true, alreadyVerified: false } });
  const getFunctions = vi.fn(() => ({}));
  const httpsCallable = vi.fn(() => invokeCallable);
  const adoptLegacyDispatchInvites = vi.fn().mockResolvedValue({ adopted: false });
  const firebaseAuth = {
    sendEmailVerification,
    createUserWithEmailAndPassword: vi.fn(async () => { auth.currentUser = user; return { user }; }),
    signInWithEmailAndPassword: vi.fn(async () => { auth.currentUser = user; return { user }; }),
    updateProfile: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(async () => { auth.currentUser = null; }),
  };
  const functions = { app: 'configured-dispatch-app', region: customerBeta && !existingBackend ? 'northamerica-northeast1' : 'us-central1' };
  const betaMode = { isCustomerBeta: () => customerBeta, isExistingDispatchCustomerBeta: () => existingBackend };
  const firebase = { auth, functions, db: {}, firebaseConfigError: null };
  const verification = loadSource('lib/email-verification.ts', {
    '@/config/beta-mode': betaMode, '@/lib/firebase': firebase,
    'firebase/auth': firebaseAuth, 'firebase/functions': { getFunctions, httpsCallable },
  });
  const session = loadSource('context/session.tsx', {
    '@/config/beta-mode': betaMode,
    react: { createContext: () => ({ Provider: 'SessionProvider' }), useEffect: () => {}, useMemo: (factory: () => unknown) => factory(), useState: (value: unknown) => [value, vi.fn()] },
    'react-native': { Platform: { OS: 'android' } }, 'firebase/auth': firebaseAuth,
    'firebase/firestore': { doc: vi.fn(), getDoc: vi.fn().mockResolvedValue({ exists: () => false }) },
    '@/lib/firebase': firebase, '@/lib/sentry': {},
    '@/services/push-token-session': { unregisterCurrentDevicePushToken: async () => {}, clearDispatchNotificationState: async () => {}, forgetRegisteredDevicePushToken: () => {} },
    '@/lib/chat-list-membership': {}, '@/lib/account-deletion': {},
    '@/services/revenuecat': { logOutDispatchRevenueCatUser: async () => false },
    '@/lib/email-identity': { normalizeEmail: (email: string) => email.trim().toLowerCase() }, '@/lib/email-verification': verification,
    '@/lib/secure-invites': { adoptLegacyDispatchInvites },
  });
  return {
    auth, functions, user, sendEmailVerification, getFunctions, httpsCallable, invokeCallable, adoptLegacyDispatchInvites,
    request: verification.requestDispatchEmailVerification,
    session: session.SessionProvider({ children: null }).props.value,
  };
}

describe('customer beta email verification transport', () => {
  it('uses only Firebase Auth with its default handler and does not forward the invite token', async () => {
    const fixture = harness(true);
    await expect(fixture.request('customer-invite')).resolves.toEqual({ queued: true, alreadyVerified: false, transport: 'firebase-auth' });
    expect(fixture.sendEmailVerification.mock.calls).toEqual([[fixture.user]]);
    expect(fixture.getFunctions).not.toHaveBeenCalled();
    expect(fixture.httpsCallable).not.toHaveBeenCalled();
    expect(fixture.invokeCallable).not.toHaveBeenCalled();
  });

  it('keeps standard and billing QA verification on the existing Dispatch callable', async () => {
    const fixture = harness(false);
    await expect(fixture.request('  original-invite  ')).resolves.toMatchObject({ queued: true, transport: 'dispatch-mail' });
    expect(fixture.getFunctions).not.toHaveBeenCalled();
    expect(fixture.httpsCallable).toHaveBeenCalledWith(fixture.functions, 'sendDispatchEmailVerification');
    expect(fixture.invokeCallable).toHaveBeenCalledWith({ inviteToken: 'original-invite' });
    expect(fixture.sendEmailVerification).not.toHaveBeenCalled();
  });

  it('keeps existing-backend beta signup and invite-aware resend on Dispatch SMTP verification', async () => {
    const fixture = harness(true, false, true);
    await expect(fixture.session.signUp({ email: 'beta@example.test', password: 'local-test-only', displayName: 'Beta Tester', inviteToken: 'existing-invite' }))
      .resolves.toMatchObject({ queued: true, transport: 'dispatch-mail' });
    expect(fixture.httpsCallable).toHaveBeenCalledWith(fixture.functions, 'sendDispatchEmailVerification');
    expect(fixture.invokeCallable).toHaveBeenCalledWith({ inviteToken: 'existing-invite' });
    expect(fixture.sendEmailVerification).not.toHaveBeenCalled();
    fixture.invokeCallable.mockRejectedValue(new Error('Dispatch mail unavailable'));
    await expect(fixture.session.sendVerificationEmail('existing-invite')).rejects.toThrow('Dispatch mail unavailable');
    expect(fixture.sendEmailVerification).not.toHaveBeenCalled();
  });

  it.each([false, true])('sign-in skips unavailable legacy adoption only on the existing beta backend: %s', async (existingBackend) => {
    const fixture = harness(true, false, existingBackend);
    fixture.user.emailVerified = true;
    await fixture.session.signIn('beta@example.test', 'local-test-only');
    expect(fixture.auth.currentUser).toBe(fixture.user);
    expect(fixture.adoptLegacyDispatchInvites).toHaveBeenCalledTimes(existingBackend ? 0 : 1);
  });

  it('requires the signed-in customer account and never pretends a missing user got mail', async () => {
    const fixture = harness(true, false);
    await expect(fixture.request()).rejects.toThrow('Sign in');
    expect(fixture.sendEmailVerification).not.toHaveBeenCalled();
    expect(fixture.invokeCallable).not.toHaveBeenCalled();
  });

  it('reports already-verified resends honestly without sending another message', async () => {
    const fixture = harness(true);
    fixture.user.emailVerified = true;
    await expect(fixture.session.sendVerificationEmail()).resolves.toEqual({ queued: false, alreadyVerified: true, transport: 'firebase-auth' });
    expect(fixture.sendEmailVerification).not.toHaveBeenCalled();
  });

  it('signup reports Firebase delivery success only after the SDK accepts the request', async () => {
    const fixture = harness(true, false);
    await expect(fixture.session.signUp({ email: 'beta@example.test', password: 'local-test-only', displayName: 'Beta Tester', inviteToken: 'invite' }))
      .resolves.toEqual({ queued: true, alreadyVerified: false, transport: 'firebase-auth' });
    expect(fixture.sendEmailVerification.mock.calls).toEqual([[fixture.user]]);
    expect(fixture.invokeCallable).not.toHaveBeenCalled();
  });

  it('signup preserves the new account but reports delivery failure; resend rejects the same failure', async () => {
    const fixture = harness(true, false);
    fixture.sendEmailVerification.mockRejectedValue(new Error('Firebase email quota exceeded'));
    const delivery = await fixture.session.signUp({ email: 'beta@example.test', password: 'local-test-only', displayName: 'Beta Tester' });
    expect(fixture.auth.currentUser).toBe(fixture.user);
    expect(delivery).toMatchObject({ queued: false, transport: 'none' });
    expect(delivery.errorMessage).toContain('Firebase email quota exceeded');
    await expect(fixture.session.sendVerificationEmail()).rejects.toThrow('Firebase email quota exceeded');
    expect(fixture.invokeCallable).not.toHaveBeenCalled();
  });

  it('a failed standard callable never falls back to Firebase customer transport', async () => {
    const fixture = harness(false);
    fixture.invokeCallable.mockRejectedValue(new Error('Dispatch mail unavailable'));
    await expect(fixture.session.sendVerificationEmail()).rejects.toThrow('Dispatch mail unavailable');
    expect(fixture.sendEmailVerification).not.toHaveBeenCalled();
  });
});
