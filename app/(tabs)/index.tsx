import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { watchManagerEvents, watchWorkerEvents } from '@/services/dispatch';
import { DispatchEvent } from '@/types/dispatch';

export default function DispatchesScreen() {
  const router = useRouter();
  const { profile } = useSession();
  const [events, setEvents] = useState<DispatchEvent[]>([]);

  useEffect(() => {
    if (!profile) return;
    return profile.role === 'manager'
      ? watchManagerEvents(profile.uid, setEvents)
      : watchWorkerEvents(profile.uid, setEvents);
  }, [profile]);

  const upcoming = useMemo(
    () => events.filter((e) => new Date(e.startsAt).getTime() >= Date.now()).sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt)),
    [events]
  );

  return (
    <View style={styles.container}>
      <Text style={styles.filter}>All Assignments ▾</Text>
      <FlatList
        data={upcoming}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={styles.empty}>No upcoming assignments.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/event/${item.id}`)}>
            <View style={styles.row}>
              <Text style={styles.title}>{item.name}</Text>
              <View style={styles.statusPill}><Text style={styles.statusText}>Upcoming</Text></View>
            </View>
            <Text style={styles.meta}>Due {new Date(item.startsAt).toLocaleString()}</Text>
            <Text style={styles.meta}>Assigned to: Team {item.teamIds[0] ? 'A' : '-'}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eef2ff', padding: 16 },
  filter: { color: '#334155', fontWeight: '600', marginBottom: 10 },
  empty: { marginTop: 20, color: '#64748b' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#0f172a', fontWeight: '700', fontSize: 20 },
  statusPill: { backgroundColor: '#e2e8f0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { color: '#475569', fontSize: 11, fontWeight: '700' },
  meta: { color: '#64748b', marginTop: 6, fontSize: 12 },
});
