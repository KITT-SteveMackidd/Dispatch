export type NotificationRouteData = {
  kind?: 'chat' | 'user_notification';
  threadId?: string;
  senderId?: string;
  teamId?: string;
  relatedEventId?: string;
};

export function resolveChatRouteFromNotification(data: NotificationRouteData, currentUserId?: string) {
  const threadId = data.threadId || '';

  if (threadId.startsWith('team:') && threadId.endsWith(':all')) {
    const teamId = data.teamId || threadId.split(':')[1];
    return {
      workerId: `all:${teamId}`,
      workerLabel: 'All',
      teamId,
      isTeamAll: '1',
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
