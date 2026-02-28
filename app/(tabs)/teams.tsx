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
      <Text style={styles.subhead}>Manage Your Team</Text>

      <FlatList
        data={teams}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={styles.empty}>No teams found yet. Tap Add Demo Team Data.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.name}</Text>
              <Text style={styles.meta}>{item.workerIds.length} workers</Text>
            </View>
            <Text style={styles.status}>{eventCountsByTeam.get(item.id) ?? 0} events</Text>
          </Pressable>
        )}
      />

      <Pressable style={styles.addBtn} onPress={handleSeedDemo} disabled={seeding || !profile}>
        {seeding ? <ActivityIndicator color="white" /> : <Text style={styles.addText}>+ Add Demo Team Data</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eef2ff', padding: 16 },
  subhead: { color: '#334155', fontWeight: '600', marginBottom: 12 },
  empty: { marginTop: 20, color: '#64748b' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: '#1d4ed8' },
  title: { color: '#0f172a', fontWeight: '700', fontSize: 16 },
  meta: { color: '#64748b', marginTop: 2, fontSize: 12 },
  status: { color: '#475569', fontSize: 12, fontWeight: '600' },
  addBtn: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  addText: { color: 'white', fontWeight: '700' },
});
