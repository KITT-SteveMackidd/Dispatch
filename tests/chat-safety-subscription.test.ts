import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, { next: (snapshot: unknown) => void; error: () => void; unsubscribe: ReturnType<typeof vi.fn> }>(),
  callable: vi.fn(),
}));
vi.mock('../lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  onSnapshot: (path: string, next: (snapshot: unknown) => void, error: () => void) => {
    const unsubscribe = vi.fn();
    mocks.listeners.set(path, { next, error, unsubscribe });
    return unsubscribe;
  },
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.callable }));

import { subscribeToChatSafety, type ChatSafetySnapshot, type ChatSafetyState } from '../services/chat-safety';

const result: ChatSafetyState = {
  enabled: true, termsVersion: '2026-10-27', acceptedTerms: true,
  blockedUsers: [], hiddenSenderIds: [], canSend: true, canModerate: false,
};
const flag = (enabled: boolean) => ({ exists: () => true, data: () => ({ chatSafetyEnabled: enabled }) });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('chat safety rollout and session isolation', () => {
  beforeEach(() => { mocks.listeners.clear(); mocks.callable.mockReset().mockResolvedValue({ data: result }); });

  it('never calls safety functions or subscribes to private state when rollout is off', async () => {
    const changes: ChatSafetySnapshot[] = [];
    const subscription = subscribeToChatSafety({ userId: 'alice', organizationId: 'org' }, (value) => changes.push(value));
    expect(changes.at(-1)?.canSend).toBe(false);
    await subscription.refresh();
    mocks.listeners.get('organizations/org')!.next(flag(false));
    await subscription.refresh();
    expect(mocks.callable).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(1);
    expect(changes.at(-1)).toMatchObject({ enabled: false, rolloutReady: true, canSend: true });
    subscription.unsubscribe();
  });

  it('requires the authoritative check before allowing an enabled thread to send', async () => {
    const changes: ChatSafetySnapshot[] = [];
    const subscription = subscribeToChatSafety({ userId: 'alice', organizationId: 'org', threadId: 'chat-a' }, (value) => changes.push(value));
    mocks.listeners.get('organizations/org')!.next(flag(true));
    expect(changes.at(-1)?.canSend).toBe(false);
    mocks.listeners.get('users/alice/chatSafetyState/current')!.next({});
    await flush();
    expect(mocks.callable).toHaveBeenCalledWith({ threadId: 'chat-a' });
    expect(changes.at(-1)).toMatchObject({ enabled: true, canSend: true, loading: false });
    subscription.unsubscribe();
  });

  it('rejects late safety results after rollout has been disabled', async () => {
    let resolve!: (value: { data: ChatSafetyState }) => void;
    mocks.callable.mockReturnValue(new Promise((done) => { resolve = done; }));
    const changes: ChatSafetySnapshot[] = [];
    const subscription = subscribeToChatSafety({ userId: 'alice', organizationId: 'org' }, (value) => changes.push(value));
    mocks.listeners.get('organizations/org')!.next(flag(true));
    mocks.listeners.get('users/alice/chatSafetyState/current')!.next({});
    mocks.listeners.get('organizations/org')!.next(flag(false));
    resolve({ data: { ...result, blockedUsers: [{ uid: 'bob', displayName: 'Bob' }] } });
    await flush();
    expect(changes.at(-1)).toMatchObject({ enabled: false, state: null });
    expect(mocks.listeners.get('users/alice/chatSafetyState/current')!.unsubscribe).toHaveBeenCalledOnce();
    subscription.unsubscribe();
  });

  it('invalidates reviewer access when organization membership changes while rollout stays enabled', async () => {
    mocks.callable.mockResolvedValueOnce({ data: { ...result, canModerate: true } });
    const changes: ChatSafetySnapshot[] = [];
    const subscription = subscribeToChatSafety({ userId: 'alice', organizationId: 'org' }, (value) => changes.push(value));
    mocks.listeners.get('organizations/org')!.next(flag(true));
    mocks.listeners.get('users/alice/chatSafetyState/current')!.next({});
    await flush();
    expect(changes.at(-1)?.state?.canModerate).toBe(true);
    mocks.listeners.get('organizations/org')!.next(flag(true));
    expect(changes.at(-1)?.loading).toBe(true);
    await flush();
    expect(changes.at(-1)?.state?.canModerate).toBe(false);
    expect(mocks.callable).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it('does not publish previous account or thread data after unsubscribe', async () => {
    let resolve!: (value: { data: ChatSafetyState }) => void;
    mocks.callable.mockReturnValue(new Promise((done) => { resolve = done; }));
    const changed = vi.fn();
    const subscription = subscribeToChatSafety({ userId: 'alice', organizationId: 'org' }, changed);
    mocks.listeners.get('organizations/org')!.next(flag(true));
    mocks.listeners.get('users/alice/chatSafetyState/current')!.next({});
    subscription.unsubscribe();
    changed.mockClear();
    resolve({ data: result });
    await flush();
    expect(changed).not.toHaveBeenCalled();
  });

  it('fails closed when the callable or either listener fails', async () => {
    mocks.callable.mockRejectedValue(new Error('unavailable'));
    const changes: ChatSafetySnapshot[] = [];
    const subscription = subscribeToChatSafety({ userId: 'alice', organizationId: 'org' }, (value) => changes.push(value));
    mocks.listeners.get('organizations/org')!.next(flag(true));
    mocks.listeners.get('users/alice/chatSafetyState/current')!.next({});
    await flush();
    expect(changes.at(-1)).toMatchObject({ canSend: false, loading: false });
    expect(changes.at(-1)?.error).toBeTruthy();
    mocks.listeners.get('users/alice/chatSafetyState/current')!.error();
    expect(changes.at(-1)?.canSend).toBe(false);
    mocks.listeners.get('organizations/org')!.error();
    expect(changes.at(-1)).toMatchObject({ canSend: false, rolloutReady: false });
    subscription.unsubscribe();
  });
});
