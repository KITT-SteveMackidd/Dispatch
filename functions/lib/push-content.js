const crypto = require('node:crypto');

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

function documentKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function chatPushRecipientIds(message, thread = {}, activeViewerIds = []) {
  const activeViewers = new Set(uniqueStrings(activeViewerIds));
  return uniqueStrings(message.recipientIds?.length ? message.recipientIds : thread.participants)
    .filter((userId) => userId !== message.senderId && !activeViewers.has(userId));
}

function rolePushContent(notification) {
  const roleLabel = typeof notification.roleName === 'string' && notification.roleName.trim()
    ? notification.roleName.trim()
    : 'assigned role';
  const eventLabel = typeof notification.eventName === 'string' && notification.eventName.trim()
    ? notification.eventName.trim()
    : 'Event';
  const title = notification.action === 'assign' ? 'New role invite' : 'Role update';
  const fallbackBody = `${eventLabel}: You were removed from ${roleLabel}.`;
  return {
    title,
    body: notification.action === 'assign'
      ? `${eventLabel}: You were invited to ${roleLabel}. Accept or decline in Dispatch.`
      : typeof notification.statusReason === 'string' && notification.statusReason.trim()
        ? notification.statusReason.trim()
        : fallbackBody,
    data: {
      kind: 'user_notification',
      relatedEventId: notification.eventId,
      roleAssignmentNotificationId: notification.id,
    },
  };
}

function rolePushRecipientId(notification) {
  const workerId = typeof notification.workerId === 'string' ? notification.workerId.trim() : '';
  const managerId = typeof notification.managerId === 'string' ? notification.managerId.trim() : '';
  return workerId && workerId !== managerId ? workerId : null;
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
  chatPushRecipientIds,
  documentKey,
  eventReminderTargets,
  normalizeExpoPushTokens,
  rolePushContent,
  rolePushRecipientId,
  uniqueStrings,
};
