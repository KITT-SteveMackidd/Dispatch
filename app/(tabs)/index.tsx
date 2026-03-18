import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Swipeable } from 'react-native-gesture-handler';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import {
  createDispatchEvent,
  createEventTemplate,
  deleteDispatchEvent,
  deleteEventTemplate,
  ensureDefaultEventTemplates,
  loadUserProfilesByIds,
  respondToRoleAssignmentNotification,
  sortDispatchEvents,
  updateEventRoleAssignment,
  updateEventTemplate,
  uploadTemplateTaskAttachment,
  watchManagerEvents,
  watchManagerEventTemplates,
  watchManagerPendingRoleInvites,
  watchManagerRoleInvites,
  watchManagerTeams,
  watchWorkerEvents,
  watchWorkerRoleAssignmentNotifications,
} from '@/services/dispatch';
import { DispatchEvent, EventRole, EventTask, EventTemplate, Team, UserProfile } from '@/types/dispatch';
import { useThemeMode } from '@/context/theme';

type ManagerNamesMap = Record<string, string>;
type UserMap = Record<string, UserProfile>;
type InviteStatus = 'pending' | 'accepted' | 'declined';

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
  description?: string;
  attachments?: Array<{ id: string; name: string; url: string; kind: 'photo' | 'document' }>;
  expectedOffsetMinutes: number;
};

type TemplateRolePreview = {
  id: string;
  name: string;
  tasks: TemplateTaskPreview[];
};

type EventTemplateOption = EventTemplate;

type CreateEventRoleDraft = {
  id: string;
  name: string;
  tasks: TemplateTaskPreview[];
  assignedWorkerId: string | null;
};

type CreateEventRoleEditorState = {
  open: boolean;
  mode: 'add' | 'edit';
  roleId: string | null;
  name: string;
};

const INITIAL_CREATE_EVENT_ROLE_EDITOR: CreateEventRoleEditorState = {
  open: false,
  mode: 'add',
  roleId: null,
  name: '',
};

