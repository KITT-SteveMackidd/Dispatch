import { describe, expect, it } from 'vitest';
import {
  clearWorkerEventRoleRemoval,
  mergePersistedAndOptimisticEvents,
  prepareWorkerEventRoleInvitation,
  removeEventRoleAndRebuildWorkers,
  removeWorkerFromEventRoleAndRebuildWorkers,
} from '../lib/event-role-deletion';
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

  it('removes every target-role membership while retaining the worker through another role', () => {
    const roles: EventRole[] = [
      {
        id: 'remove-from',
        name: 'Box Office',
        assignedWorkerIds: ['worker-1'],
        waitlistWorkerIds: ['worker-1', 'worker-2'],
        eligibleWaitlistWorkerIds: ['worker-1', 'worker-3'],
        waitlistInviteWorkerIds: ['worker-1', 'worker-4'],
        openSlots: 0,
        tasks: [],
      },
      {
        id: 'keep-in',
        name: 'Usher',
        assignedWorkerIds: ['worker-1'],
        openSlots: 0,
        tasks: [],
      },
    ];

    const result = removeWorkerFromEventRoleAndRebuildWorkers(roles, 'remove-from', 'worker-1');

    expect(result.roles[0]).toMatchObject({
      assignedWorkerIds: [],
      waitlistWorkerIds: ['worker-2'],
      eligibleWaitlistWorkerIds: ['worker-3'],
      waitlistInviteWorkerIds: ['worker-4', 'worker-2'],
      removedWorkerIds: ['worker-1'],
      openSlots: 1,
    });
    expect(result.roles[1]).toBe(roles[1]);
    expect(result.workerIds).toEqual(['worker-2', 'worker-3', 'worker-4', 'worker-1']);
    expect(result.waitlistWorkerIdsToNotify).toEqual(['worker-2']);
  });

  it('removes the worker from the event index when the target role was their only membership', () => {
    const roles: EventRole[] = [
      { id: 'role-1', name: 'Box Office', assignedWorkerIds: ['worker-1'], openSlots: 0, tasks: [] },
    ];

    expect(removeWorkerFromEventRoleAndRebuildWorkers(roles, 'role-1', 'worker-1').workerIds)
      .toEqual([]);
  });

  it('clears only the re-invited worker tombstone without indexing the pending invite', () => {
    const roles: EventRole[] = [
      {
        id: 'role-1',
        name: 'Box Office',
        assignedWorkerIds: [],
        removedWorkerIds: ['worker-1', 'worker-2'],
        openSlots: 1,
        tasks: [],
      },
    ];

    expect(clearWorkerEventRoleRemoval(roles, 'role-1', 'worker-1')).toEqual({
      roles: [{ ...roles[0], removedWorkerIds: ['worker-2'] }],
      workerIds: [],
    });
  });

  it('indexes a pending invitee without assigning them to the role', () => {
    const roles: EventRole[] = [
      {
        id: 'role-1',
        name: 'Box Office',
        assignedWorkerIds: [],
        removedWorkerIds: ['worker-1', 'worker-2'],
        openSlots: 1,
        tasks: [],
      },
    ];

    expect(prepareWorkerEventRoleInvitation(roles, 'role-1', 'worker-1')).toEqual({
      roles: [{ ...roles[0], removedWorkerIds: ['worker-2'] }],
      workerIds: ['worker-1'],
    });
  });

  it('never renders duplicate optimistic and persisted copies of a newly created event', () => {
    const event = { id: 'event-1' } as DispatchEvent;
    expect(mergePersistedAndOptimisticEvents([event], [{ ...event, name: 'optimistic' }]).map((item) => item.id))
      .toEqual(['event-1']);
  });
});
