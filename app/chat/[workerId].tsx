import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

type ChatMessage = {
  id: string;
  from: 'self' | 'other';
  text: string;
  at: string;
};

export default function WorkerChatScreen() {
  const [draft, setDraft] = useState('');
  const params = useLocalSearchParams<{
    workerId?: string;
    workerLabel?: string;
    eventName?: string;
    teamName?: string;
    teamMemberIds?: string;
    isTeamAll?: string;
  }>();
  const workerId = params.workerId ?? 'worker';
  const workerLabel = params.workerLabel ?? workerId;
  const isTeamBroadcast =
    params.isTeamAll === '1' || workerId.startsWith('all:') || workerId.startsWith('team:') || workerLabel.toLowerCase() === 'all';
  const broadcastCount = (params.teamMemberIds || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean).length;

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm1',
      from: 'other',
      text: isTeamBroadcast ? 'Ready for tonight. Send one update here and I’ll share with everyone.' : 'On-site and ready. Any priorities before start?',
      at: '09:14',
    },
    {
      id: 'm2',
      from: 'self',
      text: isTeamBroadcast ? 'Perfect. I’ll post updates here for the whole team.' : 'Yes — check booth setup first, then ping me with photos.',
      at: '09:16',
    },
  ]);

  const subtitle = useMemo(() => {
    if (isTeamBroadcast) return `Team broadcast${broadcastCount ? ` • ${broadcastCount} recipients` : ''}`;
    return 'Direct manager ↔ worker chat';
  }, [broadcastCount, isTeamBroadcast]);

  const canSend = draft.trim().length > 0;

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [
      ...prev,
      { id: `m-${Date.now()}`, from: 'self', text, at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
    ]);
    setDraft('');
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: workerLabel }} />

      <View style={styles.header}>
        <Text style={styles.title}>{workerLabel}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {params.teamName ? <Text style={styles.context}>Team: {params.teamName}</Text> : null}
        {params.eventName ? <Text style={styles.context}>Event: {params.eventName}</Text> : null}
      </View>

      <ScrollView contentContainerStyle={styles.thread} keyboardShouldPersistTaps="handled">
        {messages.map((message) => {
          const mine = message.from === 'self';
          return (
            <View key={message.id} style={[styles.row, mine ? styles.rowSelf : styles.rowOther]}>
              <View style={[styles.bubble, mine ? styles.bubbleSelf : styles.bubbleOther]}>
                <Text style={[styles.messageText, mine ? styles.messageTextSelf : styles.messageTextOther]}>{message.text}</Text>
                <Text style={[styles.time, mine ? styles.timeSelf : styles.timeOther]}>{message.at}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={isTeamBroadcast ? 'Message the whole team…' : 'Type a message…'}
          placeholderTextColor="#94a3b8"
          style={styles.input}
          multiline
          maxLength={1000}
          textAlignVertical="top"
        />
        <Pressable style={[styles.sendButton, !canSend && styles.sendButtonDisabled]} onPress={sendMessage} disabled={!canSend}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e2e8f0' },
  header: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, backgroundColor: '#fff', borderBottomColor: '#e2e8f0' },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  subtitle: { marginTop: 2, fontSize: 12, color: '#475569' },
  context: { marginTop: 2, fontSize: 11, color: '#2563eb', fontWeight: '600' },
  thread: { paddingHorizontal: 10, paddingVertical: 12, gap: 8, flexGrow: 1, justifyContent: 'flex-end' },
  row: { flexDirection: 'row' },
  rowSelf: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '84%', borderRadius: 16, paddingHorizontal: 11, paddingTop: 8, paddingBottom: 6 },
  bubbleSelf: { backgroundColor: '#2563eb', borderBottomRightRadius: 5 },
  bubbleOther: { backgroundColor: '#fff', borderBottomLeftRadius: 5 },
  messageText: { fontSize: 14, lineHeight: 19 },
  messageTextSelf: { color: '#fff' },
  messageTextOther: { color: '#0f172a' },
  time: { marginTop: 4, fontSize: 10, alignSelf: 'flex-end' },
  timeSelf: { color: '#dbeafe' },
  timeOther: { color: '#64748b' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 122,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    borderColor: '#cbd5e1',
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  sendButton: { backgroundColor: '#2563eb', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, minWidth: 66, alignItems: 'center' },
  sendButtonDisabled: { backgroundColor: '#cbd5e1' },
  sendText: { color: '#fff', fontWeight: '700' },
});