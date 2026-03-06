import { Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '@/context/theme';

export default function WorkerChatScreen() {
  const { themeMode } = useThemeMode();
  const isDarkMode = themeMode === 'dark';
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
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <Stack.Screen options={{ title: `Chat: ${workerLabel}` }} />

      <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>{workerLabel}</Text>
      <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>{isTeamBroadcast ? 'Team broadcast thread' : 'Direct manager ↔ worker thread'}</Text>

      {params.eventName ? <Text style={[styles.context, isDarkMode ? styles.contextDark : styles.contextLight]}>From Today event: {params.eventName}</Text> : null}
      {params.teamName ? (
        <Text style={[styles.context, isDarkMode ? styles.contextDark : styles.contextLight]}>
          Team: {params.teamName}{isTeamBroadcast && broadcastCount ? ` (${broadcastCount} recipients)` : ''}
        </Text>
      ) : null}

      <View style={[styles.mockThread, isDarkMode ? styles.mockThreadDark : styles.mockThreadLight]}>
        <Text style={[styles.mockMessageLabel, isDarkMode ? styles.mockMessageLabelDark : styles.mockMessageLabelLight]}>Thread</Text>
        <Text style={[styles.mockMessage, isDarkMode ? styles.mockMessageDark : styles.mockMessageLight]}>
          {isTeamBroadcast
            ? `Send a single message to all members of ${params.teamName || 'this team'}.`
            : `Start coordinating with ${workerLabel} for this event.`}
        </Text>
      </View>

      <Pressable style={styles.sendButton}>
        <Text style={styles.sendText}>Compose message</Text>
      </Pressable>

      <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>Worker id: {workerId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#020617' },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  titleLight: { color: '#0f172a' },
  titleDark: { color: '#f8fafc' },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
  },
  subtitleLight: { color: '#475569' },
  subtitleDark: { color: '#94a3b8' },
  context: {
    marginTop: 10,
    fontWeight: '600',
  },
  contextLight: { color: '#1d4ed8' },
  contextDark: { color: '#93c5fd' },
  mockThread: {
    marginTop: 18,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  mockThreadLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  mockThreadDark: { backgroundColor: '#0f172a', borderColor: '#1e293b' },
  mockMessageLabel: {
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 8,
  },
  mockMessageLabelLight: { color: '#64748b' },
  mockMessageLabelDark: { color: '#94a3b8' },
  mockMessage: {
    fontSize: 14,
  },
  mockMessageLight: { color: '#0f172a' },
  mockMessageDark: { color: '#e2e8f0' },
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
    fontSize: 12,
  },
  metaLight: { color: '#64748b' },
  metaDark: { color: '#94a3b8' },
});