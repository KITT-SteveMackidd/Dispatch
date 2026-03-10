import { useLocalSearchParams } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';
import { db } from '@/lib/firebase';
import { DispatchEvent } from '@/types/dispatch';

export default function EventDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
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
      <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
        <Text style={[styles.empty, isDarkMode ? styles.emptyDark : styles.emptyLight]}>Event not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]} contentContainerStyle={{ padding: 16 }}>
      <View style={[styles.hero, isDarkMode ? styles.heroDark : styles.heroLight]}>
        <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>{event.name}</Text>
        <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>{event.location}</Text>
        <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>Starts: {new Date(event.startsAt).toLocaleString()}</Text>

        <View style={[styles.progressWrap, isDarkMode ? styles.progressWrapDark : styles.progressWrapLight]}>
          <View style={[styles.progressFill, { width: `${completion.pct}%` }]} />
        </View>
        <Text style={[styles.progressText, isDarkMode ? styles.progressTextDark : styles.progressTextLight]}>
          {completion.done}/{completion.total} tasks complete ({completion.pct}%)
        </Text>
      </View>

      {event.roles.map((role) => (
        <View key={role.id} style={[styles.section, isDarkMode ? styles.sectionDark : styles.sectionLight]}>
          <Text style={[styles.role, isDarkMode ? styles.roleDark : styles.roleLight]}>{role.name}</Text>
          <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>
            Assigned: {role.assignedWorkerIds.length} · Open Slots: {role.openSlots}
          </Text>

          {role.tasks.map((task) => {
            const doneCount = task.completedBy?.length ?? 0;
            const doneByMe = !!profile && (task.completedBy ?? []).includes(profile.uid);
            return (
              <View key={task.id} style={[styles.taskRow, isDarkMode ? styles.taskRowDark : styles.taskRowLight]}>
                <Text style={[styles.task, isDarkMode ? styles.taskDark : styles.taskLight]}>
                  {task.name}
                  {task.optional ? ' (optional)' : ''}
                </Text>
                <Text style={[styles.taskStatus, isDarkMode ? styles.taskStatusDark : styles.taskStatusLight, doneByMe && styles.taskStatusMine]}>
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
  container: { flex: 1 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#020617' },
  empty: { padding: 24 },
  emptyLight: { color: '#64748b' },
  emptyDark: { color: '#94a3b8' },
  hero: { borderRadius: 16, borderWidth: 1, padding: 16 },
  heroLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  heroDark: { backgroundColor: '#0f172a', borderColor: '#1e293b' },
  title: { fontSize: 28, fontWeight: '700' },
  titleLight: { color: '#0f172a' },
  titleDark: { color: '#f8fafc' },
  meta: { marginTop: 4 },
  metaLight: { color: '#64748b' },
  metaDark: { color: '#94a3b8' },
  progressWrap: { height: 8, borderRadius: 999, marginTop: 14, overflow: 'hidden' },
  progressWrapLight: { backgroundColor: '#e2e8f0' },
  progressWrapDark: { backgroundColor: '#334155' },
  progressFill: { height: 8, backgroundColor: '#2563eb' },
  progressText: { marginTop: 8, fontWeight: '600' },
  progressTextLight: { color: '#334155' },
  progressTextDark: { color: '#cbd5e1' },
  section: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  sectionLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  sectionDark: { backgroundColor: '#0f172a', borderColor: '#1e293b' },
  role: { fontSize: 16, fontWeight: '700' },
  roleLight: { color: '#0f172a' },
  roleDark: { color: '#f8fafc' },
  taskRow: { marginTop: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  taskRowLight: { borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  taskRowDark: { borderColor: '#334155', backgroundColor: '#111827' },
  task: { fontSize: 13 },
  taskLight: { color: '#1e293b' },
  taskDark: { color: '#e2e8f0' },
  taskStatus: { fontSize: 12, marginTop: 4, fontWeight: '600' },
  taskStatusLight: { color: '#64748b' },
  taskStatusDark: { color: '#94a3b8' },
  taskStatusMine: { color: '#22c55e' },
});
