import { useEffect, useMemo, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { buildChatThreadId, ChatThreadHead, loadUserProfilesByIds, watchIncomingChatThreadHeads } from '@/services/dispatch';
import { useSession } from '@/context/session';
import { UserProfile } from '@/types/dispatch';
import { useThemeMode } from '@/context/theme';
import { MINIMUM_TOUCH_TARGET } from '@/constants/accessibility';
import { DrawerBottomFill } from '@/components/DrawerBottomFill';

type MemberInfo = Pick<UserProfile, 'uid' | 'displayName' | 'phoneNumber'>;

export default function TeamMemberListScreen() {
  const router = useRouter();
  const { profile } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const drawerSurfaceColor = isDarkMode ? '#101A2F' : '#FFFFFF';
  const params = useLocalSearchParams<{ teamId?: string; teamName?: string; memberIds?: string }>();

  const teamId = params.teamId ?? 'team';
  const teamName = params.teamName ?? 'Team';
  const memberIds = useMemo(() => (params.memberIds || '').split(',').map((id) => id.trim()).filter(Boolean), [params.memberIds]);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [threadHeads, setThreadHeads] = useState<ChatThreadHead[]>([]);
  const [createChatOpen, setCreateChatOpen] = useState(false);
  const [chatNameDraft, setChatNameDraft] = useState('');
  const [selectedChatMemberIds, setSelectedChatMemberIds] = useState<string[]>([]);

  useEffect(() => {
    if (!memberIds.length) {
      setMembers([]);
      return;
    }

    let active = true;
    loadUserProfilesByIds(memberIds)
      .then((profiles) => {
        if (!active) return;
        const byId = new Map(profiles.map((profile) => [profile.uid, profile]));
        const orderedMembers = memberIds.map((memberId) => {
          const profile = byId.get(memberId);
          return {
            uid: memberId,
            displayName: profile?.displayName || 'Dispatch User',
            phoneNumber: profile?.phoneNumber,
          };
        });
        setMembers(orderedMembers);
      })
      .catch(() => {
        if (!active) return;
        setMembers(memberIds.map((memberId) => ({ uid: memberId, displayName: memberId })));
      });

    return () => {
      active = false;
    };
  }, [memberIds]);

  useEffect(() => {
    if (!profile?.uid) {
      setThreadHeads([]);
      return;
    }

    return watchIncomingChatThreadHeads(profile.uid, setThreadHeads);
  }, [profile?.uid]);

  const memberInfoById = useMemo(() => {
    const entries = members.map((member) => [member.uid, member] as const);
    return new Map(entries);
  }, [members]);

  const threadHeadById = useMemo(() => {
    return new Map(threadHeads.map((thread) => [thread.id, thread]));
  }, [threadHeads]);

  const formatThreadTime = (value: ChatThreadHead['updatedAt']) => {
    const date = value instanceof Date
      ? value
      : typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function'
        ? value.toDate()
        : null;

    if (!date || Number.isNaN(date.getTime())) return 'No time yet';
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  };

  const getThreadPreview = (item: MemberInfo, isAll: boolean) => {
    if (!profile?.uid) {
      return {
        meta: 'No latest message yet',
        message: isAll ? 'Broadcast to everyone on this team' : 'Open chat',
      };
    }

    const threadId = buildChatThreadId({
      teamId,
      selfId: profile.uid,
      otherUserId: isAll ? undefined : item.uid,
      isTeamBroadcast: isAll,
    });
    const threadHead = threadHeadById.get(threadId);

    if (!threadHead?.lastMessageText?.trim()) {
      return {
        meta: 'No latest message yet',
        message: isAll ? 'Start the team chat' : 'Start the conversation',
      };
    }

    const senderName = threadHead.lastMessageSenderId === profile.uid
      ? profile.displayName || 'You'
      : memberInfoById.get(threadHead.lastMessageSenderId || '')?.displayName || 'Team member';

    return {
      meta: `${senderName} • ${formatThreadTime(threadHead.updatedAt)}`,
      message: threadHead.lastMessageText.trim(),
    };
  };

  const openChat = (workerId: string, workerLabel: string, isTeamAll = false) => {
    router.navigate({
      pathname: '/chat/[workerId]',
      params: {
        workerId,
        workerLabel,
        teamId,
        teamName,
        teamMemberIds: memberIds.join(','),
        isTeamAll: isTeamAll ? '1' : '0',
        teamThreadPath: isTeamAll ? `teams/${teamId}/all` : undefined,
      },
    });
  };

  const toggleCreateChatMember = (memberId: string) => {
    setSelectedChatMemberIds((current) => (
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    ));
  };

  const toggleSelectAllCreateChatMembers = () => {
    setSelectedChatMemberIds((current) => (
      current.length === members.length ? [] : members.map((member) => member.uid)
    ));
  };

  const closeCreateChatDrawer = () => {
    setCreateChatOpen(false);
    setChatNameDraft('');
    setSelectedChatMemberIds([]);
  };

  const openCreateChatDrawer = () => {
    setSelectedChatMemberIds([]);
    setChatNameDraft('');
    setCreateChatOpen(true);
  };

  const createGroupChat = () => {
    const selectedIds = [...new Set(selectedChatMemberIds.filter(Boolean))].sort();
    const chatName = chatNameDraft.trim();

    if (!chatName.length) {
      Alert.alert('Chat name required', 'Enter a name for this chat.');
      return;
    }

    if (!selectedIds.length) {
      Alert.alert('Select members', 'Choose at least one member for this chat.');
      return;
    }

    const groupKey = selectedIds.join('__');
    const threadId = `team:${teamId}:group:${groupKey}`;
    closeCreateChatDrawer();

    router.navigate({
      pathname: '/chat/[workerId]',
      params: {
        workerId: `group:${groupKey}`,
        workerLabel: chatName,
        teamId,
        teamName,
        teamMemberIds: selectedIds.join(','),
        isTeamAll: '1',
        teamThreadId: threadId,
        teamThreadPath: `${teamName} / ${chatName}`,
      },
    });
  };

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <Stack.Screen options={{ title: `${teamName} Members` }} />

      <View style={styles.headerRow}>
        <Text style={[styles.subhead, isDarkMode ? styles.subheadDark : styles.subheadLight]}>Choose who to message in {teamName}.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create chat"
          style={[styles.createChatButton, isDarkMode ? styles.createChatButtonDark : styles.createChatButtonLight]}
          onPress={openCreateChatDrawer}>
          <MaterialIcons name="add" size={22} color={isDarkMode ? '#0EC3C9' : '#2563eb'} />
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={[{ uid: `all:${teamId}`, displayName: 'All', phoneNumber: 'Send to the full team' }, ...members]}
        keyExtractor={(item) => item.uid}
        renderItem={({ item }) => {
          const isAll = item.displayName === 'All';
          const preview = getThreadPreview(item, isAll);
          return (
            <Pressable
              style={[
                styles.card,
                isDarkMode ? styles.cardDark : styles.cardLight,
                isAll && (isDarkMode ? styles.allCardDark : styles.allCardLight),
              ]}
              onPress={() => openChat(item.uid, item.displayName, isAll)}
            >
              <View style={[styles.avatar, isAll && styles.allAvatar]}>
                <Text style={[styles.avatarText, isAll && styles.allAvatarText]}>{isAll ? 'All' : item.displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>{item.displayName}</Text>
                <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>{preview.meta}</Text>
                <Text style={[styles.latestMessage, isDarkMode ? styles.latestMessageDark : styles.latestMessageLight]} numberOfLines={1}>
                  {preview.message}
                </Text>
              </View>
              <Text style={[styles.openLabel, isDarkMode ? styles.openLabelDark : styles.openLabelLight]}>Open</Text>
            </Pressable>
          );
        }}
      />

      <Modal visible={createChatOpen} animationType="slide" transparent onRequestClose={closeCreateChatDrawer}>
        <Pressable style={styles.drawerBackdrop} onPress={closeCreateChatDrawer}>
          <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => null}>
            <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
            <Text style={[styles.drawerTitle, isDarkMode ? styles.titleDark : styles.titleLight]}>Create Chat</Text>
            <TextInput
              value={chatNameDraft}
              onChangeText={setChatNameDraft}
              placeholder="Chat name"
              placeholderTextColor={isDarkMode ? 'rgba(244,248,255,0.5)' : '#64748b'}
              style={[styles.chatNameInput, isDarkMode ? styles.chatNameInputDark : styles.chatNameInputLight]}
            />
            <Pressable style={styles.selectAllRow} onPress={toggleSelectAllCreateChatMembers}>
              <View style={[styles.checkbox, selectedChatMemberIds.length === members.length && members.length > 0 && styles.checkboxSelected]}>
                <Text style={styles.checkboxMark}>{selectedChatMemberIds.length === members.length && members.length > 0 ? '✓' : ''}</Text>
              </View>
              <Text style={[styles.drawerMemberName, isDarkMode ? styles.titleDark : styles.titleLight]}>Select all</Text>
            </Pressable>
            <ScrollView style={styles.drawerList}>
              {members.length ? members.map((member) => {
                const selected = selectedChatMemberIds.includes(member.uid);
                const initial = member.displayName.slice(0, 1).toUpperCase();

                return (
                  <Pressable key={`create-chat-${member.uid}`} style={styles.drawerMemberRow} onPress={() => toggleCreateChatMember(member.uid)}>
                    <View style={[styles.avatar, selected && styles.avatarSelected]}>
                      <Text style={[styles.avatarText, selected && styles.avatarTextSelected]}>{initial}</Text>
                    </View>
                    <Text style={[styles.drawerMemberName, isDarkMode ? styles.titleDark : styles.titleLight]}>{member.displayName}</Text>
                    <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                      <Text style={styles.checkboxMark}>{selected ? '✓' : ''}</Text>
                    </View>
                  </Pressable>
                );
              }) : (
                <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>No members available.</Text>
              )}
            </ScrollView>
            <Pressable style={[styles.drawerPrimaryButton, !selectedChatMemberIds.length && styles.drawerDisabled]} onPress={createGroupChat}>
              <Text style={styles.drawerPrimaryText}>Create chat</Text>
            </Pressable>
            <Pressable style={styles.drawerCancelButton} onPress={closeCreateChatDrawer}>
              <Text style={[styles.drawerCancelText, isDarkMode ? styles.metaDark : styles.metaLight]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#101A2F' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  subhead: { fontWeight: '500' },
  subheadLight: { color: '#475569' },
  subheadDark: { color: '#F4F8FF' },
  createChatButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, borderRadius: MINIMUM_TOUCH_TARGET / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  createChatButtonLight: { backgroundColor: '#fff', borderColor: '#bfdbfe' },
  createChatButtonDark: { backgroundColor: '#1A2540', borderColor: '#001A4D' },
  listContent: { paddingTop: 10, paddingBottom: 12, gap: 10 },
  card: { borderRadius: 12, padding: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#1A2540', borderColor: '#001A4D' },
  allCardLight: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  allCardDark: { borderColor: '#001A4D', backgroundColor: '#001A4D' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  allAvatar: { backgroundColor: '#2563eb' },
  avatarText: { fontWeight: '700', color: '#1d4ed8' },
  allAvatarText: { color: '#fff', fontSize: 11 },
  title: { fontWeight: '700', fontSize: 16 },
  titleLight: { color: '#232832' },
  titleDark: { color: '#F4F8FF' },
  meta: { marginTop: 2, fontSize: 12 },
  metaLight: { color: '#64748b' },
  metaDark: { color: '#F4F8FF' },
  latestMessage: { marginTop: 4, fontSize: 12, fontWeight: '600' },
  latestMessageLight: { color: '#232832' },
  latestMessageDark: { color: '#F4F8FF' },
  openLabel: { fontSize: 12, fontWeight: '700' },
  openLabelLight: { color: '#2563eb' },
  openLabelDark: { color: '#0EC3C9' },
  drawerBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' },
  drawer: { maxHeight: '82%', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 12 },
  drawerLight: { backgroundColor: '#fff' },
  drawerDark: { backgroundColor: '#101A2F' },
  drawerTitle: { fontSize: 18, fontWeight: '800' },
  chatNameInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  chatNameInputLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc', color: '#232832' },
  chatNameInputDark: { borderColor: '#001A4D', backgroundColor: '#1A2540', color: '#F4F8FF' },
  selectAllRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  drawerList: { maxHeight: 360 },
  drawerMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  drawerMemberName: { flex: 1, fontSize: 14, fontWeight: '600' },
  avatarSelected: { backgroundColor: '#0EC3C9' },
  avatarTextSelected: { color: '#fff' },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: '#0EC3C9', borderColor: '#0EC3C9' },
  checkboxMark: { color: '#fff', fontSize: 13, fontWeight: '800', lineHeight: 16 },
  drawerPrimaryButton: { borderRadius: 10, backgroundColor: '#0EC3C9', alignItems: 'center', paddingVertical: 12 },
  drawerPrimaryText: { color: '#fff', fontWeight: '800' },
  drawerDisabled: { opacity: 0.55 },
  drawerCancelButton: { alignItems: 'center', paddingVertical: 8 },
  drawerCancelText: { fontWeight: '700' },
});
