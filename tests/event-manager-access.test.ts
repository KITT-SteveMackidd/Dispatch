import { describe, expect, it } from 'vitest';
import { canManagerManageEvent, hasConcurrentEventChange, mergeManagerEventScopes } from '../lib/event-manager-access';
import type { DispatchEvent } from '../types/dispatch';

const makeEvent = (id: string, managerId: string, organizationId?: string | null): DispatchEvent => ({
  id,
  managerId,
  organizationId,
  name: id,
  location: '',
  startsAt: '2026-07-31T12:00:00.000Z',
  teamIds: [],
  roles: [],
});

describe('organization Manager event access', () => {
  it('allows every Manager in the same organization to manage the event', () => {
    expect(canManagerManageEvent({
      eventManagerId: 'manager-1',
      eventOrganizationId: 'org-1',
      managerId: 'manager-2',
      managerOrganizationId: 'org-1',
      managerRole: 'manager',
    })).toBe(true);
  });

  it('does not grant cross-organization or Worker access', () => {
    expect(canManagerManageEvent({
      eventManagerId: 'manager-1',
      eventOrganizationId: 'org-1',
      managerId: 'manager-2',
      managerOrganizationId: 'org-2',
      managerRole: 'manager',
    })).toBe(false);
    expect(canManagerManageEvent({
      eventManagerId: 'manager-1',
      eventOrganizationId: 'org-1',
      managerId: 'worker-1',
      managerOrganizationId: 'org-1',
      managerRole: 'worker',
    })).toBe(false);
  });

  it('merges organization events with the Manager legacy event scope without duplicates', () => {
    const shared = makeEvent('shared', 'manager-1', 'org-1');
    const legacy = makeEvent('legacy', 'manager-2', null);
    expect(mergeManagerEventScopes([shared], [shared, legacy]).map((event) => event.id)).toEqual(['shared', 'legacy']);
  });

  it('surfaces a stale Manager edit instead of silently overwriting it', () => {
    expect(hasConcurrentEventChange(4, 3)).toBe(true);
    expect(hasConcurrentEventChange(4, 4)).toBe(false);
    expect(hasConcurrentEventChange(undefined, 0)).toBe(false);
  });
});
