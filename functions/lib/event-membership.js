function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function removeId(values, targetUserId) {
  return uniqueStrings(values).filter((value) => value !== targetUserId);
}

function rebuildEventWorkerIds(roles = []) {
  return uniqueStrings((Array.isArray(roles) ? roles : []).flatMap((role) => [
    ...uniqueStrings(role?.assignedWorkerIds),
    ...uniqueStrings(role?.waitlistWorkerIds),
    ...uniqueStrings(role?.eligibleWaitlistWorkerIds),
    ...uniqueStrings(role?.waitlistInviteWorkerIds),
  ]));
}

function removeWorkerFromEventMembership(roles = [], targetUserId) {
  const normalizedTargetUserId = typeof targetUserId === 'string' ? targetUserId.trim() : '';
  if (!normalizedTargetUserId) {
    return { roles: Array.isArray(roles) ? roles : [], workerIds: rebuildEventWorkerIds(roles), changed: false };
  }

  let changed = false;
  const nextRoles = (Array.isArray(roles) ? roles : []).map((role) => {
    const assignedWorkerIds = uniqueStrings(role?.assignedWorkerIds);
    const wasAssigned = assignedWorkerIds.includes(normalizedTargetUserId);
    const nextRole = {
      ...role,
      assignedWorkerIds: removeId(assignedWorkerIds, normalizedTargetUserId),
      waitlistWorkerIds: removeId(role?.waitlistWorkerIds, normalizedTargetUserId),
      eligibleWaitlistWorkerIds: removeId(role?.eligibleWaitlistWorkerIds, normalizedTargetUserId),
      waitlistInviteWorkerIds: removeId(role?.waitlistInviteWorkerIds, normalizedTargetUserId),
      removedWorkerIds: removeId(role?.removedWorkerIds, normalizedTargetUserId),
      openSlots: Math.max(0, Math.floor(Number(role?.openSlots) || 0) + (wasAssigned ? 1 : 0)),
      tasks: (Array.isArray(role?.tasks) ? role.tasks : []).map((task) => ({
        ...task,
        completedBy: removeId(task?.completedBy, normalizedTargetUserId),
      })),
    };
    const referencedBefore = [
      ...assignedWorkerIds,
      ...uniqueStrings(role?.waitlistWorkerIds),
      ...uniqueStrings(role?.eligibleWaitlistWorkerIds),
      ...uniqueStrings(role?.waitlistInviteWorkerIds),
      ...uniqueStrings(role?.removedWorkerIds),
      ...(Array.isArray(role?.tasks) ? role.tasks : []).flatMap((task) => uniqueStrings(task?.completedBy)),
    ].includes(normalizedTargetUserId);
    changed = changed || referencedBefore;
    return nextRole;
  });

  return { roles: nextRoles, workerIds: rebuildEventWorkerIds(nextRoles), changed };
}

module.exports = {
  rebuildEventWorkerIds,
  removeWorkerFromEventMembership,
};
