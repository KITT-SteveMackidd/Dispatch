export type WorkerInviteResult = {
  linked: boolean;
  reused: boolean;
  workerId?: string;
};

export function getWorkerInviteOutcomeMessage(result: WorkerInviteResult) {
  if (result.reused) {
    return 'An active invitation for this worker is already pending.';
  }
  if (result.linked) {
    return 'This worker already has a Dispatch account. Their in-app invitation is now pending.';
  }
  return 'Worker invite sent.';
}

export function getWorkerInviteErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code).toLowerCase()
    : '';
  const message = error instanceof Error ? error.message : '';

  if (code === 'permission-denied' || code === 'firestore/permission-denied' || /missing or insufficient permissions/i.test(message)) {
    return 'Dispatch could not verify this invitation. Confirm you are still a Manager in this organization, refresh Teams, and try again.';
  }

  return message || 'Unable to send this Worker invitation. Refresh Teams and try again.';
}

export function isExistingTeamMember(workerId: string | undefined, workerIds: string[] | undefined) {
  return Boolean(workerId && workerIds?.includes(workerId));
}
