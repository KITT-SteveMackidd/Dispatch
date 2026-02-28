import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/context/session';
import { watchManagerEvents, watchWorkerEvents } from '@/services/dispatch';
import { DispatchEvent } from '@/types/dispatch';

export default function TodayScreen() {
  const { profile } = useSession();
  const [events, setEvents] = useState<DispatchEvent[]>([]);

  useEffect(() => {
    if (!profile) return;
    return profile.role === 'manager'
      ? watchManagerEvents(profile.uid, setEvents)
      : watchWorkerEvents(profile.uid, setEvents);
  }, [profile]);

  const today = useMemo(() => {
    const now = new Date();
    return events.filter((e) => new Date(e.startsAt).toDateString() === now.toDateString());
  }, [events]);

  const badge = (event: DispatchEvent) => {
    const total = event.roles.flatMap((r) => r.tasks).length;
    const done = event.roles.flatMap((r) => r.tasks).filter((t) => (t.completedBy?.length ?? 0) > 0).length;
    if (done === total && total > 0) return { text: 'On Track', bg: '#dcfce7', fg: '#15803d' };
    if (done === 0) return { text: 'Pending', bg: '#dbeafe', fg: '#1d4ed8' };
    return { text: `${Math.max(total - done, 1)} Tasks Behind`, bg: '#ffedd5', fg: '#c2410c' };
  };

  return (
    <View style={styles.container}>
      <Text style={styles.subhead}>You have {today.length} active dispatches.</Text>
      <FlatList
        data={today}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingTop: 10 }}
        ListEmptyComponent={<Text style={styles.empty}>No dispatches for today.</Text>}
        renderItem={({ item }) => {
          const b = badge(item);
          return (
            <Pressable style={styles.card}>
              <Text style={styles.title}>{item.name}</Text>
              <View style={[styles.badge, { backgroundColor: b.bg }]}>
                <Text style={[styles.badgeText, { color: b.fg }]}>{b.text}</Text>
              </View>
              <Text style={styles.meta}>Due by {new Date(item.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eef2ff', padding: 16 },
  subhead: { color: '#475569', fontWeight: '500' },
  empty: { marginTop: 20, color: '#64748b' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  title: { color: '#0f172a', fontWeight: '700', fontSize: 20, marginBottom: 8 },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  badgeText: { fontWeight: '700', fontSize: 12 },
  meta: { color: '#64748b', fontSize: 12 },
});
