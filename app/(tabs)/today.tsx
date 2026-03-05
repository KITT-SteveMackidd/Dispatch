import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { loadUserProfilesByIds, watchManagerEvents, watchWorkerEvents } from '@/services/dispatch';
import { AppRole, DispatchEvent, EventTask } from '@/types/dispatch';

type ManagerInfo = { displayName: string; phoneNumber?: string };
type UserInfo = { displayName: string; phoneNumber?: string; role: AppRole };

type TaskProgress = {
  total: number;
  done: number;
  percent: number;
};

type WorkerSummary = {
  workerId: string;
  roleNames: string[];
};

type WorkerChecklistItem = {
  id: string;
  roleName: string;
  assignedToMe: boolean;
  completedCount: number;
  completedByMe: boolean;
  task: EventTask;
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
  const [managerInfoById, setManagerInfoById] = useState<Record<string, ManagerInfo>>({});
  const [userInfoById, setUserInfoById] = useState<Record<string, UserInfo>>({});

  useEffect(() => {
    if (!profile) return;
    return profile.role === 'manager' ? watchManagerEvents(profile.uid, setEvents) : watchWorkerEvents(profile.uid, setEvents);
  }, [profile]);

  useEffect(() => {
    if (!profile) {
      setManagerInfoById({});
      setUserInfoById({});
      return;
    }

    const idsToLoad =
      profile.role === 'worker'
        ? [...new Set(events.map((event) => event.managerId).filter(Boolean))]
        : [
            ...new Set(
              events.flatMap((event) => event.roles.flatMap((role) => role.assignedWorkerIds || [])).filter(Boolean)
            ),
          ];

    if (!idsToLoad.length) {
      setManagerInfoById({});
      setUserInfoById({});
      return;
    }

    let active = true;
    loadUserProfilesByIds(idsToLoad)
      .then((profiles) => {
        if (!active) return;

        const nextUsers = profiles.reduce<Record<string, UserInfo>>((acc, user) => {
          acc[user.uid] = {
            displayName: user.displayName || 'Dispatch User',
            phoneNumber: user.phoneNumber,
            role: user.role,
          };
          return acc;
        }, {});

        setUserInfoById(nextUsers);

        if (profile.role === 'worker') {
          const nextManagers = profiles.reduce<Record<string, ManagerInfo>>((acc, manager) => {
            acc[manager.uid] = {
              displayName: manager.displayName || 'Manager',
              phoneNumber: manager.phoneNumber,
            };
            return acc;
          }, {});
          setManagerInfoById(nextManagers);
        } else {
          setManagerInfoById({});
        }
      })
      .catch(() => {
        if (!active) return;
        setManagerInfoById({});
        setUserInfoById({});
      });

    return () => {
      active = false;
    };
  }, [events, profile]);

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

  const getWorkerProgress = (event: DispatchEvent, workerId: string): TaskProgress => {
    const tasks = event.roles
      .filter((role) => role.assignedWorkerIds.includes(workerId))
      .flatMap((role) => role.tasks);

    const total = tasks.length;
    const done = tasks.filter((task) => (task.completedBy ?? []).includes(workerId)).length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    return { total, done, percent };
  };

  const badge = (progress: TaskProgress) => {
    const { total, done } = progress;
    if (done === total && total > 0) return { text: 'On Track', bg: '#dcfce7', fg: '#15803d' };
    if (done === 0) return { text: 'Pending', bg: '#dbeafe', fg: '#1d4ed8' };
    return { text: `${Math.max(total - done, 1)} Tasks Behind`, bg: '#ffedd5', fg: '#c2410c' };
  };

  const workerNextTask = (event: DispatchEvent, workerId: string): EventTask | null => {
    const remaining = event.roles
      .filter((role) => role.assignedWorkerIds.includes(workerId))
      .flatMap((role) => role.tasks)
      .filter((task) => !(task.completedBy ?? []).includes(workerId));

    if (!remaining.length) return null;

    return [...remaining].sort((a, b) => {
      if (a.dueAt && b.dueAt) return +new Date(a.dueAt) - +new Date(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return a.name.localeCompare(b.name);
    })[0];
  };

  const formatTimeRemaining = (dueAt?: string) => {
    if (!dueAt) return null;

    const msRemaining = +new Date(dueAt) - Date.now();
    if (msRemaining <= 0) return 'Due now';

    const totalMinutes = Math.ceil(msRemaining / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m remaining`;
    if (hours > 0) return `${hours}h remaining`;
    return `${minutes}m remaining`;
  };

  const getEventChecklist = (event: DispatchEvent): WorkerChecklistItem[] => {
    if (!profile || profile.role !== 'worker') return [];

    return event.roles.flatMap((role) =>
      role.tasks.map((task) => {
        const completedBy = task.completedBy ?? [];
        return {
          id: `${role.id}:${task.id}`,
          roleName: role.name,
          assignedToMe: role.assignedWorkerIds.includes(profile.uid),
          completedCount: completedBy.length,
          completedByMe: completedBy.includes(profile.uid),
          task,
        };
      })
    );
  };

  const renderWorkerChecklist = (event: DispatchEvent) => {
    if (profile?.role !== 'worker') return null;

    const tasks = getEventChecklist(event);
    if (!tasks.length) return <Text style={styles.emptyChecklist}>No tasks have been added to this event yet.</Text>;

    return (
      <View style={styles.checklistContainer}>
        {tasks.map((item) => {
          const isComplete = item.completedCount > 0;

          return (
            <View key={item.id} style={styles.checklistItem}>
              <View style={[styles.checkbox, isComplete && styles.checkboxComplete]}>
                {isComplete ? <Text style={styles.checkboxMark}>✓</Text> : null}
              </View>
              <View style={styles.checklistContent}>
                <Text style={[styles.checklistTask, isComplete && styles.checklistTaskComplete]}>
                  {item.task.name}
                  {item.task.optional ? ' (optional)' : ''}
                </Text>
                <Text style={styles.checklistMeta}>Role: {item.roleName}</Text>
                <Text style={styles.checklistMeta}>{item.assignedToMe ? 'Assigned to you' : 'Not assigned to you'}</Text>
                <Text style={styles.checklistMeta}>
                  {item.completedByMe
                    ? 'Completed by you'
                    : item.completedCount > 0
                      ? `Completed by ${item.completedCount} worker${item.completedCount > 1 ? 's' : ''}`
                      : 'Not completed yet'}
                </Text>
                {item.task.dueAt ? (
                  <Text style={styles.checklistMeta}>
                    Due {new Date(item.task.dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    );
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
          const eventTime = new Date(item.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const isManager = profile?.role === 'manager';
          const isExpanded = !!expandedEventIds[item.id];
          const workers = isManager ? getWorkerSummaries(item) : [];
          const managerInfo = managerInfoById[item.managerId];
          const nextTask = profile?.role === 'worker' ? workerNextTask(item, profile.uid) : null;
          const timeRemaining = formatTimeRemaining(nextTask?.dueAt);

          return (
            <Pressable style={styles.card} onPress={() => toggleExpand(item.id)}>
              <View style={styles.headerRow}>
                <Text style={styles.title}>{item.name}</Text>
                <Text style={styles.expandHint}>{isExpanded ? 'Hide' : 'Expand'}</Text>
              </View>

              <Text style={styles.meta}>{item.location} • {eventTime}</Text>

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
                <>
                  <View style={[styles.badge, { backgroundColor: b.bg }]}>
                    <Text style={[styles.badgeText, { color: b.fg }]}>{b.text}</Text>
                  </View>
                  <Text style={styles.meta}>Assigned by {managerInfo?.displayName || 'Manager'}</Text>
                  <Text style={styles.meta}>Manager phone: {managerInfo?.phoneNumber || 'Not available'}</Text>
                  <Text style={styles.nextTaskLabel}>Next task: {nextTask?.name || 'All assigned tasks complete'}</Text>
                  {timeRemaining && <Text style={styles.timeRemaining}>{timeRemaining}</Text>}
                </>
              )}

              {isManager && isExpanded ? (
                <View style={styles.workerSection}>
                  {workers.length ? (
                    workers.map((worker) => {
                      const initial = worker.workerId.replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || 'W';
                      const workerInfo = userInfoById[worker.workerId];
                      const workerProgress = getWorkerProgress(item, worker.workerId);
                      const workerNext = workerNextTask(item, worker.workerId);
                      const workerTimeRemaining = formatTimeRemaining(workerNext?.dueAt);

                      return (
                        <View key={worker.workerId} style={styles.workerCard}>
                          <Pressable
                            onPress={() => {
                              router.push({
                                pathname: '/chat/[workerId]',
                                params: {
                                  workerId: worker.workerId,
                                  workerLabel: workerInfo?.displayName || worker.workerId,
                                  eventName: item.name,
                                },
                              });
                            }}
                            style={styles.avatar}
                            hitSlop={8}
                          >
                            <Text style={styles.avatarText}>{initial}</Text>
                          </Pressable>

                          <View style={styles.workerDetails}>
                            <Text style={styles.workerName}>{workerInfo?.displayName || worker.workerId}</Text>
                            <Text style={styles.workerMeta}>Phone: {workerInfo?.phoneNumber || 'Not available'}</Text>
                            <Text style={styles.workerMeta}>Role: {worker.roleNames.join(', ') || 'Unassigned'}</Text>

                            <View style={styles.workerProgressSection}>
                              <View style={styles.progressHeader}>
                                <Text style={styles.progressLabel}>Task progress</Text>
                                <Text style={styles.progressCount}>{workerProgress.done}/{workerProgress.total}</Text>
                              </View>
                              <View style={styles.progressTrack}>
                                <View style={[styles.progressFill, { width: `${workerProgress.percent}%` }]} />
                              </View>
                            </View>

                            {workerNext ? (
                              <>
                                <Text style={styles.workerMeta}>Next task: {workerNext.name}</Text>
                                {workerTimeRemaining ? <Text style={styles.timeRemaining}>{workerTimeRemaining}</Text> : null}
                              </>
                            ) : (
                              <Text style={styles.workerMeta}>Next task: All assigned tasks complete</Text>
                            )}
                          </View>
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.emptyWorkers}>No assigned workers yet.</Text>
                  )}
                </View>
              ) : null}

              {!isManager && isExpanded ? renderWorkerChecklist(item) : null}
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
  meta: { color: '#64748b', fontSize: 12, marginBottom: 2 },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 10 },
  badgeText: { fontWeight: '700', fontSize: 12 },
  progressSection: { marginTop: 12 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { color: '#334155', fontWeight: '600', fontSize: 12 },
  progressCount: { color: '#334155', fontWeight: '700', fontSize: 12 },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#2563eb', borderRadius: 999 },
  nextTaskLabel: { color: '#0f172a', fontSize: 13, fontWeight: '600', marginTop: 6 },
  timeRemaining: { color: '#2563eb', fontSize: 12, fontWeight: '600', marginTop: 2 },
  workerSection: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10, gap: 10 },
  workerCard: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'flex-start' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarText: { fontWeight: '700', color: '#1d4ed8' },
  workerDetails: { flex: 1 },
  workerName: { color: '#0f172a', fontWeight: '700', fontSize: 14 },
  workerMeta: { color: '#64748b', fontSize: 12, marginTop: 2 },
  workerProgressSection: { marginTop: 8 },
  emptyWorkers: { color: '#64748b', fontSize: 12 },
  checklistContainer: { marginTop: 12, gap: 10 },
  checklistItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', marginTop: 1, backgroundColor: '#f8fafc' },
  checkboxComplete: { borderColor: '#15803d', backgroundColor: '#dcfce7' },
  checkboxMark: { color: '#15803d', fontWeight: '800', fontSize: 12 },
  checklistContent: { flex: 1 },
  checklistTask: { color: '#0f172a', fontWeight: '600', fontSize: 14 },
  checklistTaskComplete: { color: '#166534', textDecorationLine: 'line-through' },
  checklistMeta: { color: '#64748b', fontSize: 12, marginTop: 2 },
  emptyChecklist: { color: '#64748b', marginTop: 10, fontSize: 13 },
});
