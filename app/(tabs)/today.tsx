import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { deleteDispatchEvent, loadUserProfilesByIds, toggleTaskCompletion, watchManagerEvents, watchWorkerEvents } from '@/services/dispatch';
import { AppRole, DispatchEvent, EventTask } from '@/types/dispatch';
import { useThemeMode } from '@/context/theme';

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
  roleId: string;
  taskId: string;
  roleName: string;
  assignedToMe: boolean;
  completedCount: number;
  completedByMe: boolean;
  task: EventTask;
};

type CountdownInfo = {
  label: string;
  isOverdue: boolean;
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
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({});
  const [managerInfoById, setManagerInfoById] = useState<Record<string, ManagerInfo>>({});
  const [userInfoById, setUserInfoById] = useState<Record<string, UserInfo>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [savingTaskIds, setSavingTaskIds] = useState<Record<string, boolean>>({});
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});

  useEffect(() => {
    if (!profile) return;
    return profile.role === 'manager' ? watchManagerEvents(profile.uid, setEvents) : watchWorkerEvents(profile.uid, setEvents);
  }, [profile]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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

  const occursToday = (event: DispatchEvent, timestamp: number) => {
    const now = new Date(timestamp);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1;
    const startsAtMs = +new Date(event.startsAt);
    const endsAtMs = event.endsAt ? +new Date(event.endsAt) : startsAtMs;

    return startsAtMs <= dayEnd && endsAtMs >= dayStart;
  };

  const today = useMemo(() => {
    return events
      .filter((event) => occursToday(event, nowMs))
      .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  }, [events, nowMs]);

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

  const getTaskDueAtMs = (event: DispatchEvent, task: EventTask) => {
    const startsAtMs = +new Date(event.startsAt);
    const offsetMinutes = Number(task.expectedOffsetMinutes);

    if (Number.isFinite(startsAtMs) && Number.isFinite(offsetMinutes)) {
      return startsAtMs + Math.max(0, offsetMinutes) * 60 * 1000;
    }

    if (task.dueAt) {
      const parsedDueAt = +new Date(task.dueAt);
      if (Number.isFinite(parsedDueAt)) return parsedDueAt;
    }

    return Number.POSITIVE_INFINITY;
  };

  const formatTaskOffset = (offsetMinutes?: number) => `+${Math.max(0, Math.round(offsetMinutes || 0))}m`;

  const workerNextTask = (event: DispatchEvent, workerId: string): EventTask | null => {
    const remaining = event.roles
      .filter((role) => role.assignedWorkerIds.includes(workerId))
      .flatMap((role) => role.tasks)
      .filter((task) => !(task.completedBy ?? []).includes(workerId));

    if (!remaining.length) return null;

    return [...remaining].sort((a, b) => {
      const aDue = getTaskDueAtMs(event, a);
      const bDue = getTaskDueAtMs(event, b);
      if (aDue !== bDue) return aDue - bDue;
      return a.name.localeCompare(b.name);
    })[0];
  };

  const managerNextTask = (event: DispatchEvent): EventTask | null => {
    const remaining = event.roles
      .flatMap((role) => role.tasks)
      .filter((task) => (task.completedBy?.length ?? 0) === 0);

    if (!remaining.length) return null;

    return [...remaining].sort((a, b) => {
      const aDue = getTaskDueAtMs(event, a);
      const bDue = getTaskDueAtMs(event, b);
      if (aDue !== bDue) return aDue - bDue;
      return a.name.localeCompare(b.name);
    })[0];
  };

  const formatCountdownClock = (dueAtMs?: number): CountdownInfo | null => {
    if (!Number.isFinite(dueAtMs)) return null;

    const msRemaining = (dueAtMs || 0) - nowMs;
    const totalSeconds = Math.floor(Math.abs(msRemaining) / 1000);
    const hours = Math.floor(totalSeconds / 3600)
      .toString()
      .padStart(2, '0');
    const minutes = Math.floor((totalSeconds % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');

    if (msRemaining <= 0) return { label: `Overdue by ${hours}:${minutes}:${seconds}`, isOverdue: true };
    return { label: `${hours}:${minutes}:${seconds} remaining`, isOverdue: false };
  };

  const getEventChecklist = (event: DispatchEvent): WorkerChecklistItem[] => {
    if (!profile || profile.role !== 'worker') return [];

    return event.roles.flatMap((role) =>
      role.tasks.map((task) => {
        const completedBy = task.completedBy ?? [];
        return {
          id: `${role.id}:${task.id}`,
          roleId: role.id,
          taskId: task.id,
          roleName: role.name,
          assignedToMe: role.assignedWorkerIds.includes(profile.uid),
          completedCount: completedBy.length,
          completedByMe: completedBy.includes(profile.uid),
          task,
        };
      })
    );
  };

  const handleToggleTask = async (event: DispatchEvent, item: WorkerChecklistItem) => {
    if (!profile || profile.role !== 'worker') return;
    if (!item.assignedToMe || savingTaskIds[item.id]) return;

    const shouldComplete = !item.completedByMe;

    setSavingTaskIds((prev) => ({ ...prev, [item.id]: true }));
    try {
      await toggleTaskCompletion({
        eventId: event.id,
        roleId: item.roleId,
        taskId: item.task.id,
        workerId: profile.uid,
        complete: shouldComplete,
      });
    } catch (error) {
      Alert.alert('Unable to update task', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSavingTaskIds((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const renderWorkerChecklist = (event: DispatchEvent) => {
    if (profile?.role !== 'worker') return null;

    const tasks = getEventChecklist(event);
    if (!tasks.length) return <Text style={styles.emptyChecklist}>No tasks have been added to this event yet.</Text>;

    return (
      <View style={styles.checklistContainer}>
        {tasks.map((item) => {
          const isComplete = item.completedByMe;
          const isSaving = !!savingTaskIds[item.id];
          const canToggle = item.assignedToMe && !isSaving;

          return (
            <View key={item.id} style={styles.checklistItem}>
              <Pressable
                onPress={() => handleToggleTask(event, item)}
                disabled={!canToggle}
                style={[
                  styles.checkbox,
                  isComplete && styles.checkboxComplete,
                  !item.assignedToMe && styles.checkboxDisabled,
                  isSaving && styles.checkboxSaving,
                ]}
              >
                {isComplete ? <Text style={styles.checkboxMark}>✓</Text> : null}
              </Pressable>
              <View style={styles.checklistContent}>
                <Text style={[styles.checklistTask, isComplete && styles.checklistTaskComplete]}>
                  {item.task.name} · due {formatTaskOffset(item.task.expectedOffsetMinutes)}
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
                {item.assignedToMe ? (
                  <Text style={styles.checklistMeta}>{isSaving ? 'Saving…' : isComplete ? 'Tap to uncheck' : 'Tap to check off'}</Text>
                ) : null}
                {Number.isFinite(getTaskDueAtMs(event, item.task)) ? (
                  <Text style={styles.checklistMeta}>
                    Due {new Date(getTaskDueAtMs(event, item.task)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
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

  const handleDeleteEvent = (event: DispatchEvent) => {
    if (!profile || profile.role !== 'manager') return;

    Alert.alert('Delete Event', `Delete "${event.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel', onPress: () => swipeableRefs.current[event.id]?.close() },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDispatchEvent({ eventId: event.id, managerId: profile.uid });
          } catch (error) {
            Alert.alert('Unable to delete event', error instanceof Error ? error.message : 'Please try again.');
          } finally {
            swipeableRefs.current[event.id]?.close();
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <Text style={[styles.subhead, isDarkMode ? styles.subheadDark : styles.subheadLight]}>You have {today.length} active dispatches.</Text>
      <FlatList
        data={today}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingTop: 10 }}
        ListEmptyComponent={<Text style={[styles.empty, isDarkMode ? styles.emptyDark : styles.emptyLight]}>No dispatches for today.</Text>}
        renderItem={({ item }) => {
          const progress = getProgress(item);
          const b = badge(progress);
          const startsAtDate = new Date(item.startsAt);
          const eventDate = startsAtDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
          const eventTime = startsAtDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const isManager = profile?.role === 'manager';
          const isExpanded = !!expandedEventIds[item.id];
          const workers = isManager ? getWorkerSummaries(item) : [];
          const managerInfo = managerInfoById[item.managerId];
          const nextTask = profile?.role === 'worker' ? workerNextTask(item, profile.uid) : null;
          const nextTaskDueAtMs = nextTask ? getTaskDueAtMs(item, nextTask) : Number.POSITIVE_INFINITY;
          const countdownClock = formatCountdownClock(nextTaskDueAtMs);
          const managerNext = isManager ? managerNextTask(item) : null;
          const managerNextDueAtMs = managerNext ? getTaskDueAtMs(item, managerNext) : Number.POSITIVE_INFINITY;
          const managerCountdownClock = formatCountdownClock(managerNextDueAtMs);

          const card = (
            <Pressable style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]} onPress={() => toggleExpand(item.id)}>
              <View style={styles.headerRow}>
                <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>{item.name}</Text>
                <Text style={[styles.expandHint, isDarkMode ? styles.expandHintDark : styles.expandHintLight]}>{isExpanded ? 'Hide' : 'Expand'}</Text>
              </View>

              <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>{item.location} • {eventDate} • {eventTime}</Text>

              {isManager ? (
                <>
                  <View style={styles.progressSection}>
                    <View style={styles.progressHeader}>
                      <Text style={styles.progressLabel}>Task progress</Text>
                      <Text style={styles.progressCount}>{progress.done}/{progress.total}</Text>
                    </View>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${progress.percent}%` }]} />
                    </View>
                  </View>
                  <Text style={styles.nextTaskLabel}>Next task: {managerNext ? `${managerNext.name} · due ${formatTaskOffset(managerNext.expectedOffsetMinutes)}` : 'All tasks complete'}</Text>
                  {managerCountdownClock ? <Text style={[styles.timeRemaining, managerCountdownClock.isOverdue && styles.timeRemainingOverdue]}>Countdown: {managerCountdownClock.label}</Text> : null}
                </>
              ) : (
                <>
                  <View style={[styles.badge, { backgroundColor: b.bg }]}>
                    <Text style={[styles.badgeText, { color: b.fg }]}>{b.text}</Text>
                  </View>
                  <Text style={styles.meta}>Assigned by {managerInfo?.displayName || 'Manager'}</Text>
                  <Text style={styles.meta}>Manager phone: {managerInfo?.phoneNumber || 'Not available'}</Text>
                  <Text style={styles.nextTaskLabel}>Next task: {nextTask ? `${nextTask.name} · due ${formatTaskOffset(nextTask.expectedOffsetMinutes)}` : 'All assigned tasks complete'}</Text>
                  {countdownClock ? <Text style={[styles.timeRemaining, countdownClock.isOverdue && styles.timeRemainingOverdue]}>Countdown: {countdownClock.label}</Text> : null}
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
                      const workerNextDueAtMs = workerNext ? getTaskDueAtMs(item, workerNext) : Number.POSITIVE_INFINITY;
                      const workerCountdownClock = formatCountdownClock(workerNextDueAtMs);

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
                                <Text style={styles.workerMeta}>Next task: {workerNext.name} · due {formatTaskOffset(workerNext.expectedOffsetMinutes)}</Text>
                                {workerCountdownClock ? <Text style={[styles.timeRemaining, workerCountdownClock.isOverdue && styles.timeRemainingOverdue]}>Countdown: {workerCountdownClock.label}</Text> : null}
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

          if (!isManager) return card;

          return (
            <Swipeable
              ref={(ref) => { swipeableRefs.current[item.id] = ref; }}
              renderRightActions={() => (
                <Pressable style={styles.swipeDeleteAction} onPress={() => handleDeleteEvent(item)}>
                  <Text style={styles.swipeDeleteActionText}>Delete</Text>
                </Pressable>
              )}
              rightThreshold={40}
              overshootRight={false}>
              {card}
            </Swipeable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#020617' },
  subhead: { fontWeight: '500' },
  subheadLight: { color: '#475569' },
  subheadDark: { color: '#94a3b8' },
  empty: { marginTop: 20 },
  emptyLight: { color: '#64748b' },
  emptyDark: { color: '#94a3b8' },
  card: { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1 },
  cardLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  swipeDeleteAction: {
    marginBottom: 10,
    borderRadius: 12,
    width: 92,
    backgroundColor: '#b91c1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeDeleteActionText: { color: '#fee2e2', fontWeight: '700' },
  cardDark: { backgroundColor: '#0f172a', borderColor: '#1e293b' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontWeight: '700', fontSize: 20, marginBottom: 6, flex: 1 },
  titleLight: { color: '#0f172a' },
  titleDark: { color: '#f8fafc' },
  expandHint: { fontSize: 12, fontWeight: '700', marginLeft: 8 },
  expandHintLight: { color: '#2563eb' },
  expandHintDark: { color: '#93c5fd' },
  meta: { fontSize: 12, marginBottom: 2 },
  metaLight: { color: '#64748b' },
  metaDark: { color: '#94a3b8' },
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
  timeRemainingOverdue: { color: '#dc2626' },
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
  checkboxDisabled: { opacity: 0.45 },
  checkboxSaving: { opacity: 0.65 },
  checkboxMark: { color: '#15803d', fontWeight: '800', fontSize: 12 },
  checklistContent: { flex: 1 },
  checklistTask: { color: '#0f172a', fontWeight: '600', fontSize: 14 },
  checklistTaskComplete: { color: '#166534', textDecorationLine: 'line-through' },
  checklistMeta: { color: '#64748b', fontSize: 12, marginTop: 2 },
  emptyChecklist: { color: '#64748b', marginTop: 10, fontSize: 13 },
});
