import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';
import { headerLogoSource } from '@/constants/branding';
import { ACCESSIBLE_TEXT_MAX_MULTIPLIER, MINIMUM_TOUCH_TARGET } from '@/constants/accessibility';
import {
  ChatThreadHead,
  buildOrganizationChatThreadId,
  buildOrganizationManagersThreadId,
  createChatGroup,
  createTeam,
  ensureOrganizationCommunicationThreads,
  ensureTeamCommunicationThreads,
  loadOrganizationMembers,
  loadUserProfilesByIds,
  watchIncomingChatThreadHeads,
  watchManagerTeams,
  watchUserTeamUnreadCounts,
  watchWorkerTeams,
} from '@/services/dispatch';
import { getWorkerInviteErrorMessage } from '@/lib/worker-invite-validation';
import { createSecureDispatchInvite, secureInviteErrorMessage } from '@/lib/secure-invites';
import type { Organisation, Team, UserProfile } from '@/types/dispatch';
import { buildCurrentManagerIds, buildManagerChatParticipants, getVisibleManagerChatWorkerIds } from '@/lib/chat-list-membership';
import { DrawerBottomFill } from '@/components/DrawerBottomFill';

type DrawerMode = 'add-team' | 'invite-worker' | 'invite-manager';

type ChatListItem = {
  id: string;
  title: string;
  subtitle: string;
  participantIds: string[];
  kind: 'organization' | 'team' | 'manager' | 'custom';
  teamId?: string;
  threadId?: string;
};

function toDate(value: ChatThreadHead['updatedAt']) {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  return null;
}

