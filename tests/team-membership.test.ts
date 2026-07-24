import { describe, expect, it } from 'vitest';
import { normalizeTeamMemberRole, validateTeamWorkerSelection } from '../lib/team-membership';

const members = [
  { uid: 'manager-1', role: 'Manager' },
  { uid: 'worker-1', role: 'worker' as const },
  { uid: 'worker-2', role: 'Worker' },
];

describe('validateTeamWorkerSelection', () => {
  it('normalizes legacy manager and worker role casing', () => {
    expect(normalizeTeamMemberRole(' Manager ')).toBe('manager');
    expect(normalizeTeamMemberRole('Worker')).toBe('worker');
  });

  it('returns a deduplicated organization-worker roster', () => {
    expect(validateTeamWorkerSelection(members, ['worker-2', 'worker-1', 'worker-2']))
      .toEqual(['worker-2', 'worker-1']);
  });

  it('allows a manager to remove every worker from a team', () => {
    expect(validateTeamWorkerSelection(members, [])).toEqual([]);
  });

  it('rejects managers and users outside the organization as workers', () => {
    expect(() => validateTeamWorkerSelection(members, ['manager-1'])).toThrow(/not part of this organization/i);
    expect(() => validateTeamWorkerSelection(members, ['worker-3'])).toThrow(/not part of this organization/i);
  });
});
