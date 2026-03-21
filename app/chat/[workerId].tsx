import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
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

export default function WorkerChatScreen() {
  const { profile } = useSession();
  const { resolvedThemeMode } = useThemeMode();
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
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ uri: string; name: string; kind: 'image' | 'file' | 'audio'; mimeType?: string }>>([]);
  const [sending, setSending] = useState(false);

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
          at: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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

  const headerSubtitle = useMemo(() => {
    if (isTeamBroadcast) {
      return `Team broadcast${broadcastCount ? ` • ${broadcastCount} recipients` : ''}`;
    }
    return 'Direct manager ↔ worker chat';
  }, [broadcastCount, isTeamBroadcast]);



  const emojiOptions = ['😀', '😂', '😍', '🙏', '👍', '🔥', '✅', '🎉', '📍', '⏰'];
  const attachmentOptions = [
    { key: 'photo', label: 'Photo', kind: 'image' as const },
    { key: 'file', label: 'File', kind: 'file' as const },
  ];
  const voiceQuickPhrases = [
    'On my way now.',
    'Task completed ✅',
    'Running 10 minutes behind.',
    'Need help at this station.',
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
    } catch (error) {
      Alert.alert('Attachment error', error instanceof Error ? error.message : 'Unable to attach file.');
    } finally {
      setShowAttachmentPicker(false);
    }
  };

  const toggleVoiceListening = async () => {
    setShowVoicePanel(true);
    setIsListening((current) => !current);
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
      keyboardVerticalOffset={Platform.select({ ios: 84, android: 0 })}
    >
      <Stack.Screen options={{ title: workerLabel }} />

      <View style={[styles.header, isDarkMode ? styles.headerDark : styles.headerLight]}>
        <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>{workerLabel}</Text>
        <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>{headerSubtitle}</Text>
        {params.teamName ? <Text style={[styles.context, isDarkMode ? styles.contextDark : styles.contextLight]}>Team: {params.teamName}</Text> : null}
        {params.teamThreadPath ? <Text style={[styles.context, isDarkMode ? styles.contextDark : styles.contextLight]}>Thread: {params.teamThreadPath}</Text> : null}
        {params.eventName ? <Text style={[styles.context, isDarkMode ? styles.contextDark : styles.contextLight]}>Event: {params.eventName}</Text> : null}
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item: message }) => {
          const mine = !!profile && message.senderId === profile.uid;
          return (
            <View style={[styles.row, mine ? styles.rowSelf : styles.rowOther]}>
              <View style={[styles.bubble, mine ? styles.bubbleSelf : isDarkMode ? styles.bubbleOtherDark : styles.bubbleOtherLight]}>
                {message.text ? (
                  <Text style={[styles.messageText, mine ? styles.messageTextSelf : isDarkMode ? styles.messageTextDark : styles.messageTextLight]}>{message.text}</Text>
                ) : null}
                {(message.attachments || []).map((attachment) => (
                  <View key={attachment.id} style={styles.attachmentWrap}>
                    {attachment.kind === 'image' ? (
                      <Pressable onPress={() => Linking.openURL(attachment.url)}>
                        <Image source={{ uri: attachment.url }} style={styles.attachmentImage} resizeMode="cover" />
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => Linking.openURL(attachment.url)}>
                        <Text style={[styles.attachmentLink, mine ? styles.messageTextSelf : isDarkMode ? styles.messageTextDark : styles.messageTextLight]}>
                          📎 {attachment.name}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ))}
                <Text style={[styles.time, mine ? styles.timeSelf : isDarkMode ? styles.timeDark : styles.timeLight]}>{message.at}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={[styles.composer, isDarkMode ? styles.composerDark : styles.composerLight]}>
        <View style={styles.composerTools}>
          <Pressable
            style={[styles.toolButton, isDarkMode ? styles.toolButtonDark : styles.toolButtonLight]}
            onPress={() => {
              setShowAttachmentPicker((prev) => !prev);
              setShowEmojiPicker(false);
              setShowVoicePanel(false);
            }}>
            <Text style={styles.toolIcon}>＋</Text>
          </Pressable>
          <Pressable
            style={[styles.toolButton, isDarkMode ? styles.toolButtonDark : styles.toolButtonLight]}
            onPress={() => {
              setShowEmojiPicker((prev) => !prev);
              setShowAttachmentPicker(false);
              setShowVoicePanel(false);
            }}>
            <Text style={styles.toolIcon}>😊</Text>
          </Pressable>
          <Pressable
            style={[styles.toolButton, isDarkMode ? styles.toolButtonDark : styles.toolButtonLight, isListening && styles.toolButtonActive]}
            onPress={toggleVoiceListening}>
            <Text style={styles.toolIcon}>🎤</Text>
          </Pressable>
        </View>

        {pendingAttachments.length ? (
          <View style={styles.pendingAttachmentRow}>
            {pendingAttachments.map((attachment, index) => (
              <View key={`${attachment.name}-${index}`} style={styles.pendingAttachmentChip}>
                <Text style={styles.pendingAttachmentText}>{attachment.kind === 'image' ? '🖼️' : attachment.kind === 'audio' ? '🎤' : '📎'} {attachment.name}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={hasPendingImage ? 'Add a caption…' : isTeamBroadcast ? 'Message the whole team…' : 'Type a message…'}
            placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
            style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
            returnKeyType="send"
            onSubmitEditing={sendMessage}
          />
          <Pressable style={[styles.sendButton, (!canSend || sending) && styles.sendButtonDisabled]} onPress={sendMessage} disabled={!canSend || sending}>
            <Text style={styles.sendText}>{sending ? '…' : 'Send'}</Text>
          </Pressable>
        </View>

        {showAttachmentPicker ? (
          <View style={[styles.picker, isDarkMode ? styles.pickerDark : styles.pickerLight]}>
            {attachmentOptions.map((option) => (
              <Pressable key={option.key} style={styles.pickerChip} onPress={() => handleAttachmentSelect(option.key)}>
                <Text style={[styles.pickerChipText, isDarkMode ? styles.pickerChipTextDark : styles.pickerChipTextLight]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {showEmojiPicker ? (
          <View style={[styles.picker, isDarkMode ? styles.pickerDark : styles.pickerLight]}>
            {emojiOptions.map((emoji) => (
              <Pressable key={emoji} style={styles.emojiChip} onPress={() => appendToDraft(emoji)}>
                <Text style={styles.emojiText}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {showVoicePanel ? (
          <View style={[styles.picker, isDarkMode ? styles.pickerDark : styles.pickerLight]}>
            <Text style={[styles.voiceHint, isDarkMode ? styles.voiceHintDark : styles.voiceHintLight]}>
              {isListening ? 'Quick voice phrases ready — tap one to insert it.' : 'Voice notes are temporarily disabled on iPhone builds; tap again to show quick phrases.'}
            </Text>
            <View style={styles.voicePhraseRow}>
              {voiceQuickPhrases.map((phrase) => (
                <Pressable key={phrase} style={styles.pickerChip} onPress={() => appendToDraft(phrase)}>
                  <Text style={[styles.pickerChipText, isDarkMode ? styles.pickerChipTextDark : styles.pickerChipTextLight]}>{phrase}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  containerLight: { backgroundColor: '#e2e8f0' },
  containerDark: { backgroundColor: '#101A2F' },
  header: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  headerLight: { backgroundColor: '#fff', borderBottomColor: '#e2e8f0' },
  headerDark: { backgroundColor: '#1A2540', borderBottomColor: '#001A4D' },
  title: { fontSize: 16, fontWeight: '700' },
  titleLight: { color: '#232832' },
  titleDark: { color: '#F4F8FF' },
  subtitle: { marginTop: 2, fontSize: 12 },
  subtitleLight: { color: '#475569' },
  subtitleDark: { color: '#F4F8FF' },
  context: { marginTop: 2, fontSize: 11, fontWeight: '600' },
  contextLight: { color: '#2563eb' },
  contextDark: { color: '#0EC3C9' },
  thread: { paddingHorizontal: 10, paddingVertical: 12, gap: 8, flexGrow: 1 },
  row: { flexDirection: 'row' },
  rowSelf: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '84%', borderRadius: 14, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
  bubbleSelf: { backgroundColor: '#2563eb', borderBottomRightRadius: 4 },
  bubbleOtherLight: { backgroundColor: '#fff', borderBottomLeftRadius: 4 },
  bubbleOtherDark: { backgroundColor: '#001A4D', borderBottomLeftRadius: 4 },
  messageText: { fontSize: 14 },
  messageTextSelf: { color: '#fff' },
  attachmentWrap: { marginTop: 6 },
  attachmentImage: { width: 220, height: 220, borderRadius: 10, backgroundColor: '#0f172a' },
  attachmentLink: { marginTop: 4, fontSize: 13, textDecorationLine: 'underline' },
  messageTextLight: { color: '#232832' },
  messageTextDark: { color: '#F4F8FF' },
  time: { marginTop: 4, fontSize: 10, alignSelf: 'flex-end' },
  timeSelf: { color: '#dbeafe' },
  timeLight: { color: '#64748b' },
  timeDark: { color: '#F4F8FF' },
  composer: { gap: 8, paddingHorizontal: 10, paddingVertical: 10, borderTopWidth: 1 },
  composerLight: { backgroundColor: '#fff', borderTopColor: '#e2e8f0' },
  composerDark: { backgroundColor: '#1A2540', borderTopColor: '#001A4D' },
  input: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  inputLight: { borderColor: '#cbd5e1', color: '#232832', backgroundColor: '#fff' },
  inputDark: { borderColor: '#001A4D', color: '#F4F8FF', backgroundColor: '#1A2540' },
  sendButton: { backgroundColor: '#2563eb', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  sendButtonDisabled: { opacity: 0.45 },
  sendText: { color: '#fff', fontWeight: '700' },
  composerTools: { flexDirection: 'row', gap: 8 },
  toolButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  toolButtonLight: { borderColor: '#cbd5e1', backgroundColor: '#fff' },
  toolButtonDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  toolButtonActive: { borderColor: '#0EC3C9' },
  toolIcon: { fontSize: 16 },
  pendingAttachmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pendingAttachmentChip: { borderRadius: 999, borderWidth: 1, borderColor: '#3b82f6', paddingHorizontal: 10, paddingVertical: 4 },
  pendingAttachmentText: { color: '#1e3a8a', fontSize: 12, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  picker: { borderRadius: 12, padding: 8, borderWidth: 1, gap: 8 },
  pickerLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  pickerDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  pickerChip: { borderRadius: 999, borderWidth: 1, borderColor: '#3b82f6', paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start' },
  pickerChipText: { fontSize: 12, fontWeight: '600' },
  pickerChipTextLight: { color: '#1e3a8a' },
  pickerChipTextDark: { color: '#BFDBFE' },
  emojiChip: { paddingHorizontal: 8, paddingVertical: 6 },
  emojiText: { fontSize: 22 },
  voiceHint: { fontSize: 12, fontWeight: '600' },
  voiceHintLight: { color: '#1e3a8a' },
  voiceHintDark: { color: '#93c5fd' },
  voicePhraseRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

});