type TemplateRoleDraft = {
  id: string;
  name: string;
  tasks: TemplateTaskPreview[];
};

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
  const [managerTeams, setManagerTeams] = useState<Team[]>([]);
  const [expandedInviteTeamIds, setExpandedInviteTeamIds] = useState<Record<string, boolean>>({});
  const [replaceDrawer, setReplaceDrawer] = useState<DrawerState>(INITIAL_DRAWER);
  const [inviteDrawer, setInviteDrawer] = useState<DrawerState>(INITIAL_DRAWER);
  const [inviteSelectedWorkerIds, setInviteSelectedWorkerIds] = useState<string[]>([]);
  const [inviteSubmitBusy, setInviteSubmitBusy] = useState(false);
  const [createEventDrawerOpen, setCreateEventDrawerOpen] = useState(false);
  const [createTemplateDrawerOpen, setCreateTemplateDrawerOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateNameDraft, setTemplateNameDraft] = useState('');
  const [templateDefaultTimeDraft, setTemplateDefaultTimeDraft] = useState('');
  const [showTemplateDefaultTimePicker, setShowTemplateDefaultTimePicker] = useState(false);
  const [templateDefaultLocationDraft, setTemplateDefaultLocationDraft] = useState('');
  const [templateDefaultDescriptionDraft, setTemplateDefaultDescriptionDraft] = useState('');
  const [templateRolesDraft, setTemplateRolesDraft] = useState<TemplateRoleDraft[]>([]);
  const [templateTaskOffsetDrafts, setTemplateTaskOffsetDrafts] = useState<Record<string, string>>({});
  const [templateAttachmentBusyKey, setTemplateAttachmentBusyKey] = useState<string | null>(null);
  const [templateOptions, setTemplateOptions] = useState<EventTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [reopenCreateEventAfterTemplateFlow, setReopenCreateEventAfterTemplateFlow] = useState(false);
  const [pendingRoleNotifications, setPendingRoleNotifications] = useState<Array<{
    id: string;
    action: 'assign' | 'remove';
    eventName?: string;
    eventLocation?: string;
    eventStartsAt?: string;
    roleName?: string;
    roleTaskNames?: string[];
    roleId: string;
  }>>([]);
  const [pendingInviteWorkerIdsByRoleKey, setPendingInviteWorkerIdsByRoleKey] = useState<Record<string, string[]>>({});
  const [inviteStatusByRoleWorkerKey, setInviteStatusByRoleWorkerKey] = useState<Record<string, InviteStatus>>({});
  const [notificationBusyId, setNotificationBusyId] = useState<string | null>(null);
  const [eventDateDraft, setEventDateDraft] = useState('');
  const [eventTimeDraft, setEventTimeDraft] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const drawerKeyboardOffset = Platform.select({ ios: 44, android: 24 }) ?? 0;
  const [eventLocationDraft, setEventLocationDraft] = useState('');
  const [eventDescriptionDraft, setEventDescriptionDraft] = useState('');
  const [createEventRolesDraft, setCreateEventRolesDraft] = useState<CreateEventRoleDraft[]>([]);
  const [createEventRoleEditor, setCreateEventRoleEditor] = useState<CreateEventRoleEditorState>(INITIAL_CREATE_EVENT_ROLE_EDITOR);
  const [optimisticCreatedEvents, setOptimisticCreatedEvents] = useState<DispatchEvent[]>([]);
  const [rolePickerRoleId, setRolePickerRoleId] = useState<string | null>(null);
  const [assignmentBusyKey, setAssignmentBusyKey] = useState<string | null>(null);
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
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

  const formatOffsetHhMmSs = (minutes: number) => {
    const safeMinutes = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
    const hours = Math.floor(safeMinutes / 60).toString().padStart(2, '0');
    const mins = (safeMinutes % 60).toString().padStart(2, '0');
    return `${hours}:${mins}:00`;
  };

  const parseOffsetHhMmSsToMinutes = (raw: string) => {
    const match = raw.trim().match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
    if (!match) return null;

    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    const seconds = Number.parseInt(match[3], 10);

    if ([hours, minutes, seconds].some((value) => Number.isNaN(value))) return null;
    if (minutes > 59 || seconds > 59) return null;

    return Math.max(0, Math.round((hours * 3600 + minutes * 60 + seconds) / 60));
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

    return Number.NaN;
  };

  const formatTaskDueTime = (event: DispatchEvent, task: EventTask) => {
    const dueAtMs = getTaskDueAtMs(event, task);
    if (!Number.isFinite(dueAtMs)) return 'TBD';
    return new Date(dueAtMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const formatNotificationStartsAt = (startsAt?: string) => {
    if (!startsAt) return 'TBD';
    const parsed = new Date(startsAt);
    if (Number.isNaN(parsed.getTime())) return 'TBD';
    const date = parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `${date} • ${time}`;
  };

  const parseEventStartDraftMs = () => {
    if (!eventDateDraft || !eventTimeDraft) return Number.NaN;
    const startsAtMs = +new Date(`${eventDateDraft}T${eventTimeDraft}`);
    return Number.isFinite(startsAtMs) ? startsAtMs : Number.NaN;
  };

  const formatTaskDueTimeFromDraft = (offsetMinutes?: number) => {
    const startsAtMs = parseEventStartDraftMs();
    const safeOffset = Math.max(0, Math.round(offsetMinutes || 0));
    if (!Number.isFinite(startsAtMs)) return `+${safeOffset}m from start`;
    return new Date(startsAtMs + safeOffset * 60 * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const parseEventDate = () => {
    if (!eventDateDraft) return new Date();
    const parsed = new Date(`${eventDateDraft}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  };

  const parseEventTime = () => {
    const baseDate = parseEventDate();
    const [hourText = '0', minuteText = '0'] = eventTimeDraft.split(':');
    const hours = Number(hourText);
    const minutes = Number(minuteText);
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      baseDate.setHours(Math.max(0, Math.min(23, hours)), Math.max(0, Math.min(59, minutes)), 0, 0);
    }
    return baseDate;
  };

  const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (event.type === 'dismissed' || !selectedDate) return;
    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const day = String(selectedDate.getDate()).padStart(2, '0');
    setEventDateDraft(`${year}-${month}-${day}`);
  };

  const handleTimeChange = (event: DateTimePickerEvent, selectedTime?: Date) => {
    setShowTimePicker(false);
    if (event.type === 'dismissed' || !selectedTime) return;
    const hours = String(selectedTime.getHours()).padStart(2, '0');
    const minutes = String(selectedTime.getMinutes()).padStart(2, '0');
    setEventTimeDraft(`${hours}:${minutes}`);
  };

  const parseTemplateDefaultTime = () => {
    const parsed = parseEventTime();
    const [hourText = '0', minuteText = '0'] = templateDefaultTimeDraft.split(':');
    const hours = Number(hourText);
    const minutes = Number(minuteText);
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      parsed.setHours(Math.max(0, Math.min(23, hours)), Math.max(0, Math.min(59, minutes)), 0, 0);
    }
    return parsed;
  };

  const handleTemplateDefaultTimeChange = (event: DateTimePickerEvent, selectedTime?: Date) => {
    setShowTemplateDefaultTimePicker(false);
    if (event.type === 'dismissed' || !selectedTime) return;
    const hours = String(selectedTime.getHours()).padStart(2, '0');
    const minutes = String(selectedTime.getMinutes()).padStart(2, '0');
    setTemplateDefaultTimeDraft(`${hours}:${minutes}`);
  };

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
    if (profile?.role !== 'manager') {
      setManagerTeams([]);
      return;
    }

    return watchManagerTeams(profile.uid, (teams) => {
      setManagerTeams(teams);
      const workerIds = [...new Set(teams.flatMap((team) => team.workerIds || []).filter(Boolean))];
      setTeamWorkerIds(workerIds);
    });
  }, [profile]);

  useEffect(() => {
    if (profile?.role !== 'manager') {
      setTemplateOptions([]);
      setSelectedTemplateId('');
      return;
    }

    ensureDefaultEventTemplates(profile.uid).catch((error) => {
      console.warn('Failed to ensure default templates', error);
    });

    return watchManagerEventTemplates(profile.uid, (items) => {
      setTemplateOptions(items);
      setSelectedTemplateId((currentId) => {
        if (!items.length) return '';
        if (currentId && items.some((template) => template.id === currentId)) return currentId;
        return items[0].id;
      });
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
        eventLocation: item.eventLocation,
        eventStartsAt: item.eventStartsAt,
        roleName: item.roleName,
        roleTaskNames: item.roleTaskNames,
        roleId: item.roleId,
      })));
    });
  }, [profile]);

  useEffect(() => {
    if (profile?.role !== 'manager') {
      setPendingInviteWorkerIdsByRoleKey({});
      return;
    }

    return watchManagerPendingRoleInvites(profile.uid, (items) => {
      const next: Record<string, string[]> = {};

      items.forEach((item) => {
        const key = `${item.eventId}:${item.roleId}`;
        if (!next[key]) next[key] = [];
        if (item.workerId && !next[key].includes(item.workerId)) {
          next[key].push(item.workerId);
        }
      });

      setPendingInviteWorkerIdsByRoleKey(next);
    });
  }, [profile]);

  useEffect(() => {
    if (profile?.role !== 'manager') {
      setInviteStatusByRoleWorkerKey({});
      return;
    }

    return watchManagerRoleInvites(profile.uid, (items) => {
      const next: Record<string, { status: InviteStatus; createdAtMs: number }> = {};

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

      const flattened = Object.entries(next).reduce<Record<string, InviteStatus>>((acc, [key, value]) => {
        acc[key] = value.status;
        return acc;
      }, {});

      setInviteStatusByRoleWorkerKey(flattened);
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
    if (!templateOptions.length) {
      Alert.alert('Templates Loading', 'Templates are still syncing. Try again in a moment.');
      return;
    }

    setReplaceDrawer(INITIAL_DRAWER);
    setInviteDrawer(INITIAL_DRAWER);

    const initialTemplate = templateOptions.find((template) => template.id === selectedTemplateId) || templateOptions[0];
    setEventDateDraft('');
    setEventTimeDraft(initialTemplate?.defaultTime || '');
    setShowDatePicker(false);
    setShowTimePicker(false);
    setEventLocationDraft(initialTemplate?.defaultLocation || '');
    setEventDescriptionDraft(initialTemplate?.defaultDescription || '');
    setCreateEventRolesDraft(buildCreateEventRolesDraft(initialTemplate));
    setRolePickerRoleId(null);
    setCreateEventDrawerOpen(true);
  };

  const closeCreateEventDrawer = () => {
    setCreateEventDrawerOpen(false);
    setRolePickerRoleId(null);
    setShowDatePicker(false);
    setShowTimePicker(false);
  };

  const openTemplatePickerFromCreateEvent = () => {
    setReopenCreateEventAfterTemplateFlow(true);
    setCreateEventDrawerOpen(false);
    setTemplatePickerOpen(true);
  };

  const openCreateTemplateDrawer = (template?: EventTemplateOption) => {
    setTemplatePickerOpen(false);
    setTemplateTaskOffsetDrafts({});
    setShowTemplateDefaultTimePicker(false);
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
    setShowTemplateDefaultTimePicker(false);
    setEditingTemplateId(null);
    setTemplateNameDraft('');
    setTemplateDefaultTimeDraft('');
    setTemplateDefaultLocationDraft('');
    setTemplateDefaultDescriptionDraft('');
    setTemplateRolesDraft([]);
    setTemplateTaskOffsetDrafts({});

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

  const saveTemplate = async () => {
    const name = templateNameDraft.trim();
    if (!name || !profile?.uid) return;

    const sanitizedRoles = templateRolesDraft
      .map((role, index) => {
        const sanitizedTasks = role.tasks
          .map((task, taskIndex) => ({
            id: task.id || `task-${Date.now()}-${taskIndex + 1}`,
            name: task.name.trim(),
            description: task.description?.trim() || undefined,
            attachments: (task.attachments || []).filter((attachment) => attachment.url.trim().length > 0),
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

    try {
      if (editingTemplateId) {
        await updateEventTemplate({
          managerId: profile.uid,
          templateId: editingTemplateId,
          input: {
            name,
            roles: sanitizedRoles,
            defaultTime: templateDefaultTimeDraft.trim() || undefined,
            defaultLocation: templateDefaultLocationDraft.trim() || undefined,
            defaultDescription: templateDefaultDescriptionDraft.trim() || undefined,
          },
        });

        closeCreateTemplateDrawer();
        return;
      }

      const id = await createEventTemplate(profile.uid, {
        name,
        roles: sanitizedRoles,
        defaultTime: templateDefaultTimeDraft.trim() || undefined,
        defaultLocation: templateDefaultLocationDraft.trim() || undefined,
        defaultDescription: templateDefaultDescriptionDraft.trim() || undefined,
      });

      setSelectedTemplateId(id);
      closeCreateTemplateDrawer();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save template right now.';
      Alert.alert('Template Save Failed', message);
    }
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
            description: '',
            attachments: [],
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

  const addTemplateTaskAttachment = async (roleId: string, taskId: string, kind: 'photo' | 'document') => {
    if (!profile?.uid) return;
    const busyKey = `${roleId}:${taskId}:${kind}`;
    if (templateAttachmentBusyKey) return;

    try {
      let selected: { uri: string; name: string; mimeType?: string } | null = null;

      if (kind === 'photo') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission required', 'Photo library permission is required to attach images.');
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 0.85 });
        if (result.canceled || !result.assets?.length) return;
        const asset = result.assets[0];
        selected = {
          uri: asset.uri,
          name: asset.fileName || `photo-${Date.now()}.jpg`,
          mimeType: asset.mimeType,
        };
      } else {
        const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
        if (result.canceled || !result.assets?.length) return;
        const asset = result.assets[0];
        selected = {
          uri: asset.uri,
          name: asset.name || `document-${Date.now()}`,
          mimeType: asset.mimeType,
        };
      }

      if (!selected) return;
      setTemplateAttachmentBusyKey(busyKey);
      const uploaded = await uploadTemplateTaskAttachment({
        managerId: profile.uid,
        taskId,
        uri: selected.uri,
        kind,
        name: selected.name,
        mimeType: selected.mimeType,
      });

      setTemplateRolesDraft((prev) => prev.map((role) => {
        if (role.id !== roleId) return role;
        return {
          ...role,
          tasks: role.tasks.map((task) => task.id === taskId
            ? { ...task, attachments: [...(task.attachments || []), uploaded] }
            : task),
        };
      }));
    } catch (error) {
      Alert.alert('Attachment error', error instanceof Error ? error.message : 'Unable to attach file.');
    } finally {
      setTemplateAttachmentBusyKey(null);
    }
  };

  const removeTemplateTaskAttachment = (roleId: string, taskId: string, attachmentId: string) => {
    setTemplateRolesDraft((prev) => prev.map((role) => {
      if (role.id !== roleId) return role;
      return {
        ...role,
        tasks: role.tasks.map((task) => task.id === taskId
          ? { ...task, attachments: (task.attachments || []).filter((attachment) => attachment.id !== attachmentId) }
          : task),
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
          onPress: async () => {
            if (!profile?.uid) return;
            if (templateOptions.length <= 1) {
              Alert.alert('Template Required', 'You must keep at least one template.');
              return;
            }

            try {
              await deleteEventTemplate({ managerId: profile.uid, templateId: template.id });
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unable to delete template right now.';
              Alert.alert('Template Delete Failed', message);
            }
          },
        },
      ]
    );
  };

  const upcoming = useMemo(
    () => {
      const combined = [...events, ...optimisticCreatedEvents];
      const unique = combined.filter((event, index, list) => list.findIndex((item) => item.id === event.id) === index);
      const validEvents = unique.filter((event) => Number.isFinite(new Date(event.startsAt).getTime()));
      return sortDispatchEvents(validEvents);
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

  const openTaskAttachment = (taskName: string, attachments?: Array<{ id: string; name: string; url: string; kind: 'photo' | 'document' }>) => {
    const validAttachments = (attachments || []).filter((item) => item?.url?.trim());
    if (!validAttachments.length) return;

    const openUrl = async (url: string) => {
      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert('Unable to open attachment', 'Please check the attachment URL and try again.');
      }
    };

    if (validAttachments.length === 1) {
      openUrl(validAttachments[0].url);
      return;
    }

    Alert.alert(
      `${taskName} attachments`,
      'Choose an attachment to open.',
      [
        ...validAttachments.slice(0, 3).map((attachment) => ({
          text: `${attachment.kind === 'photo' ? '🖼️' : '📄'} ${attachment.name || 'Attachment'}`,
          onPress: () => {
            openUrl(attachment.url);
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
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
          expectedOffsetMinutes: task.expectedOffsetMinutes,
          optional: !!task.optional,
          attachments: task.attachments || [],
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
            <Text style={[styles.taskName, isDarkMode ? styles.taskNameDark : styles.taskNameLight]}>• {task.taskName} · due {formatTaskDueTime(event, { id: task.id, name: task.taskName, expectedOffsetMinutes: task.expectedOffsetMinutes, optional: task.optional })}{task.optional ? ' (optional)' : ''}</Text>
            {task.attachments?.length ? (
              <Pressable onPress={() => openTaskAttachment(task.taskName, task.attachments)} hitSlop={6}>
                <Text style={styles.taskAttachmentIcon}>📎</Text>
              </Pressable>
            ) : null}
            <Text style={[styles.taskStatus, isDarkMode ? styles.metaDark : styles.metaLight, task.doneByMe && styles.taskStatusDone]}>{task.doneByMe ? 'Done' : task.roleName}</Text>
          </View>
        ))}
      </View>
    );
  };

  const workerLabel = (workerId: string) => workerProfiles[workerId]?.displayName || workerId;

  const getInviteStatusForRoleWorker = (eventId: string, roleId: string, workerId: string): InviteStatus => {
    return inviteStatusByRoleWorkerKey[`${eventId}:${roleId}:${workerId}`] || 'pending';
  };

  const getAvatarStatusRingStyle = (status: InviteStatus) => {
    switch (status) {
      case 'accepted':
        return isDarkMode ? styles.avatarCircleRingAcceptedDark : styles.avatarCircleRingAcceptedLight;
      case 'declined':
        return isDarkMode ? styles.avatarCircleRingDeclinedDark : styles.avatarCircleRingDeclinedLight;
      default:
        return isDarkMode ? styles.avatarCircleRingPendingDark : styles.avatarCircleRingPendingLight;
    }
  };

  const openWorkerTeamChat = (event: DispatchEvent, workerId: string) => {
    const workerTeam = managerTeams.find((team) => (team.workerIds || []).includes(workerId));

    router.push({
      pathname: '/chat/[workerId]',
      params: {
        workerId,
        workerLabel: workerLabel(workerId),
        eventName: event.name,
        teamId: workerTeam?.id,
        teamName: workerTeam?.name,
        teamMemberIds: workerTeam?.workerIds?.join(',') || '',
      },
    });
  };

  const renderManagerRole = (event: DispatchEvent, role: EventRole) => {
    const assignedIds = role.assignedWorkerIds || [];
    const openSlots = Math.max(0, role.openSlots || 0);
    const roleExpandKey = `${event.id}:${role.id}`;
    const roleTasksExpanded = !!expandedRoleTaskIds[roleExpandKey];
    const pendingInviteWorkerIds = pendingInviteWorkerIdsByRoleKey[roleExpandKey] || [];

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
              const inviteStatus = getInviteStatusForRoleWorker(event.id, role.id, workerId);
              return (
                <Pressable
                  key={`${event.id}-${role.id}-${workerId}`}
                  style={styles.avatarChip}
                  onPress={() => openWorkerTeamChat(event, workerId)}
                  hitSlop={6}
                >
                  <View style={[styles.avatarCircle, isDarkMode ? styles.avatarCircleDark : styles.avatarCircleLight, getAvatarStatusRingStyle(inviteStatus)]}>
                    <Text style={styles.avatarText}>{initial}</Text>
                  </View>
                  <Text style={[styles.avatarName, isDarkMode ? styles.avatarNameDark : styles.avatarNameLight]} numberOfLines={1}>{workerLabel(workerId)}</Text>
                </Pressable>
              );
            })
          ) : pendingInviteWorkerIds.length ? (
            pendingInviteWorkerIds.map((workerId) => {
              const initial = workerLabel(workerId).slice(0, 1).toUpperCase();
              const inviteStatus = getInviteStatusForRoleWorker(event.id, role.id, workerId);
              return (
                <Pressable
                  key={`${event.id}-${role.id}-invite-${workerId}`}
                  style={styles.avatarChip}
                  onPress={() => openWorkerTeamChat(event, workerId)}
                  hitSlop={6}
                >
                  <View style={[styles.avatarCircle, isDarkMode ? styles.avatarCircleDark : styles.avatarCircleLight, getAvatarStatusRingStyle(inviteStatus)]}>
                    <Text style={styles.avatarText}>{initial}</Text>
                  </View>
                  <Text style={[styles.avatarName, isDarkMode ? styles.avatarNameDark : styles.avatarNameLight]} numberOfLines={1}>{workerLabel(workerId)}</Text>
                </Pressable>
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
                <Text style={[styles.taskName, isDarkMode ? styles.taskNameDark : styles.taskNameLight]}>• {task.name} · due {formatTaskDueTime(event, task)}{task.optional ? ' (optional)' : ''}</Text>
                {task.attachments?.length ? (
                  <Pressable onPress={() => openTaskAttachment(task.name, task.attachments)} hitSlop={6}>
                    <Text style={styles.taskAttachmentIcon}>📎</Text>
                  </Pressable>
                ) : null}
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

  const openAddCreateEventRoleEditor = () => {
    setCreateEventRoleEditor({ open: true, mode: 'add', roleId: null, name: '' });
  };

  const openEditCreateEventRoleEditor = (role: CreateEventRoleDraft) => {
    setCreateEventRoleEditor({ open: true, mode: 'edit', roleId: role.id, name: role.name });
  };

  const closeCreateEventRoleEditor = () => {
    setCreateEventRoleEditor(INITIAL_CREATE_EVENT_ROLE_EDITOR);
  };

  const saveCreateEventRoleEditor = () => {
    const nextName = createEventRoleEditor.name.trim();
    if (!nextName.length) {
      Alert.alert('Role name required', 'Please enter a role name.');
      return;
    }

    if (createEventRoleEditor.mode === 'add') {
      setCreateEventRolesDraft((prev) => [
        ...prev,
        {
          id: `role-${Date.now()}-${prev.length + 1}`,
          name: nextName,
          tasks: [],
          assignedWorkerId: null,
        },
      ]);
      closeCreateEventRoleEditor();
      return;
    }

    if (!createEventRoleEditor.roleId) return;
    setCreateEventRolesDraft((prev) => prev.map((role) => (role.id === createEventRoleEditor.roleId ? { ...role, name: nextName } : role)));
    closeCreateEventRoleEditor();
  };

  const deleteCreateEventRoleDraft = (roleId: string) => {
    setCreateEventRolesDraft((prev) => prev.filter((role) => role.id !== roleId));
    setRolePickerRoleId((prev) => (prev === roleId ? null : prev));
    setCreateEventRoleEditor((prev) => (prev.roleId === roleId ? INITIAL_CREATE_EVENT_ROLE_EDITOR : prev));
  };

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

  const toggleInviteWorkerSelection = (workerId: string) => {
    setInviteSelectedWorkerIds((prev) => (prev.includes(workerId) ? prev.filter((id) => id !== workerId) : [...prev, workerId]));
  };

  const toggleInviteTeamExpanded = (teamId: string) => {
    setExpandedInviteTeamIds((prev) => ({ ...prev, [teamId]: !prev[teamId] }));
  };

  const toggleInviteTeamAllSelection = (workerIds: string[]) => {
    const uniqueWorkerIds = [...new Set(workerIds.filter(Boolean))];
    if (!uniqueWorkerIds.length) return;

    setInviteSelectedWorkerIds((prev) => {
      const selected = new Set(prev);
      const allSelected = uniqueWorkerIds.every((workerId) => selected.has(workerId));

      if (allSelected) {
        uniqueWorkerIds.forEach((workerId) => selected.delete(workerId));
      } else {
        uniqueWorkerIds.forEach((workerId) => selected.add(workerId));
      }

      return [...selected];
    });
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
    if (!inviteDrawer.open || !inviteTarget) {
      setInviteSelectedWorkerIds([]);
      setExpandedInviteTeamIds({});
      return;
    }

    setInviteSelectedWorkerIds(inviteTarget.role.assignedWorkerIds || []);
    setExpandedInviteTeamIds({});
  }, [inviteDrawer.open, inviteTarget?.event.id, inviteTarget?.role.id, inviteTarget?.role.assignedWorkerIds?.join(','), managerTeams]);

  const handleSendRoleInvites = async () => {
    if (!profile?.uid || !inviteTarget || inviteSubmitBusy) return;

    const currentlyAssigned = new Set(inviteTarget.role.assignedWorkerIds || []);
    const selected = new Set(inviteSelectedWorkerIds);
    const toAssign = inviteSelectedWorkerIds.filter((workerId) => !currentlyAssigned.has(workerId));
    const toRemove = [...currentlyAssigned].filter((workerId) => !selected.has(workerId));

    if (!toAssign.length && !toRemove.length) {
      Alert.alert('No changes', 'Select different workers to send invites.');
      return;
    }

    try {
      setInviteSubmitBusy(true);

      for (const workerId of toAssign) {
        await updateEventRoleAssignment({
          eventId: inviteTarget.event.id,
          roleId: inviteTarget.role.id,
          managerId: profile.uid,
          workerId,
          action: 'assign',
        });
      }

      for (const workerId of toRemove) {
        await updateEventRoleAssignment({
          eventId: inviteTarget.event.id,
          roleId: inviteTarget.role.id,
          managerId: profile.uid,
          workerId,
          action: 'remove',
        });
      }

      Alert.alert('Invites sent', `Sent ${toAssign.length} assignment invite${toAssign.length === 1 ? '' : 's'}${toRemove.length ? ` and ${toRemove.length} removal update${toRemove.length === 1 ? '' : 's'}` : ''}.`);
      setInviteDrawer(INITIAL_DRAWER);
    } catch (error) {
      Alert.alert('Unable to send invites', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setInviteSubmitBusy(false);
    }
  };

  useEffect(() => {
    if (!createEventDrawerOpen || !selectedTemplate) return;
    setEventTimeDraft(selectedTemplate.defaultTime || '');
    setShowDatePicker(false);
    setShowTimePicker(false);
    setEventLocationDraft(selectedTemplate.defaultLocation || '');
    setEventDescriptionDraft(selectedTemplate.defaultDescription || '');
    setCreateEventRolesDraft(buildCreateEventRolesDraft(selectedTemplate));
    setRolePickerRoleId(null);
    setCreateEventRoleEditor(INITIAL_CREATE_EVENT_ROLE_EDITOR);
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

    const sanitizedRoles = createEventRolesDraft
      .map((role, index) => ({
        ...role,
        name: role.name.trim() || `Role ${index + 1}`,
      }))
      .filter((role) => role.name.length > 0);

    try {
      const createdEvent = await createDispatchEvent({
        managerId: profile.uid,
        name: selectedTemplate.name,
        date: eventDateDraft,
        time: eventTimeDraft,
        location: eventLocationDraft,
        description: eventDescriptionDraft,
        roles: sanitizedRoles,
      });
      setOptimisticCreatedEvents((prev) => [createdEvent, ...prev.filter((item) => item.id !== createdEvent.id)]);
      Alert.alert('Event created', 'Your event has been created and added to upcoming assignments.');
      closeCreateEventDrawer();
    } catch (error) {
      Alert.alert('Unable to create event', error instanceof Error ? error.message : 'Please check required fields and try again.');
    }
  };

  const handleDeleteEvent = (event: DispatchEvent) => {
    if (!profile?.uid || profile.role !== 'manager') return;

    Alert.alert(
      'Delete Event',
      `Delete "${event.name}"? This cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => swipeableRefs.current[event.id]?.close(),
        },
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
      ]
    );
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
                <Text style={[styles.pendingNotificationDetail, isDarkMode ? styles.metaDark : styles.metaLight]}>
                  Location: {notification.eventLocation?.trim() || 'TBD'}
                </Text>
                <Text style={[styles.pendingNotificationDetail, isDarkMode ? styles.metaDark : styles.metaLight]}>
                  Time: {formatNotificationStartsAt(notification.eventStartsAt)}
                </Text>
                <Text style={[styles.pendingNotificationDetail, isDarkMode ? styles.metaDark : styles.metaLight]}>
                  Role: {notification.roleName?.trim() || 'TBD'}
                </Text>
                <Text style={[styles.pendingNotificationDetail, isDarkMode ? styles.metaDark : styles.metaLight]}>
                  Tasks: {notification.roleTaskNames?.length ? notification.roleTaskNames.join(', ') : 'No tasks listed'}
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

          const card = (
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

          if (profile?.role !== 'manager') return card;

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
              {managerTeams.length ? managerTeams.map((team) => {
                const teamWorkerIds = [...new Set((team.workerIds || []).filter(Boolean))];
                const selectedCount = teamWorkerIds.filter((workerId) => inviteSelectedWorkerIds.includes(workerId)).length;
                const allSelected = teamWorkerIds.length > 0 && selectedCount === teamWorkerIds.length;
                const teamExpanded = !!expandedInviteTeamIds[team.id];

                return (
                  <View key={`invite-team-${team.id}`} style={[styles.inviteTeamCard, isDarkMode ? styles.inviteTeamCardDark : styles.inviteTeamCardLight]}>
                    <Pressable
                      style={styles.inviteTeamHeader}
                      disabled={inviteSubmitBusy}
                      onPress={() => toggleInviteTeamExpanded(team.id)}>
                      <Text style={[styles.drawerName, isDarkMode ? styles.drawerNameDark : styles.drawerNameLight]}>{team.name}</Text>
                      <Text style={[styles.drawerMeta, isDarkMode ? styles.drawerMetaDark : styles.drawerMetaLight]}>
                        {selectedCount}/{teamWorkerIds.length} selected · {teamExpanded ? 'Hide members' : 'Show members'}
                      </Text>
                    </Pressable>

                    {teamExpanded ? (
                      <View style={styles.inviteTeamMembers}>
                        <Pressable
                          style={styles.inviteMemberRow}
                          disabled={inviteSubmitBusy || !teamWorkerIds.length}
                          onPress={() => toggleInviteTeamAllSelection(teamWorkerIds)}>
                          <View style={[styles.inviteCheckbox, allSelected && styles.inviteCheckboxSelected]}>
                            <Text style={styles.inviteCheckboxMark}>{allSelected ? '✓' : ''}</Text>
                          </View>
                          <Text style={[styles.drawerName, isDarkMode ? styles.drawerNameDark : styles.drawerNameLight]}>All</Text>
                        </Pressable>

                        {teamWorkerIds.length ? teamWorkerIds.map((workerId) => {
                          const selected = inviteSelectedWorkerIds.includes(workerId);
                          return (
                            <Pressable
                              key={`invite-${team.id}-${workerId}`}
                              style={styles.inviteMemberRow}
                              disabled={inviteSubmitBusy || !inviteTarget}
                              onPress={() => toggleInviteWorkerSelection(workerId)}>
                              <View style={[styles.inviteCheckbox, selected && styles.inviteCheckboxSelected]}>
                                <Text style={styles.inviteCheckboxMark}>{selected ? '✓' : ''}</Text>
                              </View>
                              <Text style={[styles.drawerName, isDarkMode ? styles.drawerNameDark : styles.drawerNameLight]}>{workerLabel(workerId)}</Text>
                            </Pressable>
                          );
                        }) : (
                          <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No members in this team.</Text>
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              }) : <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No team workers available.</Text>}
            </ScrollView>
            <Pressable
              style={[styles.drawerClose, inviteSubmitBusy && styles.drawerCloseDisabled]}
              onPress={handleSendRoleInvites}
              disabled={!inviteTarget || inviteSubmitBusy}>
              <Text style={styles.drawerCloseText}>{inviteSubmitBusy ? 'Sending…' : 'Send invite updates'}</Text>
            </Pressable>
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
            keyboardVerticalOffset={drawerKeyboardOffset}>
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
              <View style={styles.templateHeaderRow}>
                <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Roles needed for this event</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add role to event"
                  style={[styles.templateAddButton, isDarkMode ? styles.templateAddButtonDark : styles.templateAddButtonLight]}
                  onPress={openAddCreateEventRoleEditor}>
                  <Text style={[styles.templateAddButtonText, isDarkMode ? styles.templateAddButtonTextDark : styles.templateAddButtonTextLight]}>+ Add Role</Text>
                </Pressable>
              </View>
              <View style={[styles.rolePreviewContainer, isDarkMode ? styles.rolePreviewContainerDark : styles.rolePreviewContainerLight]}>
                {createEventRolesDraft.length ? (
                  createEventRolesDraft.map((role) => {
                    const assignedLabel = role.assignedWorkerId ? workerLabel(role.assignedWorkerId) : null;
                    const avatarInitial = assignedLabel ? assignedLabel.slice(0, 1).toUpperCase() : '';
                    const roleOffset = role.tasks.length
                      ? Math.min(...role.tasks.map((task) => Math.max(0, Math.round(task.expectedOffsetMinutes || 0))))
                      : 0;

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
                          {role.tasks.length} tasks · Offset {formatOffsetHhMmSs(roleOffset)}
                        </Text>
                        {assignedLabel ? (
                          <Text style={[styles.rolePreviewMeta, isDarkMode ? styles.rolePreviewMetaDark : styles.rolePreviewMetaLight]}>
                            Assigned: {assignedLabel}
                          </Text>
                        ) : null}
                        <View style={styles.templateActionRow}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Edit ${role.name} role`}
                            onPress={() => openEditCreateEventRoleEditor(role)}
                            style={[styles.templateActionButton, isDarkMode ? styles.templateActionButtonDark : styles.templateActionButtonLight]}>
                            <Text style={[styles.templateActionButtonText, isDarkMode ? styles.templateActionButtonTextDark : styles.templateActionButtonTextLight]}>Edit</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${role.name} role`}
                            onPress={() => deleteCreateEventRoleDraft(role.id)}
                            style={[styles.templateActionButton, isDarkMode ? styles.templateDeleteButtonDark : styles.templateDeleteButtonLight]}>
                            <Text style={[styles.templateActionButtonText, isDarkMode ? styles.templateDeleteButtonTextDark : styles.templateDeleteButtonTextLight]}>Delete</Text>
                          </Pressable>
                        </View>
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
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Event date</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Pick event date"
                style={[styles.templateSelectTrigger, isDarkMode ? styles.templateSelectTriggerDark : styles.templateSelectTriggerLight]}
                onPress={() => {
                  Keyboard.dismiss();
                  setShowDatePicker(true);
                }}>
                <Text style={[styles.templateName, isDarkMode ? styles.templateNameDark : styles.templateNameLight]}>
                  {eventDateDraft || 'Select date'}
                </Text>
              </Pressable>
              {showDatePicker ? (
                <DateTimePicker
                  value={parseEventDate()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={handleDateChange}
                />
              ) : null}
            </View>

            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Event time</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Pick event time"
                style={[styles.templateSelectTrigger, isDarkMode ? styles.templateSelectTriggerDark : styles.templateSelectTriggerLight]}
                onPress={() => {
                  Keyboard.dismiss();
                  setShowTimePicker(true);
                }}>
                <Text style={[styles.templateName, isDarkMode ? styles.templateNameDark : styles.templateNameLight]}>
                  {eventTimeDraft || 'Select time'}
                </Text>
              </Pressable>
              {showTimePicker ? (
                <DateTimePicker
                  value={parseEventTime()}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleTimeChange}
                />
              ) : null}
            </View>

            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Location</Text>
              <TextInput
                value={eventLocationDraft}
                onChangeText={setEventLocationDraft}
                placeholder="Downtown"
                placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
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
                placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
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

      <Modal visible={createEventRoleEditor.open} animationType="slide" transparent onRequestClose={closeCreateEventRoleEditor}>
        <Pressable style={styles.drawerBackdrop} onPress={closeCreateEventRoleEditor}>
          <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => null}>
            <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>
              {createEventRoleEditor.mode === 'add' ? 'Add Role' : 'Edit Role'}
            </Text>
            <Text style={[styles.drawerSub, isDarkMode ? styles.drawerSubDark : styles.drawerSubLight]}>
              {createEventRoleEditor.mode === 'add' ? 'Create a role for this event.' : 'Update this event role name.'}
            </Text>
            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Role name</Text>
              <TextInput
                value={createEventRoleEditor.name}
                onChangeText={(value) => setCreateEventRoleEditor((prev) => ({ ...prev, name: value }))}
                placeholder="Example: Security"
                placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
                autoFocus
                style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
              />
            </View>
            <Pressable style={styles.drawerClose} onPress={saveCreateEventRoleEditor}>
              <Text style={styles.drawerCloseText}>{createEventRoleEditor.mode === 'add' ? 'Add role' : 'Save role'}</Text>
            </Pressable>
            {createEventRoleEditor.mode === 'edit' && createEventRoleEditor.roleId ? (
              <Pressable
                style={[styles.drawerButton, styles.drawerDestructiveButton]}
                onPress={() => deleteCreateEventRoleDraft(createEventRoleEditor.roleId as string)}>
                <Text style={styles.drawerDestructiveButtonText}>Delete role</Text>
              </Pressable>
            ) : null}
            <Pressable style={[styles.drawerSecondaryButton, isDarkMode ? styles.drawerSecondaryButtonDark : styles.drawerSecondaryButtonLight]} onPress={closeCreateEventRoleEditor}>
              <Text style={[styles.drawerSecondaryButtonText, isDarkMode ? styles.drawerSecondaryButtonTextDark : styles.drawerSecondaryButtonTextLight]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={createTemplateDrawerOpen} animationType="slide" transparent onRequestClose={closeCreateTemplateDrawer}>
        <Pressable style={styles.drawerBackdrop} onPress={closeCreateTemplateDrawer}>
          <KeyboardAvoidingView
            style={styles.keyboardAvoidingFill}
            behavior={Platform.select({ ios: 'padding', android: 'height' })}
            keyboardVerticalOffset={drawerKeyboardOffset}>
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
                placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
                style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
              />
            </View>


            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Default event time (optional)</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Pick default event time"
                style={[styles.templateSelectTrigger, isDarkMode ? styles.templateSelectTriggerDark : styles.templateSelectTriggerLight]}
                onPress={() => {
                  Keyboard.dismiss();
                  setShowTemplateDefaultTimePicker(true);
                }}>
                <Text style={[styles.templateName, isDarkMode ? styles.templateNameDark : styles.templateNameLight]}>
                  {templateDefaultTimeDraft || 'Select time'}
                </Text>
              </Pressable>
              {showTemplateDefaultTimePicker ? (
                <DateTimePicker
                  value={parseTemplateDefaultTime()}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleTemplateDefaultTimeChange}
                />
              ) : null}
            </View>

            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Default location (optional)</Text>
              <TextInput
                value={templateDefaultLocationDraft}
                onChangeText={setTemplateDefaultLocationDraft}
                placeholder="Downtown"
                placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
                style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
              />
            </View>

            <View style={styles.formField}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.templateLabelDark : styles.templateLabelLight]}>Default description (optional)</Text>
              <TextInput
                value={templateDefaultDescriptionDraft}
                onChangeText={setTemplateDefaultDescriptionDraft}
                placeholder="Describe this template"
                placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
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
                      placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
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
                          placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
                          style={[styles.templateInput, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
                        />
                        <TextInput
                          value={task.description || ''}
                          onChangeText={(value) => updateTemplateTaskDraft(role.id, task.id, { description: value })}
                          placeholder="Task description"
                          placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
                          multiline
                          style={[styles.templateTextArea, isDarkMode ? styles.templateInputDark : styles.templateInputLight]}
                        />
                        <View style={styles.templateTaskAttachmentSection}>
                          <Text style={[styles.rolePreviewMeta, isDarkMode ? styles.rolePreviewMetaDark : styles.rolePreviewMetaLight]}>Attachments</Text>
                          <View style={styles.templateTaskAttachmentButtons}>
                            <Pressable
                              style={[styles.templateActionButton, isDarkMode ? styles.templateActionButtonDark : styles.templateActionButtonLight, templateAttachmentBusyKey && styles.templateActionButtonDisabled]}
                              disabled={!!templateAttachmentBusyKey}
                              onPress={() => addTemplateTaskAttachment(role.id, task.id, 'photo')}>
                              <Text style={[styles.templateActionButtonText, isDarkMode ? styles.templateActionButtonTextDark : styles.templateActionButtonTextLight]}>
                                + Photo
                              </Text>
                            </Pressable>
                            <Pressable
                              style={[styles.templateActionButton, isDarkMode ? styles.templateActionButtonDark : styles.templateActionButtonLight, templateAttachmentBusyKey && styles.templateActionButtonDisabled]}
                              disabled={!!templateAttachmentBusyKey}
                              onPress={() => addTemplateTaskAttachment(role.id, task.id, 'document')}>
                              <Text style={[styles.templateActionButtonText, isDarkMode ? styles.templateActionButtonTextDark : styles.templateActionButtonTextLight]}>
                                + Document
                              </Text>
                            </Pressable>
                          </View>
                          {(task.attachments || []).length ? (
                            <View style={styles.templateAttachmentList}>
                              {(task.attachments || []).map((attachment) => (
                                <View key={attachment.id} style={[styles.templateAttachmentItem, isDarkMode ? styles.templateTaskRowDark : styles.templateTaskRowLight]}>
                                  <Text style={[styles.templateAttachmentName, isDarkMode ? styles.templateNameDark : styles.templateNameLight]} numberOfLines={1}>
                                    {attachment.kind === 'photo' ? '🖼️' : '📄'} {attachment.name}
                                  </Text>
                                  <Pressable onPress={() => removeTemplateTaskAttachment(role.id, task.id, attachment.id)}>
                                    <Text style={[styles.templateDeleteButtonTextLight, isDarkMode && styles.templateDeleteButtonTextDark]}>Remove</Text>
                                  </Pressable>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </View>
                        <TextInput
                          value={templateTaskOffsetDrafts[`${role.id}:${task.id}`] ?? formatOffsetHhMmSs(task.expectedOffsetMinutes)}
                          onChangeText={(value) => {
                            const key = `${role.id}:${task.id}`;
                            setTemplateTaskOffsetDrafts((prev) => ({ ...prev, [key]: value }));
                            const parsedMinutes = parseOffsetHhMmSsToMinutes(value);
                            if (parsedMinutes !== null) {
                              updateTemplateTaskDraft(role.id, task.id, { expectedOffsetMinutes: parsedMinutes });
                            }
                          }}
                          onBlur={() => {
                            const key = `${role.id}:${task.id}`;
                            setTemplateTaskOffsetDrafts((prev) => ({ ...prev, [key]: formatOffsetHhMmSs(task.expectedOffsetMinutes) }));
                          }}
                          keyboardType="numbers-and-punctuation"
                          returnKeyType="done"
                          onSubmitEditing={Keyboard.dismiss}
                          blurOnSubmit
                          placeholder="HH:MM:SS"
                          placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
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
  containerDark: { backgroundColor: '#101A2F' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  filter: { fontWeight: '600' },
  filterLight: { color: '#334155' },
  filterDark: { color: '#F4F8FF' },
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
  emptyDark: { color: '#F4F8FF' },
  pendingNotificationsCard: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10, gap: 8 },
  pendingNotificationsCardLight: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  pendingNotificationsCardDark: { borderColor: '#00133D', backgroundColor: '#1A2540' },
  pendingNotificationsTitle: { fontWeight: '700', fontSize: 13 },
  pendingNotificationsTitleLight: { color: '#1e3a8a' },
  pendingNotificationsTitleDark: { color: '#F4F8FF' },
  pendingNotificationRow: { gap: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#334155' },
  pendingNotificationText: { fontSize: 12, fontWeight: '600' },
  pendingNotificationDetail: { fontSize: 12 },
  pendingNotificationActions: { flexDirection: 'row', gap: 8 },
  pendingActionButton: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  pendingActionButtonText: { fontSize: 13, fontWeight: '700' },
  pendingActionDeclineLight: { borderColor: '#fecaca', backgroundColor: '#fff1f2' },
  pendingActionDeclineDark: { borderColor: '#F98D2F', backgroundColor: '#00133D' },
  pendingActionDeclineTextLight: { color: '#b91c1c' },
  pendingActionDeclineTextDark: { color: '#F4F8FF' },
  pendingActionAcceptLight: { borderColor: '#93c5fd', backgroundColor: '#dbeafe' },
  pendingActionAcceptDark: { borderColor: '#001A4D', backgroundColor: '#00133D' },
  pendingActionAcceptTextLight: { color: '#1d4ed8' },
  pendingActionAcceptTextDark: { color: '#F4F8FF' },
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
  cardDark: { backgroundColor: '#1A2540', borderColor: '#001A4D' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontWeight: '700', fontSize: 20, flex: 1, marginRight: 8 },
  titleLight: { color: '#232832' },
  titleDark: { color: '#F4F8FF' },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusPillLight: { backgroundColor: '#e2e8f0' },
  statusPillDark: { backgroundColor: '#001A4D' },
  statusText: { fontSize: 11, fontWeight: '700' },
  statusTextLight: { color: '#475569' },
  statusTextDark: { color: '#F4F8FF' },
  meta: { marginTop: 6, fontSize: 12 },
  metaLight: { color: '#64748b' },
  metaDark: { color: '#F4F8FF' },
  expandHint: { marginTop: 8, fontSize: 12, fontWeight: '600' },
  expandHintLight: { color: '#2563eb' },
  expandHintDark: { color: '#0EC3C9' },
  managerExpanded: { marginTop: 10, gap: 10 },
  roleCard: { borderWidth: 1, borderRadius: 10, padding: 10 },
  roleCardLight: { borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  roleCardDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  roleHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  roleTitle: { fontWeight: '700', fontSize: 14 },
  roleTitleLight: { color: '#232832' },
  roleTitleDark: { color: '#F4F8FF' },
  roleMeta: { fontSize: 12, fontWeight: '600' },
  roleMetaLight: { color: '#64748b' },
  roleMetaDark: { color: '#F4F8FF' },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  avatarChip: { alignItems: 'center', width: 66 },
  avatarCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarCircleLight: { backgroundColor: '#dbeafe' },
  avatarCircleDark: { backgroundColor: '#00133D' },
  avatarCircleRingAcceptedLight: { borderWidth: 2, borderColor: '#16a34a' },
  avatarCircleRingAcceptedDark: { borderWidth: 2, borderColor: '#34d399' },
  avatarCircleRingDeclinedLight: { borderWidth: 2, borderColor: '#dc2626' },
  avatarCircleRingDeclinedDark: { borderWidth: 2, borderColor: '#fb7185' },
  avatarCircleRingPendingLight: { borderWidth: 2, borderColor: '#f59e0b' },
  avatarCircleRingPendingDark: { borderWidth: 2, borderColor: '#fbbf24' },
  avatarText: { fontWeight: '700', color: '#bfdbfe' },
  avatarName: { marginTop: 4, fontSize: 11 },
  avatarNameLight: { color: '#334155' },
  avatarNameDark: { color: '#F4F8FF' },
  roleTaskToggle: { marginTop: 10, alignSelf: 'flex-start' },
  roleActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  drawerButton: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  drawerButtonLight: { backgroundColor: '#e2e8f0' },
  drawerButtonDark: { backgroundColor: '#001A4D' },
  drawerButtonText: { fontSize: 12, fontWeight: '700' },
  drawerButtonTextLight: { color: '#334155' },
  drawerButtonTextDark: { color: '#F4F8FF' },
  drawerDestructiveButton: { marginBottom: 10, backgroundColor: '#7f1d1d' },
  drawerDestructiveButtonText: { color: '#fecaca', textAlign: 'center', fontWeight: '700' },
  taskList: { marginTop: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8, gap: 8 },
  taskRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  taskName: { flex: 1, fontSize: 13 },
  taskNameLight: { color: '#232832' },
  taskNameDark: { color: '#F4F8FF' },
  taskAttachmentIcon: { fontSize: 16, marginLeft: 8 },
  taskStatus: { fontSize: 12, fontWeight: '600' },
  taskStatusDone: { color: '#22c55e' },
  taskEmpty: { marginTop: 8, fontSize: 12 },
  taskEmptyLight: { color: '#64748b' },
  taskEmptyDark: { color: '#F4F8FF' },
  roleEmpty: { fontSize: 12 },
  roleEmptyLight: { color: '#64748b' },
  roleEmptyDark: { color: '#F4F8FF' },
  rolePreviewContainer: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  rolePreviewContainerLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  rolePreviewContainerDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  rolePreviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  rolePreviewLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  rolePreviewAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rolePreviewAvatarLight: { backgroundColor: '#dbeafe' },
  rolePreviewAvatarDark: { backgroundColor: '#00133D' },
  rolePreviewAvatarAssignedLight: { backgroundColor: '#0ea5e9' },
  rolePreviewAvatarAssignedDark: { backgroundColor: '#0EC3C9' },
  rolePreviewAvatarText: { fontSize: 11, fontWeight: '700', color: '#bfdbfe' },
  rolePreviewName: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  rolePreviewNameLight: { color: '#232832' },
  rolePreviewNameDark: { color: '#F4F8FF' },
  rolePreviewMeta: { fontSize: 12 },
  rolePreviewMetaLight: { color: '#64748b' },
  rolePreviewMetaDark: { color: '#F4F8FF' },
  templateRoleEditor: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 10 },
  templateRoleEditorLight: { borderColor: '#cbd5e1', backgroundColor: '#f1f5f9' },
  templateRoleEditorDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  templateRoleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  templateRoleTaskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  templateTaskRow: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 6 },
  templateTaskRowLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  templateTaskRowDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  templateTaskLabel: { fontSize: 12, fontWeight: '700' },
  templateTaskAttachmentSection: { gap: 6 },
  templateTaskAttachmentButtons: { flexDirection: 'row', gap: 8 },
  templateAttachmentList: { gap: 6 },
  templateAttachmentItem: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  templateAttachmentName: { flex: 1, fontSize: 12, fontWeight: '600' },
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)', justifyContent: 'flex-end' },
  keyboardAvoidingFill: { width: '100%', flex: 1, justifyContent: 'flex-end' },
  drawer: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '85%' },
  createEventScroll: { marginTop: 8 },
  createEventScrollContent: { paddingBottom: 16 },
  drawerLight: { backgroundColor: '#fff' },
  drawerDark: { backgroundColor: '#1A2540' },
  drawerTitle: { fontWeight: '700', fontSize: 18 },
  drawerTitleLight: { color: '#232832' },
  drawerTitleDark: { color: '#F4F8FF' },
  drawerSub: { fontSize: 12, marginTop: 4 },
  drawerSubLight: { color: '#64748b' },
  drawerSubDark: { color: '#F4F8FF' },
  drawerList: { marginTop: 12 },
  drawerRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  drawerName: { fontWeight: '600' },
  drawerNameLight: { color: '#232832' },
  drawerNameDark: { color: '#F4F8FF' },
  drawerMeta: { marginTop: 4, fontSize: 12 },
  drawerMetaLight: { color: '#64748b' },
  drawerMetaDark: { color: '#F4F8FF' },
  inviteTeamCard: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10 },
  inviteTeamCardLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  inviteTeamCardDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  inviteTeamHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  inviteTeamMembers: { marginTop: 8, gap: 6 },
  inviteMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  inviteCheckbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: '#64748b', alignItems: 'center', justifyContent: 'center' },
  inviteCheckboxSelected: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  inviteCheckboxMark: { color: '#fff', fontWeight: '700', fontSize: 12, lineHeight: 14 },
  templateSection: { marginTop: 14, gap: 8 },
  templateHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  templateSelectTrigger: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  templateSelectTriggerLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  templateSelectTriggerDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  templateLabel: { fontSize: 13, fontWeight: '700', flex: 1 },
  templateAddButton: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  templateAddButtonLight: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  templateAddButtonDark: { borderColor: '#001A4D', backgroundColor: '#00133D' },
  templateAddButtonText: { fontSize: 12, fontWeight: '700' },
  templateAddButtonTextLight: { color: '#1d4ed8' },
  templateAddButtonTextDark: { color: '#F4F8FF' },
  templateLabelLight: { color: '#334155' },
  templateLabelDark: { color: '#F4F8FF' },
  templateOption: { borderRadius: 10, borderWidth: 1, padding: 10 },
  templateOptionLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  templateOptionDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  templateOptionSelectedLight: { borderColor: '#1d4ed8', backgroundColor: '#dbeafe' },
  templateOptionSelectedDark: { borderColor: '#0EC3C9', backgroundColor: '#00133D' },
  templateOptionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  templateName: { fontWeight: '700', flex: 1 },
  templateNameLight: { color: '#232832' },
  templateNameDark: { color: '#F4F8FF' },
  templateBadge: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  templateBadgeSelected: { color: '#bfdbfe' },
  templateMeta: { marginTop: 4, fontSize: 12 },
  templateMetaLight: { color: '#475569' },
  templateMetaDark: { color: '#F4F8FF' },
  templateActionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  templateActionButton: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  templateActionButtonLight: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  templateActionButtonDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  templateActionButtonDisabled: { opacity: 0.45 },
  templateActionButtonText: { fontSize: 12, fontWeight: '700' },
  templateActionButtonTextLight: { color: '#1d4ed8' },
  templateActionButtonTextDark: { color: '#F4F8FF' },
  templateDeleteButtonLight: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  templateDeleteButtonDark: { borderColor: '#F98D2F', backgroundColor: '#00133D' },
  templateDeleteButtonTextLight: { color: '#b91c1c' },
  templateDeleteButtonTextDark: { color: '#F4F8FF' },
  formField: { marginTop: 14, gap: 8 },
  templateInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  templateTextArea: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 88, textAlignVertical: 'top' },
  templateInputLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc', color: '#232832' },
  templateInputDark: { borderColor: '#001A4D', backgroundColor: '#1A2540', color: '#F4F8FF' },
  drawerClose: { marginTop: 12, backgroundColor: '#1d4ed8', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerCloseDisabled: { opacity: 0.45 },
  drawerCloseText: { color: '#fff', fontWeight: '700' },
  drawerKeyboardDismiss: { marginTop: 12, borderWidth: 1, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
  drawerSecondaryButton: { marginTop: 10, borderWidth: 1, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerSecondaryButtonLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  drawerSecondaryButtonDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  drawerSecondaryButtonText: { fontWeight: '700' },
  drawerSecondaryButtonTextLight: { color: '#334155' },
  drawerSecondaryButtonTextDark: { color: '#F4F8FF' },
});
