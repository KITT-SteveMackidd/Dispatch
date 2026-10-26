import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

function inviteHarness(existingBackend: boolean) {
  const functions = { projectId: 'dispatch-eb63a', region: 'us-central1' };
  const invoke = vi.fn().mockResolvedValue({ data: { inviteId: 'invite', deliveryQueued: true, invites: [], adopted: false } });
  const httpsCallable = vi.fn(() => invoke);
  const code = ts.transpileModule(readFileSync(join(process.cwd(), 'lib/secure-invites.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} as Record<string, (...args: any[]) => Promise<unknown>> };
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === '@/config/beta-mode') return { isExistingDispatchCustomerBeta: () => existingBackend };
    if (name === '@/lib/firebase') return { functions };
    if (name === 'firebase/functions') return { httpsCallable };
    throw new Error(`Unexpected import ${name}`);
  }, module, module.exports);
  return { client: module.exports, functions, invoke, httpsCallable };
}

describe('existing Dispatch beta invitation compatibility', () => {
  it('skips legacy adoption and refuses unsupported list/cancel without network calls', async () => {
    const fixture = inviteHarness(true);
    await expect(fixture.client.adoptLegacyDispatchInvites()).resolves.toEqual({ adopted: false, unavailable: true });
    await expect(fixture.client.cancelSecureDispatchInvite('invite')).rejects.toThrow('not available in this beta build');
    await expect(fixture.client.listOrganizationPendingInvites()).rejects.toThrow('not available in this beta build');
    expect(fixture.httpsCallable).not.toHaveBeenCalled();
    expect(fixture.invoke).not.toHaveBeenCalled();
  });

  it('preserves emailed secure invitation creation and code/token preview and claim', async () => {
    const fixture = inviteHarness(true);
    const params = { inviteKind: 'worker', deliveryEmail: 'person@example.test', teamId: 'team' };
    await expect(fixture.client.createSecureDispatchInvite(params)).resolves.toMatchObject({ deliveryQueued: true });
    await fixture.client.getSecureDispatchInvite('backup-code');
    await fixture.client.claimSecureDispatchInvite('secure-token');
    expect(fixture.httpsCallable.mock.calls).toEqual([
      [fixture.functions, 'createDispatchInvite'], [fixture.functions, 'getDispatchInvite'], [fixture.functions, 'claimDispatchInvite'],
    ]);
    expect(fixture.invoke.mock.calls).toEqual([[params], [{ tokenOrCode: 'backup-code' }], [{ tokenOrCode: 'secure-token' }]]);
  });

  it('keeps adoption and invitation management available on supported backends', async () => {
    const fixture = inviteHarness(false);
    await fixture.client.adoptLegacyDispatchInvites();
    await fixture.client.cancelSecureDispatchInvite('invite');
    await fixture.client.listOrganizationPendingInvites();
    expect(fixture.httpsCallable.mock.calls).toEqual([
      [fixture.functions, 'adoptLegacyDispatchInvites'], [fixture.functions, 'cancelDispatchInvite'], [fixture.functions, 'listOrganizationPendingInvites'],
    ]);
  });
});
