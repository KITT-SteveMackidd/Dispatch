import type { AppRole } from '@/types/dispatch';

function uniqueIds(ids: Iterable<string>): string[] {
  return [...new Set([...ids].filter(Boolean))];
}

export function buildCurrentManagerIds(
  members: Array<{ uid: string; role: AppRole }>,
  currentProfile: { uid: string; role: AppRole }
): string[] {
  return uniqueIds([
    ...members.filter((member) => member.role === 'manager').map((member) => member.uid),
    ...(currentProfile.role === 'manager' ? [currentProfile.uid] : []),
  ]);
}

export function getVisibleManagerChatWorkerIds(
  workerIds: Iterable<string>,
  currentProfile: { uid: string; role: AppRole }
): string[] {
  return currentProfile.role === 'worker'
    ? [currentProfile.uid]
    : uniqueIds(workerIds).filter((workerId) => workerId !== currentProfile.uid);
}

export function buildManagerChatParticipants(workerId: string, managerIds: Iterable<string>): string[] {
  return uniqueIds([workerId, ...managerIds]);
}

export function shouldLinkPendingWorkerInvites(previousRole: AppRole | null, nextRole: AppRole): boolean {
  return nextRole === 'worker' && previousRole !== 'manager';
}
