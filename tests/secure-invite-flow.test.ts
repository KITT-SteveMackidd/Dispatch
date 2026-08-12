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
    expect(rules).toContain('resource.data.claimRequired != true');
    expect(rules).toContain('match /secureInvites/{inviteHash}');
    expect(rules).toContain('allow read, write: if false;');
    expect(functionsSource).toContain('deliveryEmail,');
    expect(functionsSource).not.toContain('tokenPreview:');
    expect(functionsSource).not.toContain('normalizedEmail: deliveryEmail');
  });

  it('registers native links and preserves the invitation through authentication', () => {
    const appConfig = read('app.config.js');
    const signIn = read('app/(auth)/signin.tsx');
    const signUp = read('app/(auth)/signup.tsx');
    const verifyEmail = read('app/(auth)/verify-email.tsx');
    expect(appConfig).toContain('applinks:dispatchcrewmanager.com');
    expect(appConfig).toContain("pathPrefix: '/invite'");
    expect(signIn).toContain('inviteTokenParam');
    expect(signUp).toContain('inviteTokenParam');
    expect(verifyEmail).toContain('inviteTokenParam');
  });
});
