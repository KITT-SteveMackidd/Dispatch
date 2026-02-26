import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { watchManagerEvents, watchWorkerEvents } from '@/services/dispatch';
import { DispatchEvent } from '@/types/dispatch';

export default function UpcomingScreen() {
  const router = useRouter();
  const { profile } = useSession();
  const [events, setEvents] = useState<DispatchEvent[]>([]);

  useEffect(() => {
    if (!profile) return;
    const unsub =
      profile.role === 'manager'
        ? watchManagerEvents(profile.uid, setEvents)
        : watchWorkerEvents(profile.uid, setEvents);
    return unsub;
  }, [profile]);

  const upcoming = useMemo(
    () => events.filter((e) => new Date(e.startsAt).getTime() >= Date.now()).sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt)),
    [events]
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Upcoming Events</Text>
      <FlatList
        data={upcoming}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={styles.empty}>No upcoming events yet.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/event/${item.id}`)}>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.meta}>{item.location}</Text>
            <Text style={styles.meta}>{new Date(item.startsAt).toLocaleString()}</Text>
            <Text style={styles.badge}>{item.roles.length} roles</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1020', padding: 16 },
  header: { color: 'white', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  empty: { color: '#9aa7d1', paddingTop: 24 },
  card: { backgroundColor: '#131c37', padding: 14, borderRadius: 14, marginBottom: 10 },
  title: { color: 'white', fontWeight: '700', fontSize: 16 },
  meta: { color: '#9aa7d1', marginTop: 3 },
  badge: { marginTop: 8, color: '#4dd0a0', fontWeight: '600' },
});
