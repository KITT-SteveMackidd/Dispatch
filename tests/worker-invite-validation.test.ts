import { describe, expect, it } from 'vitest';
import { getWorkerInviteErrorMessage, getWorkerInviteOutcomeMessage, isExistingTeamMember } from '../lib/worker-invite-validation';

describe('worker invite validation', () => {
  it('recognizes an existing active membership', () => {
    expect(isExistingTeamMember('worker-1', ['worker-1', 'worker-2'])).toBe(true);
    expect(isExistingTeamMember('worker-3', ['worker-1', 'worker-2'])).toBe(false);
  });

  it('explains when an active invite is reused', () => {
    expect(getWorkerInviteOutcomeMessage({ linked: false, reused: true })).toBe(
      'An active invitation for this worker is already pending.'
    );
  });

  it('explains when an existing account receives an in-app invite', () => {
    expect(getWorkerInviteOutcomeMessage({ linked: true, reused: false, workerId: 'worker-1' })).toContain(
      'already has a Dispatch account'
    );
  });

  it('replaces raw Firestore permission failures with a Manager recovery path', () => {
    expect(getWorkerInviteErrorMessage({ code: 'permission-denied' })).toContain('Confirm you are still a Manager');
    expect(getWorkerInviteErrorMessage(new Error('Missing or insufficient permissions.'))).not.toContain('Missing or insufficient');
  });
});
