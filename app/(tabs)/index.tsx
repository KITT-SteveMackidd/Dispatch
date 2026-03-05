import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useSession } from '@/context/session';
import { db } from '@/lib/firebase';
import { watchManagerEvents, watchWorkerEvents } from '@/services/dispatch';
import { DispatchEvent } from '@/types/dispatch';

type ManagerNamesMap = Record<string, string>;

export default function DispatchesScreen() {
  const router = useRouter();
  const { profile } = useSession();
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [managerNames, setManagerNames] = useState<ManagerNamesMap>({});

  useEffect(() => {
    if (!profile) return;
    return profile.role === 'manager'
      ? watchManagerEvents(profile.uid, setEvents)
      : watchWorkerEvents(profile.uid, setEvents);
  }, [profile]);

  useEffect(() => {
    if (profile?.role !== 'worker' || events.length === 0) return;

    let cancelled = false;
    const uniqueManagerIds = [...new Set(events.map((event) => event.managerId))].filter(Boolean);

    (async () => {
      const entries = await Promise.all(
        uniqueManagerIds.map(async (managerId) => {
          try {
            const snap = await getDoc(doc(db, 'users', managerId));
            const displayName = (snap.data() as { displayName?: string } | undefined)?.displayName;
            return [managerId, displayName || managerId] as const;
          } catch {
            return [managerId, managerId] as const;
          }
        })
      );

      if (!cancelled) {
        setManagerNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [events, profile?.role]);

  const upcoming = useMemo(
    () => events.filter((e) => new Date(e.startsAt).getTime() >= Date.now()).sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt)),
    [events]
  );

  const toggleExpanded = (eventId: string) => {
    setExpandedIds((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  const getWorkerSignupRatio = (event: DispatchEvent) => {
    const assignedCount = event.roles.reduce((total, role) => total + role.assignedWorkerIds.length, 0);
    const requiredCount = event.roles.reduce((total, role) => total + role.assignedWorkerIds.length + role.openSlots, 0);

    return {
      assignedCount,
      requiredCount,
      label: `${assignedCount}/${requiredCount} workers signed up`,
    };
  };

  const renderWorkerTaskList = (event: DispatchEvent) => {
    if (!profile) return null;

    const workerTasks = event.roles
      .filter((role) => role.assignedWorkerIds.includes(profile.uid))
      .flatMap((role) =>
        role.tasks.map((task) => ({
          id: `${role.id}-${task.id}`,
          roleName: role.name,
          taskName: task.name,
          optional: !!task.optional,
          doneByMe: (task.completedBy ?? []).includes(profile.uid),
        }))
      );

    if (workerTasks.length === 0) {
      return <Text style={styles.taskEmpty}>No tasks assigned to you for this event.</Text>;
    }

    return (
      <View style={styles.taskList}>
        {workerTasks.map((task) => (
          <View key={task.id} style={styles.taskRow}>
            <Text style={styles.taskName}>• {task.taskName}{task.optional ? ' (optional)' : ''}</Text>
            <Text style={[styles.taskStatus, task.doneByMe && styles.taskStatusDone]}>{task.doneByMe ? 'Done' : task.roleName}</Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.filter}>All Assignments ▾</Text>
      <FlatList
        data={upcoming}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={styles.empty}>No upcoming assignments.</Text>}
        renderItem={({ item }) => {
          const expanded = !!expandedIds[item.id];
          const managerLabel = managerNames[item.managerId] || item.managerId;
          const eventTime = new Date(item.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const signupRatio = getWorkerSignupRatio(item);

          return (
            <Pressable
              style={styles.card}
              onPress={() => (profile?.role === 'manager' ? router.push(`/event/${item.id}`) : toggleExpanded(item.id))}>
              <View style={styles.row}>
                <Text style={styles.title}>{item.name}</Text>
                <View style={styles.statusPill}><Text style={styles.statusText}>Upcoming</Text></View>
              </View>

              <Text style={styles.meta}>{item.location} • {eventTime}</Text>

              {profile?.role === 'worker' ? (
                <>
                  <Text style={styles.meta}>Assigned by: {managerLabel}</Text>
                  <Text style={styles.expandHint}>{expanded ? 'Hide tasks ▲' : 'Show tasks ▼'}</Text>
                  {expanded && renderWorkerTaskList(item)}
                </>
              ) : (
                <Text style={styles.meta}>{signupRatio.label}</Text>
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
  filter: { color: '#334155', fontWeight: '600', marginBottom: 10 },
  empty: { marginTop: 20, color: '#64748b' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#0f172a', fontWeight: '700', fontSize: 20 },
  statusPill: { backgroundColor: '#e2e8f0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { color: '#475569', fontSize: 11, fontWeight: '700' },
  meta: { color: '#64748b', marginTop: 6, fontSize: 12 },
  expandHint: { color: '#2563eb', marginTop: 8, fontSize: 12, fontWeight: '600' },
  taskList: { marginTop: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8, gap: 8 },
  taskRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  taskName: { color: '#0f172a', flex: 1, fontSize: 13 },
  taskStatus: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  taskStatusDone: { color: '#15803d' },
  taskEmpty: { color: '#64748b', marginTop: 8, fontSize: 12 },
});
