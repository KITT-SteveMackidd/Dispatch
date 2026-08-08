export type EditInviteChanges = {
  toInvite: string[];
  toRemoveAssigned: string[];
  toWithdraw: string[];
};

export type EventInviteTeamOption = {
  id: string;
  name: string;
  workerIds: string[];
};

export const SOLO_WORKERS_INVITE_TEAM_ID = '__solo-workers__';

function uniqueWorkerIds(workerIds: Iterable<string>): string[] {
  return [...new Set([...workerIds].filter(Boolean))];
}

export function buildEventInviteTeamOptions(
  teams: Iterable<{ id: string; name: string; workerIds?: Iterable<string> }>,
  organizationWorkerIds: Iterable<string>
): EventInviteTeamOption[] {
  const teamOptions = [...teams].map((team) => ({
    id: team.id,
    name: team.name,
    workerIds: uniqueWorkerIds(team.workerIds || []),
  }));
  const workersInTeams = new Set(teamOptions.flatMap((team) => team.workerIds));
  const soloWorkerIds = uniqueWorkerIds(organizationWorkerIds)
    .filter((workerId) => !workersInTeams.has(workerId));

  if (!soloWorkerIds.length) return teamOptions;

  return [
    ...teamOptions,
    {
      id: SOLO_WORKERS_INVITE_TEAM_ID,
      name: 'Solo Workers',
      workerIds: soloWorkerIds,
    },
  ];
}

export function buildEditInviteSelection(
  assignedWorkerIds: Iterable<string>,
  pendingWorkerIds: Iterable<string>
): string[] {
  return uniqueWorkerIds([...assignedWorkerIds, ...pendingWorkerIds]);
}

export function toggleEditableInviteWorker(
  selectedWorkerIds: Iterable<string>,
  workerId: string
): string[] {
  const selected = new Set(selectedWorkerIds);

  if (selected.has(workerId)) selected.delete(workerId);
  else selected.add(workerId);

  return uniqueWorkerIds(selected);
}

export function toggleEditableInviteTeam(
  selectedWorkerIds: Iterable<string>,
  teamWorkerIds: Iterable<string>
): string[] {
  const selected = new Set(selectedWorkerIds);
  const editableTeamWorkerIds = uniqueWorkerIds(teamWorkerIds);
  const allEditableSelected = editableTeamWorkerIds.length > 0
    && editableTeamWorkerIds.every((workerId) => selected.has(workerId));

  editableTeamWorkerIds.forEach((workerId) => {
    if (allEditableSelected) selected.delete(workerId);
    else selected.add(workerId);
  });

  return uniqueWorkerIds(selected);
}

export function buildEditInviteChanges(params: {
  selectedWorkerIds: Iterable<string>;
  assignedWorkerIds: Iterable<string>;
  pendingWorkerIds: Iterable<string>;
}): EditInviteChanges {
  const assigned = new Set(params.assignedWorkerIds);
  const pending = new Set(params.pendingWorkerIds);
  const selected = new Set(params.selectedWorkerIds);

  return {
    toInvite: uniqueWorkerIds(selected).filter((workerId) => !assigned.has(workerId) && !pending.has(workerId)),
    toRemoveAssigned: uniqueWorkerIds(assigned).filter((workerId) => !selected.has(workerId)),
    toWithdraw: uniqueWorkerIds(pending).filter((workerId) => !selected.has(workerId)),
  };
}
