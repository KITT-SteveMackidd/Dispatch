import { useLocalSearchParams } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/context/session';
import { db } from '@/lib/firebase';
import { DispatchEvent } from '@/types/dispatch';

export default function EventDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useSession();
  const [event, setEvent] = useState<DispatchEvent | null>(null);

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, 'events', id), (snap) => {
      if (!snap.exists()) return setEvent(null);
      setEvent({ id: snap.id, ...(snap.data() as Omit<DispatchEvent, 'id'>) });
    });
    return unsub;
  }, [id]);

  const completion = useMemo(() => {
    if (!event) return { done: 0, total: 0, pct: 0 };
    const allTasks = event.roles.flatMap((r) => r.tasks);
    const done = allTasks.filter((t) => (t.completedBy?.length ?? 0) > 0).length;
    const total = allTasks.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { done, total, pct };
  }, [event]);

  if (!event) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>Event not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.card}>
        <Text style={styles.title}>{event.name}</Text>
        <Text style={styles.meta}>{event.location}</Text>
        <Text style={styles.meta}>Starts: {new Date(event.startsAt).toLocaleString()}</Text>

        <View style={styles.progressWrap}>
          <View style={[styles.progressFill, { width: `${completion.pct}%` }]} />
        </View>
        <Text style={styles.progressText}>{completion.done}/{completion.total} tasks complete ({completion.pct}%)</Text>
      </View>

      {event.roles.map((role) => (
        <View key={role.id} style={styles.section}>
          <Text style={styles.role}>{role.name}</Text>
          <Text style={styles.meta}>Assigned: {role.assignedWorkerIds.length} · Open Slots: {role.openSlots}</Text>

          {role.tasks.map((task) => {
            const doneCount = task.completedBy?.length ?? 0;
            const doneByMe = !!profile && (task.completedBy ?? []).includes(profile.uid);
            return (
              <View key={task.id} style={styles.taskRow}>
                <Text style={styles.task}>• {task.name}{task.optional ? ' (optional)' : ''}</Text>
                <Text style={[styles.taskStatus, doneByMe && styles.taskStatusMine]}>
                  {doneByMe ? 'You completed this' : `${doneCount} complete`}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eef2ff' },
  empty: { color: '#64748b', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 14 },
  title: { color: '#0f172a', fontSize: 24, fontWeight: '700' },
  meta: { color: '#64748b', marginTop: 4 },
  progressWrap: { height: 8, borderRadius: 999, backgroundColor: '#e2e8f0', marginTop: 12, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: '#2563eb' },
  progressText: { color: '#334155', marginTop: 8, fontWeight: '600' },
  section: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' },
  role: { color: '#0f172a', fontSize: 16, fontWeight: '700' },
  taskRow: { marginTop: 8 },
  task: { color: '#1e293b' },
  taskStatus: { color: '#64748b', fontSize: 12, marginTop: 2 },
  taskStatusMine: { color: '#15803d' },
});
