export function removeCustomChatParticipant(participants: string[] | undefined, userId: string) {
  return [...new Set((participants || []).filter(Boolean))].filter((participantId) => participantId !== userId);
}

export function isChatMemberChecked(params: {
  alreadyInChat: boolean;
  canManageTeamMembers: boolean;
  selectedMemberIds: string[];
  memberId: string;
}) {
  if (params.canManageTeamMembers) {
    return params.selectedMemberIds.includes(params.memberId);
  }

  return params.alreadyInChat || params.selectedMemberIds.includes(params.memberId);
}
