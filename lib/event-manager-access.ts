import type { AppRole, DispatchEvent } from '@/types/dispatch';

export function canManagerManageEvent(params: {
  eventManagerId: string;
  eventOrganizationId?: string | null;
  managerId: string;
  managerOrganizationId?: string | null;
  managerRole?: AppRole;
}) {
  if (params.eventManagerId === params.managerId) return true;
  return params.managerRole === 'manager'
    && Boolean(params.eventOrganizationId)
    && params.eventOrganizationId === params.managerOrganizationId;
}

export function mergeManagerEventScopes(organizationEvents: DispatchEvent[], legacyOwnEvents: DispatchEvent[]) {
  const eventsById = new Map<string, DispatchEvent>();
  [...organizationEvents, ...legacyOwnEvents].forEach((event) => eventsById.set(event.id, event));
  return [...eventsById.values()];
}

export function hasConcurrentEventChange(currentRevision: number | undefined, expectedRevision: number | undefined) {
  return expectedRevision !== undefined && (currentRevision ?? 0) !== expectedRevision;
}
