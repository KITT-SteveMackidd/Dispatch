import { describe, expect, it } from 'vitest';
import { mergePersistedAndOptimisticEvents, removeEventRoleAndRebuildWorkers } from '../lib/event-role-deletion';
import type { DispatchEvent, EventRole } from '../types/dispatch';

describe('event role deletion', () => {
  it('removes the role and every worker reference that belonged only to it', () => {
    const roles: EventRole[] = [
      { id: 'remove', name: 'Removed', assignedWorkerIds: ['worker-1'], waitlistWorkerIds: ['worker-2'], openSlots: 0, tasks: [] },
      { id: 'keep', name: 'Kept', assignedWorkerIds: ['worker-3'], waitlistInviteWorkerIds: ['worker-4'], openSlots: 0, tasks: [] },
    ];
    expect(removeEventRoleAndRebuildWorkers(roles, 'remove')).toEqual({
      roles: [roles[1]],
      workerIds: ['worker-3', 'worker-4'],
    });
  });

  it('never renders duplicate optimistic and persisted copies of a newly created event', () => {
    const event = { id: 'event-1' } as DispatchEvent;
    expect(mergePersistedAndOptimisticEvents([event], [{ ...event, name: 'optimistic' }]).map((item) => item.id))
      .toEqual(['event-1']);
  });
});
