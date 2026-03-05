import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/context/session';
import { loadUserProfilesByIds, watchManagerEvents, watchManagerTeams, watchWorkerEvents } from '@/services/dispatch';
import { DispatchEvent, EventRole, UserProfile } from '@/types/dispatch';

type ManagerNamesMap = Record<string, string>;
type UserMap = Record<string, UserProfile>;

type DrawerState = {
  open: boolean;
  eventId: string | null;
  roleId: string | null;
};

const INITIAL_DRAWER: DrawerState = {
  open: false,
  eventId: null,
  roleId: null,
};

export default function DispatchesScreen() {
  const { profile } = useSession();
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [managerNames, setManagerNames] = useState<ManagerNamesMap>({});
  const [workerProfiles, setWorkerProfiles] = useState<UserMap>({});
  const [teamWorkerIds, setTeamWorkerIds] = useState<string[]>([]);
  const [replaceDrawer, setReplaceDrawer] = useState<DrawerState>(INITIAL_DRAWER);
  const [inviteDrawer, setInviteDrawer] = useState<DrawerState>(INITIAL_DRAWER);

  useEffect(() => {
    if (!profile) return;
    return profile.role === 'manager'
      ? watchManagerEvents(profile.uid, setEvents)
      : watchWorkerEvents(profile.uid, setEvents);
  }, [profile]);

  useEffect(() => {
    if (profile?.role !== 'manager') return;

    return watchManagerTeams(profile.uid, (teams) => {
      const workerIds = [...new Set(teams.flatMap((team) => team.workerIds || []).filter(Boolean))];
      setTeamWorkerIds(workerIds);
    });
  }, [profile]);

  useEffect(() => {
    if (profile?.role !== 'worker' || events.length === 0) return;

    let cancelled = false;
    const uniqueManagerIds = [...new Set(events.map((event) => event.managerId))].filter(Boolean);

    (async () => {
      const entries = await Promise.all(
        uniqueManagerIds.map(async (managerId) => {
          try {
            const [manager] = await loadUserProfilesByIds([managerId]);
            return [managerId, manager?.displayName || managerId] as const;
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

  useEffect(() => {
    if (profile?.role !== 'manager') return;

    const assignedWorkerIds = events.flatMap((event) => event.roles.flatMap((role) => role.assignedWorkerIds || []));
    const ids = [...new Set([...teamWorkerIds, ...assignedWorkerIds].filter(Boolean))];
    if (!ids.length) return;

    let cancelled = false;
    (async () => {
      try {
        const users = await loadUserProfilesByIds(ids);
        if (cancelled) return;

        setWorkerProfiles((prev) => {
          const next = { ...prev };
          users.forEach((user) => {
            next[user.uid] = user;
          });
          return next;
        });
      } catch {
        // no-op
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [events, profile?.role, teamWorkerIds]);

  const upcoming = useMemo(
    () => events.filter((e) => new Date(e.startsAt).getTime() >= Date.now()).sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt)),
    [events]
  );

  const toggleExpanded = (eventId: string) => {
    setExpandedIds((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  const findRoleForDrawer = (drawer: DrawerState): { event: DispatchEvent; role: EventRole } | null => {
    if (!drawer.eventId || !drawer.roleId) return null;
    const event = upcoming.find((item) => item.id === drawer.eventId);
    if (!event) return null;
    const role = event.roles.find((item) => item.id === drawer.roleId);
    if (!role) return null;
    return { event, role };
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

  const workerLabel = (workerId: string) => workerProfiles[workerId]?.displayName || workerId;

  const renderManagerRole = (event: DispatchEvent, role: EventRole) => {
    const assignedIds = role.assignedWorkerIds || [];
    const openSlots = Math.max(0, role.openSlots || 0);

    return (
      <View key={role.id} style={styles.roleCard}>
        <View style={styles.roleHeader}>
          <Text style={styles.roleTitle}>{role.name}</Text>
          <Text style={styles.roleMeta}>{assignedIds.length} assigned · {openSlots} open</Text>
        </View>

        <View style={styles.avatarRow}>
          {assignedIds.length ? (
            assignedIds.map((workerId) => {
              const initial = workerLabel(workerId).slice(0, 1).toUpperCase();
              return (
                <View key={`${event.id}-${role.id}-${workerId}`} style={styles.avatarChip}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>{initial}</Text>
                  </View>
                  <Text style={styles.avatarName} numberOfLines={1}>{workerLabel(workerId)}</Text>
                </View>
              );
            })
          ) : (
            <Text style={styles.roleEmpty}>No workers assigned yet.</Text>
          )}
        </View>

        <View style={styles.taskList}>
          {role.tasks.map((task) => (
            <View key={task.id} style={styles.taskRow}>
              <Text style={styles.taskName}>• {task.name}{task.optional ? ' (optional)' : ''}</Text>
            </View>
          ))}
        </View>

        <View style={styles.roleActions}>
          <Pressable
            style={styles.drawerButton}
            onPress={() => setReplaceDrawer({ open: true, eventId: event.id, roleId: role.id })}>
            <Text style={styles.drawerButtonText}>Replace</Text>
          </Pressable>
          <Pressable
            style={styles.drawerButton}
            onPress={() => setInviteDrawer({ open: true, eventId: event.id, roleId: role.id })}>
            <Text style={styles.drawerButtonText}>Invite</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const replaceTarget = findRoleForDrawer(replaceDrawer);
  const inviteTarget = findRoleForDrawer(inviteDrawer);

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

          return (
            <Pressable
              style={styles.card}
              onPress={() => toggleExpanded(item.id)}>
              <View style={styles.row}>
                <Text style={styles.title}>{item.name}</Text>
                <View style={styles.statusPill}><Text style={styles.statusText}>Upcoming</Text></View>
              </View>

              <Text style={styles.meta}>Due {new Date(item.startsAt).toLocaleString()}</Text>

              {profile?.role === 'worker' ? (
                <>
                  <Text style={styles.meta}>Assigned by: {managerLabel}</Text>
                  <Text style={styles.expandHint}>{expanded ? 'Hide tasks ▲' : 'Show tasks ▼'}</Text>
                  {expanded && renderWorkerTaskList(item)}
                </>
              ) : (
                <>
                  <Text style={styles.meta}>{item.location}</Text>
                  <Text style={styles.expandHint}>{expanded ? 'Hide role details ▲' : 'Show role details ▼'}</Text>
                  {expanded ? (
                    <View style={styles.managerExpanded}>
                      {item.roles.map((role) => renderManagerRole(item, role))}
                    </View>
                  ) : null}
                </>
              )}
            </Pressable>
          );
        }}
      />

      <Modal visible={replaceDrawer.open} animationType="slide" transparent onRequestClose={() => setReplaceDrawer(INITIAL_DRAWER)}>
        <Pressable style={styles.drawerBackdrop} onPress={() => setReplaceDrawer(INITIAL_DRAWER)}>
          <Pressable style={styles.drawer} onPress={() => null}>
            <Text style={styles.drawerTitle}>Replace Worker</Text>
            <Text style={styles.drawerSub}>Role: {replaceTarget?.role.name || 'Unknown role'}</Text>
            <ScrollView style={styles.drawerList}>
              {teamWorkerIds.length ? teamWorkerIds.map((workerId) => (
                <View key={`replace-${workerId}`} style={styles.drawerRow}>
                  <Text style={styles.drawerName}>{workerLabel(workerId)}</Text>
                  <Text style={styles.drawerMeta}>{replaceTarget?.role.assignedWorkerIds.includes(workerId) ? 'Already assigned' : 'Available'}</Text>
                </View>
              )) : <Text style={styles.roleEmpty}>No team workers available.</Text>}
            </ScrollView>
            <Pressable style={styles.drawerClose} onPress={() => setReplaceDrawer(INITIAL_DRAWER)}>
              <Text style={styles.drawerCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={inviteDrawer.open} animationType="slide" transparent onRequestClose={() => setInviteDrawer(INITIAL_DRAWER)}>
        <Pressable style={styles.drawerBackdrop} onPress={() => setInviteDrawer(INITIAL_DRAWER)}>
          <Pressable style={styles.drawer} onPress={() => null}>
            <Text style={styles.drawerTitle}>Invite Worker</Text>
            <Text style={styles.drawerSub}>Role: {inviteTarget?.role.name || 'Unknown role'}</Text>
            <ScrollView style={styles.drawerList}>
              {teamWorkerIds.length ? teamWorkerIds.map((workerId) => {
                const assigned = !!inviteTarget?.role.assignedWorkerIds.includes(workerId);
                return (
                  <View key={`invite-${workerId}`} style={styles.drawerRow}>
                    <Text style={styles.drawerName}>{workerLabel(workerId)}</Text>
                    <Text style={styles.drawerMeta}>{assigned ? 'Assigned' : 'Invite pending'}</Text>
                  </View>
                );
              }) : <Text style={styles.roleEmpty}>No team workers available.</Text>}
            </ScrollView>
            <Pressable style={styles.drawerClose} onPress={() => setInviteDrawer(INITIAL_DRAWER)}>
              <Text style={styles.drawerCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eef2ff', padding: 16 },
  filter: { color: '#334155', fontWeight: '600', marginBottom: 10 },
  empty: { marginTop: 20, color: '#64748b' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#0f172a', fontWeight: '700', fontSize: 20, flex: 1, marginRight: 8 },
  statusPill: { backgroundColor: '#e2e8f0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { color: '#475569', fontSize: 11, fontWeight: '700' },
  meta: { color: '#64748b', marginTop: 6, fontSize: 12 },
  expandHint: { color: '#2563eb', marginTop: 8, fontSize: 12, fontWeight: '600' },
  managerExpanded: { marginTop: 10, gap: 10 },
  roleCard: { borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', borderRadius: 10, padding: 10 },
  roleHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  roleTitle: { color: '#0f172a', fontWeight: '700', fontSize: 14 },
  roleMeta: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  avatarChip: { alignItems: 'center', width: 66 },
  avatarCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: '#1d4ed8' },
  avatarName: { marginTop: 4, fontSize: 11, color: '#334155' },
  roleActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  drawerButton: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#e2e8f0' },
  drawerButtonText: { color: '#334155', fontSize: 12, fontWeight: '700' },
  taskList: { marginTop: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8, gap: 8 },
  taskRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  taskName: { color: '#0f172a', flex: 1, fontSize: 13 },
  taskStatus: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  taskStatusDone: { color: '#15803d' },
  taskEmpty: { color: '#64748b', marginTop: 8, fontSize: 12 },
  roleEmpty: { color: '#64748b', fontSize: 12 },
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)', justifyContent: 'flex-end' },
  drawer: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '70%' },
  drawerTitle: { color: '#0f172a', fontWeight: '700', fontSize: 18 },
  drawerSub: { color: '#64748b', fontSize: 12, marginTop: 4 },
  drawerList: { marginTop: 12 },
  drawerRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  drawerName: { color: '#0f172a', fontWeight: '600' },
  drawerMeta: { color: '#64748b', marginTop: 4, fontSize: 12 },
  drawerClose: { marginTop: 12, backgroundColor: '#1d4ed8', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerCloseText: { color: '#fff', fontWeight: '700' },
});