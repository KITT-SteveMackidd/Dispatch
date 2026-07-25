function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value))];
}

function roleStateFingerprint(event) {
  const source = event || {};
  return JSON.stringify({
    name: source.name || '',
    location: source.location || '',
    startsAt: source.startsAt || '',
    roles: (Array.isArray(source.roles) ? source.roles : []).map((role) => ({
      id: role.id || '',
      name: role.name || '',
      openSlots: Math.max(0, Number(role.openSlots) || 0),
      assignedWorkerIds: uniqueStrings(role.assignedWorkerIds),
      waitlistWorkerIds: uniqueStrings(role.waitlistWorkerIds),
      eligibleWaitlistWorkerIds: uniqueStrings(role.eligibleWaitlistWorkerIds),
      waitlistInviteWorkerIds: uniqueStrings(role.waitlistInviteWorkerIds),
      taskNames: (Array.isArray(role.tasks) ? role.tasks : []).map((task) => task?.name).filter(Boolean),
    })),
  });
}

function buildRoleNotificationState(notification, event) {
  const source = notification || {};
  const eventData = event || {};
  const roles = Array.isArray(eventData.roles) ? eventData.roles : [];
  const role = roles.find((item) => item?.id === source.roleId);
  const eventMetadata = {
    eventName: eventData.name || source.eventName || '',
    eventLocation: eventData.location || '',
    eventStartsAt: eventData.startsAt || '',
  };

  if (!role) {
    return source.action === 'assign'
      ? {
        ...eventMetadata,
        status: 'declined',
        statusReason: 'This role is no longer part of the event.',
      }
      : eventMetadata;
  }

  const assignedWorkerIds = uniqueStrings(role.assignedWorkerIds);
  const waitlistWorkerIds = uniqueStrings(role.waitlistWorkerIds);
  const eligibleWaitlistWorkerIds = uniqueStrings(role.eligibleWaitlistWorkerIds);
  const waitlistInviteWorkerIds = uniqueStrings(role.waitlistInviteWorkerIds);
  const workerId = source.workerId;
  const assignedRole = roles.find((item) => uniqueStrings(item?.assignedWorkerIds).includes(workerId));
  const state = {
    ...eventMetadata,
    roleName: role.name || source.roleName || '',
    roleTaskNames: (Array.isArray(role.tasks) ? role.tasks : []).map((task) => task?.name).filter(Boolean),
    roleOpenSlots: Math.max(0, Number(role.openSlots) || 0),
    roleAssignedWorkerIds: assignedWorkerIds,
    roleWaitlistWorkerIds: waitlistWorkerIds,
    roleEligibleWaitlistWorkerIds: eligibleWaitlistWorkerIds,
    roleWaitlistInviteWorkerIds: waitlistInviteWorkerIds,
  };

  if (source.action !== 'assign' || !workerId) return state;

  if (assignedWorkerIds.includes(workerId)) {
    return {
      ...state,
      status: 'accepted',
      statusReason: 'Worker accepted this role assignment.',
    };
  }

  if (assignedRole && assignedRole.id !== role.id) {
    return {
      ...state,
      status: 'declined',
      statusReason: 'Worker accepted another role for this event.',
    };
  }

  if (waitlistWorkerIds.includes(workerId)) {
    return {
      ...state,
      status: 'waitlisted',
      statusReason: 'Worker joined the waitlist for this role.',
    };
  }

  if (source.status === 'accepted' || source.status === 'waitlisted') {
    return {
      ...state,
      status: 'declined',
      statusReason: source.status === 'accepted'
        ? 'Worker is no longer assigned to this role.'
        : 'Worker is no longer on the waitlist for this role.',
    };
  }

  return state;
}

function roleNotificationStateChanged(notification, nextState) {
  return Object.entries(nextState).some(([key, nextValue]) => {
    const currentValue = notification?.[key];
    if (Array.isArray(nextValue)) {
      return !Array.isArray(currentValue)
        || currentValue.length !== nextValue.length
        || nextValue.some((value, index) => value !== currentValue[index]);
    }
    return currentValue !== nextValue;
  });
}

module.exports = {
  buildRoleNotificationState,
  roleNotificationStateChanged,
  roleStateFingerprint,
};
