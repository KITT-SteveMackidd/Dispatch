import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';
import { buildChatThreadId, ChatAttachment, markTeamChatRead, sendChatMessage, uploadChatAttachment, watchChatMessages } from '@/services/dispatch';

type ChatMessage = {
  id: string;
  senderId: string;
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
    teamThreadPath?: string;
  }>();

  const workerId = params.workerId ?? 'worker';
  const workerLabel = params.workerLabel ?? workerId;
  const teamId = params.teamId;
  const isTeamBroadcast = params.isTeamAll === '1' || workerId.startsWith('all:') || workerId.startsWith('team:') || workerLabel.toLowerCase() === 'all';
  const memberIds = (params.teamMemberIds || '').split(',').map((id) => id.trim()).filter(Boolean);
  const broadcastCount = memberIds.length;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);

  const headerTitle = isTeamBroadcast ? (params.teamName || workerLabel) : workerLabel;
  const headerSubtitle = useMemo(() => {
    if (isTeamBroadcast) {
      if (params.teamThreadPath?.trim()) return params.teamThreadPath.trim();
      if (broadcastCount) return `${broadcastCount} member${broadcastCount === 1 ? '' : 's'}`;
      return 'Team chat';
    }

    if (params.teamName?.trim()) return params.teamName.trim();
    if (params.eventName?.trim()) return params.eventName.trim();
    return '';
  }, [broadcastCount, isTeamBroadcast, params.eventName, params.teamName, params.teamThreadPath]);

  const headerInitial = headerTitle.trim().slice(0, 1).toUpperCase() || 'C';

  const threadId = useMemo(() => {
    if (!profile) return null;
    return buildChatThreadId({
      teamId,
      selfId: profile.uid,
      otherUserId: isTeamBroadcast ? undefined : workerId,
      isTeamBroadcast,
    });
  }, [isTeamBroadcast, profile, teamId, workerId]);

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }

    return watchChatMessages(threadId, (items) => {
      const mapped = items.map((item) => {
        const date = item.createdAt instanceof Date
          ? item.createdAt
          : typeof item.createdAt === 'object' && item.createdAt && 'toDate' in item.createdAt && typeof item.createdAt.toDate === 'function'
            ? item.createdAt.toDate()
            : new Date();

        return {
          id: item.id,
          senderId: item.senderId,
          text: item.text,
          attachments: item.attachments || [],
          at: date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase(),
        };
      });
      setMessages(mapped);
    });
  }, [threadId]);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  useEffect(() => {
    if (!profile || !teamId) return;
    markTeamChatRead({ userId: profile.uid, teamId }).catch(() => undefined);
  }, [profile, teamId, threadId]);

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
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <MaterialIcons name="arrow-back-ios" size={28} color={isDarkMode ? '#F7F7F7' : '#121212'} />
          </Pressable>

          <View style={styles.headerCenter}>
            <View style={[styles.headerAvatar, isDarkMode ? styles.headerAvatarDark : styles.headerAvatarLight]}>
              <Text style={[styles.headerAvatarText, isDarkMode ? styles.headerAvatarTextDark : styles.headerAvatarTextLight]}>{headerInitial}</Text>
            </View>
            <View style={styles.headerCopy}>
              <Text style={[styles.headerTitle, isDarkMode ? styles.headerTitleDark : styles.headerTitleLight]} numberOfLines={1}>
                {headerTitle}
              </Text>
              {headerSubtitle ? (
                <Text style={[styles.headerSubtitle, isDarkMode ? styles.headerSubtitleDark : styles.headerSubtitleLight]} numberOfLines={1}>
                  {headerSubtitle}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.headerSpacer} />
        </View>
      </View>

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
              hitSlop={8}
              onPress={() => {
                setShowEmojiPicker((prev) => !prev);
                setShowAttachmentPicker(false);
              }}>
              <MaterialIcons name="emoji-emotions" size={24} color={isDarkMode ? '#F7F7F7' : '#121212'} />
            </Pressable>
          </View>

          <Pressable style={[styles.sendButton, (!canSend || sending) && styles.sendButtonDisabled]} onPress={sendMessage} disabled={!canSend || sending} hitSlop={8}>
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
  backButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'center', marginHorizontal: 8 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  headerAvatarLight: { backgroundColor: '#F7F7F7', borderColor: '#F98D2F' },
  headerAvatarDark: { backgroundColor: '#12274D', borderColor: '#F98D2F' },
  headerAvatarText: { fontSize: 16, fontWeight: '700' },
  headerAvatarTextLight: { color: 'rgba(249,141,47,0.25)' },
  headerAvatarTextDark: { color: '#F98D2F' },
  headerCopy: { minWidth: 0, justifyContent: 'center' },
  headerTitle: { fontSize: 16, lineHeight: 19, fontWeight: '700' },
  headerTitleLight: { color: '#121212' },
  headerTitleDark: { color: '#F7F7F7' },
  headerSubtitle: { marginTop: 2, fontSize: 10, lineHeight: 12 },
  headerSubtitleLight: { color: '#121212', opacity: 0.75 },
  headerSubtitleDark: { color: '#F7F7F7', opacity: 0.75 },
  headerSpacer: { width: 36, height: 29 },
  thread: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  messageRow: { width: '100%', paddingVertical: 4 },
  messageRowSelf: { alignItems: 'flex-end' },
  messageRowOther: { alignItems: 'flex-start' },
  bubble: { maxWidth: '72%', paddingHorizontal: 8, paddingVertical: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  bubbleSelfLight: { backgroundColor: '#0EC3C9', borderBottomLeftRadius: 8, borderBottomRightRadius: 0 },
  bubbleSelfDark: { backgroundColor: '#0EC3C9', borderBottomLeftRadius: 8, borderBottomRightRadius: 0 },
  bubbleOtherLight: { backgroundColor: '#DBE2F9', borderBottomLeftRadius: 0, borderBottomRightRadius: 8 },
  bubbleOtherDark: { backgroundColor: '#DBE2F9', borderBottomLeftRadius: 0, borderBottomRightRadius: 8 },
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
  plusButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  inputShell: {
    flex: 1,
    minHeight: 32,
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
  sendButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { opacity: 0.35 },
});
