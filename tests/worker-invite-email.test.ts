import { describe, expect, it } from 'vitest';
import { buildWorkerInviteEmailDocument } from '../lib/worker-invite-email';

function containsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(containsUndefined);
}

describe('buildWorkerInviteEmailDocument', () => {
  it('creates a solo invite without undefined Firestore fields', () => {
    const document = buildWorkerInviteEmailDocument({
      email: 'worker@example.com',
      appLink: 'https://dispatch.app/download',
      inviteId: 'invite-1',
      managerId: 'manager-1',
    });

    expect(document.dispatchInvite.teamId).toBeNull();
    expect(document.dispatchInvite.teamName).toBe('Solo worker');
    expect(containsUndefined(document)).toBe(false);
  });

  it('creates a Team invite without undefined Firestore fields', () => {
    const document = buildWorkerInviteEmailDocument({
      email: 'worker@example.com',
      teamName: undefined,
      teamId: 'team-1',
      appLink: 'https://dispatch.app/download',
      inviteId: 'invite-2',
      managerId: 'manager-1',
    });

    expect(document.dispatchInvite.teamId).toBe('team-1');
    expect(document.dispatchInvite.teamName).toBe('Dispatch Team');
    expect(containsUndefined(document)).toBe(false);
  });
});
