import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/context/session';
import { loadWorkerTeams, seedDemoData, watchManagerEvents, watchManagerTeams, watchWorkerEvents } from '@/services/dispatch';
import { DispatchEvent, Team } from '@/types/dispatch';

export default function TeamsScreen() {
  const { profile } = useSession();
  const [teams, setTeams] = useState<Team[]>([]);
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (!profile) return;

    if (profile.role === 'manager') {
      const unsubTeams = watchManagerTeams(profile.uid, setTeams);
      const unsubEvents = watchManagerEvents(profile.uid, setEvents);
      return () => {
        unsubTeams();
        unsubEvents();
      };
    }

    const unsubEvents = watchWorkerEvents(profile.uid, setEvents);
    loadWorkerTeams(profile.uid).then(setTeams).catch(() => setTeams([]));
    return unsubEvents;
  }, [profile]);

  const eventCountsByTeam = useMemo(() => {
    const counts = new Map<string, number>();
    events.forEach((event) => {
      event.teamIds.forEach((teamId) => {
        counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
      });
    });
    return counts;
  }, [events]);

  const handleSeedDemo = async () => {
    if (!profile) return;
    setSeeding(true);
    try {
      await seedDemoData(profile);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Teams & Chat</Text>
      <Text style={styles.info}>
        {profile?.role === 'worker'
          ? 'Your assigned teams and linked event load are listed below.'
          : 'Team roster and event load for your operation.'}
      </Text>

      <Pressable style={styles.seedBtn} onPress={handleSeedDemo} disabled={seeding || !profile}>
        {seeding ? <ActivityIndicator color="#052e24" /> : <Text style={styles.seedText}>Load Demo Data</Text>}
      </Pressable>

      <FlatList
        data={teams}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={styles.empty}>No teams found yet for this profile.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card}>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.meta}>{item.workerIds.length} workers</Text>
            <Text style={styles.badge}>{eventCountsByTeam.get(item.id) ?? 0} linked events</Text>
            <Text style={styles.small}>Team chat stream is next: wiring eventChats/{'{eventId}'}/messages in upcoming build step.</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1020', padding: 16 },
  header: { color: 'white', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  info: { color: '#9aa7d1', marginBottom: 10 },
  seedBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#6ee7b7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  seedText: { color: '#052e24', fontWeight: '700' },
  empty: { color: '#9aa7d1', paddingTop: 24 },
  card: { backgroundColor: '#131c37', padding: 14, borderRadius: 14, marginBottom: 10 },
  title: { color: 'white', fontWeight: '700', fontSize: 16 },
  meta: { color: '#9aa7d1', marginTop: 3 },
  badge: { marginTop: 6, color: '#4dd0a0', fontWeight: '600' },
  small: { marginTop: 8, color: '#8c9ac8', fontSize: 12 },
});
