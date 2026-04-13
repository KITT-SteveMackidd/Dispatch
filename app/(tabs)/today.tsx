import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSession } from '@/context/session';
import {
  deleteDispatchEvent,
  ensureTaskBehindScheduleNotification,
  loadUserProfilesByIds,
  loadWorkerTeams,
  toggleTaskCompletion,
  watchManagerEvents,
  watchManagerRoleInvites,
  watchManagerTeams,
  watchWorkerEvents,
} from '@/services/dispatch';
import { AppRole, DispatchEvent, EventTask, Team } from '@/types/dispatch';
import { useThemeMode } from '@/context/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const lightTodayLogoSource = { uri: 'https://www.figma.com/api/mcp/asset/ea1f259a-1993-4a31-b5d3-e13b530af9e6' };
const darkTodayLogoSource = { uri: 'https://www.figma.com/api/mcp/asset/416530cf-9e8d-49e3-9fe0-7ad6bee3db76' };

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

function formatOrdinalDay(date: Date) {
  const day = date.getDate();
  const remainder = day % 10;
  const teen = day % 100;
  if (teen >= 11 && teen <= 13) return `${day}th`;
  if (remainder === 1) return `${day}st`;
  if (remainder === 2) return `${day}nd`;
  if (remainder === 3) return `${day}rd`;
  return `${day}th`;
}

