import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSession } from '@/context/session';
import { loadUserProfilesByIds, watchManagerEvents, watchManagerTeams, watchWorkerEvents } from '@/services/dispatch';
import { DispatchEvent, EventRole, UserProfile } from '@/types/dispatch';
import { useThemeMode } from '@/context/theme';

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

type EventTemplateOption = {
  id: string;
  name: string;
  roleCount: number;
  taskCount: number;
  defaultLocation?: string;
};

const INITIAL_TEMPLATE_OPTIONS: EventTemplateOption[] = [
  { id: 'street-team', name: 'Street Team Activation', roleCount: 3, taskCount: 9, defaultLocation: 'Downtown' },
  { id: 'mall-pop-up', name: 'Mall Pop-Up', roleCount: 2, taskCount: 6, defaultLocation: 'City Mall' },
  { id: 'festival-booth', name: 'Festival Booth', roleCount: 4, taskCount: 12, defaultLocation: 'Festival Grounds' },
];

export default function EventsScreen() {
  const { profile } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [managerNames, setManagerNames] = useState<ManagerNamesMap>({});
  const [workerProfiles, setWorkerProfiles] = useState<UserMap>({});
  const [teamWorkerIds, setTeamWorkerIds] = useState<string[]>([]);
  const [replaceDrawer, setReplaceDrawer] = useState<DrawerState>(INITIAL_DRAWER);
  const [inviteDrawer, setInviteDrawer] = useState<DrawerState>(INITIAL_DRAWER);
  const [createEventDrawerOpen, setCreateEventDrawerOpen] = useState(false);
  const [createTemplateDrawerOpen, setCreateTemplateDrawerOpen] = useState(false);
  const [templateNameDraft, setTemplateNameDraft] = useState('');
  const [templateOptions, setTemplateOptions] = useState<EventTemplateOption[]>(INITIAL_TEMPLATE_OPTIONS);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(INITIAL_TEMPLATE_OPTIONS[0]?.id || '');
  const canCreateEvent = profile?.role === 'manager';

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

  useEffect(() => {
    if (canCreateEvent) return;
    setCreateEventDrawerOpen(false);
  }, [canCreateEvent]);

  const openCreateEventDrawer = () => {
    if (!canCreateEvent) return;
    setReplaceDrawer(INITIAL_DRAWER);
    setInviteDrawer(INITIAL_DRAWER);
    setCreateEventDrawerOpen(true);
  };

  const closeCreateEventDrawer = () => {
    setCreateEventDrawerOpen(false);
  };

  const openCreateTemplateDrawer = () => {
    setTemplateNameDraft('');
    setCreateTemplateDrawerOpen(true);
  };

  const closeCreateTemplateDrawer = () => {
    setCreateTemplateDrawerOpen(false);
    setTemplateNameDraft('');
  };

  const createTemplate = () => {
    const name = templateNameDraft.trim();
    if (!name) return;

    const id = `custom-${Date.now()}`;
    const nextTemplate: EventTemplateOption = {
      id,
      name,
      roleCount: 0,
      taskCount: 0,
    };

    setTemplateOptions((prev) => [nextTemplate, ...prev]);
    setSelectedTemplateId(id);
    closeCreateTemplateDrawer();
  };

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
      return <Text style={[styles.taskEmpty, isDarkMode ? styles.taskEmptyDark : styles.taskEmptyLight]}>No tasks assigned to you for this event.</Text>;
    }

    return (
      <View style={styles.taskList}>
        {workerTasks.map((task) => (
          <View key={task.id} style={styles.taskRow}>
            <Text style={[styles.taskName, isDarkMode ? styles.taskNameDark : styles.taskNameLight]}>• {task.taskName}{task.optional ? ' (optional)' : ''}</Text>
            <Text style={[styles.taskStatus, isDarkMode ? styles.metaDark : styles.metaLight, task.doneByMe && styles.taskStatusDone]}>{task.doneByMe ? 'Done' : task.roleName}</Text>
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
      <View key={role.id} style={[styles.roleCard, isDarkMode ? styles.roleCardDark : styles.roleCardLight]}>
        <View style={styles.roleHeader}>
          <Text style={[styles.roleTitle, isDarkMode ? styles.roleTitleDark : styles.roleTitleLight]}>{role.name}</Text>
          <Text style={[styles.roleMeta, isDarkMode ? styles.roleMetaDark : styles.roleMetaLight]}>{assignedIds.length} assigned · {openSlots} open</Text>
        </View>

        <View style={styles.avatarRow}>
          {assignedIds.length ? (
            assignedIds.map((workerId) => {
              const initial = workerLabel(workerId).slice(0, 1).toUpperCase();
              return (
                <View key={`${event.id}-${role.id}-${workerId}`} style={styles.avatarChip}>
                  <View style={[styles.avatarCircle, isDarkMode ? styles.avatarCircleDark : styles.avatarCircleLight]}>
                    <Text style={styles.avatarText}>{initial}</Text>
                  </View>
                  <Text style={[styles.avatarName, isDarkMode ? styles.avatarNameDark : styles.avatarNameLight]} numberOfLines={1}>{workerLabel(workerId)}</Text>
                </View>
              );
            })
          ) : (
            <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No workers assigned yet.</Text>
          )}
        </View>

        <View style={styles.taskList}>
          {role.tasks.map((task) => (
            <View key={task.id} style={styles.taskRow}>
              <Text style={[styles.taskName, isDarkMode ? styles.taskNameDark : styles.taskNameLight]}>• {task.name}{task.optional ? ' (optional)' : ''}</Text>
            </View>
          ))}
        </View>

        <View style={styles.roleActions}>
          <Pressable
            style={[styles.drawerButton, isDarkMode ? styles.drawerButtonDark : styles.drawerButtonLight]}
            onPress={() => setReplaceDrawer({ open: true, eventId: event.id, roleId: role.id })}>
            <Text style={[styles.drawerButtonText, isDarkMode ? styles.drawerButtonTextDark : styles.drawerButtonTextLight]}>Replace</Text>
          </Pressable>
          <Pressable
            style={[styles.drawerButton, isDarkMode ? styles.drawerButtonDark : styles.drawerButtonLight]}
            onPress={() => setInviteDrawer({ open: true, eventId: event.id, roleId: role.id })}>
            <Text style={[styles.drawerButtonText, isDarkMode ? styles.drawerButtonTextDark : styles.drawerButtonTextLight]}>Invite</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const replaceTarget = findRoleForDrawer(replaceDrawer);
  const inviteTarget = findRoleForDrawer(inviteDrawer);
  const selectedTemplate = templateOptions.find((template) => template.id === selectedTemplateId) || templateOptions[0];

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <View style={styles.headerRow}>
        <Text style={[styles.filter, isDarkMode ? styles.filterDark : styles.filterLight]}>All Assignments ▾</Text>
        {canCreateEvent ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create event"
            style={styles.createButton}
            onPress={openCreateEventDrawer}>
            <Text style={styles.createButtonText}>+</Text>
          </Pressable>
        ) : null}
      </View>
      <FlatList
        data={upcoming}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={[styles.empty, isDarkMode ? styles.emptyDark : styles.emptyLight]}>No upcoming assignments.</Text>}
        renderItem={({ item }) => {
          const expanded = !!expandedIds[item.id];
          const managerLabel = managerNames[item.managerId] || 'Manager';
          const eventTime = new Date(item.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const signupRatio = getWorkerSignupRatio(item);

          return (
            <Pressable
              style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}
              onPress={() => toggleExpanded(item.id)}>
              <View style={styles.row}>
                <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>{item.name}</Text>
                <View style={[styles.statusPill, isDarkMode ? styles.statusPillDark : styles.statusPillLight]}><Text style={[styles.statusText, isDarkMode ? styles.statusTextDark : styles.statusTextLight]}>Upcoming</Text></View>
              </View>

              <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>{item.location} • {eventTime}</Text>

              {profile?.role === 'worker' ? (
                <>
                  <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>Assigned by: {managerLabel}</Text>
                  <Text style={[styles.expandHint, isDarkMode ? styles.expandHintDark : styles.expandHintLight]}>{expanded ? 'Hide tasks ▲' : 'Show tasks ▼'}</Text>
                  {expanded && renderWorkerTaskList(item)}
                </>
              ) : (
                <>
                  <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>{signupRatio.label}</Text>
                  <Text style={[styles.expandHint, isDarkMode ? styles.expandHintDark : styles.expandHintLight]}>{expanded ? 'Hide role details ▲' : 'Show role details ▼'}</Text>
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
          <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => null}>
            <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>Replace Worker</Text>
            <Text style={[styles.drawerSub, isDarkMode ? styles.drawerSubDark : styles.drawerSubLight]}>Role: {replaceTarget?.role.name || 'Unknown role'}</Text>
            <ScrollView style={styles.drawerList}>
              {teamWorkerIds.length ? teamWorkerIds.map((workerId) => (
                <View key={`replace-${workerId}`} style={styles.drawerRow}>
                  <Text style={[styles.drawerName, isDarkMode ? styles.drawerNameDark : styles.drawerNameLight]}>{workerLabel(workerId)}</Text>
                  <Text style={[styles.drawerMeta, isDarkMode ? styles.drawerMetaDark : styles.drawerMetaLight]}>{replaceTarget?.role.assignedWorkerIds.includes(workerId) ? 'Already assigned' : 'Available'}</Text>
                </View>
              )) : <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No team workers available.</Text>}
            </ScrollView>
            <Pressable style={styles.drawerClose} onPress={() => setReplaceDrawer(INITIAL_DRAWER)}>
              <Text style={styles.drawerCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={inviteDrawer.open} animationType="slide" transparent onRequestClose={() => setInviteDrawer(INITIAL_DRAWER)}>
        <Pressable style={styles.drawerBackdrop} onPress={() => setInviteDrawer(INITIAL_DRAWER)}>
          <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => null}>
            <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>Invite Worker</Text>
            <Text style={[styles.drawerSub, isDarkMode ? styles.drawerSubDark : styles.drawerSubLight]}>Role: {inviteTarget?.role.name || 'Unknown role'}</Text>
            <ScrollView style={styles.drawerList}>
              {teamWorkerIds.length ? teamWorkerIds.map((workerId) => {
                const assigned = !!inviteTarget?.role.assignedWorkerIds.includes(workerId);
                return (
                  <View key={`invite-${workerId}`} style={styles.drawerRow}>
                    <Text style={[styles.drawerName, isDarkMode ? styles.drawerNameDark : styles.drawerNameLight]}>{workerLabel(workerId)}</Text>
                    <Text style={[styles.drawerMeta, isDarkMode ? styles.drawerMetaDark : styles.drawerMetaLight]}>{assigned ? 'Assigned' : 'Invite pending'}</Text>
                  </View>
                );
              }) : <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No team workers available.</Text>}
            </ScrollView>
            <Pressable style={styles.drawerClose} onPress={() => setInviteDrawer(INITIAL_DRAWER)}>
              <Text style={styles.drawerCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={createEventDrawerOpen} animationType="slide" transparent onRequestClose={closeCreateEventDrawer}>
        <Pressable style={styles.drawerBackdrop} onPress={closeCreateEventDrawer}>
          <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => null}>
            <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>Create Event</Text>
            <Text style={[styles.drawerSub, isDarkMode ? styles.drawerSubDark : styles.drawerSubLight]}>Choose a template to start your event setup.</Text>

            <View style={styles.templateSection}>
              <View style={styles.templateHeaderRow}>
                <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Event template</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create new template"
                  style={[styles.templateAddButton, isDarkMode ? styles.templateAddButtonDark : styles.templateAddButtonLight]}
                  onPress={openCreateTemplateDrawer}>
                  <Text style={[styles.templateAddButtonText, isDarkMode ? styles.templateAddButtonTextDark : styles.templateAddButtonTextLight]}>+ New Template</Text>
                </Pressable>
              </View>
              {templateOptions.map((template) => {
                const selected = template.id === selectedTemplate?.id;
                return (
                  <Pressable
                    key={template.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${template.name} template`}
                    style={[
                      styles.templateOption,
                      isDarkMode ? styles.templateOptionDark : styles.templateOptionLight,
                      selected && (isDarkMode ? styles.templateOptionSelectedDark : styles.templateOptionSelectedLight),
                    ]}
                    onPress={() => setSelectedTemplateId(template.id)}>
                    <View style={styles.templateOptionHeader}>
                      <Text style={[styles.templateName, isDarkMode ? styles.templateNameDark : styles.templateNameLight]}>{template.name}</Text>
                      <Text style={[styles.templateBadge, selected && styles.templateBadgeSelected]}>{selected ? 'Selected' : 'Select'}</Text>
                    </View>
                    <Text style={[styles.templateMeta, isDarkMode ? styles.templateMetaDark : styles.templateMetaLight]}>
                      {template.roleCount} roles · {template.taskCount} tasks
                      {template.defaultLocation ? ` · ${template.defaultLocation}` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable style={styles.drawerClose} onPress={closeCreateEventDrawer}>
              <Text style={styles.drawerCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={createTemplateDrawerOpen} animationType="slide" transparent onRequestClose={closeCreateTemplateDrawer}>
        <Pressable style={styles.drawerBackdrop} onPress={closeCreateTemplateDrawer}>
          <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => null}>
            <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>Create Template</Text>
            <Text style={[styles.drawerSub, isDarkMode ? styles.drawerSubDark : styles.drawerSubLight]}>Add a template you can reuse while creating events.</Text>

            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Template name</Text>
              <TextInput
                value={templateNameDraft}
                onChangeText={setTemplateNameDraft}
                placeholder="Example: Saturday Street Crew"
                placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
                style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
              />
            </View>

            <Pressable
              style={[styles.drawerClose, (!templateNameDraft.trim().length) && styles.drawerCloseDisabled]}
              onPress={createTemplate}
              disabled={!templateNameDraft.trim().length}>
              <Text style={styles.drawerCloseText}>Create Template</Text>
            </Pressable>
            <Pressable style={[styles.drawerSecondaryButton, isDarkMode ? styles.drawerSecondaryButtonDark : styles.drawerSecondaryButtonLight]} onPress={closeCreateTemplateDrawer}>
              <Text style={[styles.drawerSecondaryButtonText, isDarkMode ? styles.drawerSecondaryButtonTextDark : styles.drawerSecondaryButtonTextLight]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#020617' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  filter: { fontWeight: '600' },
  filterLight: { color: '#334155' },
  filterDark: { color: '#cbd5e1' },
  createButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonText: { color: '#fff', fontSize: 24, lineHeight: 24, fontWeight: '500', marginTop: -1 },
  empty: { marginTop: 20 },
  emptyLight: { color: '#64748b' },
  emptyDark: { color: '#94a3b8' },
  card: { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1 },
  cardLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#0f172a', borderColor: '#1e293b' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontWeight: '700', fontSize: 20, flex: 1, marginRight: 8 },
  titleLight: { color: '#0f172a' },
  titleDark: { color: '#f8fafc' },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusPillLight: { backgroundColor: '#e2e8f0' },
  statusPillDark: { backgroundColor: '#334155' },
  statusText: { fontSize: 11, fontWeight: '700' },
  statusTextLight: { color: '#475569' },
  statusTextDark: { color: '#cbd5e1' },
  meta: { marginTop: 6, fontSize: 12 },
  metaLight: { color: '#64748b' },
  metaDark: { color: '#94a3b8' },
  expandHint: { marginTop: 8, fontSize: 12, fontWeight: '600' },
  expandHintLight: { color: '#2563eb' },
  expandHintDark: { color: '#93c5fd' },
  managerExpanded: { marginTop: 10, gap: 10 },
  roleCard: { borderWidth: 1, borderRadius: 10, padding: 10 },
  roleCardLight: { borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  roleCardDark: { borderColor: '#334155', backgroundColor: '#111827' },
  roleHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  roleTitle: { fontWeight: '700', fontSize: 14 },
  roleTitleLight: { color: '#0f172a' },
  roleTitleDark: { color: '#e2e8f0' },
  roleMeta: { fontSize: 12, fontWeight: '600' },
  roleMetaLight: { color: '#64748b' },
  roleMetaDark: { color: '#94a3b8' },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  avatarChip: { alignItems: 'center', width: 66 },
  avatarCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarCircleLight: { backgroundColor: '#dbeafe' },
  avatarCircleDark: { backgroundColor: '#1e3a8a' },
  avatarText: { fontWeight: '700', color: '#bfdbfe' },
  avatarName: { marginTop: 4, fontSize: 11 },
  avatarNameLight: { color: '#334155' },
  avatarNameDark: { color: '#cbd5e1' },
  roleActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  drawerButton: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  drawerButtonLight: { backgroundColor: '#e2e8f0' },
  drawerButtonDark: { backgroundColor: '#334155' },
  drawerButtonText: { fontSize: 12, fontWeight: '700' },
  drawerButtonTextLight: { color: '#334155' },
  drawerButtonTextDark: { color: '#e2e8f0' },
  taskList: { marginTop: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8, gap: 8 },
  taskRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  taskName: { flex: 1, fontSize: 13 },
  taskNameLight: { color: '#0f172a' },
  taskNameDark: { color: '#e2e8f0' },
  taskStatus: { fontSize: 12, fontWeight: '600' },
  taskStatusDone: { color: '#22c55e' },
  taskEmpty: { marginTop: 8, fontSize: 12 },
  taskEmptyLight: { color: '#64748b' },
  taskEmptyDark: { color: '#94a3b8' },
  roleEmpty: { fontSize: 12 },
  roleEmptyLight: { color: '#64748b' },
  roleEmptyDark: { color: '#94a3b8' },
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)', justifyContent: 'flex-end' },
  drawer: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '70%' },
  drawerLight: { backgroundColor: '#fff' },
  drawerDark: { backgroundColor: '#0f172a' },
  drawerTitle: { fontWeight: '700', fontSize: 18 },
  drawerTitleLight: { color: '#0f172a' },
  drawerTitleDark: { color: '#f8fafc' },
  drawerSub: { fontSize: 12, marginTop: 4 },
  drawerSubLight: { color: '#64748b' },
  drawerSubDark: { color: '#94a3b8' },
  drawerList: { marginTop: 12 },
  drawerRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  drawerName: { fontWeight: '600' },
  drawerNameLight: { color: '#0f172a' },
  drawerNameDark: { color: '#e2e8f0' },
  drawerMeta: { marginTop: 4, fontSize: 12 },
  drawerMetaLight: { color: '#64748b' },
  drawerMetaDark: { color: '#94a3b8' },
  templateSection: { marginTop: 14, gap: 8 },
  templateHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  templateLabel: { fontSize: 13, fontWeight: '700', flex: 1 },
  templateAddButton: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  templateAddButtonLight: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  templateAddButtonDark: { borderColor: '#1d4ed8', backgroundColor: '#1e3a8a' },
  templateAddButtonText: { fontSize: 12, fontWeight: '700' },
  templateAddButtonTextLight: { color: '#1d4ed8' },
  templateAddButtonTextDark: { color: '#bfdbfe' },
  templateLabelLight: { color: '#334155' },
  templateLabelDark: { color: '#cbd5e1' },
  templateOption: { borderRadius: 10, borderWidth: 1, padding: 10 },
  templateOptionLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  templateOptionDark: { borderColor: '#334155', backgroundColor: '#111827' },
  templateOptionSelectedLight: { borderColor: '#1d4ed8', backgroundColor: '#dbeafe' },
  templateOptionSelectedDark: { borderColor: '#60a5fa', backgroundColor: '#1e3a8a' },
  templateOptionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  templateName: { fontWeight: '700', flex: 1 },
  templateNameLight: { color: '#0f172a' },
  templateNameDark: { color: '#e2e8f0' },
  templateBadge: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  templateBadgeSelected: { color: '#bfdbfe' },
  templateMeta: { marginTop: 4, fontSize: 12 },
  templateMetaLight: { color: '#475569' },
  templateMetaDark: { color: '#cbd5e1' },
  formField: { marginTop: 14, gap: 8 },
  templateInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  templateInputLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc', color: '#0f172a' },
  templateInputDark: { borderColor: '#334155', backgroundColor: '#111827', color: '#f8fafc' },
  drawerClose: { marginTop: 12, backgroundColor: '#1d4ed8', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerCloseDisabled: { opacity: 0.45 },
  drawerCloseText: { color: '#fff', fontWeight: '700' },
  drawerSecondaryButton: { marginTop: 10, borderWidth: 1, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerSecondaryButtonLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  drawerSecondaryButtonDark: { borderColor: '#334155', backgroundColor: '#111827' },
  drawerSecondaryButtonText: { fontWeight: '700' },
  drawerSecondaryButtonTextLight: { color: '#334155' },
  drawerSecondaryButtonTextDark: { color: '#cbd5e1' },
});
