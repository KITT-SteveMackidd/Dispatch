import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import {
  createDispatchEvent,
  loadUserProfilesByIds,
  respondToRoleAssignmentNotification,
  updateEventRoleAssignment,
  watchManagerEvents,
  watchManagerTeams,
  watchWorkerEvents,
  watchWorkerRoleAssignmentNotifications,
} from '@/services/dispatch';
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

type TemplateTaskPreview = {
  id: string;
  name: string;
  expectedOffsetMinutes: number;
};

type TemplateRolePreview = {
  id: string;
  name: string;
  tasks: TemplateTaskPreview[];
};

type EventTemplateOption = {
  id: string;
  name: string;
  roles?: TemplateRolePreview[];
  defaultLocation?: string;
  defaultTime?: string;
  defaultDescription?: string;
};

type CreateEventRoleDraft = {
  id: string;
  name: string;
  tasks: TemplateTaskPreview[];
  assignedWorkerId: string | null;
};

type TemplateRoleDraft = {
  id: string;
  name: string;
  tasks: TemplateTaskPreview[];
};

const INITIAL_TEMPLATE_OPTIONS: EventTemplateOption[] = [
  {
    id: 'street-team',
    name: 'Street Team Activation',
    roles: [
      {
        id: 'lead-ambassador',
        name: 'Lead Ambassador',
        tasks: [
          { id: 'briefing', name: 'Run pre-shift briefing', expectedOffsetMinutes: 10 },
          { id: 'zone-check', name: 'Confirm zone assignments', expectedOffsetMinutes: 25 },
          { id: 'checkpoint', name: 'Submit first-hour checkpoint', expectedOffsetMinutes: 60 },
        ],
      },
      {
        id: 'flyer-specialist',
        name: 'Flyer Specialist',
        tasks: [
          { id: 'pickup', name: 'Pick up flyer inventory', expectedOffsetMinutes: 5 },
          { id: 'rotation', name: 'Rotate handout hotspots', expectedOffsetMinutes: 45 },
          { id: 'recap', name: 'Report distribution totals', expectedOffsetMinutes: 90 },
        ],
      },
      {
        id: 'engagement-runner',
        name: 'Engagement Runner',
        tasks: [
          { id: 'script', name: 'Start engagement script rounds', expectedOffsetMinutes: 15 },
          { id: 'sampling', name: 'Launch sample sweep', expectedOffsetMinutes: 40 },
          { id: 'handoff', name: 'Handoff leads to manager', expectedOffsetMinutes: 100 },
        ],
      },
    ],
    defaultTime: '10:00',
    defaultLocation: 'Downtown',
    defaultDescription: 'Street-level promotion with handouts and passersby engagement.',
  },
  {
    id: 'mall-pop-up',
    name: 'Mall Pop-Up',
    roles: [
      {
        id: 'booth-manager',
        name: 'Booth Manager',
        tasks: [
          { id: 'open', name: 'Open booth and check signage', expectedOffsetMinutes: 10 },
          { id: 'stock', name: 'Verify promo stock levels', expectedOffsetMinutes: 35 },
          { id: 'closeout', name: 'Complete closeout checklist', expectedOffsetMinutes: 150 },
        ],
      },
      {
        id: 'demo-host',
        name: 'Demo Host',
        tasks: [
          { id: 'demo-start', name: 'Start first demo cycle', expectedOffsetMinutes: 20 },
          { id: 'qa', name: 'Run audience Q&A', expectedOffsetMinutes: 75 },
          { id: 'capture', name: 'Capture lead recap', expectedOffsetMinutes: 135 },
        ],
      },
    ],
    defaultTime: '12:00',
    defaultLocation: 'City Mall',
    defaultDescription: 'Retail-facing booth coverage with product demos and lead capture.',
  },
  {
    id: 'festival-booth',
    name: 'Festival Booth',
    roles: [
      {
        id: 'setup-captain',
        name: 'Setup Captain',
        tasks: [
          { id: 'arrival', name: 'Arrive and inspect footprint', expectedOffsetMinutes: 0 },
          { id: 'build', name: 'Complete booth buildout', expectedOffsetMinutes: 30 },
          { id: 'handoff', name: 'Handoff setup status', expectedOffsetMinutes: 50 },
        ],
      },
      {
        id: 'welcome-host',
        name: 'Welcome Host',
        tasks: [
          { id: 'welcome-open', name: 'Open welcome queue', expectedOffsetMinutes: 10 },
          { id: 'line-flow', name: 'Maintain line flow', expectedOffsetMinutes: 70 },
          { id: 'summary', name: 'Send engagement summary', expectedOffsetMinutes: 140 },
        ],
      },
      {
        id: 'sampling-lead',
        name: 'Sampling Lead',
        tasks: [
          { id: 'prep', name: 'Prep product samples', expectedOffsetMinutes: 15 },
          { id: 'wave-two', name: 'Start second sampling wave', expectedOffsetMinutes: 80 },
          { id: 'inventory', name: 'Log remaining samples', expectedOffsetMinutes: 155 },
        ],
      },
      {
        id: 'breakdown-support',
        name: 'Breakdown Support',
        tasks: [
          { id: 'pack', name: 'Pack teardown kits', expectedOffsetMinutes: 140 },
          { id: 'teardown', name: 'Teardown booth', expectedOffsetMinutes: 180 },
          { id: 'loadout', name: 'Finalize loadout checklist', expectedOffsetMinutes: 210 },
        ],
      },
    ],
    defaultTime: '09:00',
    defaultLocation: 'Festival Grounds',
    defaultDescription: 'High-traffic booth operation with staggered shift handoffs.',
  },
];

