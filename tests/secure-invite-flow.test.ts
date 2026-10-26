import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('secure invitation flow wiring', () => {
  it('uses callable secure invitations from the Manager Team Actions drawer', () => {
    const teamsSource = read('app/(tabs)/teams.tsx');
    expect(teamsSource).toContain("createSecureDispatchInvite({");
    expect(teamsSource).toContain("inviteKind: 'worker'");
    expect(teamsSource).toContain("inviteKind: 'manager'");
    expect(teamsSource).toContain('Apple, Google, or a different Dispatch email');
  });

  it('requires explicit token claiming instead of legacy email auto-linking', () => {
    const dispatchSource = read('services/dispatch.ts');
    const functionsSource = read('functions/index.js');
    const rules = read('firestore.rules');
    expect(dispatchSource).toContain('if (!invite.managerId || invite.claimRequired) continue;');
    expect(dispatchSource).toContain('if (invite.claimRequired) continue;');
    // Billing-capacity checks make every invite write server-authoritative,
    // including the legacy paths that previously checked claimRequired here.
    for (const collectionName of ['workerInvites', 'managerInvites']) {
      const inviteRules = rules.match(new RegExp(
        `match /${collectionName}/\\{inviteId\\} \\{([\\s\\S]*?)\\n    \\}`
      ))?.[1];
      expect(inviteRules).toContain('allow create, update, delete: if false;');
    }
    expect(rules).toContain('match /secureInvites/{inviteHash}');
    expect(rules).toContain('allow read, write: if false;');
    expect(functionsSource).toContain('deliveryEmail,');
    expect(functionsSource).not.toContain('tokenPreview:');
    expect(functionsSource).not.toContain('normalizedEmail: deliveryEmail');
  });

  it('registers native links and preserves the invitation through authentication', () => {
    const appConfig = read('app.config.js');
    const inviteRoute = read('app/invite/[token].tsx');
    const inviteCodeRoute = read('app/invite/index.tsx');
    const setup = read('app/(auth)/setup.tsx');
    const signIn = read('app/(auth)/signin.tsx');
    const signUp = read('app/(auth)/signup.tsx');
    const verifyEmail = read('app/(auth)/verify-email.tsx');
    expect(appConfig).toContain('applinks:dispatchcrewmanager.com');
    expect(appConfig).toContain("pathPrefix: '/invite'");
    expect(inviteRoute).toContain("pathname: '/(auth)/setup'");
    expect(inviteRoute).toContain('inviteToken: normalizedToken');
    expect(inviteCodeRoute).toContain("direct: '1'");
    expect(setup).toContain('isInviteOnboarding');
    expect(setup).toContain('<SecureInviteScreen');
    expect(setup).toContain('inviteOnboarding');
    expect(signIn).toContain('inviteTokenParam');
    expect(signUp).toContain('inviteTokenParam');
    expect(verifyEmail).toContain('inviteTokenParam');
    expect(signIn).toContain("inviteResume: '1'");
    expect(signUp).toContain("inviteResume: '1'");
    expect(verifyEmail).toContain("inviteResume: '1'");
  });

  it('preserves Dispatch verification and invite handoff outside the customer beta transport', () => {
    const session = read('context/session.tsx');
    const signUp = read('app/(auth)/signup.tsx');
    const verifyEmail = read('app/(auth)/verify-email.tsx');
    const verificationClient = read('lib/email-verification.ts');
    const verificationFunction = read('functions/index.js');
    const verificationEmail = read('functions/lib/email-verification.js');

    expect(session).toContain('requestDispatchEmailVerification(inviteToken)');
    expect(session).not.toContain('sendEmailVerification');
    expect(session).toContain("'firebase-auth'");
    expect(verificationClient).toContain('if (isCustomerBeta())');
    expect(verificationClient).toContain('await sendEmailVerification(user);');
    expect(verificationClient).toContain("'sendDispatchEmailVerification'");
    expect(verificationFunction).toContain('generateEmailVerificationLink');
    expect(verificationEmail).toContain('https://dispatchcrewmanager.com/verify-email');
    expect(verificationEmail).toContain('buildDispatchVerificationLink');
    expect(verificationEmail).toContain("destination.searchParams.set('inviteToken'");
    expect(signUp).toContain('inviteToken,');
    expect(verifyEmail).toContain('sendVerificationEmail(inviteToken)');
    expect(verifyEmail).toContain("AppState.addEventListener('change'");
    expect(verifyEmail).toContain("state === 'active'");
  });

  it('refreshes Firebase verification before showing an invitation as blocked', () => {
    const secureInviteScreen = read('components/invite/SecureInviteScreen.tsx');
    expect(secureInviteScreen).toContain('refreshAuthUserRef.current()');
    expect(secureInviteScreen).toContain("AppState.addEventListener('change'");
    expect(secureInviteScreen).toContain('requiresEmailVerification');
  });

  it('routes manual invitation actions to the code entry screen', () => {
    const signIn = read('app/(auth)/signin.tsx');
    const signUp = read('app/(auth)/signup.tsx');
    const profile = read('app/(tabs)/profile.tsx');
    const secureInviteScreen = read('components/invite/SecureInviteScreen.tsx');

    expect(signIn).toContain('href="/invite"');
    expect(signUp).toContain('href="/invite"');
    expect(profile).toContain("router.push('/invite')");
    expect(secureInviteScreen).toContain("router.push('/invite')");

    for (const source of [signIn, signUp, profile, secureInviteScreen]) {
      expect(source).not.toContain('/invite/index');
    }
  });

  it('keeps ordinary account onboarding separate from invite-link onboarding', () => {
    const setup = read('app/(auth)/setup.tsx');
    expect(setup).toContain("title={`Welcome to Dispatch");
    expect(setup).toContain('eyebrow="The Manager role"');
    expect(setup).toContain('eyebrow="The Worker role"');
    expect(setup).toContain('How will you use Dispatch?');
    expect(setup).toContain('isInviteOnboarding && step === 3');
    expect(setup).toContain('const totalSteps = isInviteOnboarding ? 4 : TOTAL_STEPS;');
  });

  it('lets an unaffiliated Manager finish onboarding without creating an organization', () => {
    const setup = read('app/(auth)/setup.tsx');
    expect(setup).toContain('const skipOrganizationSetup = async () =>');
    expect(setup).toContain("'Skip for now'");
    expect(setup).toContain('await completeOnboarding();');
    expect(setup).toContain("router.replace('/(tabs)/profile');");
    expect(setup).toContain('continue without one while you wait for an invitation');
  });

  it('guides unaffiliated Workers back to their invitation email', () => {
    const tabLayout = read('app/(tabs)/_layout.tsx');
    const setup = read('app/(auth)/setup.tsx');
    const teams = read('app/(tabs)/teams.tsx');

    expect(tabLayout).toContain("'No invitation yet'");
    expect(tabLayout).toContain('open the invitation link in that email');
    expect(setup).toContain('open its invitation link to join the organization');
    expect(teams).toContain('No team invite yet. Please check email for an invitation link.');
    expect(teams).toContain("profile?.role === 'worker'");
  });
});
