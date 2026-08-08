import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';
import { addChatParticipants, buildChatThreadId, ChatAttachment, ChatThreadHead, leaveCustomChat, loadOrganizationMembers, markChatThreadRead, renameCustomChat, sendChatMessage, setChatThreadViewerPresence, updateTeamWorkerMembership, uploadChatAttachment, watchChatMessages, watchChatThread } from '@/services/dispatch';
import type { UserProfile } from '@/types/dispatch';
import { clearActiveChatThread, setActiveChatThread } from '@/lib/foreground-chat-notifications';
import { ACCESSIBLE_TEXT_MAX_MULTIPLIER, MINIMUM_TOUCH_TARGET } from '@/constants/accessibility';
import { DrawerBottomFill } from '@/components/DrawerBottomFill';
import { isChatMemberChecked } from '@/lib/custom-chat-membership';

type ChatMessage = {
  id: string;
  senderId: string;
  senderName?: string;
  text: string;
  at: string;
  attachments?: ChatAttachment[];
};

type PendingAttachment = {
  uri: string;
  name: string;
  kind: 'image' | 'file';
  mimeType?: string;
};

export default function WorkerChatScreen() {
  const { profile } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isDarkMode = resolvedThemeMode === 'dark';
  const drawerSurfaceColor = isDarkMode ? '#12274D' : '#F7F7F7';
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const params = useLocalSearchParams<{
    workerId?: string;
    workerLabel?: string;
    eventName?: string;
    teamId?: string;
    teamName?: string;
    teamMemberIds?: string;
    isTeamAll?: string;
    teamThreadId?: string;
    teamThreadPath?: string;
    chatKind?: string;
  }>();

  const workerId = params.workerId ?? 'worker';
  const workerLabel = params.workerLabel ?? workerId;
  const teamId = params.teamId;
  const isTeamBroadcast = !!params.teamThreadId || params.isTeamAll === '1' || workerId.startsWith('all:') || workerId.startsWith('team:') || workerLabel.toLowerCase() === 'all';
  const initialMemberIds = useMemo(
    () => (params.teamMemberIds || '').split(',').map((id) => id.trim()).filter(Boolean),
    [params.teamMemberIds]
  );
  const isCustomChat = params.chatKind === 'custom' || params.teamThreadId?.includes(':group:') === true;
  const isTeamChat = params.chatKind === 'team' && !!teamId;
  const canManageTeamMembers = isTeamChat && profile?.role?.toLowerCase() === 'manager';
  const canEditMemberSelection = isCustomChat || canManageTeamMembers;
  const usesLiveThreadParticipants = isCustomChat || isTeamChat;
  const [chatThread, setChatThread] = useState<ChatThreadHead | null>(null);
  const memberIds = useMemo(
    () => [...new Set((usesLiveThreadParticipants && chatThread?.participants?.length ? chatThread.participants : initialMemberIds).filter(Boolean))],
    [chatThread?.participants, initialMemberIds, usesLiveThreadParticipants]
  );
  const broadcastCount = memberIds.length;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [organizationMembers, setOrganizationMembers] = useState<UserProfile[]>([]);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatNameDraft, setChatNameDraft] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const organizationMemberById = useMemo(
    () => new Map(organizationMembers.map((member) => [member.uid, member])),
    [organizationMembers]
  );

  const headerTitle = isCustomChat
    ? chatThread?.title?.trim() || params.teamName || workerLabel
    : isTeamBroadcast ? (params.teamName || workerLabel) : workerLabel;
  const headerSubtitle = useMemo(() => {
    if (isCustomChat) {
      return memberIds
        .map((memberId) => memberId === profile?.uid ? profile.displayName : organizationMemberById.get(memberId)?.displayName || 'Member')
        .join(', ');
    }
    if (isTeamBroadcast) {
      if (isTeamChat && broadcastCount) return `${broadcastCount} team member${broadcastCount === 1 ? '' : 's'}`;
      if (params.teamThreadPath?.trim()) return params.teamThreadPath.trim();
      if (broadcastCount) return `${broadcastCount} member${broadcastCount === 1 ? '' : 's'}`;
      return 'Team chat';
    }

    if (params.teamName?.trim()) return params.teamName.trim();
    if (params.eventName?.trim()) return params.eventName.trim();
    return '';
  }, [broadcastCount, isCustomChat, isTeamBroadcast, isTeamChat, memberIds, organizationMemberById, params.eventName, params.teamName, params.teamThreadPath, profile]);

  const headerInitial = headerTitle.trim().slice(0, 1).toUpperCase() || 'C';

  const threadId = useMemo(() => {
    if (!profile) return null;
    if (params.teamThreadId?.trim()) return params.teamThreadId.trim();
    return buildChatThreadId({
      teamId,
      selfId: profile.uid,
      otherUserId: isTeamBroadcast ? undefined : workerId,
      isTeamBroadcast,
    });
  }, [isTeamBroadcast, params.teamThreadId, profile, teamId, workerId]);

  useFocusEffect(
    useCallback(() => {
      if (!threadId || !profile?.uid) return undefined;
      const userId = profile.uid;
      const writePresence = (active: boolean) => {
        setChatThreadViewerPresence({ threadId, userId, active }).catch(() => undefined);
      };

      setActiveChatThread(threadId);
      writePresence(AppState.currentState === 'active');
      const heartbeat = setInterval(() => {
        if (AppState.currentState === 'active') writePresence(true);
      }, 45 * 1000);
      const appStateSubscription = AppState.addEventListener('change', (state) => {
        writePresence(state === 'active');
      });

      return () => {
        clearActiveChatThread(threadId);
        clearInterval(heartbeat);
        appStateSubscription.remove();
        writePresence(false);
      };
    }, [profile?.uid, threadId])
  );

  useEffect(() => {
    if (!usesLiveThreadParticipants || !threadId) {
      setChatThread(null);
      return;
    }
    return watchChatThread(threadId, setChatThread);
  }, [threadId, usesLiveThreadParticipants]);

  useEffect(() => {
    if (!profile?.organizationId) {
      setOrganizationMembers([]);
      return;
    }

    let active = true;
    loadOrganizationMembers(profile.organizationId)
      .then((result) => {
        if (active) setOrganizationMembers(result.members);
      })
      .catch(() => {
        if (active) setOrganizationMembers(profile ? [profile] : []);
      });
    return () => {
      active = false;
    };
  }, [profile]);

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }

    return watchChatMessages(
      threadId,
      (items) => {
        const mapped = items.map((item) => {
          const date = item.createdAt instanceof Date
            ? item.createdAt
            : typeof item.createdAt === 'object' && item.createdAt && 'toDate' in item.createdAt && typeof item.createdAt.toDate === 'function'
              ? item.createdAt.toDate()
              : new Date();

          return {
            id: item.id,
            senderId: item.senderId,
            senderName: item.senderName,
            text: item.text,
            attachments: item.attachments || [],
            at: date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase(),
          };
        });
        setMessages(mapped);
        setLoadError(null);
      },
      () => setLoadError('Unable to load this chat. Please go back and try again.')
    );
  }, [threadId]);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  useEffect(() => {
    if (!profile || !threadId) return;
    markChatThreadRead({ userId: profile.uid, threadId, teamId }).catch(() => undefined);
  }, [messages.length, profile, teamId, threadId]);

  const emojiOptions = ['😀', '😂', '😍', '🙏', '👍', '🔥', '✅', '🎉', '📍', '⏰'];
  const attachmentOptions = [
    { key: 'file', label: 'Document attach', icon: 'attach-file' as const },
    { key: 'photo', label: 'Add photos', icon: 'photo-library' as const },
    { key: 'camera', label: 'Take photo', icon: 'photo-camera' as const },
  ];

  const appendToDraft = (snippet: string) => {
    setDraft((current) => [current.trimEnd(), snippet].filter(Boolean).join(current.trim() ? ' ' : ''));
  };

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Photo library permission is required to attach images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setPendingAttachments((prev) => [...prev, { uri: asset.uri, name: asset.fileName || `photo-${Date.now()}.jpg`, kind: 'image', mimeType: asset.mimeType }]);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Camera permission is required to take a photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.8 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setPendingAttachments((prev) => [...prev, { uri: asset.uri, name: asset.fileName || `photo-${Date.now()}.jpg`, kind: 'image', mimeType: asset.mimeType }]);
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setPendingAttachments((prev) => [...prev, { uri: asset.uri, name: asset.name || `file-${Date.now()}`, kind: 'file', mimeType: asset.mimeType }]);
  };

  const handleAttachmentSelect = async (key: string) => {
    try {
      if (key === 'photo') await pickPhoto();
      if (key === 'file') await pickFile();
      if (key === 'camera') await takePhoto();
    } catch (error) {
      Alert.alert('Attachment error', error instanceof Error ? error.message : 'Unable to attach file.');
    } finally {
      setShowAttachmentPicker(false);
    }
  };

  const canSend = draft.trim().length > 0 || pendingAttachments.length > 0;
  const hasPendingImage = pendingAttachments.some((attachment) => attachment.kind === 'image');

  const goBack = () => {
    setShowAttachmentPicker(false);
    setShowEmojiPicker(false);

    if (router.canGoBack()) {
      router.back();
      return;
    }

    if (teamId) {
      router.replace({
        pathname: '/team/[teamId]',
        params: {
          teamId,
          teamName: params.teamName || 'Team',
          memberIds: memberIds.join(','),
        },
      });
      return;
    }

    router.replace('/(tabs)/teams');
  };

  const selectableOrganizationMembers = useMemo(() => {
    const search = memberSearch.trim().toLowerCase();
    return organizationMembers
      .filter((member) => !search || `${member.displayName} ${member.email || ''}`.toLowerCase().includes(search))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [memberSearch, organizationMembers]);

  const openMemberPicker = () => {
    const organizationManagerIds = canManageTeamMembers
      ? organizationMembers.filter((member) => member.role === 'manager').map((member) => member.uid)
      : [];
    setSelectedMemberIds([...new Set([...memberIds, ...organizationManagerIds])]);
    setMemberSearch('');
    setMemberPickerOpen(true);
  };

  const closeMemberPicker = () => {
    if (addingMembers) return;
    setMemberPickerOpen(false);
    setMemberSearch('');
    setSelectedMemberIds([]);
  };

  const toggleMemberSelection = (memberId: string) => {
    const member = organizationMemberById.get(memberId);
    const canToggleCustomMember = isCustomChat && !memberIds.includes(memberId);
    const canToggleTeamWorker = canManageTeamMembers && member?.role === 'worker';
    if (!canToggleCustomMember && !canToggleTeamWorker) return;
    setSelectedMemberIds((current) => current.includes(memberId)
      ? current.filter((id) => id !== memberId)
      : [...current, memberId]);
  };

  const toggleSelectAllMembers = () => {
    if (!canEditMemberSelection) return;
    const visibleIds = selectableOrganizationMembers
      .filter((member) => isCustomChat || member.role === 'worker')
      .map((member) => member.uid);
    const selectableIds = isCustomChat
      ? visibleIds.filter((id) => !memberIds.includes(id))
      : visibleIds;
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedMemberIds.includes(id));
    setSelectedMemberIds((current) => allSelected
      ? current.filter((id) => !selectableIds.includes(id))
      : [...new Set([...current, ...visibleIds])]);
  };

  const handleAddMembers = async () => {
    if (!isCustomChat || !threadId || addingMembers) return;
    const newMemberIds = selectedMemberIds.filter((memberId) => !memberIds.includes(memberId));
    if (!newMemberIds.length) {
      closeMemberPicker();
      return;
    }

    try {
      setAddingMembers(true);
      await addChatParticipants({ threadId, participantIds: newMemberIds });
      setMemberPickerOpen(false);
      setMemberSearch('');
      setSelectedMemberIds([]);
    } catch (error) {
      Alert.alert('Unable to add people', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setAddingMembers(false);
    }
  };

  const handleSaveTeamMembers = async () => {
    if (!canManageTeamMembers || !teamId || !profile || addingMembers) return;
    const workerIds = selectedMemberIds.filter(
      (memberId) => organizationMemberById.get(memberId)?.role === 'worker'
    );

    try {
      setAddingMembers(true);
      await updateTeamWorkerMembership({
        managerId: profile.uid,
        teamId,
        workerIds,
      });
      setMemberPickerOpen(false);
      setMemberSearch('');
      setSelectedMemberIds([]);
    } catch (error) {
      Alert.alert('Unable to update Team', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setAddingMembers(false);
    }
  };

  const openSettings = () => {
    if (!isCustomChat) return;
    setChatNameDraft(headerTitle);
    setConfirmingLeave(false);
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    if (savingSettings) return;
    setConfirmingLeave(false);
    setSettingsOpen(false);
  };

  const handleRenameChat = async () => {
    if (!profile || !threadId || savingSettings) return;
    try {
      setSavingSettings(true);
      await renameCustomChat({ threadId, userId: profile.uid, title: chatNameDraft });
      setSettingsOpen(false);
    } catch (error) {
      Alert.alert('Unable to rename chat', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleLeaveChat = async () => {
    if (!profile || !threadId || savingSettings) return;
    try {
      setSavingSettings(true);
      await leaveCustomChat({ threadId, userId: profile.uid });
      setChatThread((current) => current ? { ...current, participants: current.participants?.filter((id) => id !== profile.uid) } : current);
      setSettingsOpen(false);
      setConfirmingLeave(false);
      router.replace('/(tabs)/teams');
    } catch (error) {
      Alert.alert('Unable to leave chat', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSavingSettings(false);
    }
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if ((!text && !pendingAttachments.length) || !profile || !threadId || sending) return;

    const recipientIds = isTeamBroadcast
      ? memberIds.filter((id) => id !== profile.uid)
      : [workerId].filter((id) => id && id !== profile.uid);

    setSending(true);
    try {
      const uploadedAttachments: ChatAttachment[] = [];
      for (const attachment of pendingAttachments) {
        const uploaded = await uploadChatAttachment({
          senderId: profile.uid,
          threadId,
          uri: attachment.uri,
          kind: attachment.kind,
          name: attachment.name,
          mimeType: attachment.mimeType,
        });
        uploadedAttachments.push(uploaded);
      }

      await sendChatMessage({
        threadId,
        teamId,
        senderId: profile.uid,
        senderName: profile.displayName,
        recipientIds,
        text,
        attachments: uploadedAttachments,
      });

      setDraft('');
      setPendingAttachments([]);
      setShowAttachmentPicker(false);
      setShowEmojiPicker(false);
    } catch (error) {
      Alert.alert('Unable to send', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}
      behavior={Platform.select({ ios: 'padding', android: 'height' })}
      keyboardVerticalOffset={Platform.select({ ios: 20, android: 0 })}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.headerShell, isDarkMode ? styles.headerShellDark : styles.headerShellLight, { paddingTop: insets.top }]}>
        <View style={[styles.headerRow, isDarkMode ? styles.headerRowDark : styles.headerRowLight]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton} onPress={goBack} hitSlop={8}>
            <MaterialIcons name="arrow-back-ios" size={28} color={isDarkMode ? '#F7F7F7' : '#121212'} />
          </Pressable>

          <View style={styles.headerCenter}>
            <View style={[styles.headerAvatar, isDarkMode ? styles.headerAvatarDark : styles.headerAvatarLight]}>
              <Text style={[styles.headerAvatarText, isDarkMode ? styles.headerAvatarTextDark : styles.headerAvatarTextLight]}>{headerInitial}</Text>
            </View>
            <View style={styles.headerCopy}>
              <Text style={[styles.headerTitle, isDarkMode ? styles.headerTitleDark : styles.headerTitleLight]} numberOfLines={2} maxFontSizeMultiplier={ACCESSIBLE_TEXT_MAX_MULTIPLIER}>
                {headerTitle}
              </Text>
              {headerSubtitle ? (
                <View style={styles.headerSubtitleRow}>
                  <Pressable
                    accessibilityLabel={isCustomChat ? 'Add people to chat' : canManageTeamMembers ? 'Manage Team members' : 'View people in chat'}
                    hitSlop={8}
                    onPress={openMemberPicker}>
                    <MaterialIcons name="add-circle" size={15} color="#0EC3C9" />
                  </Pressable>
                  <Text style={[styles.headerSubtitle, styles.headerSubtitleNames, isDarkMode ? styles.headerSubtitleDark : styles.headerSubtitleLight]} numberOfLines={2} maxFontSizeMultiplier={ACCESSIBLE_TEXT_MAX_MULTIPLIER}>
                    {headerSubtitle}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {isCustomChat ? (
            <Pressable accessibilityLabel="Chat settings" style={styles.headerMenuButton} hitSlop={8} onPress={openSettings}>
              <MaterialIcons name="more-vert" size={24} color={isDarkMode ? '#F7F7F7' : '#121212'} />
            </Pressable>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>
      </View>

      {loadError ? (
        <View style={styles.loadErrorBanner}>
          <MaterialIcons name="error-outline" size={18} color="#991b1b" />
          <Text style={styles.loadErrorText}>{loadError}</Text>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.thread, { paddingBottom: 20 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item: message }) => {
          const mine = !!profile && message.senderId === profile.uid;
          return (
            <View style={[styles.messageRow, mine ? styles.messageRowSelf : styles.messageRowOther]}>
              <View style={[styles.bubble, mine ? (isDarkMode ? styles.bubbleSelfDark : styles.bubbleSelfLight) : isDarkMode ? styles.bubbleOtherDark : styles.bubbleOtherLight]}>
                {isTeamBroadcast ? (
                  <Text style={[styles.senderName, mine ? styles.senderNameSelf : styles.senderNameOther]}>
                    {mine ? profile?.displayName || message.senderName?.trim() || 'You' : message.senderName?.trim() || 'Team member'}
                  </Text>
                ) : null}
                {message.text ? (
                  <Text style={[styles.messageText, mine ? styles.messageTextSelf : styles.messageTextLight]}>
                    {message.text}
                  </Text>
                ) : null}
                {(message.attachments || []).map((attachment) => (
                  <View key={attachment.id} style={styles.attachmentWrap}>
                    {attachment.kind === 'image' ? (
                      <Pressable onPress={() => Linking.openURL(attachment.url)}>
                        <Image source={{ uri: attachment.url }} style={styles.attachmentImage} resizeMode="cover" />
                      </Pressable>
                    ) : (
                      <Pressable style={styles.attachmentFile} onPress={() => Linking.openURL(attachment.url)}>
                        <MaterialIcons name="attach-file" size={16} color={mine ? '#F7F7F7' : '#121212'} />
                        <Text style={[styles.attachmentLink, mine ? styles.messageTextSelf : styles.messageTextLight]} numberOfLines={1}>
                          {attachment.name}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ))}
                <Text style={[styles.time, mine ? styles.timeSelf : styles.timeLight]}>{message.at}</Text>
              </View>
            </View>
          );
        }}
      />

      <Modal visible={memberPickerOpen} transparent animationType="slide" onRequestClose={closeMemberPicker}>
        <Pressable style={styles.memberPickerBackdrop} onPress={closeMemberPicker}>
          <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: 'height' })} style={styles.memberPickerKeyboardView}>
            <Pressable style={[styles.memberPickerDrawer, isDarkMode ? styles.memberPickerDrawerDark : styles.memberPickerDrawerLight]} onPress={() => undefined}>
              <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
              <Text style={[styles.memberPickerTitle, isDarkMode ? styles.headerTitleDark : styles.headerTitleLight]}>
                {isCustomChat ? 'Add People' : canManageTeamMembers ? 'Manage Team' : 'People in Chat'}
              </Text>
              <TextInput
                value={memberSearch}
                onChangeText={setMemberSearch}
                placeholder="Search organization members"
                placeholderTextColor={isDarkMode ? '#9fb0cf' : '#64748b'}
                style={[styles.memberSearchInput, isDarkMode ? styles.memberSearchInputDark : styles.memberSearchInputLight]}
              />
              <Pressable
                style={[styles.selectAllRow, !canEditMemberSelection && styles.disabledControl]}
                disabled={!canEditMemberSelection}
                onPress={toggleSelectAllMembers}>
                <MaterialIcons
                  name={selectableOrganizationMembers.some((member) => isCustomChat || member.role === 'worker')
                    && selectableOrganizationMembers
                      .filter((member) => isCustomChat || member.role === 'worker')
                      .every((member) => selectedMemberIds.includes(member.uid))
                    ? 'check-box'
                    : 'check-box-outline-blank'}
                  size={23}
                  color="#0EC3C9"
                />
                <Text style={[styles.selectAllText, isDarkMode ? styles.headerTitleDark : styles.headerTitleLight]}>Select all</Text>
              </Pressable>
              <ScrollView style={styles.memberPickerList} keyboardShouldPersistTaps="handled">
                {selectableOrganizationMembers.map((member) => {
                  const alreadyInChat = memberIds.includes(member.uid);
                  const canToggleTeamWorker = canManageTeamMembers && member.role === 'worker';
                  const locked = isCustomChat ? alreadyInChat : !canToggleTeamWorker;
                  const checked = isChatMemberChecked({
                    alreadyInChat,
                    canManageTeamMembers,
                    selectedMemberIds,
                    memberId: member.uid,
                  });
                  const memberMeta = canManageTeamMembers
                    ? member.role === 'manager'
                      ? 'Manager - always included'
                      : selectedMemberIds.includes(member.uid)
                        ? 'Team member'
                        : member.email || 'Worker'
                    : alreadyInChat
                      ? 'Already in chat'
                      : member.email || (member.role === 'manager' ? 'Manager' : 'Worker');
                  return (
                    <View key={member.uid} style={[styles.memberPickerRow, locked && styles.memberPickerRowLocked]}>
                      {locked ? (
                        <View
                          accessibilityLabel={`${member.displayName} is ${checked ? '' : 'not '}in this chat`}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked, disabled: true }}
                          style={styles.memberPickerCheckbox}>
                          <MaterialIcons name={checked ? 'check-box' : 'check-box-outline-blank'} size={23} color="#0EC3C9" />
                        </View>
                      ) : (
                        <Pressable
                          accessibilityLabel={`${checked ? 'Deselect' : 'Select'} ${member.displayName}`}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked }}
                          hitSlop={4}
                          style={styles.memberPickerCheckbox}
                          onPress={() => toggleMemberSelection(member.uid)}>
                          <MaterialIcons name={checked ? 'check-box' : 'check-box-outline-blank'} size={23} color="#0EC3C9" />
                        </Pressable>
                      )}
                      <View style={styles.memberPickerCopy}>
                        <Text style={[styles.memberPickerName, isDarkMode ? styles.headerTitleDark : styles.headerTitleLight]}>{member.displayName}</Text>
                        <Text style={[styles.memberPickerMeta, isDarkMode ? styles.headerSubtitleDark : styles.headerSubtitleLight]}>
                          {memberMeta}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
              <Pressable
                style={[styles.memberPickerButton, (!canEditMemberSelection || addingMembers) && styles.sendButtonDisabled]}
                disabled={!canEditMemberSelection || addingMembers}
                onPress={canManageTeamMembers ? handleSaveTeamMembers : handleAddMembers}>
                <Text style={styles.memberPickerButtonText}>
                  {addingMembers ? (canManageTeamMembers ? 'Saving...' : 'Adding...') : canManageTeamMembers ? 'Save Team' : 'Chat'}
                </Text>
              </Pressable>
              <Pressable style={styles.memberPickerCloseButton} disabled={addingMembers} onPress={closeMemberPicker}>
                <Text style={[styles.memberPickerCloseText, isDarkMode ? styles.headerTitleDark : styles.headerTitleLight]}>Close</Text>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <Modal visible={isCustomChat && settingsOpen} transparent animationType="slide" onRequestClose={closeSettings}>
        <Pressable style={styles.memberPickerBackdrop} onPress={closeSettings}>
          <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: 'height' })} style={styles.settingsKeyboardView}>
            <Pressable style={[styles.settingsDrawer, isDarkMode ? styles.memberPickerDrawerDark : styles.memberPickerDrawerLight]} onPress={() => undefined}>
              <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
              <Text style={[styles.memberPickerTitle, isDarkMode ? styles.headerTitleDark : styles.headerTitleLight]}>Chat Settings</Text>
              <Text style={[styles.settingsLabel, isDarkMode ? styles.headerTitleDark : styles.headerTitleLight]}>Chat name</Text>
              <TextInput
                value={chatNameDraft}
                onChangeText={setChatNameDraft}
                editable={!savingSettings}
                placeholder="Chat name"
                placeholderTextColor={isDarkMode ? '#9fb0cf' : '#64748b'}
                style={[styles.memberSearchInput, isDarkMode ? styles.memberSearchInputDark : styles.memberSearchInputLight]}
              />
              <Pressable
                style={[styles.memberPickerButton, (!chatNameDraft.trim() || savingSettings) && styles.sendButtonDisabled]}
                disabled={!chatNameDraft.trim() || savingSettings}
                onPress={handleRenameChat}>
                <Text style={styles.memberPickerButtonText}>{savingSettings ? 'Saving...' : 'Rename Chat'}</Text>
              </Pressable>
              {confirmingLeave ? (
                <View style={styles.leaveChatConfirmation}>
                  <Text style={[styles.leaveChatConfirmationText, isDarkMode ? styles.headerTitleDark : styles.headerTitleLight]}>
                    Leave {headerTitle}? You will no longer receive its messages.
                  </Text>
                  <View style={styles.leaveChatConfirmationActions}>
                    <Pressable style={styles.memberPickerCloseButton} disabled={savingSettings} onPress={() => setConfirmingLeave(false)}>
                      <Text style={[styles.memberPickerCloseText, isDarkMode ? styles.headerTitleDark : styles.headerTitleLight]}>Cancel</Text>
                    </Pressable>
                    <Pressable style={[styles.leaveChatButton, savingSettings && styles.sendButtonDisabled]} disabled={savingSettings} onPress={handleLeaveChat}>
                      <MaterialIcons name="logout" size={19} color="#b91c1c" />
                      <Text style={styles.leaveChatText}>{savingSettings ? 'Leaving...' : 'Leave Chat'}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable style={[styles.leaveChatButton, savingSettings && styles.sendButtonDisabled]} disabled={savingSettings} onPress={() => setConfirmingLeave(true)}>
                  <MaterialIcons name="logout" size={19} color="#b91c1c" />
                  <Text style={styles.leaveChatText}>Leave Chat</Text>
                </Pressable>
              )}
              <Pressable style={styles.memberPickerCloseButton} disabled={savingSettings} onPress={closeSettings}>
                <Text style={[styles.memberPickerCloseText, isDarkMode ? styles.headerTitleDark : styles.headerTitleLight]}>Close</Text>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <View style={[styles.composer, isDarkMode ? styles.composerDark : styles.composerLight, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {showAttachmentPicker ? (
          <View style={[styles.actionMenu, isDarkMode ? styles.actionMenuDark : styles.actionMenuLight]}>
            {attachmentOptions.map((option) => (
              <Pressable key={option.key} style={styles.actionMenuItem} onPress={() => handleAttachmentSelect(option.key)}>
                <MaterialIcons name={option.icon} size={18} color={isDarkMode ? '#F7F7F7' : '#121212'} />
                <Text style={[styles.actionMenuText, isDarkMode ? styles.actionMenuTextDark : styles.actionMenuTextLight]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {showEmojiPicker ? (
          <View style={[styles.emojiMenu, isDarkMode ? styles.actionMenuDark : styles.actionMenuLight]}>
            {emojiOptions.map((emoji) => (
              <Pressable key={emoji} style={styles.emojiChip} onPress={() => appendToDraft(emoji)}>
                <Text style={styles.emojiText}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {pendingAttachments.length ? (
          <View style={styles.pendingAttachmentRow}>
            {pendingAttachments.map((attachment, index) => (
              <View key={`${attachment.name}-${index}`} style={[styles.pendingAttachmentChip, isDarkMode ? styles.pendingAttachmentChipDark : styles.pendingAttachmentChipLight]}>
                <MaterialIcons name={attachment.kind === 'image' ? 'image' : 'attach-file'} size={14} color={isDarkMode ? '#F7F7F7' : '#121212'} />
                <Text style={[styles.pendingAttachmentText, isDarkMode ? styles.pendingAttachmentTextDark : styles.pendingAttachmentTextLight]} numberOfLines={1}>
                  {attachment.name}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add an attachment"
            style={styles.plusButton}
            hitSlop={8}
            onPress={() => {
              setShowAttachmentPicker((prev) => !prev);
              setShowEmojiPicker(false);
            }}>
            <MaterialIcons name="add" size={30} color={isDarkMode ? '#F7F7F7' : '#121212'} />
          </Pressable>

          <View style={[styles.inputShell, isDarkMode ? styles.inputShellDark : styles.inputShellLight]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={hasPendingImage ? 'Add a caption' : isTeamBroadcast ? 'Message the team' : 'Type a message'}
              placeholderTextColor={isDarkMode ? 'rgba(244,248,255,0.5)' : 'rgba(18,18,18,0.4)'}
              style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
              returnKeyType="send"
              onSubmitEditing={sendMessage}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose an emoji"
              style={styles.emojiButton}
              hitSlop={8}
              onPress={() => {
                setShowEmojiPicker((prev) => !prev);
                setShowAttachmentPicker(false);
              }}>
              <MaterialIcons name="emoji-emotions" size={24} color={isDarkMode ? '#F7F7F7' : '#121212'} />
            </Pressable>
          </View>

          <Pressable accessibilityRole="button" accessibilityLabel="Send message" style={[styles.sendButton, (!canSend || sending) && styles.sendButtonDisabled]} onPress={sendMessage} disabled={!canSend || sending} hitSlop={8}>
            <MaterialIcons name="send" size={32} color="#0EC3C9" />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  containerLight: { backgroundColor: '#EDF0FC' },
  containerDark: { backgroundColor: '#EDF0FC' },
  headerShell: { overflow: 'hidden' },
  headerShellLight: { backgroundColor: '#F7F7F7' },
  headerShellDark: { backgroundColor: '#12274D' },
  headerRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerRowLight: { backgroundColor: '#F7F7F7' },
  headerRowDark: { backgroundColor: '#12274D' },
  backButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'center', marginHorizontal: 8 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  headerAvatarLight: { backgroundColor: '#F7F7F7', borderColor: '#F98D2F' },
  headerAvatarDark: { backgroundColor: '#12274D', borderColor: '#F98D2F' },
  headerAvatarText: { fontSize: 16, fontWeight: '700' },
  headerAvatarTextLight: { color: 'rgba(249,141,47,0.25)' },
  headerAvatarTextDark: { color: '#F98D2F' },
  headerCopy: { flex: 1, minWidth: 0, justifyContent: 'center' },
  headerTitle: { fontSize: 16, lineHeight: 19, fontWeight: '700' },
  headerTitleLight: { color: '#121212' },
  headerTitleDark: { color: '#F7F7F7' },
  headerSubtitle: { marginTop: 2, fontSize: 10, lineHeight: 12 },
  headerSubtitleRow: { marginTop: 2, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerSubtitleNames: { flex: 1, marginTop: 0 },
  headerSubtitleLight: { color: '#121212', opacity: 0.75 },
  headerSubtitleDark: { color: '#F7F7F7', opacity: 0.75 },
  headerSpacer: { width: 36, height: 29 },
  headerMenuButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  memberPickerBackdrop: { flex: 1, backgroundColor: 'rgba(6,18,41,0.55)', justifyContent: 'flex-end' },
  memberPickerKeyboardView: { height: '75%', justifyContent: 'flex-end' },
  memberPickerDrawer: { flex: 1, borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 18 },
  memberPickerDrawerLight: { backgroundColor: '#F7F7F7' },
  memberPickerDrawerDark: { backgroundColor: '#12274D' },
  memberPickerTitle: { marginBottom: 12, fontSize: 19, fontWeight: '700' },
  memberSearchInput: { minHeight: 46, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, fontSize: 14 },
  memberSearchInputLight: { backgroundColor: '#EDF0FC', borderColor: 'rgba(6,18,41,0.12)', color: '#121212' },
  memberSearchInputDark: { backgroundColor: '#203E75', borderColor: 'rgba(247,247,247,0.15)', color: '#F7F7F7' },
  selectAllRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(100,116,139,0.25)' },
  selectAllText: { fontSize: 14, fontWeight: '700' },
  memberPickerList: { flex: 1 },
  memberPickerRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(100,116,139,0.2)' },
  memberPickerRowLocked: { opacity: 0.65 },
  memberPickerCheckbox: { width: 31, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  disabledControl: { opacity: 0.5 },
  memberPickerCopy: { flex: 1, minWidth: 0 },
  memberPickerName: { fontSize: 14, fontWeight: '700' },
  memberPickerMeta: { marginTop: 2, fontSize: 12 },
  memberPickerButton: { minHeight: 52, marginTop: 14, borderRadius: 8, backgroundColor: '#0EC3C9', alignItems: 'center', justifyContent: 'center' },
  memberPickerButtonText: { color: '#061229', fontSize: 16, fontWeight: '700' },
  memberPickerCloseButton: { minHeight: 46, marginTop: 6, alignItems: 'center', justifyContent: 'center' },
  memberPickerCloseText: { fontSize: 15, fontWeight: '700' },
  settingsKeyboardView: { justifyContent: 'flex-end' },
  settingsDrawer: { borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 18, paddingBottom: 12 },
  settingsLabel: { marginBottom: 6, fontSize: 13, fontWeight: '700' },
  leaveChatButton: { minHeight: 48, marginTop: 12, borderWidth: 1, borderColor: '#fecaca', borderRadius: 8, backgroundColor: '#fef2f2', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  leaveChatText: { color: '#b91c1c', fontSize: 15, fontWeight: '700' },
  leaveChatConfirmation: { marginTop: 12, gap: 10 },
  leaveChatConfirmationText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  leaveChatConfirmationActions: { gap: 4 },
  thread: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  loadErrorBanner: { minHeight: 48, marginHorizontal: 16, marginTop: 10, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca' },
  loadErrorText: { flex: 1, color: '#991b1b', fontSize: 13, fontWeight: '600' },
  messageRow: { width: '100%', paddingVertical: 4 },
  messageRowSelf: { alignItems: 'flex-end' },
  messageRowOther: { alignItems: 'flex-start' },
  bubble: { maxWidth: '72%', paddingHorizontal: 8, paddingVertical: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  bubbleSelfLight: { backgroundColor: '#0EC3C9', borderBottomLeftRadius: 8, borderBottomRightRadius: 0 },
  bubbleSelfDark: { backgroundColor: '#0EC3C9', borderBottomLeftRadius: 8, borderBottomRightRadius: 0 },
  bubbleOtherLight: { backgroundColor: '#DBE2F9', borderBottomLeftRadius: 0, borderBottomRightRadius: 8 },
  bubbleOtherDark: { backgroundColor: '#DBE2F9', borderBottomLeftRadius: 0, borderBottomRightRadius: 8 },
  senderName: { marginBottom: 4, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  senderNameSelf: { color: '#121212' },
  senderNameOther: { color: '#0EC3C9' },
  messageText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  messageTextSelf: { color: '#F7F7F7' },
  messageTextLight: { color: '#121212' },
  messageTextDark: { color: '#121212' },
  attachmentWrap: { marginTop: 6 },
  attachmentImage: { width: 180, height: 180, borderRadius: 8, backgroundColor: '#12274D' },
  attachmentFile: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 180 },
  attachmentLink: { fontSize: 12, lineHeight: 16, fontWeight: '600', flexShrink: 1 },
  time: { marginTop: 6, fontSize: 10, lineHeight: 12, alignSelf: 'flex-end' },
  timeSelf: { color: 'rgba(247,247,247,0.75)' },
  timeLight: { color: 'rgba(18,18,18,0.5)' },
  timeDark: { color: 'rgba(18,18,18,0.5)' },
  composer: { paddingHorizontal: 10, paddingTop: 10 },
  composerLight: { backgroundColor: '#F7F7F7' },
  composerDark: { backgroundColor: '#12274D' },
  actionMenu: {
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    padding: 8,
    gap: 8,
  },
  actionMenuLight: { backgroundColor: '#F7F7F7', borderColor: 'rgba(6,18,41,0.12)' },
  actionMenuDark: { backgroundColor: '#2E559D', borderColor: 'rgba(6,18,41,0.33)' },
  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  actionMenuText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  actionMenuTextLight: { color: '#121212' },
  actionMenuTextDark: { color: '#F7F7F7' },
  emojiMenu: {
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  emojiChip: { paddingHorizontal: 8, paddingVertical: 4 },
  emojiText: { fontSize: 22 },
  pendingAttachmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  pendingAttachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pendingAttachmentChipLight: { backgroundColor: '#EDF0FC', borderColor: 'rgba(6,18,41,0.12)' },
  pendingAttachmentChipDark: { backgroundColor: '#2E559D', borderColor: 'rgba(6,18,41,0.33)' },
  pendingAttachmentText: { fontSize: 12, lineHeight: 16, fontWeight: '600', flexShrink: 1 },
  pendingAttachmentTextLight: { color: '#121212' },
  pendingAttachmentTextDark: { color: '#F7F7F7' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plusButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  inputShell: {
    flex: 1,
    minHeight: MINIMUM_TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: 24,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputShellLight: { borderColor: 'rgba(6,18,41,0.33)', backgroundColor: '#F7F7F7' },
  inputShellDark: { borderColor: 'rgba(6,18,41,0.33)', backgroundColor: '#2E559D' },
  input: { flex: 1, minHeight: 22, fontSize: 12, lineHeight: 16, fontWeight: '600', paddingVertical: 0 },
  inputLight: { color: '#121212' },
  inputDark: { color: '#F7F7F7' },
  emojiButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  sendButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { opacity: 0.35 },
});
