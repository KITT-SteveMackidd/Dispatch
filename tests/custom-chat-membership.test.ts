import { describe, expect, it } from 'vitest';
import { isChatMemberChecked, removeCustomChatParticipant } from '../lib/custom-chat-membership';

describe('removeCustomChatParticipant', () => {
  it('removes only the current user and normalizes duplicate participants', () => {
    expect(removeCustomChatParticipant(['manager-1', 'worker-1', 'worker-1'], 'worker-1')).toEqual(['manager-1']);
  });

  it('does not change membership when the user is already absent', () => {
    expect(removeCustomChatParticipant(['manager-1', 'worker-1'], 'worker-2')).toEqual(['manager-1', 'worker-1']);
  });
});

describe('isChatMemberChecked', () => {
  it('keeps existing members visibly checked in a read-only people list', () => {
    expect(isChatMemberChecked({
      alreadyInChat: true,
      canManageTeamMembers: false,
      selectedMemberIds: [],
      memberId: 'worker-1',
    })).toBe(true);
  });

  it('uses the manager selection when team membership can be edited', () => {
    expect(isChatMemberChecked({
      alreadyInChat: true,
      canManageTeamMembers: true,
      selectedMemberIds: [],
      memberId: 'worker-1',
    })).toBe(false);
  });
});
