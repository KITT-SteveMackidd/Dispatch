import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/context/session';
import { watchManagerEvents, watchWorkerEvents } from '@/services/dispatch';
import { DispatchEvent } from '@/types/dispatch';

type TaskProgress = {
  total: number;
  done: number;
  percent: number;
};

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

  const getProgress = (event: DispatchEvent): TaskProgress => {
    const tasks = event.roles.flatMap((r) => r.tasks);
    const total = tasks.length;
    const done = tasks.filter((t) => (t.completedBy?.length ?? 0) > 0).length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    return { total, done, percent };
  };

  const badge = (progress: TaskProgress) => {
    const { total, done } = progress;
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
          const progress = getProgress(item);
          const b = badge(progress);
          const formattedTime = new Date(item.startsAt).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          });

          return (
            <Pressable style={styles.card}>
              <Text style={styles.title}>{item.name}</Text>
              <Text style={styles.meta}>{item.location} • {formattedTime}</Text>

              {profile?.role === 'manager' ? (
                <View style={styles.progressSection}>
                  <View style={styles.progressHeader}>
                    <Text style={styles.progressLabel}>Task progress</Text>
                    <Text style={styles.progressCount}>{progress.done}/{progress.total}</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${progress.percent}%` }]} />
                  </View>
                </View>
              ) : (
                <View style={[styles.badge, { backgroundColor: b.bg }]}>
                  <Text style={[styles.badgeText, { color: b.fg }]}>{b.text}</Text>
                </View>
              )}
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
  title: { color: '#0f172a', fontWeight: '700', fontSize: 20, marginBottom: 6 },
  meta: { color: '#64748b', fontSize: 13 },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 10 },
  badgeText: { fontWeight: '700', fontSize: 12 },
  progressSection: { marginTop: 12 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { color: '#334155', fontWeight: '600', fontSize: 12 },
  progressCount: { color: '#334155', fontWeight: '700', fontSize: 12 },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 999,
  },
});
