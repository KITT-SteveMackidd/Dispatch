import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';
import { buildChatThreadId, markTeamChatRead, sendChatMessage, watchChatMessages } from '@/services/dispatch';

type ChatMessage = {
  id: string;
  senderId: string;
  text: string;
  at: string;
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

  const canSend = draft.trim().length > 0;
  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || !profile || !threadId) return;

    const recipientIds = isTeamBroadcast
      ? memberIds.filter((id) => id !== profile.uid)
      : [workerId].filter((id) => id && id !== profile.uid);

    await sendChatMessage({
      threadId,
      teamId,
      senderId: profile.uid,
      recipientIds,
      text,
    });

    setDraft('');
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
                <Text style={[styles.messageText, mine ? styles.messageTextSelf : isDarkMode ? styles.messageTextDark : styles.messageTextLight]}>{message.text}</Text>
                <Text style={[styles.time, mine ? styles.timeSelf : isDarkMode ? styles.timeDark : styles.timeLight]}>{message.at}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={[styles.composer, isDarkMode ? styles.composerDark : styles.composerLight]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={isTeamBroadcast ? 'Message the whole team…' : 'Type a message…'}
          placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
          style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
          returnKeyType="send"
          onSubmitEditing={sendMessage}
        />
        <Pressable style={[styles.sendButton, !canSend && styles.sendButtonDisabled]} onPress={sendMessage} disabled={!canSend}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  containerLight: { backgroundColor: '#e2e8f0' },
  containerDark: { backgroundColor: '#181B24' },
  header: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  headerLight: { backgroundColor: '#fff', borderBottomColor: '#e2e8f0' },
  headerDark: { backgroundColor: '#232832', borderBottomColor: '#1e293b' },
  title: { fontSize: 16, fontWeight: '700' },
  titleLight: { color: '#232832' },
  titleDark: { color: '#f8fafc' },
  subtitle: { marginTop: 2, fontSize: 12 },
  subtitleLight: { color: '#475569' },
  subtitleDark: { color: '#94a3b8' },
  context: { marginTop: 2, fontSize: 11, fontWeight: '600' },
  contextLight: { color: '#2563eb' },
  contextDark: { color: '#93c5fd' },
  thread: { paddingHorizontal: 10, paddingVertical: 12, gap: 8, flexGrow: 1 },
  row: { flexDirection: 'row' },
  rowSelf: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '84%', borderRadius: 14, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
  bubbleSelf: { backgroundColor: '#2563eb', borderBottomRightRadius: 4 },
  bubbleOtherLight: { backgroundColor: '#fff', borderBottomLeftRadius: 4 },
  bubbleOtherDark: { backgroundColor: '#1e293b', borderBottomLeftRadius: 4 },
  messageText: { fontSize: 14 },
  messageTextSelf: { color: '#fff' },
  messageTextLight: { color: '#232832' },
  messageTextDark: { color: '#e2e8f0' },
  time: { marginTop: 4, fontSize: 10, alignSelf: 'flex-end' },
  timeSelf: { color: '#dbeafe' },
  timeLight: { color: '#64748b' },
  timeDark: { color: '#94a3b8' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10, borderTopWidth: 1 },
  composerLight: { backgroundColor: '#fff', borderTopColor: '#e2e8f0' },
  composerDark: { backgroundColor: '#232832', borderTopColor: '#1e293b' },
  input: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  inputLight: { borderColor: '#cbd5e1', color: '#232832', backgroundColor: '#fff' },
  inputDark: { borderColor: '#334155', color: '#e2e8f0', backgroundColor: '#232832' },
  sendButton: { backgroundColor: '#2563eb', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  sendButtonDisabled: { opacity: 0.45 },
  sendText: { color: '#fff', fontWeight: '700' },
});