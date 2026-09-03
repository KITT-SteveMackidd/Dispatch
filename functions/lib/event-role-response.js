function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(
    (value) => typeof value === 'string' && value.trim().length > 0
  ))];
}

function availableRoleSlots(role) {
  const storedOpenSlots = Math.max(0, Number(role?.openSlots) || 0);
  if (storedOpenSlots > 0) return storedOpenSlots;
  return uniqueStrings(role?.assignedWorkerIds).length === 0 ? 1 : 0;
}

function removeWorkerFromOtherRoleWaitlists(role, acceptedRoleId, workerId) {
  if (role.id === acceptedRoleId) return role;
  return {
    ...role,
    waitlistWorkerIds: uniqueStrings(role.waitlistWorkerIds).filter((id) => id !== workerId),
    waitlistInviteWorkerIds: uniqueStrings(role.waitlistInviteWorkerIds).filter((id) => id !== workerId),
    eligibleWaitlistWorkerIds: uniqueStrings(role.eligibleWaitlistWorkerIds).filter((id) => id !== workerId),
  };
}

function buildEventRoleResponse({ notification, event, workerId, workerName, response }) {
  if (!notification || notification.workerId !== workerId) {
    throw new Error('This role invitation belongs to another user.');
  }
  if (!['accept', 'decline'].includes(response)) {
    throw new Error('Choose Accept or Decline.');
  }
  if (notification.status !== 'pending') {
    return {
      alreadyHandled: true,
      eventId: notification.eventId,
      roleId: notification.roleId,
      shouldQueueReminder: false,
    };
  }

  let nextRoles = Array.isArray(event?.roles) ? event.roles : [];
  const notificationRole = nextRoles.find((role) => role?.id === notification.roleId);
  const roleName = notificationRole?.name || notification.roleName || 'role';
  let eventChanged = false;

  if (notification.action === 'assign' && response === 'accept') {
    if (!notificationRole) throw new Error('The invited role no longer exists.');
    const alreadyAssigned = uniqueStrings(notificationRole.assignedWorkerIds).includes(workerId);
    const alreadyAssignedToEvent = nextRoles.some((role) => uniqueStrings(role.assignedWorkerIds).includes(workerId));
    if (alreadyAssignedToEvent && !alreadyAssigned) {
      throw new Error('You already accepted a role for this event.');
    }
    if (!alreadyAssigned && availableRoleSlots(notificationRole) <= 0) {
      throw new Error('This role is full. Join the waitlist instead.');
    }

    nextRoles = nextRoles.map((role) => {
      if (role.id !== notification.roleId) {
        return removeWorkerFromOtherRoleWaitlists(role, notification.roleId, workerId);
      }
      if (alreadyAssigned) return role;
      return {
        ...role,
        assignedWorkerIds: [...uniqueStrings(role.assignedWorkerIds), workerId],
        waitlistWorkerIds: uniqueStrings(role.waitlistWorkerIds).filter((id) => id !== workerId),
        eligibleWaitlistWorkerIds: uniqueStrings(role.eligibleWaitlistWorkerIds).filter((id) => id !== workerId),
        waitlistInviteWorkerIds: uniqueStrings(role.waitlistInviteWorkerIds).filter((id) => id !== workerId),
        openSlots: Math.max(0, availableRoleSlots(role) - 1),
      };
    });
    eventChanged = true;
  }

  if (notification.action === 'assign' && response === 'decline') {
    if (!notificationRole) throw new Error('The invited role no longer exists.');
    nextRoles = nextRoles.map((role) => {
      if (role.id !== notification.roleId) return role;
      return {
        ...role,
        assignedWorkerIds: uniqueStrings(role.assignedWorkerIds).filter((id) => id !== workerId),
        waitlistWorkerIds: uniqueStrings(role.waitlistWorkerIds).filter((id) => id !== workerId),
        waitlistInviteWorkerIds: uniqueStrings(role.waitlistInviteWorkerIds).filter((id) => id !== workerId),
        eligibleWaitlistWorkerIds: uniqueStrings([...uniqueStrings(role.eligibleWaitlistWorkerIds), workerId]),
      };
    });
    eventChanged = true;
  }

  if (notification.action === 'remove' && response === 'decline') {
    if (!notificationRole) throw new Error('The removed role no longer exists.');
    nextRoles = nextRoles.map((role) => {
      if (role.id !== notification.roleId) return role;
      const assignedWorkerIds = uniqueStrings(role.assignedWorkerIds);
      if (assignedWorkerIds.includes(workerId)) return role;
      return {
        ...role,
        assignedWorkerIds: [...assignedWorkerIds, workerId],
        openSlots: Math.max(0, (Number(role.openSlots) || 0) - 1),
      };
    });
    eventChanged = true;
  }

  return {
    alreadyHandled: false,
    eventId: notification.eventId,
    roleId: notification.roleId,
    eventPatch: eventChanged ? {
      roles: nextRoles,
      workerIds: uniqueStrings([...uniqueStrings(event.workerIds), workerId]),
      revision: (Number(event.revision) || 0) + 1,
    } : null,
    notificationPatch: {
      status: response === 'accept' ? 'accepted' : 'declined',
      statusReason: response === 'accept'
        ? 'Worker accepted this role assignment update.'
        : 'Worker declined this role assignment update.',
      response,
    },
    managerNotification: {
      userId: notification.managerId,
      kind: 'role_invite_response',
      title: response === 'accept' ? 'Role invite accepted' : 'Role invite declined',
      body: `${workerName || 'Worker'} ${response === 'accept' ? 'accepted' : 'declined'} ${roleName} for ${event.name || 'the event'}.`,
      relatedEventId: notification.eventId,
      relatedRoleId: notification.roleId,
      sourceNotificationId: notification.id,
      read: false,
    },
    shouldQueueReminder: notification.action === 'assign' && response === 'accept',
  };
}

module.exports = { buildEventRoleResponse };