export default function EventsScreen() {
  const { profile } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ openTemplateDrawer?: string; templateId?: string }>();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [expandedRoleTaskIds, setExpandedRoleTaskIds] = useState<Record<string, boolean>>({});
  const [managerNames, setManagerNames] = useState<ManagerNamesMap>({});
  const [workerProfiles, setWorkerProfiles] = useState<UserMap>({});
  const [teamWorkerIds, setTeamWorkerIds] = useState<string[]>([]);
  const [replaceDrawer, setReplaceDrawer] = useState<DrawerState>(INITIAL_DRAWER);
  const [inviteDrawer, setInviteDrawer] = useState<DrawerState>(INITIAL_DRAWER);
  const [createEventDrawerOpen, setCreateEventDrawerOpen] = useState(false);
  const [createTemplateDrawerOpen, setCreateTemplateDrawerOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateNameDraft, setTemplateNameDraft] = useState('');
  const [templateDefaultTimeDraft, setTemplateDefaultTimeDraft] = useState('');
  const [templateDefaultLocationDraft, setTemplateDefaultLocationDraft] = useState('');
  const [templateDefaultDescriptionDraft, setTemplateDefaultDescriptionDraft] = useState('');
  const [templateRolesDraft, setTemplateRolesDraft] = useState<TemplateRoleDraft[]>([]);
  const [templateOptions, setTemplateOptions] = useState<EventTemplateOption[]>(INITIAL_TEMPLATE_OPTIONS);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(INITIAL_TEMPLATE_OPTIONS[0]?.id || '');
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [reopenCreateEventAfterTemplateFlow, setReopenCreateEventAfterTemplateFlow] = useState(false);
  const [pendingRoleNotifications, setPendingRoleNotifications] = useState<Array<{
    id: string;
    action: 'assign' | 'remove';
    eventName?: string;
    roleId: string;
  }>>([]);
  const [notificationBusyId, setNotificationBusyId] = useState<string | null>(null);
  const [eventDateDraft, setEventDateDraft] = useState('');
  const [eventTimeDraft, setEventTimeDraft] = useState('');
  const [eventLocationDraft, setEventLocationDraft] = useState('');
  const [eventDescriptionDraft, setEventDescriptionDraft] = useState('');
  const [createEventRolesDraft, setCreateEventRolesDraft] = useState<CreateEventRoleDraft[]>([]);
  const [optimisticCreatedEvents, setOptimisticCreatedEvents] = useState<DispatchEvent[]>([]);
  const [rolePickerRoleId, setRolePickerRoleId] = useState<string | null>(null);
  const [assignmentBusyKey, setAssignmentBusyKey] = useState<string | null>(null);
  const canCreateEvent = profile?.role === 'manager';

  const buildCreateEventRolesDraft = (template?: EventTemplateOption): CreateEventRoleDraft[] => {
    if (!template?.roles?.length) return [];

    return template.roles.map((role, index) => ({
      id: role.id || `role-${index + 1}`,
      name: role.name || `Role ${index + 1}`,
      tasks: role.tasks || [],
      assignedWorkerId: null,
    }));
  };

  const getTemplateRoleCount = (template: EventTemplateOption) => template.roles?.length ?? 0;
  const getTemplateTaskCount = (template: EventTemplateOption) => (template.roles || []).reduce((sum, role) => sum + (role.tasks?.length || 0), 0);
  const formatTaskOffset = (offsetMinutes: number) => `+${offsetMinutes}m`;

  useEffect(() => {
    if (!profile) return;
    return profile.role === 'manager'
      ? watchManagerEvents(profile.uid, (items) => {
          setEvents(items);
          setOptimisticCreatedEvents((prev) => prev.filter((pending) => !items.some((item) => item.id === pending.id)));
        })
      : watchWorkerEvents(profile.uid, (items) => {
          setEvents(items);
          setOptimisticCreatedEvents((prev) => prev.filter((pending) => !items.some((item) => item.id === pending.id)));
        });
  }, [profile]);

  useEffect(() => {
    if (profile?.role !== 'manager') return;

    return watchManagerTeams(profile.uid, (teams) => {
      const workerIds = [...new Set(teams.flatMap((team) => team.workerIds || []).filter(Boolean))];
      setTeamWorkerIds(workerIds);
    });
  }, [profile]);

  useEffect(() => {
    if (profile?.role !== 'worker') {
      setPendingRoleNotifications([]);
      return;
    }

    return watchWorkerRoleAssignmentNotifications(profile.uid, (items) => {
      setPendingRoleNotifications(items.map((item) => ({
        id: item.id,
        action: item.action,
        eventName: item.eventName,
        roleId: item.roleId,
      })));
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

    const initialTemplate = templateOptions.find((template) => template.id === selectedTemplateId) || templateOptions[0];
    setEventDateDraft('');
    setEventTimeDraft(initialTemplate?.defaultTime || '');
    setEventLocationDraft(initialTemplate?.defaultLocation || '');
    setEventDescriptionDraft(initialTemplate?.defaultDescription || '');
    setCreateEventRolesDraft(buildCreateEventRolesDraft(initialTemplate));
    setRolePickerRoleId(null);
    setCreateEventDrawerOpen(true);
  };

  const closeCreateEventDrawer = () => {
    setCreateEventDrawerOpen(false);
    setRolePickerRoleId(null);
  };

  const openTemplatePickerFromCreateEvent = () => {
    setReopenCreateEventAfterTemplateFlow(true);
    setCreateEventDrawerOpen(false);
    setTemplatePickerOpen(true);
  };

  const openCreateTemplateDrawer = (template?: EventTemplateOption) => {
    setTemplatePickerOpen(false);
    if (template) {
      setEditingTemplateId(template.id);
      setTemplateNameDraft(template.name);
      setTemplateDefaultTimeDraft(template.defaultTime || '');
      setTemplateDefaultLocationDraft(template.defaultLocation || '');
      setTemplateDefaultDescriptionDraft(template.defaultDescription || '');
      setTemplateRolesDraft((template.roles || []).map((role, index) => ({
        id: role.id || `role-${index + 1}`,
        name: role.name || `Role ${index + 1}`,
        tasks: role.tasks || [],
      })));
    } else {
      setEditingTemplateId(null);
      setTemplateNameDraft('');
      setTemplateDefaultTimeDraft('');
      setTemplateDefaultLocationDraft('');
      setTemplateDefaultDescriptionDraft('');
      setTemplateRolesDraft([]);
    }
    setCreateTemplateDrawerOpen(true);
  };

  const openCreateTemplateDrawerFromCreateEvent = (template?: EventTemplateOption) => {
    setReopenCreateEventAfterTemplateFlow(true);
    setCreateEventDrawerOpen(false);
    openCreateTemplateDrawer(template);
  };

  const closeCreateTemplateDrawer = () => {
    setCreateTemplateDrawerOpen(false);
    setEditingTemplateId(null);
    setTemplateNameDraft('');
    setTemplateDefaultTimeDraft('');
    setTemplateDefaultLocationDraft('');
    setTemplateDefaultDescriptionDraft('');
    setTemplateRolesDraft([]);

    if (reopenCreateEventAfterTemplateFlow) {
      setCreateEventDrawerOpen(true);
      setReopenCreateEventAfterTemplateFlow(false);
    }
  };

  const closeTemplatePicker = () => {
    setTemplatePickerOpen(false);
    if (reopenCreateEventAfterTemplateFlow) {
      setCreateEventDrawerOpen(true);
      setReopenCreateEventAfterTemplateFlow(false);
    }
  };

  useEffect(() => {
    if (params.openTemplateDrawer !== '1') return;

    const requestedTemplateId = typeof params.templateId === 'string' ? params.templateId : null;
    const requestedTemplate = requestedTemplateId ? templateOptions.find((template) => template.id === requestedTemplateId) : undefined;

    if (requestedTemplate) {
      setSelectedTemplateId(requestedTemplate.id);
      openCreateTemplateDrawer(requestedTemplate);
    } else {
      openCreateTemplateDrawer();
    }

    router.setParams({ openTemplateDrawer: undefined, templateId: undefined });
  }, [params.openTemplateDrawer, params.templateId, router, templateOptions]);

  const saveTemplate = () => {
    const name = templateNameDraft.trim();
    if (!name) return;

    const sanitizedRoles = templateRolesDraft
      .map((role, index) => {
        const sanitizedTasks = role.tasks
          .map((task, taskIndex) => ({
            id: task.id || `task-${Date.now()}-${taskIndex + 1}`,
            name: task.name.trim(),
            expectedOffsetMinutes: Number.isFinite(task.expectedOffsetMinutes)
              ? Math.max(0, Math.round(task.expectedOffsetMinutes))
              : 0,
          }))
          .filter((task) => task.name.length > 0);

        return {
          ...role,
          name: role.name.trim() || `Role ${index + 1}`,
          tasks: sanitizedTasks,
        };
      })
      .filter((role) => role.name.length > 0);

    if (editingTemplateId) {
      setTemplateOptions((prev) => prev.map((template) => (
        template.id === editingTemplateId
          ? {
              ...template,
              name,
              roles: sanitizedRoles,
              defaultTime: templateDefaultTimeDraft.trim() || undefined,
              defaultLocation: templateDefaultLocationDraft.trim() || undefined,
              defaultDescription: templateDefaultDescriptionDraft.trim() || undefined,
            }
          : template
      )));
      closeCreateTemplateDrawer();
      return;
    }

    const id = `custom-${Date.now()}`;
    const nextTemplate: EventTemplateOption = {
      id,
      name,
      roles: sanitizedRoles,
      defaultTime: templateDefaultTimeDraft.trim() || undefined,
      defaultLocation: templateDefaultLocationDraft.trim() || undefined,
      defaultDescription: templateDefaultDescriptionDraft.trim() || undefined,
    };

    setTemplateOptions((prev) => [nextTemplate, ...prev]);
    setSelectedTemplateId(id);
    closeCreateTemplateDrawer();
  };

  const addTemplateRoleDraft = () => {
    setTemplateRolesDraft((prev) => [
      ...prev,
      {
        id: `role-${Date.now()}-${prev.length + 1}`,
        name: `Role ${prev.length + 1}`,
        tasks: [],
      },
    ]);
  };

  const updateTemplateRoleDraftName = (roleId: string, name: string) => {
    setTemplateRolesDraft((prev) => prev.map((role) => (role.id === roleId ? { ...role, name } : role)));
  };

  const removeTemplateRoleDraft = (roleId: string) => {
    setTemplateRolesDraft((prev) => prev.filter((role) => role.id !== roleId));
  };

  const addTemplateTaskDraft = (roleId: string) => {
    setTemplateRolesDraft((prev) => prev.map((role) => {
      if (role.id !== roleId) return role;
      return {
        ...role,
        tasks: [
          ...role.tasks,
          {
            id: `task-${Date.now()}-${role.tasks.length + 1}`,
            name: '',
            expectedOffsetMinutes: role.tasks.length ? role.tasks[role.tasks.length - 1].expectedOffsetMinutes + 15 : 15,
          },
        ],
      };
    }));
  };

  const updateTemplateTaskDraft = (
    roleId: string,
    taskId: string,
    updates: Partial<TemplateTaskPreview>
  ) => {
    setTemplateRolesDraft((prev) => prev.map((role) => {
      if (role.id !== roleId) return role;
      return {
        ...role,
        tasks: role.tasks.map((task) => {
          if (task.id !== taskId) return task;
          const nextOffset = updates.expectedOffsetMinutes;
          return {
            ...task,
            ...updates,
            expectedOffsetMinutes:
              nextOffset === undefined || Number.isNaN(nextOffset)
                ? task.expectedOffsetMinutes
                : Math.max(0, Math.round(nextOffset)),
          };
        }),
      };
    }));
  };

  const removeTemplateTaskDraft = (roleId: string, taskId: string) => {
    setTemplateRolesDraft((prev) => prev.map((role) => (
      role.id === roleId
        ? { ...role, tasks: role.tasks.filter((task) => task.id !== taskId) }
        : role
    )));
  };

  const deleteTemplate = (template: EventTemplateOption) => {
    Alert.alert(
      'Delete Template',
      `Delete "${template.name}" permanently?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setTemplateOptions((prev) => {
              const remaining = prev.filter((option) => option.id !== template.id);
              if (!remaining.length) return prev;
              if (selectedTemplateId === template.id) {
                setSelectedTemplateId(remaining[0].id);
              }
              return remaining;
            });
          },
        },
      ]
    );
  };

  const upcoming = useMemo(
    () => {
      const combined = [...events, ...optimisticCreatedEvents];
      const unique = combined.filter((event, index, list) => list.findIndex((item) => item.id === event.id) === index);
      return unique.filter((e) => new Date(e.startsAt).getTime() >= Date.now()).sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
    },
    [events, optimisticCreatedEvents]
  );

  const toggleExpanded = (eventId: string) => {
    setExpandedIds((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  const toggleRoleTaskExpanded = (eventId: string, roleId: string) => {
    const key = `${eventId}:${roleId}`;
    setExpandedRoleTaskIds((prev) => ({ ...prev, [key]: !prev[key] }));
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
    const roleExpandKey = `${event.id}:${role.id}`;
    const roleTasksExpanded = !!expandedRoleTaskIds[roleExpandKey];

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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${roleTasksExpanded ? 'Hide' : 'Show'} tasks for ${role.name}`}
          style={styles.roleTaskToggle}
          onPress={() => toggleRoleTaskExpanded(event.id, role.id)}>
          <Text style={[styles.expandHint, isDarkMode ? styles.expandHintDark : styles.expandHintLight]}>
            {roleTasksExpanded ? 'Hide tasks ▲' : `Show tasks (${role.tasks.length}) ▼`}
          </Text>
        </Pressable>

        {roleTasksExpanded ? (
          <View style={styles.taskList}>
            {role.tasks.map((task) => (
              <View key={task.id} style={styles.taskRow}>
                <Text style={[styles.taskName, isDarkMode ? styles.taskNameDark : styles.taskNameLight]}>• {task.name}{task.optional ? ' (optional)' : ''}</Text>
              </View>
            ))}
          </View>
        ) : null}

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
  const rolePickerTarget = createEventRolesDraft.find((role) => role.id === rolePickerRoleId) || null;
  const isEditingTemplate = !!editingTemplateId;

  const assignWorkerToCreateEventRole = (workerId: string) => {
    if (!rolePickerRoleId) return;
    setCreateEventRolesDraft((prev) => prev.map((role) => (role.id === rolePickerRoleId ? { ...role, assignedWorkerId: workerId } : role)));
    setRolePickerRoleId(null);
  };

  const clearWorkerFromCreateEventRole = () => {
    if (!rolePickerRoleId) return;
    setCreateEventRolesDraft((prev) => prev.map((role) => (role.id === rolePickerRoleId ? { ...role, assignedWorkerId: null } : role)));
    setRolePickerRoleId(null);
  };

  const handleRoleAssignmentUpdate = async (params: {
    eventId: string;
    roleId: string;
    workerId: string;
    currentlyAssigned: boolean;
  }) => {
    if (!profile?.uid) return;

    const busyKey = `${params.eventId}:${params.roleId}:${params.workerId}`;
    if (assignmentBusyKey === busyKey) return;

    const action = params.currentlyAssigned ? 'remove' : 'assign';

    try {
      setAssignmentBusyKey(busyKey);
      await updateEventRoleAssignment({
        eventId: params.eventId,
        roleId: params.roleId,
        managerId: profile.uid,
        workerId: params.workerId,
        action,
      });

      Alert.alert(
        action === 'assign' ? 'Assignment sent' : 'Removal sent',
        `${workerLabel(params.workerId)} can now accept or decline this ${action === 'assign' ? 'role assignment' : 'role removal'} notification.`
      );
    } catch (error) {
      Alert.alert('Unable to update role', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setAssignmentBusyKey(null);
    }
  };

  useEffect(() => {
    if (!createEventDrawerOpen || !selectedTemplate) return;
    setEventTimeDraft(selectedTemplate.defaultTime || '');
    setEventLocationDraft(selectedTemplate.defaultLocation || '');
    setEventDescriptionDraft(selectedTemplate.defaultDescription || '');
    setCreateEventRolesDraft(buildCreateEventRolesDraft(selectedTemplate));
    setRolePickerRoleId(null);
  }, [createEventDrawerOpen, selectedTemplate?.id]);

  const handleRoleNotificationResponse = async (notificationId: string, response: 'accept' | 'decline') => {
    if (!profile?.uid || notificationBusyId === notificationId) return;
    try {
      setNotificationBusyId(notificationId);
      await respondToRoleAssignmentNotification({ notificationId, workerId: profile.uid, response });
    } catch (error) {
      Alert.alert('Unable to respond', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setNotificationBusyId(null);
    }
  };

  const handleCreateEvent = async () => {
    if (!profile?.uid || !selectedTemplate) return;

    try {
      const createdEvent = await createDispatchEvent({
        managerId: profile.uid,
        name: selectedTemplate.name,
        date: eventDateDraft,
        time: eventTimeDraft,
        location: eventLocationDraft,
        description: eventDescriptionDraft,
        roles: createEventRolesDraft,
      });
      setOptimisticCreatedEvents((prev) => [createdEvent, ...prev.filter((item) => item.id !== createdEvent.id)]);
      Alert.alert('Event created', 'Your event has been created and added to upcoming assignments.');
      closeCreateEventDrawer();
    } catch (error) {
      Alert.alert('Unable to create event', error instanceof Error ? error.message : 'Please check required fields and try again.');
    }
  };

  const hasEventSchedule = eventDateDraft.trim().length > 0 && eventTimeDraft.trim().length > 0;
  const canCreateEventNow = !!selectedTemplate && hasEventSchedule && eventLocationDraft.trim().length > 0 && eventDescriptionDraft.trim().length > 0;

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
      {profile?.role === 'worker' && pendingRoleNotifications.length ? (
        <View style={[styles.pendingNotificationsCard, isDarkMode ? styles.pendingNotificationsCardDark : styles.pendingNotificationsCardLight]}>
          <Text style={[styles.pendingNotificationsTitle, isDarkMode ? styles.pendingNotificationsTitleDark : styles.pendingNotificationsTitleLight]}>
            Role updates need your response
          </Text>
          {pendingRoleNotifications.map((notification) => {
            const busy = notificationBusyId === notification.id;
            return (
              <View key={notification.id} style={styles.pendingNotificationRow}>
                <Text style={[styles.pendingNotificationText, isDarkMode ? styles.metaDark : styles.metaLight]}>
                  {notification.eventName || 'Event'} · {notification.action === 'assign' ? 'Assigned to role' : 'Removed from role'}
                </Text>
                <View style={styles.pendingNotificationActions}>
                  <Pressable
                    disabled={busy}
                    style={[
                      styles.pendingActionButton,
                      isDarkMode ? styles.pendingActionDeclineDark : styles.pendingActionDeclineLight,
                      busy && styles.drawerCloseDisabled,
                    ]}
                    onPress={() => handleRoleNotificationResponse(notification.id, 'decline')}>
                    <Text style={[styles.pendingActionButtonText, isDarkMode ? styles.pendingActionDeclineTextDark : styles.pendingActionDeclineTextLight]}>
                      {busy ? '…' : 'Decline'}
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={busy}
                    style={[
                      styles.pendingActionButton,
                      isDarkMode ? styles.pendingActionAcceptDark : styles.pendingActionAcceptLight,
                      busy && styles.drawerCloseDisabled,
                    ]}
                    onPress={() => handleRoleNotificationResponse(notification.id, 'accept')}>
                    <Text style={[styles.pendingActionButtonText, isDarkMode ? styles.pendingActionAcceptTextDark : styles.pendingActionAcceptTextLight]}>{busy ? '…' : 'Accept'}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      <FlatList
        data={upcoming}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={[styles.empty, isDarkMode ? styles.emptyDark : styles.emptyLight]}>No upcoming assignments.</Text>}
        renderItem={({ item }) => {
          const expanded = !!expandedIds[item.id];
          const managerLabel = managerNames[item.managerId] || 'Manager';
          const startsAtDate = new Date(item.startsAt);
          const eventDate = startsAtDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
          const eventTime = startsAtDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const signupRatio = getWorkerSignupRatio(item);

          return (
            <Pressable
              style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}
              onPress={() => toggleExpanded(item.id)}>
              <View style={styles.row}>
                <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>{item.name}</Text>
                <View style={[styles.statusPill, isDarkMode ? styles.statusPillDark : styles.statusPillLight]}><Text style={[styles.statusText, isDarkMode ? styles.statusTextDark : styles.statusTextLight]}>Upcoming</Text></View>
              </View>

              <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>{item.location} • {eventDate} • {eventTime}</Text>

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
              {teamWorkerIds.length ? teamWorkerIds.map((workerId) => {
                const assigned = !!replaceTarget?.role.assignedWorkerIds.includes(workerId);
                const busy = assignmentBusyKey === `${replaceTarget?.event.id}:${replaceTarget?.role.id}:${workerId}`;

                return (
                  <View key={`replace-${workerId}`} style={styles.drawerRow}>
                    <Text style={[styles.drawerName, isDarkMode ? styles.drawerNameDark : styles.drawerNameLight]}>{workerLabel(workerId)}</Text>
                    <Pressable
                      disabled={assigned || busy || !replaceTarget}
                      onPress={() => {
                        if (!replaceTarget) return;
                        handleRoleAssignmentUpdate({
                          eventId: replaceTarget.event.id,
                          roleId: replaceTarget.role.id,
                          workerId,
                          currentlyAssigned: false,
                        });
                      }}>
                      <Text style={[styles.drawerMeta, isDarkMode ? styles.drawerMetaDark : styles.drawerMetaLight]}>{assigned ? 'Already assigned' : busy ? 'Sending…' : 'Assign + notify'}</Text>
                    </Pressable>
                  </View>
                );
              }) : <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No team workers available.</Text>}
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
                const busy = assignmentBusyKey === `${inviteTarget?.event.id}:${inviteTarget?.role.id}:${workerId}`;
                return (
                  <View key={`invite-${workerId}`} style={styles.drawerRow}>
                    <Text style={[styles.drawerName, isDarkMode ? styles.drawerNameDark : styles.drawerNameLight]}>{workerLabel(workerId)}</Text>
                    <Pressable
                      disabled={busy || !inviteTarget}
                      onPress={() => {
                        if (!inviteTarget) return;
                        handleRoleAssignmentUpdate({
                          eventId: inviteTarget.event.id,
                          roleId: inviteTarget.role.id,
                          workerId,
                          currentlyAssigned: assigned,
                        });
                      }}>
                      <Text style={[styles.drawerMeta, isDarkMode ? styles.drawerMetaDark : styles.drawerMetaLight]}>
                        {busy ? 'Sending…' : assigned ? 'Remove + notify' : 'Assign + notify'}
                      </Text>
                    </Pressable>
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
          <KeyboardAvoidingView
            style={styles.keyboardAvoidingFill}
            behavior={Platform.select({ ios: 'padding', android: 'height' })}
            keyboardVerticalOffset={Platform.select({ ios: 20, android: 0 })}>
            <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={Keyboard.dismiss}>
            <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>Create Event</Text>
            <Text style={[styles.drawerSub, isDarkMode ? styles.drawerSubDark : styles.drawerSubLight]}>Choose a template to start your event setup.</Text>

            <ScrollView
              style={styles.createEventScroll}
              contentContainerStyle={styles.createEventScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator>
            <View style={styles.templateSection}>
              <View style={styles.templateHeaderRow}>
                <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Event template</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create new template"
                  style={[styles.templateAddButton, isDarkMode ? styles.templateAddButtonDark : styles.templateAddButtonLight]}
                  onPress={() => openCreateTemplateDrawerFromCreateEvent()}>
                  <Text style={[styles.templateAddButtonText, isDarkMode ? styles.templateAddButtonTextDark : styles.templateAddButtonTextLight]}>+ New Template</Text>
                </Pressable>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open template selector"
                style={[styles.templateSelectTrigger, isDarkMode ? styles.templateSelectTriggerDark : styles.templateSelectTriggerLight]}
                onPress={openTemplatePickerFromCreateEvent}>
                <View>
                  <Text style={[styles.templateName, isDarkMode ? styles.templateNameDark : styles.templateNameLight]}>{selectedTemplate?.name || 'Select template'}</Text>
                  {selectedTemplate ? (
                    <Text style={[styles.templateMeta, isDarkMode ? styles.templateMetaDark : styles.templateMetaLight]}>
                      {getTemplateRoleCount(selectedTemplate)} roles · {getTemplateTaskCount(selectedTemplate)} tasks
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.templateMeta, isDarkMode ? styles.templateMetaDark : styles.templateMetaLight]}>▼</Text>
              </Pressable>

              {selectedTemplate ? (
                <View style={styles.templateActionRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${selectedTemplate.name} template`}
                    onPress={() => openCreateTemplateDrawerFromCreateEvent(selectedTemplate)}
                    style={[styles.templateActionButton, isDarkMode ? styles.templateActionButtonDark : styles.templateActionButtonLight]}>
                    <Text style={[styles.templateActionButtonText, isDarkMode ? styles.templateActionButtonTextDark : styles.templateActionButtonTextLight]}>Edit</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${selectedTemplate.name} template`}
                    onPress={() => deleteTemplate(selectedTemplate)}
                    disabled={templateOptions.length <= 1}
                    style={[
                      styles.templateActionButton,
                      isDarkMode ? styles.templateDeleteButtonDark : styles.templateDeleteButtonLight,
                      templateOptions.length <= 1 && styles.templateActionButtonDisabled,
                    ]}>
                    <Text style={[styles.templateActionButtonText, isDarkMode ? styles.templateDeleteButtonTextDark : styles.templateDeleteButtonTextLight]}>Delete</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Roles needed for this event</Text>
              <View style={[styles.rolePreviewContainer, isDarkMode ? styles.rolePreviewContainerDark : styles.rolePreviewContainerLight]}>
                {createEventRolesDraft.length ? (
                  createEventRolesDraft.map((role) => {
                    const assignedLabel = role.assignedWorkerId ? workerLabel(role.assignedWorkerId) : null;
                    const avatarInitial = assignedLabel ? assignedLabel.slice(0, 1).toUpperCase() : '+';

                    return (
                      <View key={`${selectedTemplate?.id}-${role.id}`} style={styles.rolePreviewRow}>
                        <View style={styles.rolePreviewLeft}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${role.assignedWorkerId ? 'Change' : 'Assign'} worker for ${role.name}`}
                            style={[
                              styles.rolePreviewAvatar,
                              role.assignedWorkerId
                                ? (isDarkMode ? styles.rolePreviewAvatarAssignedDark : styles.rolePreviewAvatarAssignedLight)
                                : (isDarkMode ? styles.rolePreviewAvatarDark : styles.rolePreviewAvatarLight),
                            ]}
                            onPress={() => setRolePickerRoleId(role.id)}>
                            <Text style={styles.rolePreviewAvatarText}>{avatarInitial}</Text>
                          </Pressable>
                          <Text style={[styles.rolePreviewName, isDarkMode ? styles.rolePreviewNameDark : styles.rolePreviewNameLight]}>{role.name}</Text>
                        </View>
                        <Text style={[styles.rolePreviewMeta, isDarkMode ? styles.rolePreviewMetaDark : styles.rolePreviewMetaLight]}>
                          {assignedLabel ? assignedLabel : 'Tap avatar to assign'} · {role.tasks.length} tasks
                        </Text>
                        {!!role.tasks.length ? (
                          <Text style={[styles.rolePreviewMeta, isDarkMode ? styles.rolePreviewMetaDark : styles.rolePreviewMetaLight]}>
                            Next due: {formatTaskOffset(Math.min(...role.tasks.map((task) => task.expectedOffsetMinutes)))} from start
                          </Text>
                        ) : null}
                      </View>
                    );
                  })
                ) : (
                  <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>
                    No roles in this template yet. Add roles while editing the template.
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Event date (YYYY-MM-DD)</Text>
              <TextInput
                value={eventDateDraft}
                onChangeText={setEventDateDraft}
                autoCapitalize="none"
                placeholder="2026-06-15"
                placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
                returnKeyType="next"
                blurOnSubmit={false}
                style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
              />
            </View>

            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Event time (24h)</Text>
              <TextInput
                value={eventTimeDraft}
                onChangeText={setEventTimeDraft}
                autoCapitalize="none"
                placeholder="14:30"
                placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
                returnKeyType="next"
                blurOnSubmit={false}
                style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
              />
            </View>

            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Location</Text>
              <TextInput
                value={eventLocationDraft}
                onChangeText={setEventLocationDraft}
                placeholder="Downtown"
                placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
                returnKeyType="next"
                blurOnSubmit={false}
                style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
              />
            </View>

            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Description</Text>
              <TextInput
                value={eventDescriptionDraft}
                onChangeText={setEventDescriptionDraft}
                placeholder="Describe this event for workers"
                placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
                multiline
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                blurOnSubmit
                style={[styles.templateTextArea, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
              />
            </View>

            <Pressable
              style={[styles.drawerKeyboardDismiss, isDarkMode ? styles.drawerSecondaryButtonDark : styles.drawerSecondaryButtonLight]}
              onPress={Keyboard.dismiss}>
              <Text style={[styles.drawerSecondaryButtonText, isDarkMode ? styles.drawerSecondaryButtonTextDark : styles.drawerSecondaryButtonTextLight]}>Done typing</Text>
            </Pressable>

            <Pressable
              style={[styles.drawerClose, !canCreateEventNow && styles.drawerCloseDisabled]}
              disabled={!canCreateEventNow}
              onPress={handleCreateEvent}>
              <Text style={styles.drawerCloseText}>Create Event</Text>
            </Pressable>
            <Pressable style={[styles.drawerSecondaryButton, isDarkMode ? styles.drawerSecondaryButtonDark : styles.drawerSecondaryButtonLight]} onPress={closeCreateEventDrawer}>
              <Text style={[styles.drawerSecondaryButtonText, isDarkMode ? styles.drawerSecondaryButtonTextDark : styles.drawerSecondaryButtonTextLight]}>Cancel</Text>
            </Pressable>
            </ScrollView>
          </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <Modal visible={templatePickerOpen} animationType="slide" transparent onRequestClose={closeTemplatePicker}>
        <Pressable style={styles.drawerBackdrop} onPress={closeTemplatePicker}>
          <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => null}>
            <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>Select Template</Text>
            <ScrollView style={styles.drawerList}>
              {templateOptions.map((template) => {
                const selected = template.id === selectedTemplate?.id;
                return (
                  <Pressable
                    key={`combo-${template.id}`}
                    style={styles.drawerRow}
                    onPress={() => {
                      setSelectedTemplateId(template.id);
                      closeTemplatePicker();
                    }}>
                    <Text style={[styles.drawerName, isDarkMode ? styles.drawerNameDark : styles.drawerNameLight]}>
                      {template.name} {selected ? '✓' : ''}
                    </Text>
                    <Text style={[styles.drawerMeta, isDarkMode ? styles.drawerMetaDark : styles.drawerMetaLight]}>
                      {getTemplateRoleCount(template)} roles · {getTemplateTaskCount(template)} tasks
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={styles.drawerClose} onPress={closeTemplatePicker}>
              <Text style={styles.drawerCloseText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!rolePickerRoleId} animationType="slide" transparent onRequestClose={() => setRolePickerRoleId(null)}>
        <Pressable style={styles.drawerBackdrop} onPress={() => setRolePickerRoleId(null)}>
          <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => null}>
            <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>Assign Worker</Text>
            <Text style={[styles.drawerSub, isDarkMode ? styles.drawerSubDark : styles.drawerSubLight]}>
              Role: {rolePickerTarget?.name || 'Unknown role'}
            </Text>
            <ScrollView style={styles.drawerList}>
              {rolePickerTarget?.assignedWorkerId ? (
                <Pressable style={[styles.drawerButton, styles.drawerDestructiveButton]} onPress={clearWorkerFromCreateEventRole}>
                  <Text style={styles.drawerDestructiveButtonText}>Remove assigned worker</Text>
                </Pressable>
              ) : null}

              {teamWorkerIds.length ? teamWorkerIds.map((workerId) => {
                const selected = rolePickerTarget?.assignedWorkerId === workerId;
                return (
                  <Pressable key={`role-picker-${workerId}`} style={styles.drawerRow} onPress={() => assignWorkerToCreateEventRole(workerId)}>
                    <Text style={[styles.drawerName, isDarkMode ? styles.drawerNameDark : styles.drawerNameLight]}>{workerLabel(workerId)}</Text>
                    <Text style={[styles.drawerMeta, isDarkMode ? styles.drawerMetaDark : styles.drawerMetaLight]}>{selected ? 'Assigned · tap to reassign' : 'Tap to assign'}</Text>
                  </Pressable>
                );
              }) : <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No team workers available.</Text>}
            </ScrollView>
            <Pressable style={styles.drawerClose} onPress={() => setRolePickerRoleId(null)}>
              <Text style={styles.drawerCloseText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={createTemplateDrawerOpen} animationType="slide" transparent onRequestClose={closeCreateTemplateDrawer}>
        <Pressable style={styles.drawerBackdrop} onPress={closeCreateTemplateDrawer}>
          <KeyboardAvoidingView
            style={styles.keyboardAvoidingFill}
            behavior={Platform.select({ ios: 'padding', android: 'height' })}
            keyboardVerticalOffset={Platform.select({ ios: 20, android: 0 })}>
            <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={Keyboard.dismiss}>
            <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>{isEditingTemplate ? 'Edit Template' : 'Create Template'}</Text>
            <Text style={[styles.drawerSub, isDarkMode ? styles.drawerSubDark : styles.drawerSubLight]}>{isEditingTemplate ? 'Update this template. Changes are saved permanently.' : 'Add a template you can reuse while creating events.'}</Text>

            <ScrollView
              style={styles.createEventScroll}
              contentContainerStyle={styles.createEventScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator>
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


            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Default event time (24h, optional)</Text>
              <TextInput
                value={templateDefaultTimeDraft}
                onChangeText={setTemplateDefaultTimeDraft}
                autoCapitalize="none"
                placeholder="14:30"
                placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                blurOnSubmit
                style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
              />
            </View>

            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Default location (optional)</Text>
              <TextInput
                value={templateDefaultLocationDraft}
                onChangeText={setTemplateDefaultLocationDraft}
                placeholder="Downtown"
                placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
                style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
              />
            </View>

            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Default description (optional)</Text>
              <TextInput
                value={templateDefaultDescriptionDraft}
                onChangeText={setTemplateDefaultDescriptionDraft}
                placeholder="Describe this template"
                placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
                multiline
                style={[styles.templateTextArea, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
              />
            </View>
            <View style={styles.formField}>
              <View style={styles.templateHeaderRow}>
                <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Roles</Text>
                <Pressable
                  accessibilityLabel="Add role to template"
                  style={[styles.templateAddButton, isDarkMode ? styles.templateAddButtonDark : styles.templateAddButtonLight]}
                  onPress={addTemplateRoleDraft}>
                  <Text style={[styles.templateAddButtonText, isDarkMode ? styles.templateAddButtonTextDark : styles.templateAddButtonTextLight]}>+ Add Role</Text>
                </Pressable>
              </View>
              <View style={[styles.rolePreviewContainer, isDarkMode ? styles.rolePreviewContainerDark : styles.rolePreviewContainerLight]}>
                {templateRolesDraft.length ? templateRolesDraft.map((role, index) => (
                  <View key={role.id} style={[styles.templateRoleEditor, isDarkMode ? styles.templateRoleEditorDark : styles.templateRoleEditorLight]}>
                    <View style={styles.templateRoleHeader}>
                      <Text style={[styles.rolePreviewName, isDarkMode ? styles.rolePreviewNameDark : styles.rolePreviewNameLight]}>Role {index + 1}</Text>
                      <Pressable
                        accessibilityLabel={`Delete role ${role.name || index + 1}`}
                        style={[styles.templateActionButton, isDarkMode ? styles.templateDeleteButtonDark : styles.templateDeleteButtonLight]}
                        onPress={() => removeTemplateRoleDraft(role.id)}>
                        <Text style={[styles.templateActionButtonText, isDarkMode ? styles.templateDeleteButtonTextDark : styles.templateDeleteButtonTextLight]}>Delete</Text>
                      </Pressable>
                    </View>

                    <TextInput
                      value={role.name}
                      onChangeText={(value) => updateTemplateRoleDraftName(role.id, value)}
                      placeholder={`Role ${index + 1}`}
                      placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
                      style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
                    />

                    <View style={styles.templateRoleTaskHeader}>
                      <Text style={[styles.rolePreviewMeta, isDarkMode ? styles.rolePreviewMetaDark : styles.rolePreviewMetaLight]}>{role.tasks.length} tasks configured</Text>
                      <Pressable
                        accessibilityLabel={`Add task to ${role.name || `role ${index + 1}`}`}
                        style={[styles.templateActionButton, isDarkMode ? styles.templateActionButtonDark : styles.templateActionButtonLight]}
                        onPress={() => addTemplateTaskDraft(role.id)}>
                        <Text style={[styles.templateActionButtonText, isDarkMode ? styles.templateActionButtonTextDark : styles.templateActionButtonTextLight]}>+ Add Task</Text>
                      </Pressable>
                    </View>

                    {role.tasks.length ? role.tasks.map((task, taskIndex) => (
                      <View key={task.id} style={[styles.templateTaskRow, isDarkMode ? styles.templateTaskRowDark : styles.templateTaskRowLight]}>
                        <Text style={[styles.templateTaskLabel, isDarkMode ? styles.rolePreviewMetaDark : styles.rolePreviewMetaLight]}>Task {taskIndex + 1}</Text>
                        <TextInput
                          value={task.name}
                          onChangeText={(value) => updateTemplateTaskDraft(role.id, task.id, { name: value })}
                          placeholder="Task name"
                          placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
                          style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
                        />
                        <TextInput
                          value={`${task.expectedOffsetMinutes}`}
                          onChangeText={(value) => updateTemplateTaskDraft(role.id, task.id, { expectedOffsetMinutes: Number.parseInt(value || '0', 10) || 0 })}
                          keyboardType="numeric"
                          returnKeyType="done"
                          onSubmitEditing={Keyboard.dismiss}
                          blurOnSubmit
                          placeholder="Minutes from event start"
                          placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
                          style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
                        />
                        <Pressable
                          accessibilityLabel={`Delete task ${task.name || taskIndex + 1} from ${role.name || `role ${index + 1}`}`}
                          style={[styles.templateActionButton, isDarkMode ? styles.templateDeleteButtonDark : styles.templateDeleteButtonLight]}
                          onPress={() => removeTemplateTaskDraft(role.id, task.id)}>
                          <Text style={[styles.templateActionButtonText, isDarkMode ? styles.templateDeleteButtonTextDark : styles.templateDeleteButtonTextLight]}>Delete Task</Text>
                        </Pressable>
                      </View>
                    )) : (
                      <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No tasks yet for this role.</Text>
                    )}
                  </View>
                )) : <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No roles yet. Add at least one role for this template.</Text>}
              </View>
            </View>

            <Pressable
              style={[styles.drawerKeyboardDismiss, isDarkMode ? styles.drawerSecondaryButtonDark : styles.drawerSecondaryButtonLight]}
              onPress={Keyboard.dismiss}>
              <Text style={[styles.drawerSecondaryButtonText, isDarkMode ? styles.drawerSecondaryButtonTextDark : styles.drawerSecondaryButtonTextLight]}>Done typing</Text>
            </Pressable>

            <Pressable
              style={[styles.drawerClose, (!templateNameDraft.trim().length) && styles.drawerCloseDisabled]}
              onPress={saveTemplate}
              disabled={!templateNameDraft.trim().length}>
              <Text style={styles.drawerCloseText}>{isEditingTemplate ? 'Save Changes' : 'Create Template'}</Text>
            </Pressable>
            <Pressable style={[styles.drawerSecondaryButton, isDarkMode ? styles.drawerSecondaryButtonDark : styles.drawerSecondaryButtonLight]} onPress={closeCreateTemplateDrawer}>
              <Text style={[styles.drawerSecondaryButtonText, isDarkMode ? styles.drawerSecondaryButtonTextDark : styles.drawerSecondaryButtonTextLight]}>Cancel</Text>
            </Pressable>
            </ScrollView>
          </Pressable>
          </KeyboardAvoidingView>
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
  pendingNotificationsCard: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10, gap: 8 },
  pendingNotificationsCardLight: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  pendingNotificationsCardDark: { borderColor: '#1e3a8a', backgroundColor: '#0b1220' },
  pendingNotificationsTitle: { fontWeight: '700', fontSize: 13 },
  pendingNotificationsTitleLight: { color: '#1e3a8a' },
  pendingNotificationsTitleDark: { color: '#bfdbfe' },
  pendingNotificationRow: { gap: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#334155' },
  pendingNotificationText: { fontSize: 12 },
  pendingNotificationActions: { flexDirection: 'row', gap: 8 },
  pendingActionButton: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  pendingActionButtonText: { fontSize: 13, fontWeight: '700' },
  pendingActionDeclineLight: { borderColor: '#fecaca', backgroundColor: '#fff1f2' },
  pendingActionDeclineDark: { borderColor: '#7f1d1d', backgroundColor: '#3f0b0b' },
  pendingActionDeclineTextLight: { color: '#b91c1c' },
  pendingActionDeclineTextDark: { color: '#fecaca' },
  pendingActionAcceptLight: { borderColor: '#93c5fd', backgroundColor: '#dbeafe' },
  pendingActionAcceptDark: { borderColor: '#1d4ed8', backgroundColor: '#1e3a8a' },
  pendingActionAcceptTextLight: { color: '#1d4ed8' },
  pendingActionAcceptTextDark: { color: '#dbeafe' },
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
  roleTaskToggle: { marginTop: 10, alignSelf: 'flex-start' },
  roleActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  drawerButton: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  drawerButtonLight: { backgroundColor: '#e2e8f0' },
  drawerButtonDark: { backgroundColor: '#334155' },
  drawerButtonText: { fontSize: 12, fontWeight: '700' },
  drawerButtonTextLight: { color: '#334155' },
  drawerButtonTextDark: { color: '#e2e8f0' },
  drawerDestructiveButton: { marginBottom: 10, backgroundColor: '#7f1d1d' },
  drawerDestructiveButtonText: { color: '#fecaca', textAlign: 'center', fontWeight: '700' },
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
  rolePreviewContainer: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  rolePreviewContainerLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  rolePreviewContainerDark: { borderColor: '#334155', backgroundColor: '#111827' },
  rolePreviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  rolePreviewLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  rolePreviewAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rolePreviewAvatarLight: { backgroundColor: '#dbeafe' },
  rolePreviewAvatarDark: { backgroundColor: '#1e3a8a' },
  rolePreviewAvatarAssignedLight: { backgroundColor: '#0ea5e9' },
  rolePreviewAvatarAssignedDark: { backgroundColor: '#2563eb' },
  rolePreviewAvatarText: { fontSize: 11, fontWeight: '700', color: '#bfdbfe' },
  rolePreviewName: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  rolePreviewNameLight: { color: '#0f172a' },
  rolePreviewNameDark: { color: '#e2e8f0' },
  rolePreviewMeta: { fontSize: 12 },
  rolePreviewMetaLight: { color: '#64748b' },
  rolePreviewMetaDark: { color: '#94a3b8' },
  templateRoleEditor: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 10 },
  templateRoleEditorLight: { borderColor: '#cbd5e1', backgroundColor: '#f1f5f9' },
  templateRoleEditorDark: { borderColor: '#334155', backgroundColor: '#0b1220' },
  templateRoleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  templateRoleTaskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  templateTaskRow: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 6 },
  templateTaskRowLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  templateTaskRowDark: { borderColor: '#334155', backgroundColor: '#111827' },
  templateTaskLabel: { fontSize: 12, fontWeight: '700' },
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)', justifyContent: 'flex-end' },
  keyboardAvoidingFill: { width: '100%' },
  drawer: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '85%' },
  createEventScroll: { marginTop: 8 },
  createEventScrollContent: { paddingBottom: 16 },
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
  templateSelectTrigger: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  templateSelectTriggerLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  templateSelectTriggerDark: { borderColor: '#334155', backgroundColor: '#111827' },
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
  templateActionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  templateActionButton: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  templateActionButtonLight: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  templateActionButtonDark: { borderColor: '#334155', backgroundColor: '#0f172a' },
  templateActionButtonDisabled: { opacity: 0.45 },
  templateActionButtonText: { fontSize: 12, fontWeight: '700' },
  templateActionButtonTextLight: { color: '#1d4ed8' },
  templateActionButtonTextDark: { color: '#bfdbfe' },
  templateDeleteButtonLight: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  templateDeleteButtonDark: { borderColor: '#7f1d1d', backgroundColor: '#450a0a' },
  templateDeleteButtonTextLight: { color: '#b91c1c' },
  templateDeleteButtonTextDark: { color: '#fecaca' },
  formField: { marginTop: 14, gap: 8 },
  templateInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  templateTextArea: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 88, textAlignVertical: 'top' },
  templateInputLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc', color: '#0f172a' },
  templateInputDark: { borderColor: '#334155', backgroundColor: '#111827', color: '#f8fafc' },
  drawerClose: { marginTop: 12, backgroundColor: '#1d4ed8', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerCloseDisabled: { opacity: 0.45 },
  drawerCloseText: { color: '#fff', fontWeight: '700' },
  drawerKeyboardDismiss: { marginTop: 12, borderWidth: 1, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
  drawerSecondaryButton: { marginTop: 10, borderWidth: 1, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerSecondaryButtonLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  drawerSecondaryButtonDark: { borderColor: '#334155', backgroundColor: '#111827' },
  drawerSecondaryButtonText: { fontWeight: '700' },
  drawerSecondaryButtonTextLight: { color: '#334155' },
  drawerSecondaryButtonTextDark: { color: '#cbd5e1' },
});
