function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function legacyOrganizationRecordUpdate({
  kind,
  record = {},
  managerId,
  organizationId,
  organizationName = null,
  allowedMemberIds,
  allowedTeamIds,
} = {}) {
  const normalizedManagerId = typeof managerId === 'string' ? managerId.trim() : '';
  const normalizedOrganizationId = typeof organizationId === 'string' ? organizationId.trim() : '';
  const recordManagerId = typeof record.managerId === 'string' ? record.managerId.trim() : '';
  const existingOrganizationId = typeof record.organizationId === 'string' ? record.organizationId.trim() : '';
  if (!['team', 'event'].includes(kind)
    || !normalizedManagerId
    || !normalizedOrganizationId
    || recordManagerId !== normalizedManagerId
    || existingOrganizationId) {
    return null;
  }

  if (Array.isArray(allowedMemberIds)) {
    const allowedMembers = new Set(uniqueStrings(allowedMemberIds));
    const liveReferencedMemberIds = uniqueStrings([
      ...uniqueStrings(record.workerIds),
      ...(Array.isArray(record.roles) ? record.roles : []).flatMap((role) => [
        ...uniqueStrings(role?.assignedWorkerIds),
        ...uniqueStrings(role?.waitlistWorkerIds),
        ...uniqueStrings(role?.eligibleWaitlistWorkerIds),
        ...uniqueStrings(role?.waitlistInviteWorkerIds),
      ]),
    ]);
    if (liveReferencedMemberIds.some((userId) => !allowedMembers.has(userId))) return null;
  }
  if (kind === 'event' && Array.isArray(allowedTeamIds)) {
    const allowedTeams = new Set(uniqueStrings(allowedTeamIds));
    if (uniqueStrings(record.teamIds).some((teamId) => !allowedTeams.has(teamId))) return null;
  }

  if (kind === 'team') {
    return {
      organizationId: normalizedOrganizationId,
      organizationName: typeof organizationName === 'string' && organizationName.trim()
        ? organizationName.trim()
        : null,
      managerIds: [recordManagerId],
    };
  }

  return { organizationId: normalizedOrganizationId };
}

module.exports = { legacyOrganizationRecordUpdate };
