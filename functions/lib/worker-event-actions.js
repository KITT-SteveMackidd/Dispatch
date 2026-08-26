const { rebuildEventWorkerIds } = require('./event-membership');

const WORKER_EVENT_ACTION_TYPES = Object.freeze([
  'cancel_worker_role',
  'join_event_waitlist',
  'accept_waitlist_invite',
  'respond_role_notification',
  'toggle_task_completion',
]);

function normalizedId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizedId).filter(Boolean))];
}

function sameIds(left, right) {
  const normalizedLeft = uniqueIds(left);
  const normalizedRight = uniqueIds(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function failure(code, reason, message) {
  return { ok: false, code, reason, message };
}

function validIdentityList(value) {
  if (value == null) return true;
  if (!Array.isArray(value)) return false;
  const normalized = value.map(normalizedId);
  return normalized.every((valueId, index) => (
    valueId && value[index] === valueId && normalized.indexOf(valueId) === index
  ));
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return failure('failed-precondition', 'invalid-event-state', 'The event is missing or malformed.');
  }
  const eventId = normalizedId(event.id);
  const managerId = normalizedId(event.managerId);
  if (!eventId || event.id !== eventId || !managerId || event.managerId !== managerId || !Array.isArray(event.roles)) {
    return failure('failed-precondition', 'invalid-event-state', 'The event is missing or malformed.');
  }

  const roleIds = new Set();
  for (const role of event.roles) {
    if (!role || typeof role !== 'object' || Array.isArray(role)) {
      return failure('failed-precondition', 'invalid-event-state', 'The event contains a malformed role.');
    }
    const roleId = normalizedId(role.id);
    if (!roleId || role.id !== roleId || roleIds.has(roleId)) {
      return failure('failed-precondition', 'invalid-event-state', 'The event contains an invalid or duplicate role.');
    }
    roleIds.add(roleId);
    if (
      !validIdentityList(role.assignedWorkerIds)
      || !validIdentityList(role.waitlistWorkerIds)
      || !validIdentityList(role.eligibleWaitlistWorkerIds)
      || !validIdentityList(role.waitlistInviteWorkerIds)
      || !validIdentityList(role.removedWorkerIds)
      || (role.openSlots != null && (
        !Number.isSafeInteger(role.openSlots) || role.openSlots < 0
      ))
      || (role.tasks != null && !Array.isArray(role.tasks))
    ) {
      return failure('failed-precondition', 'invalid-event-state', 'The event contains malformed role availability.');
    }

    const taskIds = new Set();
    for (const task of role.tasks || []) {
      const taskId = normalizedId(task?.id);
      if (
        !task
        || typeof task !== 'object'
        || Array.isArray(task)
        || !taskId
        || task.id !== taskId
        || taskIds.has(taskId)
        || !validIdentityList(task.completedBy)
      ) {
        return failure('failed-precondition', 'invalid-event-state', 'The event contains an invalid or duplicate task.');
      }
      taskIds.add(taskId);
    }
  }

  return { ok: true, eventId, managerId, roles: event.roles };
}

function prepareContext(params, actionType) {
  const callerUserId = normalizedId(params?.callerUserId);
  if (!callerUserId) {
    return failure('unauthenticated', 'missing-caller', 'Sign in before changing an event.');
  }
  if (params?.workerId !== undefined && normalizedId(params.workerId) !== callerUserId) {
    return failure(
      'permission-denied',
      'caller-identity-mismatch',
      'A worker action can modify only the authenticated worker identity.'
    );
  }

  const validatedEvent = validateEvent(params?.event);
  if (!validatedEvent.ok) return validatedEvent;
  if (params?.eventId !== undefined && normalizedId(params.eventId) !== validatedEvent.eventId) {
    return failure(
      'failed-precondition',
      'event-id-mismatch',
      'The requested event does not match the authoritative event document.'
    );
  }

  return {
    ok: true,
    actionType,
    callerUserId,
    event: params.event,
    ...validatedEvent,
  };
}

function findRole(context, roleIdValue) {
  const roleId = normalizedId(roleIdValue);
  if (!roleId) {
    return failure('invalid-argument', 'missing-role-id', 'Choose a valid event role.');
  }
  const role = context.roles.find((candidate) => candidate.id === roleId);
  if (!role) return failure('not-found', 'role-not-found', 'The selected event role no longer exists.');
  return { ok: true, roleId, role };
}

function roleIdentityList(role, fieldName) {
  return uniqueIds(role?.[fieldName]);
}

function availableRoleSlots(role) {
  const storedOpenSlots = role.openSlots || 0;
  if (storedOpenSlots > 0) return storedOpenSlots;
  return roleIdentityList(role, 'assignedWorkerIds').length === 0 ? 1 : 0;
}

function callerAssignedRoleIds(roles, callerUserId) {
  return roles
    .filter((role) => roleIdentityList(role, 'assignedWorkerIds').includes(callerUserId))
    .map((role) => role.id);
}

function removeCallerFromRoleAvailability(role, callerUserId, { includeRemoved = false } = {}) {
  const nextRole = {
    ...role,
    waitlistWorkerIds: roleIdentityList(role, 'waitlistWorkerIds').filter((id) => id !== callerUserId),
    eligibleWaitlistWorkerIds: roleIdentityList(role, 'eligibleWaitlistWorkerIds').filter((id) => id !== callerUserId),
    waitlistInviteWorkerIds: roleIdentityList(role, 'waitlistInviteWorkerIds').filter((id) => id !== callerUserId),
  };
  if (includeRemoved) {
    nextRole.removedWorkerIds = roleIdentityList(role, 'removedWorkerIds').filter((id) => id !== callerUserId);
  }
  return nextRole;
}

function roleAvailabilityChanged(before, after) {
  return !sameIds(before.waitlistWorkerIds, after.waitlistWorkerIds)
    || !sameIds(before.eligibleWaitlistWorkerIds, after.eligibleWaitlistWorkerIds)
    || !sameIds(before.waitlistInviteWorkerIds, after.waitlistInviteWorkerIds)
    || !sameIds(before.removedWorkerIds, after.removedWorkerIds);
}

function success({
  context,
  roles,
  outcome,
  eventChanged,
  notificationSpecs = [],
  roleNotificationUpdate = null,
  reminderEmailSpec = null,
}) {
  return {
    ok: true,
    actionType: context.actionType,
    callerUserId: context.callerUserId,
    eventId: context.eventId,
    outcome,
    eventChanged: eventChanged === true,
    roles,
    workerIds: rebuildEventWorkerIds(roles),
    notificationSpecs,
    roleNotificationUpdate,
    reminderEmailSpec,
  };
}

function planCancelWorkerRole(params = {}) {
  const context = prepareContext(params, 'cancel_worker_role');
  if (!context.ok) return context;
  const target = findRole(context, params.roleId);
  if (!target.ok) return target;

  const callerUserId = context.callerUserId;
  const assignedWorkerIds = roleIdentityList(target.role, 'assignedWorkerIds');
  if (!assignedWorkerIds.includes(callerUserId)) {
    return failure(
      'failed-precondition',
      'caller-not-assigned',
      'You are not currently assigned to this role.'
    );
  }

  const waitlistWorkerIds = roleIdentityList(target.role, 'waitlistWorkerIds')
    .filter((id) => id !== callerUserId);
  const nextTargetRole = {
    ...target.role,
    assignedWorkerIds: assignedWorkerIds.filter((id) => id !== callerUserId),
    waitlistWorkerIds,
    waitlistInviteWorkerIds: uniqueIds([
      ...roleIdentityList(target.role, 'waitlistInviteWorkerIds').filter((id) => id !== callerUserId),
      ...waitlistWorkerIds,
    ]),
    eligibleWaitlistWorkerIds: uniqueIds([
      ...roleIdentityList(target.role, 'eligibleWaitlistWorkerIds'),
      callerUserId,
    ]),
    openSlots: (target.role.openSlots || 0) + 1,
    tasks: (target.role.tasks || []).map((task) => ({
      ...task,
      completedBy: roleIdentityList(task, 'completedBy').filter((id) => id !== callerUserId),
    })),
  };
  const roles = context.roles.map((role) => role.id === target.roleId ? nextTargetRole : role);
  const eventName = typeof context.event.name === 'string' && context.event.name.trim()
    ? context.event.name.trim()
    : 'Event';
  const roleName = typeof target.role.name === 'string' && target.role.name.trim()
    ? target.role.name.trim()
    : 'role';
  const notificationSpecs = [{
    userId: context.managerId,
    kind: 'worker_role_cancelled',
    title: 'Worker cancelled role',
    body: `${eventName}: a worker cancelled ${roleName}.`,
    relatedEventId: context.eventId,
    relatedRoleId: target.roleId,
    read: false,
  }, ...waitlistWorkerIds.map((userId) => ({
    userId,
    kind: 'role_available',
    title: 'Role available',
    body: `${eventName}: ${roleName} is available.`,
    relatedEventId: context.eventId,
    relatedRoleId: target.roleId,
    read: false,
  }))];

  return success({
    context,
    roles,
    outcome: 'cancelled',
    eventChanged: true,
    notificationSpecs,
  });
}

function planJoinEventWaitlist(params = {}) {
  const context = prepareContext(params, 'join_event_waitlist');
  if (!context.ok) return context;
  const target = findRole(context, params.roleId);
  if (!target.ok) return target;
  const callerUserId = context.callerUserId;
  let waitlistNotificationUpdate = null;
  let notificationAuthorizesWaitlist = false;

  if (params.notification !== undefined) {
    const notification = params.notification;
    const notificationId = normalizedId(params.notificationId || notification?.id);
    const authorizedManagerIds = params.authorizedManagerIds === undefined
      ? [context.managerId]
      : uniqueIds(params.authorizedManagerIds);
    if (!notification || typeof notification !== 'object' || Array.isArray(notification)) {
      return failure('not-found', 'notification-not-found', 'The role notification no longer exists.');
    }
    if (!notificationId
      || (notification.id !== undefined && normalizedId(notification.id) !== notificationId)
      || normalizedId(notification.workerId) !== callerUserId
      || normalizedId(notification.eventId) !== context.eventId
      || normalizedId(notification.roleId) !== target.roleId
      || notification.action !== 'assign'
      || !['pending', 'declined'].includes(notification.status)
      || !authorizedManagerIds.includes(normalizedId(notification.managerId))) {
      return failure(
        'permission-denied',
        'waitlist-notification-invalid',
        'This role notification cannot authorize the requested waitlist change.'
      );
    }
    notificationAuthorizesWaitlist = true;
    waitlistNotificationUpdate = {
      notificationId,
      status: 'waitlisted',
      statusReason: 'Worker joined the waitlist for this role.',
    };
  }

  if (callerAssignedRoleIds(context.roles, callerUserId).length) {
    return failure(
      'failed-precondition',
      'caller-already-assigned',
      'You already accepted a role for this event.'
    );
  }
  if (availableRoleSlots(target.role) > 0) {
    return failure(
      'failed-precondition',
      'role-has-open-slot',
      'This role has an open slot; accept it instead of joining the waitlist.'
    );
  }

  const waitlistWorkerIds = roleIdentityList(target.role, 'waitlistWorkerIds');
  const eligibleWorkerIds = roleIdentityList(target.role, 'eligibleWaitlistWorkerIds');
  const invitedWorkerIds = roleIdentityList(target.role, 'waitlistInviteWorkerIds');
  if (!notificationAuthorizesWaitlist
    && ![waitlistWorkerIds, eligibleWorkerIds, invitedWorkerIds].some((ids) => ids.includes(callerUserId))) {
    return failure(
      'permission-denied',
      'caller-not-waitlist-eligible',
      'This worker is not eligible to join this role waitlist.'
    );
  }

  const nextTargetRole = {
    ...target.role,
    waitlistWorkerIds: uniqueIds([...waitlistWorkerIds, callerUserId]),
    eligibleWaitlistWorkerIds: eligibleWorkerIds.filter((id) => id !== callerUserId),
    waitlistInviteWorkerIds: invitedWorkerIds.filter((id) => id !== callerUserId),
  };
  const eventChanged = roleAvailabilityChanged(target.role, nextTargetRole);
  const roles = eventChanged
    ? context.roles.map((role) => role.id === target.roleId ? nextTargetRole : role)
    : context.roles;

  return success({
    context,
    roles,
    outcome: 'waitlisted',
    eventChanged,
    roleNotificationUpdate: waitlistNotificationUpdate,
  });
}

function planAcceptWaitlistInvite(params = {}) {
  const context = prepareContext(params, 'accept_waitlist_invite');
  if (!context.ok) return context;
  const target = findRole(context, params.roleId);
  if (!target.ok) return target;
  const callerUserId = context.callerUserId;
  const assignedRoleIds = callerAssignedRoleIds(context.roles, callerUserId);
  const assignedToTarget = assignedRoleIds.includes(target.roleId);
  if (assignedRoleIds.some((roleId) => roleId !== target.roleId)) {
    return failure(
      'failed-precondition',
      'caller-already-assigned',
      'You already accepted a role for this event.'
    );
  }

  if (assignedToTarget) {
    let eventChanged = false;
    const roles = context.roles.map((role) => {
      const nextRole = removeCallerFromRoleAvailability(role, callerUserId, {
        includeRemoved: role.id === target.roleId,
      });
      eventChanged = eventChanged || roleAvailabilityChanged(role, nextRole);
      return roleAvailabilityChanged(role, nextRole) ? nextRole : role;
    });
    return success({
      context,
      roles,
      outcome: 'already_assigned',
      eventChanged,
    });
  }

  const waitlistWorkerIds = roleIdentityList(target.role, 'waitlistWorkerIds');
  const eligibleWorkerIds = roleIdentityList(target.role, 'eligibleWaitlistWorkerIds');
  const invitedWorkerIds = roleIdentityList(target.role, 'waitlistInviteWorkerIds');
  if (![waitlistWorkerIds, eligibleWorkerIds, invitedWorkerIds].some((ids) => ids.includes(callerUserId))) {
    return failure(
      'failed-precondition',
      'waitlist-invite-unavailable',
      'This waitlist invite is no longer available.'
    );
  }

  const openSlots = availableRoleSlots(target.role);
  if (openSlots <= 0) {
    const nextTargetRole = {
      ...target.role,
      waitlistWorkerIds: uniqueIds([...waitlistWorkerIds, callerUserId]),
      eligibleWaitlistWorkerIds: eligibleWorkerIds.filter((id) => id !== callerUserId),
      waitlistInviteWorkerIds: invitedWorkerIds.filter((id) => id !== callerUserId),
    };
    const roles = context.roles.map((role) => role.id === target.roleId ? nextTargetRole : role);
    return success({
      context,
      roles,
      outcome: 'waitlisted_role_full',
      eventChanged: true,
    });
  }

  const roles = context.roles.map((role) => {
    if (role.id !== target.roleId) {
      const nextRole = removeCallerFromRoleAvailability(role, callerUserId);
      return roleAvailabilityChanged(role, nextRole) ? nextRole : role;
    }
    return {
      ...removeCallerFromRoleAvailability(role, callerUserId, { includeRemoved: true }),
      assignedWorkerIds: [...roleIdentityList(role, 'assignedWorkerIds'), callerUserId],
      openSlots: Math.max(0, openSlots - 1),
    };
  });
  const eventName = typeof context.event.name === 'string' && context.event.name.trim()
    ? context.event.name.trim()
    : 'Event';
  const roleName = typeof target.role.name === 'string' && target.role.name.trim()
    ? target.role.name.trim()
    : 'role';
  const workerName = typeof params.callerDisplayName === 'string' && params.callerDisplayName.trim()
    ? params.callerDisplayName.trim()
    : 'Worker';

  return success({
    context,
    roles,
    outcome: 'accepted',
    eventChanged: true,
    notificationSpecs: [{
      userId: context.managerId,
      kind: 'role_invite_response',
      title: 'Waitlist invite accepted',
      body: `${workerName} accepted ${roleName} for ${eventName}.`,
      relatedEventId: context.eventId,
      relatedRoleId: target.roleId,
      read: false,
    }],
    reminderEmailSpec: {
      eventId: context.eventId,
      roleId: target.roleId,
      workerId: callerUserId,
    },
  });
}

function validateRoleNotification(context, params) {
  const notification = params?.notification;
  if (!notification || typeof notification !== 'object' || Array.isArray(notification)) {
    return failure('not-found', 'notification-not-found', 'The role notification no longer exists.');
  }
  const notificationId = normalizedId(params.notificationId || notification.id);
  if (!notificationId || (notification.id !== undefined && normalizedId(notification.id) !== notificationId)) {
    return failure('failed-precondition', 'notification-id-mismatch', 'The role notification identity is invalid.');
  }
  if (normalizedId(notification.workerId) !== context.callerUserId) {
    return failure(
      'permission-denied',
      'notification-not-owned',
      'You can respond only to your own role notification.'
    );
  }
  if (normalizedId(notification.eventId) !== context.eventId) {
    return failure(
      'failed-precondition',
      'notification-event-mismatch',
      'The notification no longer matches this event.'
    );
  }
  if (notification.status !== 'pending') {
    return failure(
      'failed-precondition',
      'notification-not-pending',
      'This role notification has already been resolved.'
    );
  }
  if (notification.action !== 'assign' && notification.action !== 'remove') {
    return failure('failed-precondition', 'invalid-notification-action', 'The role notification action is invalid.');
  }

  const managerId = normalizedId(notification.managerId);
  const authorizedManagerIds = params.authorizedManagerIds === undefined
    ? [context.managerId]
    : uniqueIds(params.authorizedManagerIds);
  if (!managerId || !authorizedManagerIds.includes(managerId)) {
    return failure(
      'permission-denied',
      'notification-manager-not-authorized',
      'The notification was not issued by an authorized event Manager.'
    );
  }

  const target = findRole(context, notification.roleId);
  if (!target.ok) return target;
  if (params.roleId !== undefined && normalizedId(params.roleId) !== target.roleId) {
    return failure(
      'failed-precondition',
      'notification-role-mismatch',
      'The notification no longer matches this event role.'
    );
  }
  return { ok: true, notification, notificationId, managerId, ...target };
}

function planRespondRoleNotification(params = {}) {
  const context = prepareContext(params, 'respond_role_notification');
  if (!context.ok) return context;
  if (params.response !== 'accept' && params.response !== 'decline') {
    return failure('invalid-argument', 'invalid-notification-response', 'Choose accept or decline.');
  }
  const validatedNotification = validateRoleNotification(context, params);
  if (!validatedNotification.ok) return validatedNotification;

  const { notification, notificationId, managerId, roleId, role } = validatedNotification;
  const callerUserId = context.callerUserId;
  const assignedRoleIds = callerAssignedRoleIds(context.roles, callerUserId);
  const assignedToTarget = assignedRoleIds.includes(roleId);
  const assignedElsewhere = assignedRoleIds.some((assignedRoleId) => assignedRoleId !== roleId);
  let roles = context.roles;
  let eventChanged = false;
  let reminderEmailSpec = null;

  if (notification.action === 'assign' && params.response === 'accept') {
    if (assignedElsewhere) {
      return failure(
        'failed-precondition',
        'caller-already-assigned',
        'You already accepted a role for this event.'
      );
    }
    if (!assignedToTarget && availableRoleSlots(role) <= 0) {
      return failure(
        'failed-precondition',
        'role-full',
        'This role is full. Join the waitlist instead.'
      );
    }
    roles = context.roles.map((candidate) => {
      if (candidate.id !== roleId) {
        const nextRole = removeCallerFromRoleAvailability(candidate, callerUserId);
        if (roleAvailabilityChanged(candidate, nextRole)) eventChanged = true;
        return roleAvailabilityChanged(candidate, nextRole) ? nextRole : candidate;
      }
      const nextRole = removeCallerFromRoleAvailability(candidate, callerUserId, { includeRemoved: true });
      if (!assignedToTarget) {
        nextRole.assignedWorkerIds = [...roleIdentityList(candidate, 'assignedWorkerIds'), callerUserId];
        nextRole.openSlots = Math.max(0, availableRoleSlots(candidate) - 1);
      }
      if (roleAvailabilityChanged(candidate, nextRole) || !assignedToTarget) eventChanged = true;
      return eventChanged || !assignedToTarget ? nextRole : candidate;
    });
    reminderEmailSpec = { eventId: context.eventId, roleId, workerId: callerUserId };
  }

  if (notification.action === 'assign' && params.response === 'decline') {
    if (assignedToTarget) {
      return failure(
        'failed-precondition',
        'notification-event-state-mismatch',
        'This assignment is already active and cannot be declined as a pending invite.'
      );
    }
    const nextTargetRole = {
      ...role,
      waitlistWorkerIds: roleIdentityList(role, 'waitlistWorkerIds').filter((id) => id !== callerUserId),
      waitlistInviteWorkerIds: roleIdentityList(role, 'waitlistInviteWorkerIds').filter((id) => id !== callerUserId),
      eligibleWaitlistWorkerIds: uniqueIds([
        ...roleIdentityList(role, 'eligibleWaitlistWorkerIds'),
        callerUserId,
      ]),
    };
    eventChanged = roleAvailabilityChanged(role, nextTargetRole);
    roles = eventChanged
      ? context.roles.map((candidate) => candidate.id === roleId ? nextTargetRole : candidate)
      : context.roles;
  }

  if (notification.action === 'remove') {
    const removedWorkerIds = roleIdentityList(role, 'removedWorkerIds');
    if (!removedWorkerIds.includes(callerUserId) || assignedToTarget) {
      return failure(
        'failed-precondition',
        'notification-event-state-mismatch',
        'This removal notification no longer matches the event role state.'
      );
    }
    if (params.response === 'decline') {
      if (assignedElsewhere) {
        return failure(
          'failed-precondition',
          'caller-already-assigned',
          'You already accepted a role for this event.'
        );
      }
      const openSlots = availableRoleSlots(role);
      if (openSlots <= 0) {
        return failure('failed-precondition', 'role-full', 'This role no longer has room to restore the assignment.');
      }
      roles = context.roles.map((candidate) => {
        if (candidate.id !== roleId) {
          const nextRole = removeCallerFromRoleAvailability(candidate, callerUserId);
          return roleAvailabilityChanged(candidate, nextRole) ? nextRole : candidate;
        }
        return {
          ...removeCallerFromRoleAvailability(candidate, callerUserId, { includeRemoved: true }),
          assignedWorkerIds: [...roleIdentityList(candidate, 'assignedWorkerIds'), callerUserId],
          openSlots: Math.max(0, openSlots - 1),
        };
      });
      eventChanged = true;
    }
  }

  const eventName = typeof context.event.name === 'string' && context.event.name.trim()
    ? context.event.name.trim()
    : 'Event';
  const roleName = typeof role.name === 'string' && role.name.trim()
    ? role.name.trim()
    : typeof notification.roleName === 'string' && notification.roleName.trim()
      ? notification.roleName.trim()
      : 'role';
  const workerName = typeof params.callerDisplayName === 'string' && params.callerDisplayName.trim()
    ? params.callerDisplayName.trim()
    : 'Worker';
  const accepted = params.response === 'accept';

  return success({
    context,
    roles,
    outcome: `${notification.action}_${params.response}`,
    eventChanged,
    notificationSpecs: [{
      userId: managerId,
      kind: 'role_invite_response',
      title: accepted ? 'Role invite accepted' : 'Role invite declined',
      body: `${workerName} ${accepted ? 'accepted' : 'declined'} ${roleName} for ${eventName}.`,
      relatedEventId: context.eventId,
      relatedRoleId: roleId,
      sourceNotificationId: notificationId,
      read: false,
    }],
    roleNotificationUpdate: {
      notificationId,
      status: accepted ? 'accepted' : 'declined',
      statusReason: accepted
        ? 'Worker accepted this role assignment update.'
        : 'Worker declined this role assignment update.',
      response: params.response,
    },
    reminderEmailSpec,
  });
}

function planToggleTaskCompletion(params = {}) {
  const context = prepareContext(params, 'toggle_task_completion');
  if (!context.ok) return context;
  if (typeof params.complete !== 'boolean') {
    return failure('invalid-argument', 'invalid-completion-state', 'Task completion must be true or false.');
  }
  const target = findRole(context, params.roleId);
  if (!target.ok) return target;
  const callerUserId = context.callerUserId;
  if (!roleIdentityList(target.role, 'assignedWorkerIds').includes(callerUserId)) {
    return failure(
      'permission-denied',
      'caller-not-assigned',
      'Only a worker assigned to this role can update its tasks.'
    );
  }

  const taskId = normalizedId(params.taskId);
  if (!taskId) return failure('invalid-argument', 'missing-task-id', 'Choose a valid event task.');
  const task = (target.role.tasks || []).find((candidate) => candidate.id === taskId);
  if (!task) return failure('not-found', 'task-not-found', 'The selected event task no longer exists.');
  const completedBy = roleIdentityList(task, 'completedBy');
  const isComplete = completedBy.includes(callerUserId);
  if (isComplete === params.complete) {
    return success({
      context,
      roles: context.roles,
      outcome: params.complete ? 'already_complete' : 'already_incomplete',
      eventChanged: false,
    });
  }

  const roles = context.roles.map((role) => {
    if (role.id !== target.roleId) return role;
    return {
      ...role,
      tasks: (role.tasks || []).map((candidate) => candidate.id === taskId ? {
        ...candidate,
        completedBy: params.complete
          ? [...completedBy, callerUserId]
          : completedBy.filter((id) => id !== callerUserId),
      } : candidate),
    };
  });
  return success({
    context,
    roles,
    outcome: params.complete ? 'completed' : 'reopened',
    eventChanged: true,
  });
}

function planWorkerEventAction(params = {}) {
  switch (params.actionType) {
    case 'cancel_worker_role': return planCancelWorkerRole(params);
    case 'join_event_waitlist': return planJoinEventWaitlist(params);
    case 'accept_waitlist_invite': return planAcceptWaitlistInvite(params);
    case 'respond_role_notification': return planRespondRoleNotification(params);
    case 'toggle_task_completion': return planToggleTaskCompletion(params);
    default:
      return failure(
        'invalid-argument',
        'invalid-worker-action',
        'Choose a supported worker event action.'
      );
  }
}

module.exports = {
  WORKER_EVENT_ACTION_TYPES,
  planAcceptWaitlistInvite,
  planCancelWorkerRole,
  planJoinEventWaitlist,
  planRespondRoleNotification,
  planToggleTaskCompletion,
  planWorkerEventAction,
};
