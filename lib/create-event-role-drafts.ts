import type { EventTemplate } from '@/types/dispatch';

export type CreateEventRoleDraft = {
  id: string;
  name: string;
  tasks: EventTemplate['roles'][number]['tasks'];
  assignedWorkerId: string | null;
};

export function buildCreateEventRoleDrafts(template?: Pick<EventTemplate, 'roles'>): CreateEventRoleDraft[] {
  if (!template?.roles?.length) return [];

  return template.roles.map((role, index) => ({
    id: role.id || `role-${index + 1}`,
    name: role.name || `Role ${index + 1}`,
    tasks: (role.tasks || []).map((task) => ({
      ...task,
      attachments: task.attachments?.map((attachment) => ({ ...attachment })),
    })),
    assignedWorkerId: null,
  }));
}
