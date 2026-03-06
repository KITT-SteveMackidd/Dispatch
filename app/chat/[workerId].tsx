import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlatList } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useThemeMode } from '@/context/theme';

type ChatMessage = {
  id: string;
  text: string;
  fromMe: boolean;
  timeLabel: string;
};

const nowTime = () =>
  new Date().toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

export default function WorkerChatScreen() {
  const params = useLocalSearchParams<{
    workerId?: string;
    workerLabel?: string;
    eventName?: string;
    teamName?: string;
    teamMemberIds?: string;
    isTeamAll?: string;
  }>();
  const { themeMode } = useThemeMode();
  const isDarkMode = themeMode === 'dark';

  const workerId = params.workerId ?? 'worker';
  const workerLabel = params.workerLabel ?? workerId;
  const isTeamBroadcast = params.isTeamAll === '1' || workerId.startsWith('all:') || workerId.startsWith('team:') || workerLabel.toLowerCase() === 'all';
  const broadcastCount = (params.teamMemberIds || '').split(',').map((id) => id.trim()).filter(Boolean).length;

  const [composer, setComposer] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'intro-1',
      text: isTeamBroadcast
        ? `Broadcast channel ready for ${params.teamName || 'this team'}.`
        : `You are now chatting with ${workerLabel}.`,
      fromMe: false,
      timeLabel: nowTime(),
    },
    {
      id: 'intro-2',
      text: isTeamBroadcast
        ? 'Type once and deliver to everyone in this team.'
        : 'Keep updates concise so task handoffs are clear.',
      fromMe: true,
      timeLabel: nowTime(),
    },
  ]);

  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 40);
    return () => clearTimeout(t);
  }, []);

  const palette = useMemo(
    () => ({
      screen: isDarkMode ? '#020617' : '#e5e7eb',
      headerBg: isDarkMode ? '#0f172a' : '#ffffff',
      headerBorder: isDarkMode ? '#1e293b' : '#dbe2ea',
      name: isDarkMode ? '#f8fafc' : '#0f172a',
      meta: isDarkMode ? '#94a3b8' : '#64748b',
      badgeBg: isDarkMode ? '#1e293b' : '#e2e8f0',
      badgeText: isDarkMode ? '#cbd5e1' : '#334155',
      incomingBubble: isDarkMode ? '#1e293b' : '#ffffff',
      incomingText: isDarkMode ? '#e2e8f0' : '#0f172a',
      outgoingBubble: isDarkMode ? '#0ea5e9' : '#2563eb',
      outgoingText: '#ffffff',
      time: isDarkMode ? '#94a3b8' : '#64748b',
      composerBg: isDarkMode ? '#0f172a' : '#ffffff',
      composerBorder: isDarkMode ? '#1e293b' : '#dbe2ea',
      inputBg: isDarkMode ? '#111827' : '#f8fafc',
      inputText: isDarkMode ? '#e2e8f0' : '#0f172a',
      placeholder: isDarkMode ? '#64748b' : '#94a3b8',
      sendBg: isDarkMode ? '#0284c7' : '#2563eb',
      sendBgDisabled: isDarkMode ? '#1f2937' : '#cbd5e1',
      sendTextDisabled: isDarkMode ? '#64748b' : '#94a3b8',
    }),
    [isDarkMode]
  );

  const sendMessage = () => {
    const text = composer.trim();
    if (!text) return;

    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}`,
        text,
        fromMe: true,
        timeLabel: nowTime(),
      },
    ]);
    setComposer('');

    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: palette.screen }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <Stack.Screen options={{ title: workerLabel }} />

      <View style={[styles.conversationHeader, { backgroundColor: palette.headerBg, borderColor: palette.headerBorder }]}> 
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{isTeamBroadcast ? 'All' : workerLabel.slice(0, 1).toUpperCase()}</Text>
        </View>

        <View style={styles.headerCopy}>
          <Text style={[styles.headerName, { color: palette.name }]} numberOfLines={1}>{workerLabel}</Text>
          <Text style={[styles.headerMeta, { color: palette.meta }]} numberOfLines={1}>
            {isTeamBroadcast
              ? `Broadcast to ${broadcastCount || 0} member${broadcastCount === 1 ? '' : 's'}`
              : 'Direct conversation'}
          </Text>
          {params.teamName ? (
            <Text style={[styles.contextLine, { color: palette.badgeText, backgroundColor: palette.badgeBg }]} numberOfLines={1}>
              Team: {params.teamName}
            </Text>
          ) : null}
          {params.eventName ? (
            <Text style={[styles.contextLine, { color: palette.badgeText, backgroundColor: palette.badgeBg }]} numberOfLines={1}>
              Event: {params.eventName}
            </Text>
          ) : null}
        </View>
      </View>

      <FlatList
        ref={listRef}
        style={styles.thread}
        contentContainerStyle={styles.threadContent}
        data={messages}
        keyExtractor={(item) => item.id}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={[styles.bubbleRow, item.fromMe ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
            <View
              style={[
                styles.bubble,
                {
                  backgroundColor: item.fromMe ? palette.outgoingBubble : palette.incomingBubble,
                  borderColor: item.fromMe ? 'transparent' : palette.headerBorder,
                },
              ]}
            >
              <Text style={[styles.bubbleText, { color: item.fromMe ? palette.outgoingText : palette.incomingText }]}>{item.text}</Text>
              <Text style={[styles.timeLabel, { color: item.fromMe ? 'rgba(255,255,255,0.85)' : palette.time }]}>{item.timeLabel}</Text>
            </View>
          </View>
        )}
      />

      <View style={[styles.composerShell, { backgroundColor: palette.composerBg, borderColor: palette.composerBorder }]}> 
        <TextInput
          value={composer}
          onChangeText={setComposer}
          placeholder={isTeamBroadcast ? 'Message everyone…' : 'Type a message…'}
          placeholderTextColor={palette.placeholder}
          style={[styles.input, { backgroundColor: palette.inputBg, color: palette.inputText, borderColor: palette.composerBorder }]}
          multiline
          maxLength={1000}
        />
        <Pressable
          style={[styles.sendButton, { backgroundColor: composer.trim() ? palette.sendBg : palette.sendBgDisabled }]}
          onPress={sendMessage}
          disabled={!composer.trim()}
        >
          <Text style={[styles.sendText, !composer.trim() && { color: palette.sendTextDisabled }]}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  conversationHeader: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    gap: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerName: {
    fontSize: 17,
    fontWeight: '700',
  },
  headerMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  contextLine: {
    marginTop: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '700',
  },
  thread: {
    flex: 1,
  },
  threadContent: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 4,
    gap: 8,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
  bubbleRowTheirs: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 20,
  },
  timeLabel: {
    marginTop: 4,
    fontSize: 11,
    alignSelf: 'flex-end',
  },
  composerShell: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  sendButton: {
    height: 40,
    minWidth: 62,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  sendText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