export default function TeamsScreen() {
  const { profile } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const drawerSurfaceColor = isDarkMode ? '#12274D' : '#F7F7F7';

  const [teams, setTeams] = useState<Team[]>([]);
  const [organization, setOrganization] = useState<Organisation | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [threadHeads, setThreadHeads] = useState<ChatThreadHead[]>([]);
  const [unreadCountByThreadId, setUnreadCountByThreadId] = useState<Record<string, number>>({});
  const [legacyUnreadCountByTeamId, setLegacyUnreadCountByTeamId] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [creatingChat, setCreatingChat] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('add-team');
  const [teamName, setTeamName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteTeamId, setInviteTeamId] = useState<'solo' | string>('solo');
  const [saving, setSaving] = useState(false);
  const [drawerMessage, setDrawerMessage] = useState<string | null>(null);
  const [drawerMessageTone, setDrawerMessageTone] = useState<'success' | 'error'>('success');

  useEffect(() => {
    if (!profile) return;
    const handleTeams = (items: Team[]) => {
      setTeams(items);
      setLoadError(null);
    };
    const handleError = () => setLoadError('Unable to load team conversations. Please try again.');
    return profile.role === 'manager'
      ? watchManagerTeams(profile.uid, handleTeams, profile.organizationId, handleError)
      : watchWorkerTeams(
          profile.uid,
          (items) => handleTeams(items.filter((team) => (team.workerIds || []).includes(profile.uid))),
          handleError,
          profile.organizationId
        );
  }, [profile]);

  useEffect(() => {
    if (!profile?.organizationId) {
      setOrganization(null);
      setMembers(profile ? [profile] : []);
      return;
    }
    const organizationId = profile.organizationId;

    let active = true;
    (async () => {
      try {
        const result = await loadOrganizationMembers(organizationId);
        const teamWorkerIds = profile.role === 'manager'
          ? [...new Set(teams.flatMap((team) => team.workerIds || []).filter(Boolean))]
          : [];
        const teamWorkers = teamWorkerIds.length ? await loadUserProfilesByIds(teamWorkerIds) : [];
        if (!active) return;
        setOrganization(result.organization);
        setMembers([
          ...new Map([...result.members, ...teamWorkers].map((member) => [member.uid, member])).values(),
        ]);
      } catch {
        if (!active) return;
        setOrganization(null);
        setMembers([profile]);
      }
    })();
    return () => {
      active = false;
    };
  }, [profile, teams]);

  useEffect(() => {
    if (!profile?.uid) return;
    return watchIncomingChatThreadHeads(
      profile.uid,
      (items) => {
        setThreadHeads(items);
        setLoadError(null);
      },
      () => setLoadError('Unable to load chat activity. Please try again.')
    );
  }, [profile?.uid]);

  useEffect(() => {
    if (!profile?.uid) return;
    return watchUserTeamUnreadCounts(profile.uid, (items) => {
      setUnreadCountByThreadId(Object.fromEntries(items.filter((item) => item.threadId).map((item) => [item.threadId as string, item.unreadCount])));
      setLegacyUnreadCountByTeamId(Object.fromEntries(items.filter((item) => !item.threadId && item.teamId).map((item) => [item.teamId as string, item.unreadCount])));
    }, () => setLoadError('Unable to load chat activity. Please try again.'));
  }, [profile?.uid]);

  useEffect(() => {
    if (!profile) return;
    teams.forEach((team) => ensureTeamCommunicationThreads(team).catch(() => undefined));
    if (profile.organizationId) {
      ensureOrganizationCommunicationThreads(profile.organizationId).catch(() => undefined);
    }
  }, [profile, teams]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.uid, member])), [members]);
  const threadHeadById = useMemo(() => new Map(threadHeads.map((thread) => [thread.id, thread])), [threadHeads]);

  const chatItems = useMemo<ChatListItem[]>(() => {
    if (!profile) return [];
    const items: ChatListItem[] = [];
    const allMemberIds = [...new Set([profile.uid, ...members.map((member) => member.uid)])];
    const managerIds = buildCurrentManagerIds(members, profile);
    const organizationId = organization?.id || profile.organizationId;
    const managerThreadWorkerIds = threadHeads
      .filter((thread) => organizationId && thread.kind === 'manager' && thread.id.startsWith(`organization:${organizationId}:managers:`))
      .map((thread) => thread.id.split(':managers:')[1])
      .filter(Boolean);
    const workerIds = [...new Set([
      ...(organization?.workerIds || members.filter((member) => member.role === 'worker').map((member) => member.uid)),
      ...teams.flatMap((team) => team.workerIds || []),
      ...managerThreadWorkerIds,
      ...(profile.role === 'worker' ? [profile.uid] : []),
    ])];
    if (organizationId) {
      items.push({
        id: buildOrganizationChatThreadId(organizationId),
        threadId: buildOrganizationChatThreadId(organizationId),
        title: organization?.name || profile.organizationName || 'Organization',
        subtitle: `Everyone in the organization (${allMemberIds.length})`,
        participantIds: allMemberIds,
        kind: 'organization',
      });
    }

    teams.forEach((team) => {
      const participantIds = [...new Set([...managerIds, ...(team.managerIds || [team.managerId]), ...(team.workerIds || [])])];
      if (!participantIds.includes(profile.uid)) return;
      items.push({
        id: `team:${team.id}:all`,
        threadId: `team:${team.id}:all`,
        teamId: team.id,
        title: team.name,
        subtitle: `${participantIds.length} team members`,
        participantIds,
        kind: 'team',
      });
    });

    const visibleWorkerIds = getVisibleManagerChatWorkerIds(workerIds, profile);
    visibleWorkerIds.forEach((workerId) => {
      const threadId = buildOrganizationManagersThreadId(organizationId || '', workerId);
      const existingThread = threadHeadById.get(threadId);
      const participantIds = buildManagerChatParticipants(workerId, managerIds);
      if (!organizationId || !participantIds.includes(profile.uid)) return;
      const worker = memberById.get(workerId);
      const chatManagerIds = participantIds.filter((participantId) => participantId !== workerId && memberById.get(participantId)?.role === 'manager');
      const workerFacingTitle = chatManagerIds.length === 1
        ? memberById.get(chatManagerIds[0])?.displayName || 'Manager'
        : 'Managers';
      items.push({
        id: threadId,
        threadId,
        title: profile.role === 'worker' ? workerFacingTitle : worker?.displayName || existingThread?.title || 'Worker',
        subtitle: 'Worker and all organization managers',
        participantIds,
        kind: 'manager',
      });
    });

    threadHeads
      .filter((thread) => thread.kind === 'custom' && thread.participants?.includes(profile.uid))
      .forEach((thread) => {
        items.push({
          id: thread.id,
          threadId: thread.id,
          title: thread.title || 'Group chat',
          subtitle: `${thread.participants?.length || 0} members`,
          participantIds: thread.participants || [profile.uid],
          kind: 'custom',
        });
      });

    return [...new Map(items.map((item) => [item.id, item])).values()];
  }, [memberById, members, organization, profile, teams, threadHeads]);

  const selectableMembers = useMemo(() => {
    const search = memberSearch.trim().toLowerCase();
    return members
      .filter((member) => member.uid !== profile?.uid)
      .filter((member) => !search || `${member.displayName} ${member.email || ''}`.toLowerCase().includes(search))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [memberSearch, members, profile?.uid]);

  const formatThreadTime = (head?: ChatThreadHead) => {
    const date = toDate(head?.updatedAt);
    return date ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase() : '';
  };

  const openChat = (item: ChatListItem) => {
    if (!profile) return;
    const otherId = item.participantIds.find((id) => id !== profile.uid) || item.id;
    router.navigate({
      pathname: '/chat/[workerId]',
      params: {
        workerId: otherId,
        workerLabel: item.title,
        teamId: item.teamId,
        teamName: item.title,
        teamMemberIds: item.participantIds.join(','),
        isTeamAll: '1',
        teamThreadId: item.threadId,
        teamThreadPath: item.subtitle,
        chatKind: item.kind,
      },
    });
  };

  const toggleMember = (memberId: string) => {
    setSelectedMemberIds((current) => current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]);
  };

  const toggleSelectAll = () => {
    const visibleIds = selectableMembers.map((member) => member.uid);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedMemberIds.includes(id));
    setSelectedMemberIds((current) => allSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])]);
  };

  const closeChatPicker = () => {
    setChatPickerOpen(false);
    setMemberSearch('');
    setSelectedMemberIds([]);
  };

  const handleCreateChat = async () => {
    if (!profile?.organizationId || !selectedMemberIds.length || creatingChat) return;
    const selected = [...new Set(selectedMemberIds)].sort();
    const participantIds = [...new Set([profile.uid, ...selected])];
    const names = selected.map((id) => memberById.get(id)?.displayName || 'Member');
    const title = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
    const threadId = `organization:${profile.organizationId}:group:${participantIds.slice().sort().join('__')}`;

    try {
      setCreatingChat(true);
      await createChatGroup({
        threadId,
        organizationId: profile.organizationId,
        title,
        creatorId: profile.uid,
        participantIds,
      });
      closeChatPicker();
      openChat({ id: threadId, threadId, title, subtitle: `${participantIds.length} members`, participantIds, kind: 'custom' });
    } catch (error) {
      Alert.alert('Unable to create chat', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setCreatingChat(false);
    }
  };

  const openDrawer = () => {
    setDrawerMode('add-team');
    setTeamName('');
    setInviteEmail('');
    setDrawerMessage(null);
    setDrawerOpen(true);
  };

  const handleSubmitDrawer = async () => {
    if (!profile || profile.role !== 'manager' || saving) return;
    try {
      setSaving(true);
      setDrawerMessage(null);
      if (drawerMode === 'add-team') {
        await createTeam(profile.uid, teamName);
        setTeamName('');
        setDrawerMessage('Team created.');
      } else if (drawerMode === 'invite-worker') {
        const result = await createSecureDispatchInvite({
          inviteKind: 'worker',
          deliveryEmail: inviteEmail,
          teamId: inviteTeamId === 'solo' ? undefined : inviteTeamId,
        });
        setInviteEmail('');
        setDrawerMessage(`Worker invitation sent. They may continue with Apple, Google, or email. Backup code: ${result.inviteCode}`);
      } else {
        const result = await createSecureDispatchInvite({
          inviteKind: 'manager',
          deliveryEmail: inviteEmail,
        });
        setInviteEmail('');
        setDrawerMessage(`Manager invitation sent. They may continue with Apple, Google, or email. Backup code: ${result.inviteCode}`);
      }
      setDrawerMessageTone('success');
    } catch (error) {
      setDrawerMessageTone('error');
      setDrawerMessage(
        drawerMode === 'invite-worker'
          ? getWorkerInviteErrorMessage(error)
          : secureInviteErrorMessage(error)
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <View style={[styles.topHeader, { paddingTop: insets.top + 16 }]}>
        <Image source={headerLogoSource} style={styles.logo} resizeMode="contain" />
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="Create chat" style={styles.iconButton} onPress={() => setChatPickerOpen(true)}>
            <MaterialIcons name="chat" size={21} color="#F7F7F7" />
          </Pressable>
          {profile?.role === 'manager' ? (
            <Pressable accessibilityLabel="Team actions" style={styles.iconButton} onPress={openDrawer}>
              <MaterialIcons name="add" size={26} color="#F7F7F7" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={chatItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={loadError ? (
          <View style={styles.loadErrorBanner}>
            <MaterialIcons name="error-outline" size={18} color="#991b1b" />
            <Text style={styles.loadErrorText}>{loadError}</Text>
          </View>
        ) : null}
        ListEmptyComponent={<Text style={[styles.emptyText, isDarkMode ? styles.mutedDark : styles.mutedLight]}>No conversations yet.</Text>}
        renderItem={({ item }) => {
          const head = threadHeadById.get(item.id);
          const unread = unreadCountByThreadId[item.id] ?? (item.teamId ? legacyUnreadCountByTeamId[item.teamId] || 0 : 0);
          return (
            <Pressable style={[styles.chatCard, isDarkMode ? styles.cardDark : styles.cardLight]} onPress={() => openChat(item)}>
              <View style={[styles.avatar, styles.groupAvatar]}>
                <MaterialIcons name="groups" size={22} color="#F98D2F" />
              </View>
              <View style={[styles.flex, styles.chatCopy]}>
                <Text style={[styles.itemTitle, isDarkMode ? styles.textDark : styles.textLight]} numberOfLines={2} maxFontSizeMultiplier={ACCESSIBLE_TEXT_MAX_MULTIPLIER}>{item.title}</Text>
                <Text style={[styles.itemSubtitle, isDarkMode ? styles.mutedDark : styles.mutedLight]} numberOfLines={2} maxFontSizeMultiplier={ACCESSIBLE_TEXT_MAX_MULTIPLIER}>
                  {head?.lastMessageText || item.subtitle}
                </Text>
              </View>
              <View style={styles.chatMetaColumn}>
                {unread > 0 ? (
                  <View style={styles.badge}><Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text></View>
                ) : (
                  <View style={styles.badgePlaceholder} />
                )}
                <Text style={[styles.timeText, isDarkMode ? styles.mutedDark : styles.mutedLight]}>{formatThreadTime(head)}</Text>
              </View>
            </Pressable>
          );
        }}
      />

      <Modal visible={chatPickerOpen} transparent animationType="slide" onRequestClose={closeChatPicker}>
        <Pressable style={styles.backdrop} onPress={closeChatPicker}>
          <Pressable style={[styles.pickerDrawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => undefined}>
            <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
            <Text style={[styles.drawerTitle, isDarkMode ? styles.textDark : styles.textLight]}>New Chat</Text>
            <TextInput
              value={memberSearch}
              onChangeText={setMemberSearch}
              placeholder="Search organization members"
              placeholderTextColor={isDarkMode ? '#9fb0cf' : '#64748b'}
              style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
            />
            <Pressable style={styles.selectAllRow} onPress={toggleSelectAll}>
              <MaterialIcons
                name={selectableMembers.length > 0 && selectableMembers.every((member) => selectedMemberIds.includes(member.uid)) ? 'check-box' : 'check-box-outline-blank'}
                size={23}
                color="#0EC3C9"
              />
              <Text style={[styles.selectLabel, isDarkMode ? styles.textDark : styles.textLight]}>Select all</Text>
            </Pressable>
            <ScrollView style={styles.memberList} keyboardShouldPersistTaps="handled">
              {selectableMembers.map((member) => (
                <View key={member.uid} style={styles.memberRow}>
                  <Pressable
                    accessibilityLabel={`Select ${member.displayName}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selectedMemberIds.includes(member.uid) }}
                    hitSlop={4}
                    style={styles.memberSelectButton}
                    onPress={() => toggleMember(member.uid)}>
                    <MaterialIcons name={selectedMemberIds.includes(member.uid) ? 'check-box' : 'check-box-outline-blank'} size={23} color="#0EC3C9" />
                  </Pressable>
                  <View style={styles.flex}>
                    <Text style={[styles.itemTitle, isDarkMode ? styles.textDark : styles.textLight]}>{member.displayName}</Text>
                    <Text style={[styles.itemSubtitle, isDarkMode ? styles.mutedDark : styles.mutedLight]}>{member.email || (member.role === 'manager' ? 'Manager' : 'Worker')}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <Pressable style={[styles.chatButton, (!selectedMemberIds.length || creatingChat) && styles.disabled]} disabled={!selectedMemberIds.length || creatingChat} onPress={handleCreateChat}>
              <Text style={styles.chatButtonText}>{creatingChat ? 'Creating...' : 'Chat'}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={drawerOpen} transparent animationType="slide" onRequestClose={() => setDrawerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setDrawerOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: 'height' })}>
            <Pressable style={[styles.actionDrawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => undefined}>
              <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.drawerContent}>
                <Text style={[styles.drawerTitle, isDarkMode ? styles.textDark : styles.textLight]}>Team Actions</Text>
                <View style={styles.modeRow}>
                  {(['add-team', 'invite-worker', 'invite-manager'] as DrawerMode[]).map((mode) => (
                    <Pressable key={mode} style={[styles.modeButton, drawerMode === mode && styles.modeButtonActive]} onPress={() => { setDrawerMode(mode); setDrawerMessage(null); }}>
                      <Text style={[styles.modeText, drawerMode === mode && styles.modeTextActive]}>{mode === 'add-team' ? 'Add Team' : mode === 'invite-worker' ? 'Invite Worker' : 'Invite Manager'}</Text>
                    </Pressable>
                  ))}
                </View>
                {drawerMode === 'add-team' ? (
                  <>
                    <Text style={[styles.fieldLabel, isDarkMode ? styles.textDark : styles.textLight]}>Team name</Text>
                    <TextInput value={teamName} onChangeText={setTeamName} style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]} placeholder="Team name" placeholderTextColor="#64748b" />
                  </>
                ) : (
                  <>
                    {drawerMode === 'invite-worker' ? (
                      <>
                        <Text style={[styles.fieldLabel, isDarkMode ? styles.textDark : styles.textLight]}>Team</Text>
                        <View style={styles.teamChips}>
                          <Pressable style={[styles.teamChip, inviteTeamId === 'solo' && styles.teamChipActive]} onPress={() => setInviteTeamId('solo')}><Text style={styles.teamChipText}>Solo worker</Text></Pressable>
                          {teams.map((team) => <Pressable key={team.id} style={[styles.teamChip, inviteTeamId === team.id && styles.teamChipActive]} onPress={() => setInviteTeamId(team.id)}><Text style={styles.teamChipText}>{team.name}</Text></Pressable>)}
                        </View>
                      </>
                    ) : null}
                    <Text style={[styles.fieldLabel, isDarkMode ? styles.textDark : styles.textLight]}>Delivery email</Text>
                    <TextInput value={inviteEmail} onChangeText={setInviteEmail} autoCapitalize="none" keyboardType="email-address" style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]} placeholder="name@example.com" placeholderTextColor="#64748b" />
                    <Text style={[styles.inviteEmailHint, isDarkMode ? styles.textDark : styles.textLight]}>
                      This address only receives the invitation. The recipient can join with Apple, Google, or a different Dispatch email.
                    </Text>
                  </>
                )}
                {drawerMessage ? <Text selectable style={drawerMessageTone === 'error' ? styles.errorText : styles.successText}>{drawerMessage}</Text> : null}
                <Pressable style={[styles.chatButton, saving && styles.disabled]} disabled={saving} onPress={handleSubmitDrawer}>
                  <Text style={styles.chatButtonText}>{saving ? 'Saving...' : drawerMode === 'add-team' ? 'Create Team' : drawerMode === 'invite-worker' ? 'Invite Worker' : 'Invite Manager'}</Text>
                </Pressable>
                <Pressable style={styles.closeButton} onPress={() => setDrawerOpen(false)}><Text style={[styles.closeText, isDarkMode ? styles.textDark : styles.textLight]}>Close</Text></Pressable>
              </ScrollView>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  containerLight: { backgroundColor: '#DBE2F9' },
  containerDark: { backgroundColor: '#061229' },
  topHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16 },
  logo: { width: 64, height: 64 },
  headerActions: { flexDirection: 'row', gap: 10 },
  iconButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, borderRadius: MINIMUM_TOUCH_TARGET / 2, backgroundColor: '#0EC3C9', alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 24 },
  chatCard: { minHeight: 76, borderRadius: 8, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1 },
  loadErrorBanner: { minHeight: 48, marginBottom: 10, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca' },
  loadErrorText: { flex: 1, color: '#991b1b', fontSize: 13, fontWeight: '600' },
  cardLight: { backgroundColor: '#F7F7F7', borderColor: '#F7F7F7' },
  cardDark: { backgroundColor: '#12274D', borderColor: '#203E75' },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: '#F98D2F', alignItems: 'center', justifyContent: 'center' },
  groupAvatar: { backgroundColor: 'rgba(14,195,201,0.1)' },
  flex: { flex: 1, minWidth: 0 },
  chatCopy: { minHeight: 44, justifyContent: 'center' },
  chatMetaColumn: { width: 58, minHeight: 44, alignItems: 'flex-end', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemTitle: { fontSize: 15, fontWeight: '700' },
  itemSubtitle: { marginTop: 3, fontSize: 12, lineHeight: 16 },
  timeText: { fontSize: 11 },
  textLight: { color: '#232832' },
  textDark: { color: '#F4F8FF' },
  mutedLight: { color: '#64748b' },
  mutedDark: { color: '#B7C3D9' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  badgePlaceholder: { height: 22 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  emptyText: { paddingTop: 24, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(6,18,41,0.55)', justifyContent: 'flex-end' },
  pickerDrawer: { height: '78%', borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 18 },
  actionDrawer: { maxHeight: '88%', borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 18 },
  drawerLight: { backgroundColor: '#F7F7F7' },
  drawerDark: { backgroundColor: '#12274D' },
  drawerTitle: { fontSize: 19, fontWeight: '700', marginBottom: 12 },
  drawerContent: { paddingBottom: 8 },
  input: { minHeight: 46, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, fontSize: 14 },
  inputLight: { backgroundColor: '#EDF0FC', borderColor: 'rgba(6,18,41,0.12)', color: '#121212' },
  inputDark: { backgroundColor: '#203E75', borderColor: 'rgba(247,247,247,0.15)', color: '#F7F7F7' },
  selectAllRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(100,116,139,0.25)' },
  selectLabel: { fontSize: 14, fontWeight: '700' },
  memberList: { flex: 1 },
  memberRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(100,116,139,0.2)' },
  memberSelectButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  chatButton: { minHeight: 52, borderRadius: 8, backgroundColor: '#0EC3C9', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  chatButtonText: { color: '#061229', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  modeRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  modeButton: { flex: 1, minHeight: 42, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(100,116,139,0.3)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  modeButtonActive: { borderColor: '#F98D2F' },
  modeText: { color: '#64748b', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  modeTextActive: { color: '#F98D2F' },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  inviteEmailHint: { marginTop: 8, fontSize: 12, lineHeight: 17, opacity: 0.78 },
  teamChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  teamChip: { borderRadius: 7, borderWidth: 1, borderColor: 'rgba(100,116,139,0.35)', paddingHorizontal: 10, paddingVertical: 9 },
  teamChipActive: { borderColor: '#F98D2F' },
  teamChipText: { color: '#F98D2F', fontSize: 12, fontWeight: '700' },
  successText: { color: '#15803d', fontSize: 13, fontWeight: '600', marginTop: 12 },
  errorText: { color: '#dc2626', fontSize: 13, fontWeight: '600', marginTop: 12 },
  closeButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  closeText: { fontSize: 15, fontWeight: '700' },
});
