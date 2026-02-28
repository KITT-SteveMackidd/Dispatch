import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/context/session';
import { toggleTaskCompletion, watchManagerEvents, watchWorkerEvents } from '@/services/dispatch';
import { DispatchEvent } from '@/types/dispatch';

export default function TodayScreen() {
  const { profile } = useSession();
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    const unsub =
      profile.role === 'manager'
        ? watchManagerEvents(profile.uid, setEvents)
        : watchWorkerEvents(profile.uid, setEvents);
    return unsub;
  }, [profile]);

  const today = useMemo(() => {
    const now = new Date();
    return events.filter((e) => {
      const d = new Date(e.startsAt);
      return d.toDateString() === now.toDateString();
    });
  }, [events]);

  const roleTaskRows = (event: DispatchEvent) =>
    event.roles.flatMap((role) => role.tasks.map((task) => ({ roleId: role.id, task })));

  const onToggle = async (event: DispatchEvent, roleId: string, taskId: string, complete: boolean) => {
    if (!profile) return;
    const key = `${event.id}:${roleId}:${taskId}`;
    setSavingKey(key);
    try {
      await toggleTaskCompletion({
        eventId: event.id,
        roleId,
        taskId,
        workerId: profile.uid,
        complete,
      });
    } catch (error) {
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Unable to update task.');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Today's Events</Text>
      <FlatList
        data={today}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={styles.empty}>No events scheduled for today.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Pressable onPress={() => setOpenEventId(openEventId === item.id ? null : item.id)}>
              <Text style={styles.title}>{item.name}</Text>
              <Text style={styles.meta}>{item.location}</Text>
            </Pressable>

            {openEventId === item.id ? (
              <View style={{ marginTop: 12 }}>
                {roleTaskRows(item).map(({ roleId, task }) => {
                  const doneByMe = !!profile && (task.completedBy ?? []).includes(profile.uid);
                  const key = `${item.id}:${roleId}:${task.id}`;
                  const busy = savingKey === key;
                  return (
                    <Pressable
                      key={task.id}
                      style={[styles.task, doneByMe && styles.taskDone]}
                      onPress={() => onToggle(item, roleId, task.id, !doneByMe)}>
                      <View style={styles.taskRow}>
                        <Text style={[styles.taskText, doneByMe && styles.taskDoneText]}>{doneByMe ? '☑' : '☐'} {task.name}</Text>
                        {busy ? <ActivityIndicator size="small" color="#a7f3d0" /> : null}
                      </View>
                      <Text style={styles.taskMeta}>
                        {(task.completedBy?.length ?? 0)} completed
                        {task.dueAt ? ` · Due: ${new Date(task.dueAt).toLocaleTimeString()}` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
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
  task: { backgroundColor: '#0f1730', borderRadius: 10, padding: 10, marginBottom: 8 },
  taskDone: { backgroundColor: '#0f2a22', borderWidth: 1, borderColor: '#1f8f6f' },
  taskRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  taskText: { color: '#e6ecff', fontWeight: '600' },
  taskDoneText: { color: '#a7f3d0' },
  taskMeta: { color: '#8c9ac8', fontSize: 12, marginTop: 3 },
});
