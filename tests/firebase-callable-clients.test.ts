import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { firebaseFunctionsRegion } from '../lib/firebase-region';

function loadClient(file: string, functions: object) {
  const invoke = vi.fn().mockResolvedValue({ data: { accepted: true } });
  const httpsCallable = vi.fn(() => invoke);
  const getFunctions = vi.fn(() => { throw new Error('Client bypassed the configured Firebase instance'); });
  const code = ts.transpileModule(readFileSync(join(process.cwd(), file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} as Record<string, (...args: any[]) => Promise<unknown>> };
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === '@/lib/firebase') return { functions };
    if (name === 'firebase/functions') return { httpsCallable, getFunctions };
    throw new Error(`Unexpected import ${name}`);
  }, module, module.exports);
  return { client: module.exports, invoke, httpsCallable, getFunctions };
}

const cases = [
  ['lib/chat-message-access.ts', 'sendChatMessageThroughServer', 'sendChatMessage', [{ threadId: 'thread', text: 'Hello', attachments: [] }]],
  ['lib/chat-message-access.ts', 'addCustomChatParticipantsThroughServer', 'addCustomChatParticipants', [{ threadId: 'thread', participantIds: ['member'] }]],
  ['lib/event-role-invite-access.ts', 'prepareEventRoleInviteResponse', 'prepareEventRoleInviteResponse', ['notification']],
  ['lib/event-role-invite-access.ts', 'respondToEventRoleInvite', 'respondToEventRoleInvite', ['notification', 'accept']],
  ['lib/push-token-access.ts', 'registerDevicePushTokenThroughServer', 'registerDevicePushToken', [{ token: 'device-token', platform: 'android', permissionStatus: 'granted' }]],
  ['lib/push-token-access.ts', 'unregisterDevicePushTokenThroughServer', 'unregisterDevicePushToken', [{ token: 'device-token' }]],
] as const;

describe.each(['dispatch-customer-beta', 'dispatch-eb63a', 'demo-dispatch-billing'])('callable clients in %s', projectId => {
  it.each(cases)('%s uses configured Firebase for %s', async (file, method, endpoint, args) => {
    const configuredFunctions = {
      app: { options: { projectId } },
      region: firebaseFunctionsRegion(projectId),
      emulator: projectId.startsWith('demo-') ? '192.168.1.45:5001' : undefined,
    };
    const fixture = loadClient(file, configuredFunctions);
    await fixture.client[method](...args);
    expect(fixture.httpsCallable.mock.calls).toEqual([[configuredFunctions, endpoint]]);
    expect(fixture.getFunctions).not.toHaveBeenCalled();
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    const expectedPayload = method === 'prepareEventRoleInviteResponse'
      ? { notificationId: 'notification' }
      : method === 'respondToEventRoleInvite'
        ? { notificationId: 'notification', response: 'accept' }
        : args[0];
    expect(fixture.invoke).toHaveBeenCalledWith(expectedPayload);
  });
});
