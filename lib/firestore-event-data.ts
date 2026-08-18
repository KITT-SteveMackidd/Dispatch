import type { EventRole, EventTask } from '@/types/dispatch';

export type EventTaskTemplateInput = Pick<
  EventTask,
  'id' | 'name' | 'description' | 'attachments' | 'expectedOffsetMinutes' | 'optional'
>;

export function sanitizeEventTaskForFirestore(task: EventTask, index: number): EventTask {
  const description = task.description?.trim() || '';
  const expectedOffsetMinutes = Number(task.expectedOffsetMinutes);
  const hasCountdown = Number.isFinite(expectedOffsetMinutes);
  const dueAt = hasCountdown && task.dueAt?.trim() ? task.dueAt.trim() : '';

  return {
    id: task.id?.trim() || `task-${index + 1}`,
    name: task.name?.trim() || `Task ${index + 1}`,
    ...(description ? { description } : {}),
    attachments: (task.attachments || []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      kind: attachment.kind,
    })),
    ...(hasCountdown ? { expectedOffsetMinutes: Math.max(0, expectedOffsetMinutes) } : {}),
    ...(dueAt ? { dueAt } : {}),
    optional: Boolean(task.optional),
    completedBy: [...new Set((task.completedBy || []).filter(Boolean))],
  };
}

export function sanitizeEventRoleForFirestore(role: EventRole, tasks = role.tasks): EventRole {
  return {
    id: role.id,
    name: role.name.trim(),
    assignedWorkerIds: [...new Set((role.assignedWorkerIds || []).filter(Boolean))],
    waitlistWorkerIds: [...new Set((role.waitlistWorkerIds || []).filter(Boolean))],
    eligibleWaitlistWorkerIds: [...new Set((role.eligibleWaitlistWorkerIds || []).filter(Boolean))],
    waitlistInviteWorkerIds: [...new Set((role.waitlistInviteWorkerIds || []).filter(Boolean))],
    removedWorkerIds: [...new Set((role.removedWorkerIds || []).filter(Boolean))],
    openSlots: Number.isFinite(role.openSlots) ? Math.max(0, role.openSlots) : 0,
    tasks: (tasks || []).map(sanitizeEventTaskForFirestore),
  };
}

export function buildEventTaskFromTemplate(
  task: EventTaskTemplateInput,
  eventStartsAtMs: number,
  index: number
): EventTask {
  const expectedOffsetMinutes = Number(task.expectedOffsetMinutes);
  const hasCountdown = Number.isFinite(expectedOffsetMinutes);
  const safeOffsetMinutes = hasCountdown ? Math.max(0, Math.round(expectedOffsetMinutes)) : undefined;

  return sanitizeEventTaskForFirestore({
    ...task,
    ...(safeOffsetMinutes !== undefined
      ? {
          expectedOffsetMinutes: safeOffsetMinutes,
          dueAt: new Date(eventStartsAtMs + safeOffsetMinutes * 60 * 1000).toISOString(),
        }
      : {}),
    completedBy: [],
  }, index);
}

export function buildNewEventRoleForFirestore(
  id: string,
  name: string,
  tasks: EventTaskTemplateInput[],
  eventStartsAtMs: number
): EventRole {
  return sanitizeEventRoleForFirestore({
    id,
    name,
    assignedWorkerIds: [],
    waitlistWorkerIds: [],
    eligibleWaitlistWorkerIds: [],
    waitlistInviteWorkerIds: [],
    removedWorkerIds: [],
    openSlots: 1,
    tasks: tasks.map((task, index) => buildEventTaskFromTemplate(task, eventStartsAtMs, index)),
  });
}
