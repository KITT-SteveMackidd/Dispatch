import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { watchManagerEvents, watchWorkerEvents } from '@/services/dispatch';
import { DispatchEvent } from '@/types/dispatch';

type TaskProgress = {
  total: number;
  done: number;
  percent: number;
};

type WorkerSummary = {
  workerId: string;
  roleNames: string[];
};

function getWorkerSummaries(event: DispatchEvent): WorkerSummary[] {
  const map = new Map<string, WorkerSummary>();

  for (const role of event.roles) {
    for (const workerId of role.assignedWorkerIds || []) {
      const current = map.get(workerId) ?? { workerId, roleNames: [] };
      if (!current.roleNames.includes(role.name)) current.roleNames.push(role.name);
      map.set(workerId, current);
    }
  }

  return [...map.values()].sort((a, b) => a.workerId.localeCompare(b.workerId));
}

export default function TodayScreen() {
  const { profile } = useSession();
  const router = useRouter();
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!profile) return;
    return profile.role === 'manager' ? watchManagerEvents(profile.uid, setEvents) : watchWorkerEvents(profile.uid, setEvents);
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

  const toggleExpand = (eventId: string) => {
    setExpandedEventIds((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
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
          const formattedTime = new Date(item.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const isManager = profile?.role === 'manager';
          const isExpanded = !!expandedEventIds[item.id];
          const workers = isManager ? getWorkerSummaries(item) : [];

          return (
            <Pressable style={styles.card} onPress={() => (isManager ? toggleExpand(item.id) : undefined)}>
              <View style={styles.headerRow}>
                <Text style={styles.title}>{item.name}</Text>
                {isManager ? <Text style={styles.expandHint}>{isExpanded ? 'Hide' : 'Expand'}</Text> : null}
              </View>

              <Text style={styles.meta}>{item.location} • {formattedTime}</Text>

              {isManager ? (
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

              {isManager && isExpanded ? (
                <View style={styles.workerSection}>
                  {workers.length ? (
                    workers.map((worker) => {
                      const initial = worker.workerId.replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || 'W';
                      return (
                        <View key={worker.workerId} style={styles.workerCard}>
                          <Pressable
                            onPress={() => {
                              router.push({
                                pathname: '/chat/[workerId]',
                                params: { workerId: worker.workerId, workerLabel: worker.workerId, eventName: item.name },
                              });
                            }}
                            style={styles.avatar}
                            hitSlop={8}
                          >
                            <Text style={styles.avatarText}>{initial}</Text>
                          </Pressable>

                          <View style={styles.workerDetails}>
                            <Text style={styles.workerName}>{worker.workerId}</Text>
                            <Text style={styles.workerMeta}>Role: {worker.roleNames.join(', ')}</Text>
                          </View>
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.emptyWorkers}>No assigned workers yet.</Text>
                  )}
                </View>
              ) : null}
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#0f172a', fontWeight: '700', fontSize: 20, marginBottom: 6, flex: 1 },
  expandHint: { color: '#2563eb', fontSize: 12, fontWeight: '700', marginLeft: 8 },
  meta: { color: '#64748b', fontSize: 13 },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 10 },
  badgeText: { fontWeight: '700', fontSize: 12 },
  progressSection: { marginTop: 12 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { color: '#334155', fontWeight: '600', fontSize: 12 },
  progressCount: { color: '#334155', fontWeight: '700', fontSize: 12 },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#2563eb', borderRadius: 999 },
  workerSection: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10, gap: 10 },
  workerCard: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarText: { fontWeight: '700', color: '#1d4ed8' },
  workerDetails: { flex: 1 },
  workerName: { color: '#0f172a', fontWeight: '700', fontSize: 14 },
  workerMeta: { color: '#64748b', fontSize: 12, marginTop: 2 },
  emptyWorkers: { color: '#64748b', fontSize: 12 },
});
