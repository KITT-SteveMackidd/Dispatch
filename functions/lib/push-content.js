function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function normalizeExpoPushTokens(values) {
  return uniqueStrings(values).filter((token) => /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token));
}

function chatPushContent(message, thread = {}) {
  const senderName = typeof message.senderName === 'string' ? message.senderName.trim() : '';
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const attachmentCount = Array.isArray(message.attachments) ? message.attachments.length : 0;
  return {
    title: senderName ? `New message from ${senderName}` : 'New chat message',
    body: text || (attachmentCount ? `Sent ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}.` : 'You have a new message.'),
    data: {
      kind: 'chat',
      threadId: message.threadId || thread.id,
      senderId: message.senderId,
      teamId: message.teamId || thread.teamId || undefined,
      organizationId: thread.organizationId || undefined,
      threadTitle: thread.title || undefined,
      participantIds: uniqueStrings(thread.participants),
    },
  };
}

function rolePushContent(notification) {
  const roleLabel = typeof notification.roleName === 'string' && notification.roleName.trim()
    ? notification.roleName.trim()
    : 'assigned role';
  const title = notification.action === 'assign' ? 'New role invite' : 'Role update';
  const fallbackBody = `${notification.eventName || 'Event'}: ${notification.action === 'assign' ? `You were invited to ${roleLabel}.` : `You were removed from ${roleLabel}.`}`;
  return {
    title,
    body: typeof notification.statusReason === 'string' && notification.statusReason.trim()
      ? notification.statusReason.trim()
      : fallbackBody,
    data: {
      kind: 'user_notification',
      relatedEventId: notification.eventId,
      roleAssignmentNotificationId: notification.id,
    },
  };
}

function eventReminderTargets(event) {
  const targets = new Map();
  for (const role of Array.isArray(event.roles) ? event.roles : []) {
    for (const workerId of uniqueStrings(role.assignedWorkerIds)) {
      const roleNames = targets.get(workerId) || [];
      if (role.name && !roleNames.includes(role.name)) roleNames.push(role.name);
      targets.set(workerId, roleNames);
    }
  }
  return [...targets.entries()].map(([userId, roleNames]) => ({ userId, roleNames }));
}

module.exports = {
  chatPushContent,
  eventReminderTargets,
  normalizeExpoPushTokens,
  rolePushContent,
  uniqueStrings,
};
