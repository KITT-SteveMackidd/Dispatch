export function buildLateTaskNotificationTargets(params: {
  eventManagerId: string;
  organizationManagerIds?: string[];
  eventId: string;
  roleId: string;
  taskId: string;
}) {
  const managerIds = [...new Set([
    params.eventManagerId,
    ...(params.organizationManagerIds || []),
  ].filter(Boolean))];
  const baseId = `behind_schedule__${params.eventId}__${params.roleId}__${params.taskId}`;

  return managerIds.map((managerId) => ({
    managerId,
    notificationId: managerId === params.eventManagerId ? baseId : `${baseId}__${managerId}`,
  }));
}
