import { Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function WorkerChatScreen() {
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
  const isTeamBroadcast = params.isTeamAll === '1' || workerId.startsWith('all:') || workerId.startsWith('team:') || workerLabel.toLowerCase() === 'all';
  const broadcastCount = (params.teamMemberIds || '').split(',').map((id) => id.trim()).filter(Boolean).length;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `Chat: ${workerLabel}` }} />

      <Text style={styles.title}>{workerLabel}</Text>
      <Text style={styles.subtitle}>{isTeamBroadcast ? 'Team broadcast thread' : 'Direct manager ↔ worker thread'}</Text>

      {params.eventName ? <Text style={styles.context}>From Today event: {params.eventName}</Text> : null}
      {params.teamName ? (
        <Text style={styles.context}>
          Team: {params.teamName}{isTeamBroadcast && broadcastCount ? ` (${broadcastCount} recipients)` : ''}
        </Text>
      ) : null}

      <View style={styles.mockThread}>
        <Text style={styles.mockMessageLabel}>Thread</Text>
        <Text style={styles.mockMessage}>
          {isTeamBroadcast
            ? `Send a single message to all members of ${params.teamName || 'this team'}.`
            : `Start coordinating with ${workerLabel} for this event.`}
        </Text>
      </View>

      <Pressable style={styles.sendButton}>
        <Text style={styles.sendText}>Compose message</Text>
      </Pressable>

      <Text style={styles.meta}>Worker id: {workerId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#eef2ff',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#475569',
  },
  context: {
    marginTop: 10,
    color: '#1d4ed8',
    fontWeight: '600',
  },
  mockThread: {
    marginTop: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
  },
  mockMessageLabel: {
    color: '#64748b',
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 8,
  },
  mockMessage: {
    color: '#0f172a',
    fontSize: 14,
  },
  sendButton: {
    marginTop: 14,
    alignSelf: 'flex-start',
    borderRadius: 10,
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendText: {
    color: '#fff',
    fontWeight: '700',
  },
  meta: {
    marginTop: 12,
    color: '#64748b',
    fontSize: 12,
  },
});
