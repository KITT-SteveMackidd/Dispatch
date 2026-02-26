import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/context/session';
import { watchManagerEvents, watchWorkerEvents } from '@/services/dispatch';
import { DispatchEvent } from '@/types/dispatch';

export default function TodayScreen() {
  const { profile } = useSession();
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [openEventId, setOpenEventId] = useState<string | null>(null);

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
                {item.roles.flatMap((r) => r.tasks).map((task) => (
                  <Pressable
                    key={task.id}
                    style={styles.task}
                    onPress={() => Alert.alert('Task update', `${task.name} marked complete (wire Firestore update in next iteration).`)}>
                    <Text style={styles.taskText}>☐ {task.name}</Text>
                    {task.dueAt ? <Text style={styles.taskMeta}>Due: {new Date(task.dueAt).toLocaleTimeString()}</Text> : null}
                  </Pressable>
                ))}
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
  taskText: { color: '#e6ecff', fontWeight: '600' },
  taskMeta: { color: '#8c9ac8', fontSize: 12, marginTop: 3 },
});
