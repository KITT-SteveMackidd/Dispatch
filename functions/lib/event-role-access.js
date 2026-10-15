function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(
    (value) => typeof value === 'string' && value.trim().length > 0
  ))];
}

function eventAccessForRoleInvitation(notification, event, userId) {
  if (!notification || notification.workerId !== userId) {
    throw new Error('This role invitation belongs to another user.');
  }
  if (notification.action !== 'assign') {
    throw new Error('Only role assignment invitations grant Event access.');
  }
  if (!['pending', 'declined', 'waitlisted'].includes(notification.status)) {
    throw new Error('This role invitation is no longer available.');
  }
  const roles = Array.isArray(event?.roles) ? event.roles : [];
  if (!roles.some((role) => role?.id === notification.roleId)) {
    throw new Error('The invited role no longer exists.');
  }

  const currentWorkerIds = uniqueStrings(event.workerIds);
  return {
    changed: !currentWorkerIds.includes(userId),
    workerIds: uniqueStrings([...currentWorkerIds, userId]),
  };
}

module.exports = { eventAccessForRoleInvitation };
