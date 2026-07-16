import { describe, expect, it } from 'vitest';
import { buildWorkerRoleExport, toLocalDateKey } from '../lib/worker-role-export-data';
import { DispatchEvent, UserProfile } from '../types/dispatch';

function makeEvent(params: { id: string; startsAt: Date; roleName: string; workerIds: string[] }): DispatchEvent {
  return {
    id: params.id,
    managerId: 'manager-1',
    name: 'Event',
    location: 'Venue',
    startsAt: params.startsAt.toISOString(),
    teamIds: [],
    roles: [{
      id: `role-${params.id}`,
      name: params.roleName,
      assignedWorkerIds: params.workerIds,
      openSlots: 0,
      tasks: [],
    }],
  };
}

describe('worker role export', () => {
  it('places role titles in rows, event dates in columns, and assigned workers in cells', () => {
    const firstDate = new Date(2026, 6, 2, 10, 0, 0);
    const secondDate = new Date(2026, 6, 4, 18, 0, 0);
    const workers: UserProfile[] = [
      { uid: 'w1', displayName: 'Alex Worker', role: 'worker' },
      { uid: 'w2', displayName: 'Blair Worker', role: 'worker' },
    ];
    const events = [
      makeEvent({ id: 'one', startsAt: firstDate, roleName: 'Box Office', workerIds: ['w2', 'w1'] }),
      makeEvent({ id: 'two', startsAt: firstDate, roleName: 'Box Office', workerIds: ['w1'] }),
      makeEvent({ id: 'three', startsAt: secondDate, roleName: 'Security', workerIds: ['w2'] }),
      makeEvent({ id: 'four', startsAt: secondDate, roleName: 'Unfilled', workerIds: [] }),
    ];

    expect(buildWorkerRoleExport(events, workers)).toEqual({
      dates: [toLocalDateKey(firstDate), toLocalDateKey(secondDate)],
      rows: [
        {
          roleTitle: 'Box Office',
          workersByDate: {
            [toLocalDateKey(firstDate)]: ['Alex Worker', 'Blair Worker'],
            [toLocalDateKey(secondDate)]: [],
          },
        },
        {
          roleTitle: 'Security',
          workersByDate: {
            [toLocalDateKey(firstDate)]: [],
            [toLocalDateKey(secondDate)]: ['Blair Worker'],
          },
        },
      ],
    });
  });
});
