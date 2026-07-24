import type { UserProfile } from '@/types/dispatch';

export function normalizeTeamMemberRole(role?: string | null): UserProfile['role'] | null {
  const normalizedRole = role?.trim().toLowerCase();
  return normalizedRole === 'manager' || normalizedRole === 'worker' ? normalizedRole : null;
}

export function validateTeamWorkerSelection(
  organizationMembers: Array<{ uid: string; role?: string | null }>,
  selectedWorkerIds: string[]
) {
  const organizationWorkerIds = new Set(
    organizationMembers
      .filter((member) => normalizeTeamMemberRole(member.role) === 'worker')
      .map((member) => member.uid)
  );
  const selected = [...new Set(selectedWorkerIds.filter(Boolean))];
  const invalidWorkerIds = selected.filter((workerId) => !organizationWorkerIds.has(workerId));
  if (invalidWorkerIds.length) {
    throw new Error('One or more selected workers are not part of this organization.');
  }
  return selected;
}
