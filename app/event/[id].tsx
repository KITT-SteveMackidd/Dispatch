import { useLocalSearchParams } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { db } from '@/lib/firebase';
import { DispatchEvent } from '@/types/dispatch';

export default function EventDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<DispatchEvent | null>(null);

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, 'events', id), (snap) => {
      if (!snap.exists()) return setEvent(null);
      setEvent({ id: snap.id, ...(snap.data() as Omit<DispatchEvent, 'id'>) });
    });
    return unsub;
  }, [id]);

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

      {event.roles.map((role) => (
        <View key={role.id} style={styles.section}>
          <Text style={styles.role}>{role.name}</Text>
          <Text style={styles.meta}>Assigned: {role.assignedWorkerIds.length} · Open Slots: {role.openSlots}</Text>
          {role.tasks.map((task) => (
            <Text key={task.id} style={styles.task}>• {task.name}{task.optional ? ' (optional)' : ''}</Text>
          ))}
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
  section: { marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: '#131c37' },
  role: { color: 'white', fontSize: 16, fontWeight: '700' },
  task: { color: '#d7defa', marginTop: 6 },
});
