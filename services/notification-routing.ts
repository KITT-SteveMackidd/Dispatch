export type NotificationRouteData = {
  kind?: 'chat' | 'user_notification';
  threadId?: string;
  senderId?: string;
  teamId?: string;
  organizationId?: string;
  threadTitle?: string;
  participantIds?: string[];
  relatedEventId?: string;
  userNotificationId?: string;
};

export function resolveChatRouteFromNotification(data: NotificationRouteData, currentUserId?: string) {
  const threadId = data.threadId || '';

  if (threadId.startsWith('organization:')) {
    const parts = threadId.split(':');
    const organizationId = data.organizationId || parts[1];
    const isManagersGroup = parts[2] === 'managers';
    const workerId = isManagersGroup ? parts[3] : `organization:${organizationId}:all`;
    const currentUserIsWorker = isManagersGroup && currentUserId === workerId;
    const title = currentUserIsWorker ? 'Managers' : data.threadTitle || (isManagersGroup ? 'Worker' : 'Organization');

    return {
      workerId,
      workerLabel: title,
      teamName: title,
      teamMemberIds: (data.participantIds || []).join(','),
      isTeamAll: '1',
      teamThreadId: threadId,
      teamThreadPath: isManagersGroup ? 'Worker and all organization managers' : 'Everyone in the organization',
    };
  }

  if (threadId.startsWith('team:') && threadId.endsWith(':all')) {
    const teamId = data.teamId || threadId.split(':')[1];
    const title = data.threadTitle || 'Team';
    return {
      workerId: `all:${teamId}`,
      workerLabel: title,
      teamId,
      teamName: title,
      teamMemberIds: (data.participantIds || []).join(','),
      isTeamAll: '1',
      teamThreadId: threadId,
      teamThreadPath: 'All Team workers and organization managers',
    };
  }

  const dmMarker = ':dm:';
  if (threadId.includes(dmMarker)) {
    const participantsRaw = threadId.split(dmMarker).pop() || '';
    const participants = participantsRaw.split('__').filter(Boolean);
    const other = participants.find((id) => id !== currentUserId) || data.senderId;
    if (other) {
      return {
        workerId: other,
        workerLabel: 'Teammate',
        teamId: data.teamId,
      };
    }
  }

  if (data.senderId) {
    return {
      workerId: data.senderId,
      workerLabel: 'Teammate',
      teamId: data.teamId,
    };
  }

  return null;
}