export default function TodayScreen() {
  const { profile } = useSession();
  const router = useRouter();
  const { resolvedThemeMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({});
  const [managerInfoById, setManagerInfoById] = useState<Record<string, ManagerInfo>>({});
  const [userInfoById, setUserInfoById] = useState<Record<string, UserInfo>>({});
  const [managerTeams, setManagerTeams] = useState<Team[]>([]);
  const [workerTeams, setWorkerTeams] = useState<Team[]>([]);
  const [inviteStatusByRoleWorkerKey, setInviteStatusByRoleWorkerKey] = useState<Record<string, 'pending' | 'accepted' | 'declined'>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [savingTaskIds, setSavingTaskIds] = useState<Record<string, boolean>>({});
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
  const behindScheduleNotificationCache = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (!profile) return;
    return profile.role === 'manager' ? watchManagerEvents(profile.uid, setEvents) : watchWorkerEvents(profile.uid, setEvents);
  }, [profile]);

  useEffect(() => {
    if (!profile) {
      setManagerTeams([]);
      setWorkerTeams([]);
      return;
    }

    if (profile.role === 'manager') {
      setWorkerTeams([]);
      return watchManagerTeams(profile.uid, setManagerTeams);
    }

    setManagerTeams([]);
    let active = true;
    loadWorkerTeams(profile.uid)
      .then((teams) => {
        if (!active) return;
        setWorkerTeams(teams);
      })
      .catch(() => {
        if (!active) return;
        setWorkerTeams([]);
      });

    return () => {
      active = false;
    };
  }, [profile]);

  useEffect(() => {
    if (profile?.role !== 'manager') {
      setInviteStatusByRoleWorkerKey({});
      return;
    }

    return watchManagerRoleInvites(profile.uid, (items) => {
      const next: Record<string, { status: 'pending' | 'accepted' | 'declined'; createdAtMs: number }> = {};

      items.forEach((item) => {
        if (!item.eventId || !item.roleId || !item.workerId) return;
        if (item.status !== 'pending' && item.status !== 'accepted' && item.status !== 'declined') return;

        const key = `${item.eventId}:${item.roleId}:${item.workerId}`;
        const createdAtMs = item.createdAt && 'toDate' in item.createdAt && typeof item.createdAt.toDate === 'function'
          ? item.createdAt.toDate().getTime()
          : 0;

        if (!next[key] || createdAtMs >= next[key].createdAtMs) {
          next[key] = {
            status: item.status,
            createdAtMs,
          };
        }
      });

      const flattened = Object.entries(next).reduce<Record<string, 'pending' | 'accepted' | 'declined'>>((acc, [key, value]) => {
        acc[key] = value.status;
        return acc;
      }, {});

      setInviteStatusByRoleWorkerKey(flattened);
    });
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

  const todayDateLabel = useMemo(() => {
    const now = new Date(nowMs);
    const month = now.toLocaleDateString([], { month: 'long' });
    return `${month} ${formatOrdinalDay(now)}, ${now.getFullYear()}`;
  }, [nowMs]);

  useEffect(() => {
    if (!profile || profile.role !== 'manager') return;

    const overdue = today.flatMap((event) =>
      getOverdueIncompleteTasks(event).map(({ role, task, dueAtMs }) => ({ event, role, task, dueAtMs }))
    );

    overdue.forEach(({ event, role, task, dueAtMs }) => {
      const cacheKey = `${event.id}:${role.id}:${task.id}`;
      if (behindScheduleNotificationCache.current[cacheKey]) return;

      behindScheduleNotificationCache.current[cacheKey] = true;
      ensureTaskBehindScheduleNotification({
        managerId: event.managerId,
        eventId: event.id,
        eventName: event.name,
        roleId: role.id,
        roleName: role.name,
        taskId: task.id,
        taskName: task.name,
        dueAt: new Date(dueAtMs).toISOString(),
      }).catch(() => {
        delete behindScheduleNotificationCache.current[cacheKey];
      });
    });
  }, [profile, today, nowMs]);

  const getProgress = (event: DispatchEvent, options?: { excludeUnfilledRoles?: boolean }): TaskProgress => {
    const roles = options?.excludeUnfilledRoles
      ? event.roles.filter((role) => (role.assignedWorkerIds?.length ?? 0) > 0)
      : event.roles;
    const tasks = roles.flatMap((r) => r.tasks);
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

  const badge = (event: DispatchEvent, progress: TaskProgress) => {
    const { done } = progress;
    const dueNow = event.roles
      .flatMap((role) => role.tasks)
      .filter((task) => {
        const dueAtMs = getTaskDueAtMs(event, task);
        return Number.isFinite(dueAtMs) && dueAtMs <= nowMs;
      }).length;

    const scheduleDelta = done - dueNow;

    if (scheduleDelta < 0) {
      return { text: `${Math.abs(scheduleDelta)} Tasks behind`, fg: '#F98D2F' };
    }

    return { text: `${scheduleDelta} Tasks ahead`, fg: '#0EC3C9' };
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

  const formatTaskDueTime = (event: DispatchEvent, task: EventTask) => {
    const dueAtMs = getTaskDueAtMs(event, task);
    if (!Number.isFinite(dueAtMs)) return 'TBD';
    return new Date(dueAtMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const getOverdueIncompleteTasks = (event: DispatchEvent) => {
    return event.roles.flatMap((role) =>
      role.tasks
        .filter((task) => {
          const dueAtMs = getTaskDueAtMs(event, task);
          if (!Number.isFinite(dueAtMs)) return false;
          const completed = (task.completedBy?.length ?? 0) > 0;
          return !completed && dueAtMs <= nowMs;
        })
        .map((task) => ({ role, task, dueAtMs: getTaskDueAtMs(event, task) }))
    );
  };

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

  const isRoleAcceptedForManager = (event: DispatchEvent, role: DispatchEvent['roles'][number]) => {
    const assignedWorkerIds = role.assignedWorkerIds || [];
    if (!assignedWorkerIds.length) return false;

    const statuses = assignedWorkerIds.map((workerId) => inviteStatusByRoleWorkerKey[`${event.id}:${role.id}:${workerId}`]);
    const hasTrackedStatus = statuses.some(Boolean);

    if (!hasTrackedStatus) return true;
    return statuses.includes('accepted');
  };

  const managerNextTask = (event: DispatchEvent): EventTask | null => {
    const remaining = event.roles
      .filter((role) => isRoleAcceptedForManager(event, role))
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

    return event.roles
      .filter((role) => role.assignedWorkerIds.includes(profile.uid))
      .flatMap((role) =>
        role.tasks.map((task) => {
          const completedBy = task.completedBy ?? [];
          return {
            id: `${role.id}:${task.id}`,
            roleId: role.id,
            taskId: task.id,
            roleName: role.name,
            assignedToMe: true,
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

  const openAttachmentUrl = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Unable to open attachment', 'Please check the attachment URL and try again.');
    }
  };

  const renderWorkerChecklist = (event: DispatchEvent) => {
    if (profile?.role !== 'worker') return null;

    const tasks = getEventChecklist(event);
    if (!tasks.length) return <Text style={[styles.emptyChecklist, isDarkMode ? styles.emptyChecklistDark : styles.emptyChecklistLight]}>No tasks have been added to this event yet.</Text>;

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
                  isDarkMode ? styles.checkboxDark : styles.checkboxLight,
                  isComplete && styles.checkboxComplete,
                  !item.assignedToMe && styles.checkboxDisabled,
                  isSaving && styles.checkboxSaving,
                ]}
              >
                {isComplete ? <Text style={styles.checkboxMark}>✓</Text> : null}
              </Pressable>
              <View style={styles.checklistContent}>
                <View style={styles.checklistTaskRow}>
                  <Text style={[styles.checklistTask, isDarkMode ? styles.checklistTaskDark : styles.checklistTaskLight, isComplete && styles.checklistTaskComplete]}>
                    {item.task.name} · due {formatTaskDueTime(event, item.task)}
                    {item.task.optional ? ' (optional)' : ''}
                  </Text>
                  {item.task.attachments?.length ? (
                    <View style={styles.taskAttachmentRow}>
                      {item.task.attachments
                        .filter((attachment) => attachment?.url?.trim())
                        .map((attachment) => (
                          <Pressable
                            key={attachment.id}
                            onPress={() => openAttachmentUrl(attachment.url)}
                            hitSlop={6}
                            accessibilityRole="button"
                            accessibilityLabel={`Open ${attachment.kind === 'photo' ? 'photo' : 'document'} attachment`}
                          >
                            <Text style={styles.taskAttachmentIcon}>{attachment.kind === 'photo' ? '🖼️' : '📄'}</Text>
                          </Pressable>
                        ))}
                    </View>
                  ) : null}
                </View>
                {!!item.task.description?.trim() ? <Text style={[styles.checklistDescription, isDarkMode ? styles.checklistDescriptionDark : styles.checklistDescriptionLight]}>{item.task.description.trim()}</Text> : null}
                <Text style={[styles.checklistMeta, isDarkMode ? styles.checklistMetaDark : styles.checklistMetaLight]}>Role: {item.roleName}</Text>
                <Text style={[styles.checklistMeta, isDarkMode ? styles.checklistMetaDark : styles.checklistMetaLight]}>
                  {item.completedByMe
                    ? 'Completed by you'
                    : item.completedCount > 0
                      ? `Completed by ${item.completedCount} worker${item.completedCount > 1 ? 's' : ''}`
                      : 'In progress'}
                </Text>
                {isSaving ? <Text style={[styles.checklistMeta, isDarkMode ? styles.checklistMetaDark : styles.checklistMetaLight]}>Saving…</Text> : null}
                {Number.isFinite(getTaskDueAtMs(event, item.task)) ? (
                  <Text style={[styles.checklistMeta, isDarkMode ? styles.checklistMetaDark : styles.checklistMetaLight]}>
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

  const openWorkerTeamChat = (event: DispatchEvent, workerId: string, workerLabel?: string) => {
    const eventTeamIds = new Set(event.teamIds || []);
    const workerTeam = managerTeams.find((team) => eventTeamIds.has(team.id) && (team.workerIds || []).includes(workerId))
      || managerTeams.find((team) => (team.workerIds || []).includes(workerId));

    router.push({
      pathname: '/chat/[workerId]',
      params: {
        workerId,
        workerLabel: workerLabel || workerId,
        eventName: event.name,
        teamId: workerTeam?.id,
        teamName: workerTeam?.name,
        teamMemberIds: workerTeam?.workerIds?.join(',') || '',
      },
    });
  };

  const openManagerChat = (event: DispatchEvent) => {
    const managerId = event.managerId;
    const managerLabel = managerInfoById[managerId]?.displayName || 'Manager';
    const eventTeamIds = new Set(event.teamIds || []);
    const managerTeam = workerTeams.find((team) => eventTeamIds.has(team.id) && team.managerId === managerId)
      || workerTeams.find((team) => team.managerId === managerId);

    router.push({
      pathname: '/chat/[workerId]',
      params: {
        workerId: managerId,
        workerLabel: managerLabel,
        eventName: event.name,
        teamId: managerTeam?.id,
        teamName: managerTeam?.name,
        teamMemberIds: managerTeam?.workerIds?.join(',') || '',
      },
    });
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

  const renderLightManagerCard = (item: DispatchEvent, isExpanded: boolean) => {
    const progress = getProgress(item, { excludeUnfilledRoles: true });
    const startsAtDate = new Date(item.startsAt);
    const eventDate = startsAtDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const eventTime = startsAtDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const managerNext = managerNextTask(item);
    const managerNextDueAtMs = managerNext ? getTaskDueAtMs(item, managerNext) : Number.POSITIVE_INFINITY;
    const managerCountdownClock = formatCountdownClock(managerNextDueAtMs);
    const workers = getWorkerSummaries(item);

    return (
      <Pressable style={styles.figmaCardLight} onPress={() => toggleExpand(item.id)}>
        <View style={styles.figmaCardTop}>
          <View style={styles.figmaCardTitleWrap}>
            <Text style={styles.figmaCardTitleLight} numberOfLines={1}>{item.name}</Text>
          </View>
          <Text style={styles.figmaExpandLight}>{isExpanded ? 'Hide' : 'Expand'}</Text>
        </View>

        <Text style={styles.figmaCardMetaLight}>{item.location} - {eventDate} - {eventTime}</Text>

        <View style={styles.figmaProgressSection}>
          <View style={styles.figmaProgressHeader}>
            <Text style={styles.figmaProgressLabelLight}>Task progress</Text>
            <Text style={styles.figmaProgressCountLight}>{progress.done}/{progress.total}</Text>
          </View>
          <View style={styles.figmaProgressTrackLight}>
            <View style={[styles.figmaProgressFillLight, { width: `${progress.percent}%` }]} />
          </View>
          <View style={styles.figmaNextTaskRow}>
            <Text style={styles.figmaNextTaskLabelLight}>
              Next Task: {managerNext ? `${managerNext.name} - ` : 'All tasks complete'}
            </Text>
            {managerCountdownClock ? (
              <Text style={[styles.figmaNextTaskTime, managerCountdownClock.isOverdue ? styles.figmaNextTaskTimeOverdueLight : styles.figmaNextTaskTimeAheadLight]}>
                {managerCountdownClock.isOverdue
                  ? `+ ${managerCountdownClock.label.replace('Overdue by ', '')}`
                  : managerCountdownClock.label.replace(' remaining', '')}
              </Text>
            ) : null}
          </View>
        </View>

        {isExpanded ? (
          <View style={styles.figmaWorkerSection}>
            {workers.length ? workers.map((worker) => {
              const workerInfo = userInfoById[worker.workerId];
              const initial = (workerInfo?.displayName || worker.workerId).slice(0, 1).toUpperCase() || 'W';
              const workerProgress = getWorkerProgress(item, worker.workerId);
              const workerNext = workerNextTask(item, worker.workerId);
              const workerNextDueAtMs = workerNext ? getTaskDueAtMs(item, workerNext) : Number.POSITIVE_INFINITY;
              const workerCountdownClock = formatCountdownClock(workerNextDueAtMs);

              return (
                <View key={worker.workerId} style={styles.figmaWorkerCardLight}>
                  <Pressable
                    onPress={() => openWorkerTeamChat(item, worker.workerId, workerInfo?.displayName || worker.workerId)}
                    style={styles.figmaAvatarLight}
                    hitSlop={8}>
                    <Text style={styles.figmaAvatarTextLight}>{initial}</Text>
                  </Pressable>

                  <View style={styles.figmaWorkerDetails}>
                    <View style={styles.figmaWorkerTopRow}>
                      <View style={styles.figmaWorkerTextWrap}>
                        <Text style={styles.figmaWorkerRoleLight}>{worker.roleNames[0] || 'Role Name'}</Text>
                        <Text style={styles.figmaWorkerMetaLight}>Worker: {workerInfo?.displayName || worker.workerId}</Text>
                        <Text style={styles.figmaWorkerMetaLight}>Phone: {workerInfo?.phoneNumber || 'Not available'}</Text>
                      </View>
                      <Pressable onPress={() => openWorkerTeamChat(item, worker.workerId, workerInfo?.displayName || worker.workerId)} hitSlop={8}>
                        <MaterialIcons name="phone-enabled" size={24} color="#121212" />
                      </Pressable>
                    </View>

                    <View style={styles.figmaProgressSection}>
                      <View style={styles.figmaProgressHeader}>
                        <Text style={styles.figmaProgressLabelLight}>Task progress</Text>
                        <Text style={styles.figmaProgressCountLight}>{workerProgress.done}/{workerProgress.total}</Text>
                      </View>
                      <View style={styles.figmaProgressTrackLight}>
                        <View style={[styles.figmaProgressFillLight, { width: `${workerProgress.percent}%` }]} />
                      </View>
                      <View style={styles.figmaNextTaskRow}>
                        <Text style={styles.figmaNextTaskLabelLight}>
                          Next Task: {workerNext ? `${workerNext.name} - ` : 'All tasks complete'}
                        </Text>
                        {workerCountdownClock ? (
                          <Text style={[styles.figmaNextTaskTime, workerCountdownClock.isOverdue ? styles.figmaNextTaskTimeOverdueLight : styles.figmaNextTaskTimeAheadLight]}>
                            {workerCountdownClock.isOverdue
                              ? `+ ${workerCountdownClock.label.replace('Overdue by ', '')}`
                              : workerCountdownClock.label.replace(' remaining', '')}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                </View>
              );
            }) : (
              <Text style={styles.emptyWorkers}>No assigned workers yet.</Text>
            )}
          </View>
        ) : null}
      </Pressable>
    );
  };

  const renderDarkManagerCard = (item: DispatchEvent, isExpanded: boolean) => {
    const progress = getProgress(item, { excludeUnfilledRoles: true });
    const startsAtDate = new Date(item.startsAt);
    const eventDate = startsAtDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const eventTime = startsAtDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const managerNext = managerNextTask(item);
    const managerNextDueAtMs = managerNext ? getTaskDueAtMs(item, managerNext) : Number.POSITIVE_INFINITY;
    const managerCountdownClock = formatCountdownClock(managerNextDueAtMs);
    const workers = getWorkerSummaries(item);

    return (
      <Pressable style={styles.figmaCardDark} onPress={() => toggleExpand(item.id)}>
        <View style={styles.figmaCardTop}>
          <View style={styles.figmaCardTitleWrap}>
            <Text style={styles.figmaCardTitleDark} numberOfLines={1}>{item.name}</Text>
          </View>
          <Text style={styles.figmaExpandDark}>{isExpanded ? 'Hide' : 'Expand'}</Text>
        </View>

        <Text style={styles.figmaCardMetaDark}>{item.location} - {eventDate} - {eventTime}</Text>

        <View style={styles.figmaProgressSection}>
          <View style={styles.figmaProgressHeader}>
            <Text style={styles.figmaProgressLabelDark}>Task progress</Text>
            <Text style={styles.figmaProgressCountDark}>{progress.done}/{progress.total}</Text>
          </View>
          <View style={styles.figmaProgressTrackDark}>
            <View style={[styles.figmaProgressFillDark, { width: `${progress.percent}%` }]} />
          </View>
          <View style={styles.figmaNextTaskRow}>
            <Text style={styles.figmaNextTaskLabelDark}>
              Next Task: {managerNext ? `${managerNext.name} - ` : 'All tasks complete'}
            </Text>
            {managerCountdownClock ? (
              <Text style={[styles.figmaNextTaskTime, managerCountdownClock.isOverdue ? styles.figmaNextTaskTimeOverdueDark : styles.figmaNextTaskTimeAheadDark]}>
                {managerCountdownClock.isOverdue
                  ? `+ ${managerCountdownClock.label.replace('Overdue by ', '')}`
                  : managerCountdownClock.label.replace(' remaining', '')}
              </Text>
            ) : null}
          </View>
        </View>

        {isExpanded ? (
          <View style={styles.figmaWorkerSection}>
            {workers.length ? workers.map((worker) => {
              const workerInfo = userInfoById[worker.workerId];
              const initial = (workerInfo?.displayName || worker.workerId).slice(0, 1).toUpperCase() || 'W';
              const workerProgress = getWorkerProgress(item, worker.workerId);
              const workerNext = workerNextTask(item, worker.workerId);
              const workerNextDueAtMs = workerNext ? getTaskDueAtMs(item, workerNext) : Number.POSITIVE_INFINITY;
              const workerCountdownClock = formatCountdownClock(workerNextDueAtMs);

              return (
                <View key={worker.workerId} style={styles.figmaWorkerCardDark}>
                  <Pressable
                    onPress={() => openWorkerTeamChat(item, worker.workerId, workerInfo?.displayName || worker.workerId)}
                    style={styles.figmaAvatarDark}
                    hitSlop={8}>
                    <Text style={styles.figmaAvatarTextDark}>{initial}</Text>
                  </Pressable>

                  <View style={styles.figmaWorkerDetails}>
                    <View style={styles.figmaWorkerTopRow}>
                      <View style={styles.figmaWorkerTextWrap}>
                        <Text style={styles.figmaWorkerRoleDark}>{worker.roleNames[0] || 'Role Name'}</Text>
                        <Text style={styles.figmaWorkerMetaDark}>Worker: {workerInfo?.displayName || worker.workerId}</Text>
                        <Text style={styles.figmaWorkerMetaDark}>Phone: {workerInfo?.phoneNumber || 'Not available'}</Text>
                      </View>
                      <Pressable onPress={() => openWorkerTeamChat(item, worker.workerId, workerInfo?.displayName || worker.workerId)} hitSlop={8}>
                        <MaterialIcons name="phone-enabled" size={24} color="#F7F7F7" />
                      </Pressable>
                    </View>

                    <View style={styles.figmaProgressSection}>
                      <View style={styles.figmaProgressHeader}>
                        <Text style={styles.figmaProgressLabelDark}>Task progress</Text>
                        <Text style={styles.figmaProgressCountDark}>{workerProgress.done}/{workerProgress.total}</Text>
                      </View>
                      <View style={styles.figmaProgressTrackDark}>
                        <View style={[styles.figmaProgressFillDark, { width: `${workerProgress.percent}%` }]} />
                      </View>
                      <View style={styles.figmaNextTaskRow}>
                        <Text style={styles.figmaNextTaskLabelDark}>
                          Next Task: {workerNext ? `${workerNext.name} - ` : 'All tasks complete'}
                        </Text>
                        {workerCountdownClock ? (
                          <Text style={[styles.figmaNextTaskTime, workerCountdownClock.isOverdue ? styles.figmaNextTaskTimeOverdueDark : styles.figmaNextTaskTimeAheadDark]}>
                            {workerCountdownClock.isOverdue
                              ? `+ ${workerCountdownClock.label.replace('Overdue by ', '')}`
                              : workerCountdownClock.label.replace(' remaining', '')}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                </View>
              );
            }) : (
              <Text style={styles.emptyWorkers}>No assigned workers yet.</Text>
            )}
          </View>
        ) : null}
      </Pressable>
    );
  };

  const useFigmaHeader = profile?.role === 'manager' || profile?.role === 'worker';

  return (
    <View style={[styles.container, !isDarkMode && useFigmaHeader ? styles.containerLightFigma : isDarkMode && useFigmaHeader ? styles.containerDarkFigma : isDarkMode ? styles.containerDark : styles.containerLight]}>
      {!isDarkMode && useFigmaHeader ? (
        <View style={[styles.figmaHeaderLight, { paddingTop: insets.top }]}>
          <View style={styles.figmaHeaderRow}>
            <Image source={lightTodayLogoSource} style={styles.figmaLogoLight} resizeMode="cover" />
            <Pressable accessibilityRole="button" accessibilityLabel="Notifications" hitSlop={8}>
              <MaterialIcons name="notifications-none" size={28} color="#8C8B92" />
            </Pressable>
          </View>
          <View style={styles.figmaDateChipLight}>
            <Text style={styles.figmaDateChipTextLight}>{todayDateLabel}</Text>
          </View>
        </View>
      ) : isDarkMode && useFigmaHeader ? (
        <View style={[styles.figmaHeaderDark, { paddingTop: insets.top }]}>
          <View style={styles.figmaHeaderRow}>
            <Image source={darkTodayLogoSource} style={styles.figmaLogoLight} resizeMode="cover" />
            <Pressable accessibilityRole="button" accessibilityLabel="Notifications" hitSlop={8}>
              <MaterialIcons name="notifications-none" size={28} color="#F7F7F7" />
            </Pressable>
          </View>
          <View style={styles.figmaDateChipDark}>
            <Text style={styles.figmaDateChipTextDark}>{todayDateLabel}</Text>
          </View>
        </View>
      ) : (
        <Text style={[styles.subhead, isDarkMode ? styles.subheadDark : styles.subheadLight]}>You have {today.length} active dispatches.</Text>
      )}
      <FlatList
        data={today}
        keyExtractor={(i) => i.id}
        style={useFigmaHeader ? styles.figmaTodayList : undefined}
        contentContainerStyle={useFigmaHeader ? styles.figmaTodayListContent : { paddingTop: 10, paddingBottom: 24 }}
        ListEmptyComponent={<Text style={[styles.empty, isDarkMode ? styles.emptyDark : styles.emptyLight]}>No dispatches for today.</Text>}
        renderItem={({ item }) => {
          const isManager = profile?.role === 'manager';
          const progress = getProgress(item, { excludeUnfilledRoles: isManager });
          const b = badge(item, progress);
          const startsAtDate = new Date(item.startsAt);
          const eventDate = startsAtDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
          const eventTime = startsAtDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const isExpanded = !!expandedEventIds[item.id];
          const workers = isManager ? getWorkerSummaries(item) : [];
          const managerInfo = managerInfoById[item.managerId];
          const nextTask = profile?.role === 'worker' ? workerNextTask(item, profile.uid) : null;
          const nextTaskDueAtMs = nextTask ? getTaskDueAtMs(item, nextTask) : Number.POSITIVE_INFINITY;
          const countdownClock = formatCountdownClock(nextTaskDueAtMs);
          const managerNext = isManager ? managerNextTask(item) : null;
          const managerNextDueAtMs = managerNext ? getTaskDueAtMs(item, managerNext) : Number.POSITIVE_INFINITY;
          const managerCountdownClock = formatCountdownClock(managerNextDueAtMs);
          const overdueTaskCount = isManager ? getOverdueIncompleteTasks(item).length : 0;

          const card = !isDarkMode && isManager ? renderLightManagerCard(item, isExpanded) : isDarkMode && isManager ? renderDarkManagerCard(item, isExpanded) : (
            <Pressable style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]} onPress={() => toggleExpand(item.id)}>
              <View style={styles.headerRow}>
                <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>{item.name}</Text>
                {isManager && overdueTaskCount > 0 ? (
                  <View style={styles.overdueChip}>
                    <Text style={styles.overdueChipText}>{overdueTaskCount}</Text>
                  </View>
                ) : null}
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
                  <View style={styles.nextTaskRow}>
                    <Text style={styles.nextTaskLabel}>Next task: {managerNext ? `${managerNext.name} · due ${formatTaskDueTime(item, managerNext)}` : 'All tasks complete'}</Text>
                    {managerCountdownClock ? <Text style={[styles.timeRemaining, managerCountdownClock.isOverdue && styles.timeRemainingOverdue]}>{managerCountdownClock.label}</Text> : null}
                  </View>
                </>
              ) : (
                <>
                  <View style={[styles.badge, { backgroundColor: isDarkMode ? '#12274D' : '#F7F7F7', borderColor: b.fg }]}>
                    <Text style={[styles.badgeText, { color: b.fg }]}>{b.text}</Text>
                  </View>
                  <View style={styles.managerRow}>
                    <Pressable onPress={() => openManagerChat(item)} style={[styles.avatar, isDarkMode ? styles.avatarDark : styles.avatarLight]} hitSlop={8}>
                      <Text style={[styles.avatarText, isDarkMode ? styles.avatarTextDarkTheme : styles.avatarTextLightTheme]}>{(managerInfo?.displayName || 'Manager').slice(0, 1).toUpperCase()}</Text>
                    </Pressable>
                    <View style={styles.managerDetails}>
                      <Text style={[styles.workerName, isDarkMode ? styles.workerNameDark : styles.workerNameLight]}>{managerInfo?.displayName || 'Manager'}</Text>
                      <Text style={[styles.workerMeta, isDarkMode ? styles.workerMetaDark : styles.workerMetaLight]}>Phone: {managerInfo?.phoneNumber || 'Not available'}</Text>
                    </View>
                  </View>
                  <View style={styles.nextTaskRow}>
                    <Text style={[styles.nextTaskLabel, isDarkMode ? styles.nextTaskLabelDark : styles.nextTaskLabelLight]}>Next task: {nextTask ? `${nextTask.name} · due ${formatTaskDueTime(item, nextTask)}` : 'All assigned tasks complete'}</Text>
                    {countdownClock ? <Text style={[styles.timeRemaining, countdownClock.isOverdue ? styles.timeRemainingOverdue : isDarkMode ? styles.timeRemainingDark : styles.timeRemainingLight]}>{countdownClock.label}</Text> : null}
                  </View>
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
                        <View key={worker.workerId} style={[styles.workerCard, isDarkMode ? styles.workerCardDark : styles.workerCardLight]}>
                          <Pressable
                            onPress={() => openWorkerTeamChat(item, worker.workerId, workerInfo?.displayName || worker.workerId)}
                            style={[styles.avatar, isDarkMode ? styles.avatarDark : styles.avatarLight]}
                            hitSlop={8}
                          >
                            <Text style={[styles.avatarText, isDarkMode ? styles.avatarTextDarkTheme : styles.avatarTextLightTheme]}>{initial}</Text>
                          </Pressable>

                          <View style={styles.workerDetails}>
                            <Text style={[styles.workerName, isDarkMode ? styles.workerNameDark : styles.workerNameLight]}>{workerInfo?.displayName || worker.workerId}</Text>
                            <Text style={[styles.workerMeta, isDarkMode ? styles.workerMetaDark : styles.workerMetaLight]}>Phone: {workerInfo?.phoneNumber || 'Not available'}</Text>
                            <Text style={[styles.workerMeta, isDarkMode ? styles.workerMetaDark : styles.workerMetaLight]}>Role: {worker.roleNames.join(', ') || 'Unassigned'}</Text>

                            <View style={styles.workerProgressSection}>
                              <View style={styles.progressHeader}>
                                <Text style={[styles.progressLabel, isDarkMode ? styles.progressLabelDark : styles.progressLabelLight]}>Task progress</Text>
                                <Text style={[styles.progressCount, isDarkMode ? styles.progressCountDark : styles.progressCountLight]}>{workerProgress.done}/{workerProgress.total}</Text>
                              </View>
                              <View style={[styles.progressTrack, isDarkMode ? styles.progressTrackDark : styles.progressTrackLight]}>
                                <View style={[styles.progressFill, isDarkMode ? styles.progressFillDark : styles.progressFillLight, { width: `${workerProgress.percent}%` }]} />
                              </View>
                            </View>

                            {workerNext ? (
                              <>
                                <View style={styles.nextTaskRow}>
                                  <Text style={[styles.workerMeta, isDarkMode ? styles.workerMetaDark : styles.workerMetaLight]}>Next task: {workerNext.name} · due {formatTaskDueTime(item, workerNext)}</Text>
                                  {workerCountdownClock ? <Text style={[styles.timeRemaining, workerCountdownClock.isOverdue ? styles.timeRemainingOverdue : isDarkMode ? styles.timeRemainingDark : styles.timeRemainingLight]}>{workerCountdownClock.label}</Text> : null}
                                </View>
                              </>
                            ) : (
                              <Text style={[styles.workerMeta, isDarkMode ? styles.workerMetaDark : styles.workerMetaLight]}>Next task: All assigned tasks complete</Text>
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
  containerLightFigma: { flex: 1, padding: 16, backgroundColor: '#DBE2F9' },
  containerDarkFigma: { flex: 1, padding: 16, backgroundColor: '#061229' },
  containerLight: { backgroundColor: '#DBE2F9' },
  containerDark: { backgroundColor: '#101A2F' },
  figmaHeaderLight: { gap: 14, paddingHorizontal: 0, paddingBottom: 8 },
  figmaHeaderDark: { gap: 14, paddingHorizontal: 0, paddingBottom: 8 },
  figmaHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  figmaLogoLight: { width: 64, height: 64 },
  figmaDateChipLight: {
    minHeight: 40,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#F98D2F',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DBE2F9',
  },
  figmaDateChipTextLight: { color: '#F98D2F', fontSize: 20, lineHeight: 24, fontWeight: '700' },
  figmaDateChipDark: {
    minHeight: 40,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#F98D2F',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#061229',
  },
  figmaDateChipTextDark: { color: '#F98D2F', fontSize: 20, lineHeight: 24, fontWeight: '700' },
  figmaTodayList: { flex: 1 },
  figmaTodayListContent: { paddingHorizontal: 0, paddingBottom: 8, gap: 8 },
  subhead: { fontWeight: '500' },
  subheadLight: { color: '#475569' },
  subheadDark: { color: '#F4F8FF' },
  empty: { marginTop: 20 },
  emptyLight: { color: '#64748b' },
  emptyDark: { color: '#F4F8FF' },
  figmaCardLight: { backgroundColor: '#F7F7F7', borderRadius: 16, padding: 16, gap: 12, marginBottom: 8 },
  figmaCardDark: { backgroundColor: '#12274D', borderRadius: 16, padding: 16, gap: 12, marginBottom: 8 },
  figmaCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  figmaCardTitleWrap: { flex: 1 },
  figmaCardTitleLight: { color: '#121212', fontSize: 16, fontWeight: '700' },
  figmaCardTitleDark: { color: '#F7F7F7', fontSize: 16, fontWeight: '700' },
  figmaExpandLight: { color: '#F98D2F', fontSize: 10, fontWeight: '400' },
  figmaExpandDark: { color: '#F98D2F', fontSize: 10, fontWeight: '400' },
  figmaCardMetaLight: { color: '#121212', fontSize: 12, fontWeight: '200' },
  figmaCardMetaDark: { color: '#F7F7F7', fontSize: 12, fontWeight: '200' },
  figmaProgressSection: { gap: 8 },
  figmaProgressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  figmaProgressLabelLight: { color: '#121212', fontSize: 10, fontWeight: '700' },
  figmaProgressCountLight: { color: '#121212', fontSize: 10, fontWeight: '700' },
  figmaProgressLabelDark: { color: '#F7F7F7', fontSize: 10, fontWeight: '700' },
  figmaProgressCountDark: { color: '#F7F7F7', fontSize: 10, fontWeight: '700' },
  figmaProgressTrackLight: { height: 9, borderRadius: 16, backgroundColor: '#DBE2F9', overflow: 'hidden', flexDirection: 'row' },
  figmaProgressFillLight: { height: '100%', backgroundColor: '#F98D2F', borderRadius: 12 },
  figmaProgressTrackDark: { height: 9, borderRadius: 16, backgroundColor: '#DBE2F9', overflow: 'hidden', flexDirection: 'row' },
  figmaProgressFillDark: { height: '100%', backgroundColor: '#F98D2F', borderRadius: 12 },
  figmaNextTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  figmaNextTaskLabelLight: { color: '#121212', fontSize: 10, fontWeight: '700' },
  figmaNextTaskLabelDark: { color: '#F7F7F7', fontSize: 10, fontWeight: '700' },
  figmaNextTaskTime: { fontSize: 10, fontWeight: '700' },
  figmaNextTaskTimeAheadLight: { color: '#0EC3C9' },
  figmaNextTaskTimeOverdueLight: { color: '#F98D2F' },
  figmaNextTaskTimeAheadDark: { color: '#0EC3C9' },
  figmaNextTaskTimeOverdueDark: { color: '#F98D2F' },
  figmaWorkerSection: { gap: 8 },
  figmaWorkerCardLight: { backgroundColor: '#EDF0FC', borderRadius: 8, padding: 8, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  figmaWorkerCardDark: { backgroundColor: '#203E75', borderRadius: 8, padding: 8, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  figmaAvatarLight: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#0EC3C9', alignItems: 'center', justifyContent: 'center', backgroundColor: '#EDF0FC' },
  figmaAvatarTextLight: { color: 'rgba(14,195,201,0.25)', fontSize: 16, fontWeight: '700' },
  figmaAvatarDark: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#0EC3C9', alignItems: 'center', justifyContent: 'center', backgroundColor: '#203E75' },
  figmaAvatarTextDark: { color: 'rgba(14,195,201,0.25)', fontSize: 16, fontWeight: '700' },
  figmaWorkerDetails: { flex: 1, gap: 8 },
  figmaWorkerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  figmaWorkerTextWrap: { flex: 1, gap: 2 },
  figmaWorkerRoleLight: { color: '#121212', fontSize: 12, fontWeight: '700' },
  figmaWorkerMetaLight: { color: '#121212', fontSize: 10, fontWeight: '400' },
  figmaWorkerRoleDark: { color: '#F7F7F7', fontSize: 12, fontWeight: '700' },
  figmaWorkerMetaDark: { color: '#F7F7F7', fontSize: 10, fontWeight: '400' },
  card: { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1 },
  cardLight: { backgroundColor: '#F7F7F7', borderColor: '#F7F7F7', borderRadius: 16, padding: 16, marginBottom: 8 },
  swipeDeleteAction: {
    marginBottom: 10,
    borderRadius: 12,
    width: 92,
    backgroundColor: '#b91c1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeDeleteActionText: { color: '#fee2e2', fontWeight: '700' },
  cardDark: { backgroundColor: '#12274D', borderColor: '#12274D', borderRadius: 16, padding: 16, marginBottom: 8 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontWeight: '700', fontSize: 20, marginBottom: 6, flex: 1 },
  titleLight: { color: '#232832' },
  titleDark: { color: '#F4F8FF' },
  expandHint: { fontSize: 12, fontWeight: '700', marginLeft: 8 },
  expandHintLight: { color: '#F98D2F' },
  expandHintDark: { color: '#F98D2F' },
  overdueChip: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  overdueChipText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  meta: { fontSize: 12, marginBottom: 2 },
  metaLight: { color: '#121212' },
  metaDark: { color: '#F7F7F7' },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 10, borderWidth: 1 },
  badgeText: { fontWeight: '700', fontSize: 12 },
  managerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  managerDetails: { flex: 1 },
  progressSection: { marginTop: 12 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontWeight: '700', fontSize: 10 },
  progressLabelLight: { color: '#121212' },
  progressLabelDark: { color: '#F7F7F7' },
  progressCount: { fontWeight: '700', fontSize: 10 },
  progressCountLight: { color: '#121212' },
  progressCountDark: { color: '#F7F7F7' },
  progressTrack: { height: 9, borderRadius: 999, overflow: 'hidden' },
  progressTrackLight: { backgroundColor: '#DBE2F9' },
  progressTrackDark: { backgroundColor: '#DBE2F9' },
  progressFill: { height: '100%', borderRadius: 999 },
  progressFillLight: { backgroundColor: '#F98D2F' },
  progressFillDark: { backgroundColor: '#F98D2F' },
  nextTaskRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 6 },
  nextTaskLabel: { fontSize: 10, fontWeight: '700', flex: 1 },
  nextTaskLabelLight: { color: '#121212' },
  nextTaskLabelDark: { color: '#F7F7F7' },
  timeRemaining: { fontSize: 10, fontWeight: '700' },
  timeRemainingLight: { color: '#0EC3C9' },
  timeRemainingDark: { color: '#0EC3C9' },
  timeRemainingOverdue: { color: '#F98D2F' },
  workerSection: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10, gap: 10 },
  workerCard: { borderWidth: 1, borderRadius: 8, padding: 8, flexDirection: 'row', alignItems: 'flex-start' },
  workerCardLight: { backgroundColor: '#EDF0FC', borderColor: '#EDF0FC' },
  workerCardDark: { backgroundColor: '#203E75', borderColor: '#203E75' },
  avatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#0EC3C9', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarLight: { backgroundColor: '#F7F7F7' },
  avatarDark: { backgroundColor: '#12274D' },
  avatarText: { fontWeight: '700', fontSize: 16 },
  avatarTextLightTheme: { color: 'rgba(14,195,201,0.25)' },
  avatarTextDarkTheme: { color: 'rgba(14,195,201,0.25)' },
  workerDetails: { flex: 1 },
  workerName: { fontWeight: '700', fontSize: 12 },
  workerNameLight: { color: '#121212' },
  workerNameDark: { color: '#F7F7F7' },
  workerMeta: { fontSize: 10, marginTop: 2 },
  workerMetaLight: { color: '#121212' },
  workerMetaDark: { color: '#F7F7F7' },
  workerProgressSection: { marginTop: 8 },
  emptyWorkers: { fontSize: 10 },
  checklistContainer: { marginTop: 12, gap: 10 },
  checklistItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxLight: { borderColor: '#DBE2F9', backgroundColor: '#EDF0FC' },
  checkboxDark: { borderColor: '#203E75', backgroundColor: '#203E75' },
  checkboxComplete: { borderColor: '#0EC3C9', backgroundColor: '#DBE2F9' },
  checkboxDisabled: { opacity: 0.45 },
  checkboxSaving: { opacity: 0.65 },
  checkboxMark: { color: '#0EC3C9', fontWeight: '800', fontSize: 12 },
  checklistContent: { flex: 1 },
  checklistTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checklistTask: { fontWeight: '600', fontSize: 14, flex: 1 },
  checklistTaskLight: { color: '#121212' },
  checklistTaskDark: { color: '#F7F7F7' },
  checklistTaskComplete: { color: '#0EC3C9', textDecorationLine: 'line-through' },
  taskAttachmentRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskAttachmentIcon: { fontSize: 16 },
  checklistDescription: { fontSize: 12, marginTop: 3 },
  checklistDescriptionLight: { color: '#121212' },
  checklistDescriptionDark: { color: '#F7F7F7' },
  checklistMeta: { fontSize: 12, marginTop: 2 },
  checklistMetaLight: { color: '#121212' },
  checklistMetaDark: { color: '#F7F7F7' },
  emptyChecklist: { marginTop: 10, fontSize: 13 },
  emptyChecklistLight: { color: '#121212' },
  emptyChecklistDark: { color: '#F7F7F7' },
});
