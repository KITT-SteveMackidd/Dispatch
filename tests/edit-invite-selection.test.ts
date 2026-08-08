import { describe, expect, it } from 'vitest';
import {
  buildEventInviteTeamOptions,
  buildEditInviteChanges,
  buildEditInviteSelection,
  SOLO_WORKERS_INVITE_TEAM_ID,
  toggleEditableInviteTeam,
  toggleEditableInviteWorker,
} from '../lib/edit-invite-selection';

describe('Edit Invites selection', () => {
  it('opens with accepted assignments and pending invitations selected', () => {
    expect(buildEditInviteSelection(['assigned-1'], ['pending-1', 'assigned-1']))
      .toEqual(['assigned-1', 'pending-1']);
  });

  it('allows an accepted and assigned worker to be deselected', () => {
    expect(toggleEditableInviteWorker(['assigned-1', 'pending-1'], 'assigned-1'))
      .toEqual(['pending-1']);
  });

  it('toggles every worker, including accepted assignments, with the team All control', () => {
    expect(toggleEditableInviteTeam(
      ['assigned-1', 'pending-1'],
      ['assigned-1', 'pending-1', 'new-1']
    )).toEqual(['assigned-1', 'pending-1', 'new-1']);

    expect(toggleEditableInviteTeam(
      ['assigned-1', 'pending-1', 'new-1'],
      ['assigned-1', 'pending-1', 'new-1']
    )).toEqual([]);
  });

  it('adds solo organization workers as an invite group', () => {
    expect(buildEventInviteTeamOptions(
      [
        { id: 'team-1', name: 'Crew', workerIds: ['worker-1', 'worker-2'] },
        { id: 'team-2', name: 'Load Out', workerIds: ['worker-2'] },
      ],
      ['worker-1', 'worker-2', 'solo-1', 'solo-1']
    )).toEqual([
      { id: 'team-1', name: 'Crew', workerIds: ['worker-1', 'worker-2'] },
      { id: 'team-2', name: 'Load Out', workerIds: ['worker-2'] },
      { id: SOLO_WORKERS_INVITE_TEAM_ID, name: 'Solo Workers', workerIds: ['solo-1'] },
    ]);
  });

  it('omits the Solo Workers group when every organization worker belongs to a team', () => {
    expect(buildEventInviteTeamOptions(
      [{ id: 'team-1', name: 'Crew', workerIds: ['worker-1', 'worker-2'] }],
      ['worker-1', 'worker-2']
    )).toEqual([
      { id: 'team-1', name: 'Crew', workerIds: ['worker-1', 'worker-2'] },
    ]);
  });

  it('sends new invites, removes deselected assignments, and withdraws pending invites', () => {
    expect(buildEditInviteChanges({
      selectedWorkerIds: ['new-1'],
      assignedWorkerIds: ['assigned-1'],
      pendingWorkerIds: ['pending-1'],
    })).toEqual({
      toInvite: ['new-1'],
      toRemoveAssigned: ['assigned-1'],
      toWithdraw: ['pending-1'],
    });
  });
});
