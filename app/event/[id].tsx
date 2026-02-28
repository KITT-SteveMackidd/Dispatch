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
    if (!event) return { done: 0, total: 0 };
    const allTasks = event.roles.flatMap((r) => r.tasks);
    const done = allTasks.filter((t) => (t.completedBy?.length ?? 0) > 0).length;
    return { done, total: allTasks.length };
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
      <Text style={styles.title}>{event.name}</Text>
      <Text style={styles.meta}>{event.location}</Text>
      <Text style={styles.meta}>Starts: {new Date(event.startsAt).toLocaleString()}</Text>
      <Text style={styles.progress}>{completion.done}/{completion.total} tasks have at least one completion</Text>

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
                  {doneByMe ? 'You done this' : `${doneCount} complete`}
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
  container: { flex: 1, backgroundColor: '#0b1020' },
  empty: { color: '#9aa7d1', padding: 24 },
  title: { color: 'white', fontSize: 24, fontWeight: '700' },
  meta: { color: '#9aa7d1', marginTop: 4 },
  progress: { color: '#4dd0a0', marginTop: 8, fontWeight: '600' },
  section: { marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: '#131c37' },
  role: { color: 'white', fontSize: 16, fontWeight: '700' },
  taskRow: { marginTop: 6 },
  task: { color: '#d7defa' },
  taskStatus: { color: '#8c9ac8', fontSize: 12, marginTop: 2 },
  taskStatusMine: { color: '#a7f3d0' },
});
