function taskDueAtMs(event, task) {
  const startsAtMs = Date.parse(event.startsAt || '');
  const offsetMinutes = Number(task.expectedOffsetMinutes);
  if (Number.isFinite(startsAtMs) && Number.isFinite(offsetMinutes)) {
    return startsAtMs + Math.max(0, offsetMinutes) * 60 * 1000;
  }

  const dueAtMs = Date.parse(task.dueAt || '');
  return Number.isFinite(dueAtMs) ? dueAtMs : Number.POSITIVE_INFINITY;
}

function lateTaskNotificationDocuments(params) {
  const managerIds = [...new Set([
    params.event.managerId,
    ...(params.organizationManagerIds || []),
  ].filter(Boolean))];

  return (params.event.roles || []).flatMap((role) =>
    (role.tasks || []).flatMap((task) => {
      const dueAtMs = taskDueAtMs(params.event, task);
      if (!Number.isFinite(dueAtMs) || dueAtMs > params.nowMs || (task.completedBy || []).length) return [];

      const baseId = `behind_schedule__${params.event.id}__${role.id}__${task.id}`;
      return managerIds.map((managerId) => ({
        id: managerId === params.event.managerId ? baseId : `${baseId}__${managerId}`,
        userId: managerId,
        kind: 'task_behind_schedule',
        title: 'Task behind schedule',
        body: `${params.event.name || 'Event'}: ${role.name || 'Role'} is behind on "${task.name || 'Task'}".`,
        relatedEventId: params.event.id,
        relatedRoleId: role.id,
        relatedTaskId: task.id,
        dueAt: new Date(dueAtMs).toISOString(),
        read: false,
        statusReason: `Task due at ${new Date(dueAtMs).toISOString()} passed before completion.`,
      }));
    })
  );
}

module.exports = { lateTaskNotificationDocuments, taskDueAtMs };
