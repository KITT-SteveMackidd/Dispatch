import { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Swipeable } from 'react-native-gesture-handler';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSession } from '@/context/session';
import {
  cancelWorkerEventRole,
  acceptEventRoleWaitlistInvite,
  addEventRole,
  buildOrganizationManagersThreadId,
  createDispatchEvent,
  createEventTemplate,
  deleteDispatchEvent,
  deleteEventRole,
  deleteEventTemplate,
  ensureDefaultEventTemplates,
  joinEventRoleWaitlist,
  joinRoleWaitlist,
  loadOrganizationMembers,
  loadUserProfilesByIds,
  respondToRoleAssignmentNotification,
  sortDispatchEvents,
  updateEventRoleAssignment,
  updateEventRoleDetails,
  updateDispatchEventDetails,
  updateEventTemplate,
  uploadTemplateTaskAttachment,
  withdrawPendingEventRoleInvite,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { headerLogoSource } from '@/constants/branding';
import { ACCESSIBLE_TEXT_MAX_MULTIPLIER, MINIMUM_TOUCH_TARGET } from '@/constants/accessibility';
import {
  DRAWER_KEYBOARD_CONTENT_GAP,
  EVENT_ROLE_DRAWER_KEYBOARD_BEHAVIOR,
  EVENT_ROLE_EDITOR_KEYBOARD_VERTICAL_OFFSET,
  getEventRoleEditorKeyboardBehavior,
  getTemplateEditorReturnOffset,
} from '@/lib/keyboard-layout';
import { mergePersistedAndOptimisticEvents } from '@/lib/event-role-deletion';
import { addDispatchEventToCalendar } from '@/lib/calendar-events';
import { fetchPlaceAutocomplete, PlaceAutocompleteSuggestion } from '@/lib/google-places';
import { openMapAppPicker } from '@/lib/map-apps';
import {
  getAvailableRoleSlots,
  getWorkerRoleAction,
  getWorkerRoleActionFromNotification,
  getWorkerVisibleRoles,
  keepLatestWorkerRoleNotifications,
  mergeWorkerRoleAvailability,
} from '@/lib/worker-role-action';
import { preserveTemplateTaskOrder } from '@/lib/template-task-order';
import { buildCreateEventRoleDrafts, type CreateEventRoleDraft } from '@/lib/create-event-role-drafts';
import { resolveNativePickerChangeAction } from '@/lib/native-picker';
import {
  buildEventInviteTeamOptions,
  buildEditInviteChanges,
  buildEditInviteSelection,
  toggleEditableInviteTeam,
  toggleEditableInviteWorker,
} from '@/lib/edit-invite-selection';
import { DrawerBottomFill } from '@/components/DrawerBottomFill';

const lightEventsLogoSource = headerLogoSource;
const darkEventsLogoSource = headerLogoSource;

type ManagerNamesMap = Record<string, string>;
type UserMap = Record<string, UserProfile>;
type InviteStatus = 'pending' | 'accepted' | 'declined' | 'waitlisted';

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

type EventRoleEditorState = DrawerState & {
  mode: 'add' | 'edit';
  name: string;
  editingTasks: boolean;
  tasks: EventTask[];
  expectedRevision?: number;
};

const INITIAL_EVENT_ROLE_EDITOR: EventRoleEditorState = {
  open: false,
  eventId: null,
  roleId: null,
  mode: 'edit',
  name: '',
  editingTasks: false,
  tasks: [],
};

type TemplateTaskPreview = {
  id: string;
  name: string;
  description?: string;
  attachments?: Array<{ id: string; name: string; url: string; kind: 'photo' | 'document' }>;
  expectedOffsetMinutes?: number;
};

type TemplateRolePreview = {
  id: string;
  name: string;
  tasks: TemplateTaskPreview[];
};

type EventTemplateOption = EventTemplate;

type CreateEventRoleEditorState = {
  open: boolean;
  mode: 'add' | 'edit';
  roleId: string | null;
  name: string;
};

type EventEditState = {
  open: boolean;
  eventId: string | null;
  name: string;
  date: string;
  time: string;
  location: string;
  locationPlaceId: string;
  description: string;
  expectedRevision?: number;
};

const INITIAL_EVENT_EDIT_STATE: EventEditState = {
  open: false,
  eventId: null,
  name: '',
  date: '',
  time: '',
  location: '',
  locationPlaceId: '',
  description: '',
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

type TemplateTaskEditorState = {
  open: boolean;
  mode: 'add' | 'edit';
  roleId: string | null;
  taskId: string | null;
  name: string;
  description: string;
  includeCountdownTimer: boolean;
  expectedOffsetText: string;
  attachments: Array<{ id: string; name: string; url: string; kind: 'photo' | 'document' }>;
};

const INITIAL_TEMPLATE_TASK_EDITOR: TemplateTaskEditorState = {
  open: false,
  mode: 'add',
  roleId: null,
  taskId: null,
  name: '',
  description: '',
  includeCountdownTimer: false,
  expectedOffsetText: '00:00:00',
  attachments: [],
};

type EventsWeekRow =
  | { type: 'day'; key: string; date: Date }
  | { type: 'event'; key: string; event: DispatchEvent };

function LocationAutocompleteField({
  label,
  value,
  onChangeText,
  selectedPlaceId,
  onPlaceIdChange,
  placeholder,
  isDarkMode,
  onFocus,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  selectedPlaceId?: string | null;
  onPlaceIdChange: (placeId: string | null) => void;
  placeholder: string;
  isDarkMode: boolean;
  onFocus?: () => void;
}) {
  const [suggestions, setSuggestions] = useState<PlaceAutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = value.trim();
    if (selectedPlaceId) {
      setSuggestions([]);
      setError(null);
      setLoading(false);
      return;
    }
    if (query.length < 3) {
      setSuggestions([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      setLoading(true);
      fetchPlaceAutocomplete(query, controller.signal)
        .then((items) => {
          setSuggestions(items);
          setError(null);
        })
        .catch((autocompleteError) => {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setError(autocompleteError instanceof Error ? autocompleteError.message : 'Unable to load location suggestions.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [selectedPlaceId, value]);

  const selectSuggestion = (suggestion: PlaceAutocompleteSuggestion) => {
    onChangeText(suggestion.label);
    onPlaceIdChange(suggestion.id);
    setSuggestions([]);
    setError(null);
  };

  return (
    <View style={styles.locationAutocompleteWrap}>
      <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(text) => {
          onChangeText(text);
          onPlaceIdChange(null);
        }}
        placeholder={placeholder}
        placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.33)' : '#94a3b8'}
        returnKeyType="next"
        blurOnSubmit={false}
        onFocus={onFocus}
        style={[styles.templateInput, isDarkMode ? styles.createEventTextInputDark : styles.createEventTextInputLight]}
      />
      {loading ? (
        <Text style={[styles.locationAutocompleteHint, isDarkMode ? styles.drawerMetaDark : styles.drawerMetaLight]}>Searching...</Text>
      ) : null}
      {selectedPlaceId ? (
        <Text style={[styles.locationAutocompleteHint, isDarkMode ? styles.drawerMetaDark : styles.drawerMetaLight]}>Confirmed Google Places location</Text>
      ) : value.trim().length >= 3 && !loading ? (
        <Text style={[styles.locationAutocompleteHint, isDarkMode ? styles.drawerMetaDark : styles.drawerMetaLight]}>Choose a suggestion to confirm this location.</Text>
      ) : null}
      {error ? (
        <Text style={[styles.locationAutocompleteHint, styles.locationAutocompleteError]}>{error}</Text>
      ) : null}
      {suggestions.length ? (
        <View style={[styles.locationSuggestions, isDarkMode ? styles.locationSuggestionsDark : styles.locationSuggestionsLight]}>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.id}
              accessibilityRole="button"
              accessibilityLabel={`Use ${suggestion.label}`}
              style={styles.locationSuggestionRow}
              onPress={() => selectSuggestion(suggestion)}>
              <MaterialIcons name="place" size={18} color="#F98D2F" />
              <View style={styles.locationSuggestionTextWrap}>
                <Text style={[styles.locationSuggestionTitle, isDarkMode ? styles.titleDark : styles.titleLight]} numberOfLines={1}>
                  {suggestion.label}
                </Text>
                {suggestion.secondaryLabel ? (
                  <Text style={[styles.locationSuggestionMeta, isDarkMode ? styles.drawerMetaDark : styles.drawerMetaLight]} numberOfLines={1}>
                    {suggestion.secondaryLabel}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function EventsScreen() {
  const { profile } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ openTemplateDrawer?: string; templateId?: string }>();
  const { resolvedThemeMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const isDarkMode = resolvedThemeMode === 'dark';
  const drawerSurfaceColor = isDarkMode ? '#12274D' : '#F7F7F7';
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [expandedRoleTaskIds, setExpandedRoleTaskIds] = useState<Record<string, boolean>>({});
  const [managerNames, setManagerNames] = useState<ManagerNamesMap>({});
  const [workerProfiles, setWorkerProfiles] = useState<UserMap>({});
  const [teamWorkerIds, setTeamWorkerIds] = useState<string[]>([]);
  const [organizationWorkerIds, setOrganizationWorkerIds] = useState<string[]>([]);
  const [managerTeams, setManagerTeams] = useState<Team[]>([]);
  const [expandedInviteTeamIds, setExpandedInviteTeamIds] = useState<Record<string, boolean>>({});
  const [replaceDrawer, setReplaceDrawer] = useState<DrawerState>(INITIAL_DRAWER);
  const [inviteDrawer, setInviteDrawer] = useState<DrawerState>(INITIAL_DRAWER);
  const [eventRoleEditor, setEventRoleEditor] = useState<EventRoleEditorState>(INITIAL_EVENT_ROLE_EDITOR);
  const [eventRoleTaskEditor, setEventRoleTaskEditor] = useState<TemplateTaskEditorState>(INITIAL_TEMPLATE_TASK_EDITOR);
  const [roleMutationBusyKey, setRoleMutationBusyKey] = useState<string | null>(null);
  const [roleCancellationBusyKey, setRoleCancellationBusyKey] = useState<string | null>(null);
  const [inviteSelectedWorkerIds, setInviteSelectedWorkerIds] = useState<string[]>([]);
  const [inviteSubmitBusy, setInviteSubmitBusy] = useState(false);
  const [createEventDrawerOpen, setCreateEventDrawerOpen] = useState(false);
  const [createTemplateDrawerOpen, setCreateTemplateDrawerOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateNameDraft, setTemplateNameDraft] = useState('');
  const [templateDefaultTimeDraft, setTemplateDefaultTimeDraft] = useState('');
  const [showTemplateDefaultTimePicker, setShowTemplateDefaultTimePicker] = useState(false);
  const [templateDefaultLocationDraft, setTemplateDefaultLocationDraft] = useState('');
  const [templateDefaultLocationPlaceIdDraft, setTemplateDefaultLocationPlaceIdDraft] = useState('');
  const [templateDefaultDescriptionDraft, setTemplateDefaultDescriptionDraft] = useState('');
  const [templateRolesDraft, setTemplateRolesDraft] = useState<TemplateRoleDraft[]>([]);
  const [templateTaskEditor, setTemplateTaskEditor] = useState<TemplateTaskEditorState>(INITIAL_TEMPLATE_TASK_EDITOR);
  const [templateTaskOffsetSelectorPart, setTemplateTaskOffsetSelectorPart] = useState<'hours' | 'minutes' | 'seconds' | null>(null);
  const [templateTaskOffsetDrafts, setTemplateTaskOffsetDrafts] = useState<Record<string, string>>({});
  const [templateAttachmentBusyKey, setTemplateAttachmentBusyKey] = useState<string | null>(null);
  const [templateOptions, setTemplateOptions] = useState<EventTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [reopenCreateEventAfterTemplateFlow, setReopenCreateEventAfterTemplateFlow] = useState(false);
  const resumeCreateEventAfterRoleEditorRef = useRef(false);
  const [pendingRoleNotifications, setPendingRoleNotifications] = useState<Array<{
    id: string;
    action: 'assign' | 'remove';
    status: 'pending' | 'accepted' | 'declined' | 'waitlisted';
    managerId: string;
    eventId: string;
    eventName?: string;
    eventLocation?: string;
    eventStartsAt?: string;
    roleName?: string;
    roleTaskNames?: string[];
    roleId: string;
    roleOpenSlots?: number;
    roleAssignedWorkerIds?: string[];
    roleWaitlistWorkerIds?: string[];
    roleEligibleWaitlistWorkerIds?: string[];
    roleWaitlistInviteWorkerIds?: string[];
  }>>([]);
  const [pendingInviteWorkerIdsByRoleKey, setPendingInviteWorkerIdsByRoleKey] = useState<Record<string, string[]>>({});
  const [inviteStatusByRoleWorkerKey, setInviteStatusByRoleWorkerKey] = useState<Record<string, InviteStatus>>({});
  const [notificationBusyId, setNotificationBusyId] = useState<string | null>(null);
  const [expandedPendingNotificationIds, setExpandedPendingNotificationIds] = useState<Record<string, boolean>>({});
  const [eventDateDraft, setEventDateDraft] = useState('');
  const [eventTimeDraft, setEventTimeDraft] = useState('');
  const [eventDatePickerDraft, setEventDatePickerDraft] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showEventsWeekPicker, setShowEventsWeekPicker] = useState(false);
  const drawerKeyboardOffset = 0;
  const [eventLocationDraft, setEventLocationDraft] = useState('');
  const [eventLocationPlaceIdDraft, setEventLocationPlaceIdDraft] = useState('');
  const [eventDescriptionDraft, setEventDescriptionDraft] = useState('');
  const [createEventRolesDraft, setCreateEventRolesDraft] = useState<CreateEventRoleDraft[]>([]);
  const [createEventRoleEditor, setCreateEventRoleEditor] = useState<CreateEventRoleEditorState>(INITIAL_CREATE_EVENT_ROLE_EDITOR);
  const [eventEdit, setEventEdit] = useState<EventEditState>(INITIAL_EVENT_EDIT_STATE);
  const [eventEditBusy, setEventEditBusy] = useState(false);
  const [optimisticCreatedEvents, setOptimisticCreatedEvents] = useState<DispatchEvent[]>([]);
  const [rolePickerRoleId, setRolePickerRoleId] = useState<string | null>(null);
  const [assignmentBusyKey, setAssignmentBusyKey] = useState<string | null>(null);
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => {
    const today = new Date();
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    base.setDate(base.getDate() - base.getDay());
    base.setHours(0, 0, 0, 0);
    return base;
  });
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
  const createEventScrollRef = useRef<ScrollView | null>(null);
  const createTemplateScrollRef = useRef<ScrollView | null>(null);
  const createTemplateScrollOffsetRef = useRef(0);
  const templateRoleYByIdRef = useRef<Record<string, number>>({});
  const templateTaskReturnScrollYRef = useRef(0);
  const templateTaskRestorePendingRef = useRef(false);
  const templateTaskDescriptionYRef = useRef(0);
  const templateDefaultLocationYRef = useRef(0);
  const templateDefaultDescriptionYRef = useRef(0);
  const eventLocationYRef = useRef(0);
  const eventDescriptionYRef = useRef(0);
  const knownEventIdsRef = useRef<Set<string>>(new Set());
  const eventListInitializedRef = useRef(false);
  const calendarPromptedEventIdsRef = useRef<Set<string>>(new Set());
  const canCreateEvent = profile?.role === 'manager';
  const eventInviteTeamOptions = useMemo(
    () => buildEventInviteTeamOptions(managerTeams, organizationWorkerIds),
    [managerTeams, organizationWorkerIds]
  );

  useEffect(() => {
    if (templateTaskEditor.open || !templateTaskRestorePendingRef.current) return;

    const returnScrollY = templateTaskReturnScrollYRef.current;
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        createTemplateScrollRef.current?.scrollTo({ y: returnScrollY, animated: false });
        createTemplateScrollOffsetRef.current = returnScrollY;
        templateTaskRestorePendingRef.current = false;
      });
    });

    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame) cancelAnimationFrame(innerFrame);
    };
  }, [templateTaskEditor.open]);

  const getTemplateRoleCount = (template: EventTemplateOption) => template.roles?.length ?? 0;
  const getTemplateTaskCount = (template: EventTemplateOption) => (template.roles || []).reduce((sum, role) => sum + (role.tasks?.length || 0), 0);

  const formatOffsetHhMmSs = (minutes: number) => {
    const safeMinutes = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
    const hours = Math.floor(safeMinutes / 60).toString().padStart(2, '0');
    const mins = (safeMinutes % 60).toString().padStart(2, '0');
    return `${hours}:${mins}:00`;
  };

  const formatRoleDurationLabel = (tasks: TemplateTaskPreview[]) => {
    if (!tasks.length) return '0 min total';

    const offsets = tasks.map((task) => Math.max(0, Math.round(task.expectedOffsetMinutes || 0)));
    const durationMinutes = Math.max(0, Math.max(...offsets) - Math.min(...offsets));
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;

    if (hours && minutes) return `${hours}h ${minutes} min total`;
    if (hours) return `${hours}h total`;
    if (minutes) return `${minutes} min total`;
    return '0 min total';
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

  const scrollFieldAboveKeyboard = (scrollRef: RefObject<ScrollView | null>, fieldY: number) => {
    const delay = Platform.OS === 'ios' ? 220 : 320;
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, fieldY - 120),
        animated: true,
      });
    }, delay);
  };

  const scrollCreateEventFieldAboveKeyboard = (fieldY: number) => {
    scrollFieldAboveKeyboard(createEventScrollRef, fieldY);
  };

  const scrollCreateTemplateFieldAboveKeyboard = (fieldY: number) => {
    scrollFieldAboveKeyboard(createTemplateScrollRef, fieldY);
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

  const normalizeEventDate = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const formatEventDateDraft = (date: Date) => {
    const normalized = normalizeEventDate(date);
    const year = normalized.getFullYear();
    const month = String(normalized.getMonth() + 1).padStart(2, '0');
    const day = String(normalized.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const parseEventDate = () => {
    if (!eventDateDraft) return normalizeEventDate(new Date());
    const parsed = new Date(`${eventDateDraft}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? normalizeEventDate(new Date()) : normalizeEventDate(parsed);
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
    const action = resolveNativePickerChangeAction(Platform.OS, event.type, Boolean(selectedDate));
    if (action === 'dismiss') {
      setShowDatePicker(false);
      return;
    }
    if (action === 'ignore' || !selectedDate) return;

    const normalizedDate = normalizeEventDate(selectedDate);
    setEventDatePickerDraft(normalizedDate);
    if (action === 'commit') {
      setEventDateDraft(formatEventDateDraft(normalizedDate));
      setShowDatePicker(false);
    }
  };

  const handleSelectEventDate = () => {
    setEventDateDraft(formatEventDateDraft(eventDatePickerDraft));
    setShowDatePicker(false);
  };

  const handleTimeChange = (event: DateTimePickerEvent, selectedTime?: Date) => {
    const action = resolveNativePickerChangeAction(Platform.OS, event.type, Boolean(selectedTime));
    if (action === 'dismiss') {
      setShowTimePicker(false);
      return;
    }
    if (action === 'ignore' || !selectedTime) return;

    const hours = String(selectedTime.getHours()).padStart(2, '0');
    const minutes = String(selectedTime.getMinutes()).padStart(2, '0');
    setEventTimeDraft(`${hours}:${minutes}`);
    if (action === 'commit') setShowTimePicker(false);
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
    const action = resolveNativePickerChangeAction(Platform.OS, event.type, Boolean(selectedTime));
    if (action === 'dismiss') {
      setShowTemplateDefaultTimePicker(false);
      return;
    }
    if (action === 'ignore' || !selectedTime) return;

    const hours = String(selectedTime.getHours()).padStart(2, '0');
    const minutes = String(selectedTime.getMinutes()).padStart(2, '0');
    setTemplateDefaultTimeDraft(`${hours}:${minutes}`);
    if (action === 'commit') setShowTemplateDefaultTimePicker(false);
  };

  const pickerSharedProps = {
    accentColor: '#0EC3C9',
    textColor: isDarkMode ? '#F7F7F7' : '#121212',
    themeVariant: isDarkMode ? 'dark' as const : 'light' as const,
  };

  const applyWeekFromDate = (date: Date) => {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    setSelectedWeekStart(start);
  };

  const parseTemplateTaskOffsetParts = (raw: string) => {
    const [hourText = '0', minuteText = '0', secondText = '0'] = raw.split(':');
    const safeHours = Math.max(0, Math.min(23, Number(hourText) || 0));
    const safeMinutes = Math.max(0, Math.min(59, Number(minuteText) || 0));
    const safeSeconds = Math.max(0, Math.min(59, Number(secondText) || 0));
    return { hours: safeHours, minutes: safeMinutes, seconds: safeSeconds };
  };

  const setTemplateTaskOffsetPart = (part: 'hours' | 'minutes' | 'seconds', value: number) => {
    setTemplateTaskEditor((prev) => {
      const current = parseTemplateTaskOffsetParts(prev.expectedOffsetText);
      const next = { ...current };
      const limits = { hours: 23, minutes: 59, seconds: 59 };
      next[part] = Math.max(0, Math.min(limits[part], value));
      return {
        ...prev,
        expectedOffsetText: [
          String(next.hours).padStart(2, '0'),
          String(next.minutes).padStart(2, '0'),
          String(next.seconds).padStart(2, '0'),
        ].join(':'),
      };
    });
  };

  const promptAddEventToCalendar = (event: DispatchEvent) => {
    if (calendarPromptedEventIdsRef.current.has(event.id)) return;
    calendarPromptedEventIdsRef.current.add(event.id);

    const startsAt = new Date(event.startsAt);
    const when = Number.isNaN(startsAt.getTime())
      ? 'the scheduled event time'
      : startsAt.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

    Alert.alert(
      'Add event to calendar?',
      `${event.name} starts ${when}${event.location ? ` at ${event.location}` : ''}.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Add',
          onPress: async () => {
            try {
              await addDispatchEventToCalendar(event);
              Alert.alert('Added to calendar', `${event.name} was added to your calendar.`);
            } catch (error) {
              Alert.alert('Unable to add calendar event', error instanceof Error ? error.message : 'Please try again.');
            }
          },
        },
      ]
    );
  };

  const updateWatchedEvents = (items: DispatchEvent[]) => {
    setEvents(items);
    const nextIds = new Set(items.map((item) => item.id));

    if (!eventListInitializedRef.current) {
      knownEventIdsRef.current = nextIds;
      eventListInitializedRef.current = true;
      return;
    }

    const addedEvents = items.filter((item) => !knownEventIdsRef.current.has(item.id));
    knownEventIdsRef.current = nextIds;
    addedEvents.forEach(promptAddEventToCalendar);
  };

  useEffect(() => {
    if (!profile) return;
    knownEventIdsRef.current = new Set();
    eventListInitializedRef.current = false;
    calendarPromptedEventIdsRef.current = new Set();

    return profile.role === 'manager'
      ? watchManagerEvents(profile.uid, (items) => {
          updateWatchedEvents(items);
          setOptimisticCreatedEvents((prev) => prev.filter((pending) => !items.some((item) => item.id === pending.id)));
        }, profile.organizationId)
      : watchWorkerEvents(profile.uid, (items) => {
          updateWatchedEvents(items);
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
    }, profile.organizationId);
  }, [profile]);

  useEffect(() => {
    if (profile?.role !== 'manager' || !profile.organizationId) {
      setOrganizationWorkerIds([]);
      return;
    }

    let active = true;
    loadOrganizationMembers(profile.organizationId)
      .then(({ members }) => {
        if (!active) return;
        const workers = members.filter((member) => member.role === 'worker');
        setOrganizationWorkerIds([...new Set(workers.map((worker) => worker.uid).filter(Boolean))]);
        setWorkerProfiles((prev) => ({
          ...prev,
          ...Object.fromEntries(workers.map((worker) => [worker.uid, worker])),
        }));
      })
      .catch(() => {
        if (active) setOrganizationWorkerIds([]);
      });

    return () => {
      active = false;
    };
  }, [profile?.role, profile?.organizationId, inviteDrawer.open, managerTeams]);

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
        status: item.status,
        managerId: item.managerId,
        eventId: item.eventId,
        eventName: item.eventName,
        eventLocation: item.eventLocation,
        eventStartsAt: item.eventStartsAt,
        roleName: item.roleName,
        roleTaskNames: item.roleTaskNames,
        roleId: item.roleId,
        roleOpenSlots: item.roleOpenSlots,
        roleAssignedWorkerIds: item.roleAssignedWorkerIds,
        roleWaitlistWorkerIds: item.roleWaitlistWorkerIds,
        roleEligibleWaitlistWorkerIds: item.roleEligibleWaitlistWorkerIds,
        roleWaitlistInviteWorkerIds: item.roleWaitlistInviteWorkerIds,
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
        if (item.status !== 'pending' && item.status !== 'accepted' && item.status !== 'declined' && item.status !== 'waitlisted') return;

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
    setEventDatePickerDraft(normalizeEventDate(new Date()));
    setEventTimeDraft(initialTemplate?.defaultTime || '');
    setShowDatePicker(false);
    setShowTimePicker(false);
    setEventLocationDraft(initialTemplate?.defaultLocation || '');
    setEventLocationPlaceIdDraft(initialTemplate?.defaultLocationPlaceId || '');
    setEventDescriptionDraft(initialTemplate?.defaultDescription || '');
    setCreateEventRolesDraft(buildCreateEventRoleDrafts(initialTemplate));
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
    setTemplateTaskEditor(INITIAL_TEMPLATE_TASK_EDITOR);
    setShowTemplateDefaultTimePicker(false);
    if (template) {
      setEditingTemplateId(template.id);
      setTemplateNameDraft(template.name);
      setTemplateDefaultTimeDraft(template.defaultTime || '');
      setTemplateDefaultLocationDraft(template.defaultLocation || '');
      setTemplateDefaultLocationPlaceIdDraft(template.defaultLocationPlaceId || '');
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
      setTemplateDefaultLocationPlaceIdDraft('');
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
    templateTaskRestorePendingRef.current = false;
    setCreateTemplateDrawerOpen(false);
    setShowTemplateDefaultTimePicker(false);
    setTemplateTaskEditor(INITIAL_TEMPLATE_TASK_EDITOR);
    setEditingTemplateId(null);
    setTemplateNameDraft('');
    setTemplateDefaultTimeDraft('');
    setTemplateDefaultLocationDraft('');
    setTemplateDefaultLocationPlaceIdDraft('');
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
    if (templateDefaultLocationDraft.trim() && !templateDefaultLocationPlaceIdDraft.trim()) {
      Alert.alert('Confirm default location', 'Choose the default location from the Google Places suggestions before saving this template.');
      return;
    }

    const sanitizedRoles = templateRolesDraft
      .map((role, index) => {
        const sanitizedTasks = preserveTemplateTaskOrder(role.tasks)
          .map((task, taskIndex) => {
            const description = task.description?.trim();
            return {
              id: task.id || `task-${Date.now()}-${taskIndex + 1}`,
              name: task.name.trim(),
              ...(description ? { description } : {}),
              attachments: (task.attachments || []).filter((attachment) => attachment.url.trim().length > 0),
              ...(Number.isFinite(task.expectedOffsetMinutes)
                ? { expectedOffsetMinutes: Math.max(0, Math.round(task.expectedOffsetMinutes as number)) }
                : {}),
            };
          })
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
            defaultLocationPlaceId: templateDefaultLocationPlaceIdDraft.trim() || undefined,
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
        defaultLocationPlaceId: templateDefaultLocationPlaceIdDraft.trim() || undefined,
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

  const openTemplateTaskEditor = (roleId: string) => {
    const role = templateRolesDraft.find((item) => item.id === roleId);
    templateTaskReturnScrollYRef.current = getTemplateEditorReturnOffset(
      templateRoleYByIdRef.current[roleId],
      createTemplateScrollOffsetRef.current
    );
    setTemplateTaskEditor({
      open: true,
      mode: 'add',
      roleId,
      taskId: `task-${Date.now()}-${(role?.tasks.length || 0) + 1}`,
      name: '',
      description: '',
      includeCountdownTimer: false,
      expectedOffsetText: '00:00:00',
      attachments: [],
    });
    setTemplateTaskOffsetSelectorPart(null);
  };

  const editTemplateTaskEditor = (roleId: string, task: TemplateTaskPreview) => {
    templateTaskReturnScrollYRef.current = getTemplateEditorReturnOffset(
      templateRoleYByIdRef.current[roleId],
      createTemplateScrollOffsetRef.current
    );
    setTemplateTaskEditor({
      open: true,
      mode: 'edit',
      roleId,
      taskId: task.id,
      name: task.name || '',
      description: task.description || '',
      includeCountdownTimer: Number.isFinite(task.expectedOffsetMinutes),
      expectedOffsetText: formatOffsetHhMmSs(task.expectedOffsetMinutes || 0),
      attachments: [...(task.attachments || [])],
    });
    setTemplateTaskOffsetSelectorPart(null);
  };

  const closeTemplateTaskEditor = () => {
    templateTaskRestorePendingRef.current = true;
    setTemplateTaskOffsetSelectorPart(null);
    setTemplateTaskEditor(INITIAL_TEMPLATE_TASK_EDITOR);
  };

  const saveTemplateTaskEditor = () => {
    const roleId = templateTaskEditor.roleId;
    const taskId = templateTaskEditor.taskId;
    const taskName = templateTaskEditor.name.trim();

    if (!roleId || !taskId) return;
    if (!taskName.length) {
      Alert.alert('Task name required', 'Please add a task name before confirming.');
      return;
    }

    const parsedOffsetMinutes = templateTaskEditor.includeCountdownTimer
      ? parseOffsetHhMmSsToMinutes(templateTaskEditor.expectedOffsetText)
      : undefined;
    if (templateTaskEditor.includeCountdownTimer && parsedOffsetMinutes === null) {
      Alert.alert('Invalid task time', 'Use the format HH:MM:SS for the total time.');
      return;
    }

    setTemplateRolesDraft((prev) => prev.map((role) => (
      role.id === roleId
        ? {
            ...role,
            tasks: preserveTemplateTaskOrder(templateTaskEditor.mode === 'edit'
              ? role.tasks.map((task) => (
                  task.id === taskId
                    ? (() => {
                        const { expectedOffsetMinutes: _offset, ...taskWithoutCountdown } = task;
                        return {
                        ...taskWithoutCountdown,
                        name: taskName,
                        description: templateTaskEditor.description.trim(),
                        attachments: templateTaskEditor.attachments,
                        ...(parsedOffsetMinutes !== undefined && parsedOffsetMinutes !== null ? { expectedOffsetMinutes: parsedOffsetMinutes } : {}),
                      };
                    })()
                    : task
                ))
              : [
                  ...role.tasks,
                  {
                    id: taskId,
                    name: taskName,
                    description: templateTaskEditor.description.trim(),
                    attachments: templateTaskEditor.attachments,
                    ...(parsedOffsetMinutes !== undefined && parsedOffsetMinutes !== null ? { expectedOffsetMinutes: parsedOffsetMinutes } : {}),
                  },
                ]),
          }
        : role
    )));

    closeTemplateTaskEditor();
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

  const setTemplateTaskCountdownEnabled = (roleId: string, taskId: string, enabled: boolean) => {
    setTemplateTaskOffsetDrafts((prev) => {
      const next = { ...prev };
      delete next[`${roleId}:${taskId}`];
      return next;
    });
    setTemplateRolesDraft((prev) => prev.map((role) => {
      if (role.id !== roleId) return role;
      return {
        ...role,
        tasks: role.tasks.map((task) => {
          if (task.id !== taskId) return task;
          if (enabled) {
            return {
              ...task,
              expectedOffsetMinutes: Number.isFinite(task.expectedOffsetMinutes) ? task.expectedOffsetMinutes : 0,
            };
          }

          const { expectedOffsetMinutes: _offset, ...taskWithoutCountdown } = task;
          return taskWithoutCountdown;
        }),
      };
    }));
  };

  const addTemplateTaskEditorAttachment = async (kind: 'photo' | 'document') => {
    if (!profile?.uid || !templateTaskEditor.taskId) return;
    const busyKey = `template-task-editor:${kind}`;
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
        taskId: templateTaskEditor.taskId,
        uri: selected.uri,
        kind,
        name: selected.name,
        mimeType: selected.mimeType,
      });

      setTemplateTaskEditor((prev) => ({
        ...prev,
        attachments: [...prev.attachments, uploaded],
      }));
    } catch (error) {
      Alert.alert('Attachment error', error instanceof Error ? error.message : 'Unable to attach file.');
    } finally {
      setTemplateAttachmentBusyKey(null);
    }
  };

  const removeTemplateTaskEditorAttachment = (attachmentId: string) => {
    setTemplateTaskEditor((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((attachment) => attachment.id !== attachmentId),
    }));
  };

  const showTemplateTaskDescription = (taskName: string, description?: string) => {
    const trimmed = description?.trim();
    if (!trimmed) return;
    Alert.alert(taskName || 'Task Description', trimmed);
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

  const latestRoleNotifications = useMemo(
    () => keepLatestWorkerRoleNotifications(pendingRoleNotifications),
    [pendingRoleNotifications]
  );

  const allEvents = useMemo(
    () => {
      const buildPendingInviteRole = (notification: (typeof pendingRoleNotifications)[number]): EventRole => ({
        id: notification.roleId,
        name: notification.roleName?.trim() || 'Invited role',
        assignedWorkerIds: notification.roleAssignedWorkerIds || [],
        waitlistWorkerIds: notification.roleWaitlistWorkerIds || [],
        eligibleWaitlistWorkerIds: notification.roleEligibleWaitlistWorkerIds || [],
        waitlistInviteWorkerIds: notification.roleWaitlistInviteWorkerIds || [],
        openSlots: getAvailableRoleSlots({
          openSlots: notification.roleOpenSlots,
          assignedWorkerIds: notification.roleAssignedWorkerIds,
        }),
        tasks: (notification.roleTaskNames || []).map((taskName, index) => ({
          id: `pending-task-${notification.id}-${index}`,
          name: taskName,
          completedBy: [],
        })),
      });

      const baseEvents = mergePersistedAndOptimisticEvents(events, optimisticCreatedEvents);
      const activeEventIds = new Set(baseEvents.map((event) => event.id));
      const pendingNotificationsByEvent = new Map<string, typeof pendingRoleNotifications>();

      if (profile?.role === 'worker') {
        latestRoleNotifications
          .filter((notification) => notification.action === 'assign')
          .filter((notification) => notification.status === 'pending' || notification.status === 'declined' || notification.status === 'waitlisted')
          .filter((notification) => Number.isFinite(new Date(notification.eventStartsAt || '').getTime()))
          .forEach((notification) => {
            const current = pendingNotificationsByEvent.get(notification.eventId) || [];
            current.push(notification);
            pendingNotificationsByEvent.set(notification.eventId, current);
          });
      }

      const activeEventsWithPendingInvites = baseEvents.map((event) => {
        if (profile?.role !== 'worker') return event;
        const notifications = pendingNotificationsByEvent.get(event.id) || [];
        if (!notifications.length) return event;

        const rolesWithLiveAvailability = event.roles.map((role) => {
          const notification = notifications.find((item) => item.roleId === role.id);
          return notification ? mergeWorkerRoleAvailability(role, notification) : role;
        });
        const eventWithLiveAvailability = { ...event, roles: rolesWithLiveAvailability };
        const hasAcceptedRole = rolesWithLiveAvailability.some((role) => role.assignedWorkerIds.includes(profile.uid));
        if (hasAcceptedRole) return eventWithLiveAvailability;

        const existingRoleIds = new Set(rolesWithLiveAvailability.map((role) => role.id));
        const pendingRoles = notifications
          .filter((notification) => !existingRoleIds.has(notification.roleId))
          .map(buildPendingInviteRole);

        return {
          ...eventWithLiveAvailability,
          pendingInviteNotificationIds: {
            ...(event.pendingInviteNotificationIds || {}),
            ...Object.fromEntries(notifications.map((notification) => [notification.roleId, notification.id])),
          },
          roles: [...rolesWithLiveAvailability, ...pendingRoles],
        };
      });

      const pendingInviteEvents: DispatchEvent[] = profile?.role === 'worker'
        ? latestRoleNotifications
            .filter((notification) => notification.action === 'assign')
            .filter((notification) => notification.status === 'pending' || notification.status === 'declined' || notification.status === 'waitlisted')
            .filter((notification) => !activeEventIds.has(notification.eventId))
            .filter((notification) => Number.isFinite(new Date(notification.eventStartsAt || '').getTime()))
            .reduce<DispatchEvent[]>((acc, notification) => {
              const existing = acc.find((event) => event.id === notification.eventId);
              if (existing) {
                existing.roles.push(buildPendingInviteRole(notification));
                existing.pendingInviteNotificationIds = {
                  ...(existing.pendingInviteNotificationIds || {}),
                  [notification.roleId]: notification.id,
                };
                return acc;
              }

              acc.push({
                id: notification.eventId,
                managerId: notification.managerId,
                name: notification.eventName?.trim() || 'Event invite',
                location: notification.eventLocation?.trim() || 'TBD',
                startsAt: notification.eventStartsAt || new Date().toISOString(),
                teamIds: [],
                pendingInviteNotificationId: notification.id,
                pendingInviteRoleId: notification.roleId,
                pendingInviteNotificationIds: { [notification.roleId]: notification.id },
                roles: [buildPendingInviteRole(notification)],
              });
              return acc;
            }, [])
        : [];
      const combined = [...activeEventsWithPendingInvites, ...pendingInviteEvents];
      const unique = combined.filter((event, index, list) => list.findIndex((item) => item.id === event.id) === index);
      const validEvents = unique.filter((event) => Number.isFinite(new Date(event.startsAt).getTime()));
      return sortDispatchEvents(validEvents);
    },
    [events, latestRoleNotifications, optimisticCreatedEvents, profile?.role, profile?.uid]
  );

  const acceptedWorkerEventIds = useMemo(() => {
    if (profile?.role !== 'worker' || !profile.uid) return new Set<string>();
    return new Set(
      allEvents
        .filter((event) => event.roles.some((role) => (role.assignedWorkerIds || []).includes(profile.uid)))
        .map((event) => event.id)
    );
  }, [allEvents, profile?.role, profile?.uid]);

  const actionableRoleNotifications = useMemo(
    () => latestRoleNotifications
      .filter((notification) => notification.status === 'pending')
      .filter((notification) => !acceptedWorkerEventIds.has(notification.eventId)),
    [acceptedWorkerEventIds, latestRoleNotifications]
  );

  const visibleEvents = useMemo(() => {
    const start = new Date(selectedWeekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    return allEvents.filter((event) => {
      const startsAtMs = new Date(event.startsAt).getTime();
      return Number.isFinite(startsAtMs) && startsAtMs >= start.getTime() && startsAtMs < end.getTime();
    });
  }, [allEvents, selectedWeekStart]);

  const eventsWeekRows = useMemo<EventsWeekRow[]>(() => {
    const rows: EventsWeekRow[] = [];

    for (let offset = 0; offset < 7; offset += 1) {
      const day = new Date(selectedWeekStart);
      day.setDate(day.getDate() + offset);
      day.setHours(0, 0, 0, 0);

      rows.push({
        type: 'day',
        key: `day-${day.toISOString()}`,
        date: day,
      });

      const dayEvents = visibleEvents.filter((event) => {
        const startsAt = new Date(event.startsAt);
        return startsAt.toDateString() === day.toDateString();
      });

      dayEvents.forEach((event) => {
        rows.push({
          type: 'event',
          key: event.id,
          event,
        });
      });
    }

    return rows;
  }, [selectedWeekStart, visibleEvents]);

  const formatOrdinalDay = (date: Date) => {
    const day = date.getDate();
    const remainder = day % 10;
    const teen = day % 100;
    if (teen >= 11 && teen <= 13) return `${day}th`;
    if (remainder === 1) return `${day}st`;
    if (remainder === 2) return `${day}nd`;
    if (remainder === 3) return `${day}rd`;
    return `${day}th`;
  };

  const formatEventsRangeLabel = (weekStart: Date) => {
    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startMonth = start.toLocaleDateString([], { month: 'short' });
    const endMonth = end.toLocaleDateString([], { month: 'short' });

    return startMonth === endMonth
      ? `${startMonth} ${formatOrdinalDay(start)} - ${end.getDate()}`
      : `${startMonth} ${formatOrdinalDay(start)} - ${endMonth} ${end.getDate()}`;
  };

  const shiftSelectedWeek = (direction: -1 | 1) => {
    setSelectedWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + direction * 7);
      next.setHours(0, 0, 0, 0);
      return next;
    });
  };

  const handleEventsWeekChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowEventsWeekPicker(false);
    if (event.type === 'dismissed' || !selectedDate) return;
    const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    setSelectedWeekStart(start);
  };

  const isCompletedEvent = (event: DispatchEvent) => {
    const startsAtMs = new Date(event.startsAt).getTime();
    return Number.isFinite(startsAtMs) && startsAtMs < Date.now();
  };

  const toggleExpanded = (eventId: string) => {
    setExpandedIds((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  const toggleRoleTaskExpanded = (eventId: string, roleId: string) => {
    const key = `${eventId}:${roleId}`;
    setExpandedRoleTaskIds((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const getWorkerRoleSubtitle = (event: DispatchEvent) => {
    if (!profile?.uid || profile.role !== 'worker') return '';
    const assignedRoleNames = event.roles
      .filter((role) => (role.assignedWorkerIds || []).includes(profile.uid))
      .map((role) => role.name)
      .filter(Boolean);
    if (assignedRoleNames.length) return assignedRoleNames.join(', ');

    const waitlistedRoleNames = event.roles
      .filter((role) => (role.waitlistWorkerIds || []).includes(profile.uid))
      .map((role) => `${role.name} - Waitlisted`)
      .filter(Boolean);
    if (waitlistedRoleNames.length) return waitlistedRoleNames.join(', ');

    const pendingRoleIds = new Set(Object.keys(event.pendingInviteNotificationIds || {}));
    const pendingRoleNames = event.roles
      .filter((role) => pendingRoleIds.has(role.id))
      .map((role) => role.name)
      .filter(Boolean);
    return pendingRoleNames.join(', ');
  };

  const findRoleForDrawer = (drawer: DrawerState): { event: DispatchEvent; role: EventRole } | null => {
    if (!drawer.eventId || !drawer.roleId) return null;
    const event = visibleEvents.find((item) => item.id === drawer.eventId);
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

  const openTaskDescription = (task: EventTask) => {
    Alert.alert(task.name || 'Task description', task.description?.trim() || 'No description has been added for this task.');
  };

  const confirmCancelWorkerRole = (event: DispatchEvent, role: EventRole) => {
    if (!profile?.uid) return;

    const busyKey = `${event.id}:${role.id}`;
    if (roleCancellationBusyKey === busyKey) return;

    setRoleCancellationBusyKey(busyKey);
    cancelWorkerEventRole({
      eventId: event.id,
      roleId: role.id,
      workerId: profile.uid,
    }).catch((error) => {
      Alert.alert('Unable to cancel role', error instanceof Error ? error.message : 'Please try again.');
    }).finally(() => {
      setRoleCancellationBusyKey(null);
    });
  };

  const renderWorkerTaskList = (event: DispatchEvent) => {
    if (!profile) return null;

    const pendingRoleIds = Object.keys(event.pendingInviteNotificationIds || {});
    const visibleWorkerRoles = getWorkerVisibleRoles(event.roles, profile.uid, pendingRoleIds);
    const assignedRoles = visibleWorkerRoles.filter((role) => role.assignedWorkerIds.includes(profile.uid));
    const pendingInviteRoleCards = Object.entries(event.pendingInviteNotificationIds || {})
      .flatMap(([roleId, notificationId]) => {
        const role = visibleWorkerRoles.find((item) => item.id === roleId);
        if (!role) return [];
        const notification = latestRoleNotifications.find(
          (item) => item.eventId === event.id && item.roleId === roleId
        );
        return [{
          notificationId: notification?.id || notificationId,
          notificationStatus: notification?.status,
          notification,
          role,
        }];
      });

    if (!assignedRoles.length && pendingInviteRoleCards.length) {
      return (
        <View style={styles.taskList}>
          {pendingInviteRoleCards.map(({ notificationId, notificationStatus, notification, role }) => {
            const busyKey = `${event.id}:${role.id}`;
            const busy = notificationBusyId === notificationId || notificationBusyId === busyKey;
            const roleAction = notification
              ? getWorkerRoleActionFromNotification(notification, profile.uid)
              : getWorkerRoleAction(role, profile.uid);
            const canAccept = roleAction === 'accept';
            const isWaitlisted = roleAction === 'waitlisted';
            const buttonLabel = canAccept ? 'Accept' : isWaitlisted ? 'Waitlisted' : 'Join Waitlist';

            return (
              <View key={`pending-invite-role-${notificationId}`} style={[styles.pendingInviteRoleCard, isDarkMode ? styles.pendingInviteRoleCardDark : styles.pendingInviteRoleCardLight]}>
                <View style={styles.pendingInviteRoleInfo}>
                  <Text style={[styles.roleMeta, isDarkMode ? styles.roleMetaDark : styles.roleMetaLight]}>
                    {canAccept ? 'Open role' : isWaitlisted ? 'Waitlisted role' : 'Invited role'}
                  </Text>
                  <Text style={[styles.roleTitle, isDarkMode ? styles.roleTitleDark : styles.roleTitleLight]}>{role.name}</Text>
                  {role.tasks.length ? (
                    <Text style={[styles.roleMeta, isDarkMode ? styles.roleMetaDark : styles.roleMetaLight]}>
                      {role.tasks.length} task{role.tasks.length === 1 ? '' : 's'}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={canAccept ? `Accept ${role.name}` : isWaitlisted ? `Waitlisted for ${role.name}` : `Join waitlist for ${role.name}`}
                  disabled={busy || isWaitlisted}
                  style={[
                    styles.pendingInviteWaitlistButton,
                    canAccept
                      ? (isDarkMode ? styles.pendingActionAcceptDark : styles.pendingActionAcceptLight)
                      : (isDarkMode ? styles.pendingActionWaitlistDark : styles.pendingActionWaitlistLight),
                    (busy || isWaitlisted) && styles.drawerCloseDisabled,
                  ]}
                  onPress={() => {
                    if (canAccept) {
                      if (notificationStatus === 'pending') {
                        handleRoleNotificationResponse(notificationId, 'accept');
                      } else {
                        handleAcceptEventRoleWaitlistInvite(event.id, role.id);
                      }
                      return;
                    }
                    handleJoinRoleWaitlist(notificationId);
                  }}>
                  <Text style={[
                    styles.pendingActionButtonText,
                    canAccept
                      ? (isDarkMode ? styles.pendingActionAcceptTextDark : styles.pendingActionAcceptTextLight)
                      : (isDarkMode ? styles.pendingActionWaitlistTextDark : styles.pendingActionWaitlistTextLight),
                  ]}>
                    {busy ? (canAccept ? 'Accepting...' : 'Joining...') : buttonLabel}
                  </Text>
                </Pressable>
              </View>
            );
          })}
          <Text style={[styles.taskEmpty, isDarkMode ? styles.taskEmptyDark : styles.taskEmptyLight]}>
            Accept a role invite to see assigned tasks.
          </Text>
        </View>
      );
    }

    const waitlistEligibleRoles = assignedRoles.length
      ? []
      : visibleWorkerRoles.filter((role) =>
          (role.eligibleWaitlistWorkerIds || []).includes(profile.uid)
          || (role.waitlistWorkerIds || []).includes(profile.uid)
          || (role.waitlistInviteWorkerIds || []).includes(profile.uid)
        );
    const workerTasks = visibleWorkerRoles
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
    const renderWaitlistRoleCards = () => waitlistEligibleRoles.map((role) => {
      const busyKey = `${event.id}:${role.id}`;
      const busy = notificationBusyId === busyKey;
      const roleAction = getWorkerRoleAction(role, profile.uid);
      const canAccept = roleAction === 'accept';
      const isWaitlisted = roleAction === 'waitlisted';
      const waitlistButtonLabel = canAccept ? 'Accept' : isWaitlisted ? 'Waitlisted' : 'Join Waitlist';

      return (
        <View key={`waitlist-role-${role.id}`} style={[styles.pendingInviteRoleCard, isDarkMode ? styles.pendingInviteRoleCardDark : styles.pendingInviteRoleCardLight]}>
          <View style={styles.pendingInviteRoleInfo}>
            <Text style={[styles.roleMeta, isDarkMode ? styles.roleMetaDark : styles.roleMetaLight]}>
              {canAccept ? 'Open role' : isWaitlisted ? 'Waitlisted role' : 'Available waitlist'}
            </Text>
            <Text style={[styles.roleTitle, isDarkMode ? styles.roleTitleDark : styles.roleTitleLight]}>{role.name}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={canAccept ? `Accept ${role.name}` : isWaitlisted ? `Waitlisted for ${role.name}` : `Join waitlist for ${role.name}`}
            disabled={busy || isWaitlisted}
            style={[
              styles.pendingInviteWaitlistButton,
              canAccept
                ? (isDarkMode ? styles.pendingActionAcceptDark : styles.pendingActionAcceptLight)
                : (isDarkMode ? styles.pendingActionWaitlistDark : styles.pendingActionWaitlistLight),
              (busy || isWaitlisted) && styles.drawerCloseDisabled,
            ]}
            onPress={() => canAccept ? handleAcceptEventRoleWaitlistInvite(event.id, role.id) : handleJoinEventRoleWaitlist(event.id, role.id)}>
            <Text style={[
              styles.pendingActionButtonText,
              canAccept
                ? (isDarkMode ? styles.pendingActionAcceptTextDark : styles.pendingActionAcceptTextLight)
                : (isDarkMode ? styles.pendingActionWaitlistTextDark : styles.pendingActionWaitlistTextLight),
            ]}>
              {busy ? '...' : waitlistButtonLabel}
            </Text>
          </Pressable>
        </View>
      );
    });

    if (workerTasks.length === 0) {
      if (waitlistEligibleRoles.length) {
        return (
          <View style={styles.taskList}>
            {renderWaitlistRoleCards()}
          </View>
        );
      }

      return <Text style={[styles.taskEmpty, isDarkMode ? styles.taskEmptyDark : styles.taskEmptyLight]}>No tasks assigned to you for this event.</Text>;
    }

    return (
      <View style={styles.taskList}>
        {renderWaitlistRoleCards()}
        {assignedRoles.map((role) => {
          const busyKey = `${event.id}:${role.id}`;
          const busy = roleCancellationBusyKey === busyKey;

          return (
            <Pressable
              key={`cancel-role-${role.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Cancel ${role.name} role`}
              disabled={busy}
              style={[
                styles.workerCancelRoleButton,
                isDarkMode ? styles.workerCancelRoleButtonDark : styles.workerCancelRoleButtonLight,
                busy && styles.drawerCloseDisabled,
              ]}
              onPress={() => confirmCancelWorkerRole(event, role)}>
              <MaterialIcons name="person-remove" size={16} color={isDarkMode ? '#fb7185' : '#dc2626'} />
              <Text style={[styles.workerCancelRoleText, isDarkMode ? styles.workerCancelRoleTextDark : styles.workerCancelRoleTextLight]}>
                {busy ? 'Cancelling...' : `Cancel ${role.name}`}
              </Text>
            </Pressable>
          );
        })}
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
      case 'waitlisted':
        return isDarkMode ? styles.avatarCircleRingWaitlistedDark : styles.avatarCircleRingWaitlistedLight;
      default:
        return isDarkMode ? styles.avatarCircleRingPendingDark : styles.avatarCircleRingPendingLight;
    }
  };

  const renderLocationMeta = (location: string, locationPlaceId: string | undefined, eventDate: string, eventTime: string) => (
    <View style={styles.locationMetaRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${location} in a map app`}
        hitSlop={8}
        onPress={(event) => {
          event.stopPropagation();
          openMapAppPicker(location, locationPlaceId);
        }}
        style={styles.locationMetaText}>
        <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>
        {location} • {eventDate} • {eventTime}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${location} in a map app`}
        hitSlop={8}
        onPress={(event) => {
          event.stopPropagation();
          openMapAppPicker(location, locationPlaceId);
        }}
        style={styles.mapIconButton}
      >
        <MaterialIcons name="map" size={18} color="#F98D2F" />
      </Pressable>
    </View>
  );

  const openWorkerTeamChat = (event: DispatchEvent, workerId: string) => {
    if (!profile?.organizationId) return;
    const managerIds = [...new Set([
      profile.uid,
      ...managerTeams.flatMap((team) => team.managerIds || [team.managerId]),
    ].filter(Boolean))];
    const title = workerLabel(workerId);

    router.navigate({
      pathname: '/chat/[workerId]',
      params: {
        workerId,
        workerLabel: title,
        eventName: event.name,
        teamName: title,
        teamMemberIds: [...new Set([workerId, ...managerIds])].join(','),
        isTeamAll: '1',
        teamThreadId: buildOrganizationManagersThreadId(profile.organizationId, workerId),
        teamThreadPath: 'Worker and all organization managers',
      },
    });
  };

  const openEventRoleEditor = (event: DispatchEvent, role: EventRole) => {
    setEventRoleEditor({
      open: true,
      eventId: event.id,
      roleId: role.id,
      mode: 'edit',
      name: role.name,
      editingTasks: false,
      tasks: (role.tasks || []).map((task) => ({ ...task })),
      expectedRevision: event.revision ?? 0,
    });
  };

  const closeEventRoleEditor = () => {
    setEventRoleTaskEditor(INITIAL_TEMPLATE_TASK_EDITOR);
    setTemplateTaskOffsetSelectorPart(null);
    setEventRoleEditor(INITIAL_EVENT_ROLE_EDITOR);
  };

  const openEventRoleTaskEditor = () => {
    setEventRoleTaskEditor({
      open: true,
      mode: 'add',
      roleId: eventRoleEditor.roleId,
      taskId: `task-${Date.now()}-${eventRoleEditor.tasks.length + 1}`,
      name: '',
      description: '',
      includeCountdownTimer: false,
      expectedOffsetText: '00:00:00',
      attachments: [],
    });
    setTemplateTaskOffsetSelectorPart(null);
  };

  const editEventRoleTaskEditor = (task: EventTask) => {
    setEventRoleTaskEditor({
      open: true,
      mode: 'edit',
      roleId: eventRoleEditor.roleId,
      taskId: task.id,
      name: task.name || '',
      description: task.description || '',
      includeCountdownTimer: Number.isFinite(task.expectedOffsetMinutes),
      expectedOffsetText: formatOffsetHhMmSs(task.expectedOffsetMinutes || 0),
      attachments: [...(task.attachments || [])],
    });
    setTemplateTaskOffsetSelectorPart(null);
  };

  const closeEventRoleTaskEditor = () => {
    setEventRoleTaskEditor(INITIAL_TEMPLATE_TASK_EDITOR);
    setTemplateTaskOffsetSelectorPart(null);
  };

  const setEventRoleTaskOffsetPart = (part: 'hours' | 'minutes' | 'seconds', value: number) => {
    const parts = parseTemplateTaskOffsetParts(eventRoleTaskEditor.expectedOffsetText);
    const nextParts = { ...parts, [part]: value };
    setEventRoleTaskEditor((prev) => ({
      ...prev,
      expectedOffsetText: `${String(nextParts.hours).padStart(2, '0')}:${String(nextParts.minutes).padStart(2, '0')}:${String(nextParts.seconds).padStart(2, '0')}`,
    }));
  };

  const addEventRoleTaskEditorAttachment = async (kind: 'photo' | 'document') => {
    if (!profile?.uid || !eventRoleTaskEditor.taskId) return;
    const busyKey = `event-role-task-editor:${kind}`;
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
        taskId: eventRoleTaskEditor.taskId,
        uri: selected.uri,
        kind,
        name: selected.name,
        mimeType: selected.mimeType,
      });

      setEventRoleTaskEditor((prev) => ({
        ...prev,
        attachments: [...prev.attachments, uploaded],
      }));
    } catch (error) {
      Alert.alert('Attachment error', error instanceof Error ? error.message : 'Unable to attach file.');
    } finally {
      setTemplateAttachmentBusyKey(null);
    }
  };

  const removeEventRoleTaskEditorAttachment = (attachmentId: string) => {
    setEventRoleTaskEditor((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((attachment) => attachment.id !== attachmentId),
    }));
  };

  const saveEventRoleTaskEditor = () => {
    const taskId = eventRoleTaskEditor.taskId;
    const taskName = eventRoleTaskEditor.name.trim();

    if (!taskId) return;
    if (!taskName.length) {
      Alert.alert('Task name required', 'Please add a task name before confirming.');
      return;
    }

    const parsedOffsetMinutes = eventRoleTaskEditor.includeCountdownTimer
      ? parseOffsetHhMmSsToMinutes(eventRoleTaskEditor.expectedOffsetText)
      : undefined;
    if (eventRoleTaskEditor.includeCountdownTimer && parsedOffsetMinutes === null) {
      Alert.alert('Invalid task time', 'Use the format HH:MM:SS for the total time.');
      return;
    }

    setEventRoleEditor((prev) => ({
      ...prev,
      tasks: eventRoleTaskEditor.mode === 'edit'
        ? prev.tasks.map((task) => (
            task.id === taskId
              ? (() => {
                  const { expectedOffsetMinutes: _offset, dueAt: _dueAt, ...taskWithoutCountdown } = task;
                  const description = eventRoleTaskEditor.description.trim();
                  return {
                    ...taskWithoutCountdown,
                    name: taskName,
                    ...(description ? { description } : {}),
                    attachments: eventRoleTaskEditor.attachments,
                    ...(parsedOffsetMinutes !== undefined && parsedOffsetMinutes !== null ? { expectedOffsetMinutes: parsedOffsetMinutes } : {}),
                  };
              })()
              : task
          ))
        : [
            ...prev.tasks,
            {
              id: taskId,
              name: taskName,
              ...(eventRoleTaskEditor.description.trim() ? { description: eventRoleTaskEditor.description.trim() } : {}),
              attachments: eventRoleTaskEditor.attachments,
              ...(parsedOffsetMinutes !== undefined && parsedOffsetMinutes !== null ? { expectedOffsetMinutes: parsedOffsetMinutes } : {}),
              completedBy: [],
            },
          ],
    }));

    closeEventRoleTaskEditor();
  };

  const saveEventRoleEditor = async () => {
    if (!profile?.uid || !eventRoleEditor.eventId) return;

    const nextName = eventRoleEditor.name.trim();
    if (!nextName.length) {
      Alert.alert('Role name required', 'Please enter a role name.');
      return;
    }

    const busyKey = `${eventRoleEditor.eventId}:${eventRoleEditor.roleId || 'new'}:${eventRoleEditor.mode}`;
    if (roleMutationBusyKey === busyKey) return;

    try {
      setRoleMutationBusyKey(busyKey);
      const tasks = eventRoleEditor.tasks.map((task, index) => {
        const { description: _description, ...taskWithoutDescription } = task;
        const description = task.description?.trim() || '';
        return {
          ...taskWithoutDescription,
          name: task.name.trim() || `Task ${index + 1}`,
          ...(description ? { description } : {}),
        };
      });

      if (eventRoleEditor.mode === 'add') {
        await addEventRole({
          eventId: eventRoleEditor.eventId,
          managerId: profile.uid,
          name: nextName,
          tasks,
          expectedRevision: eventRoleEditor.expectedRevision,
        });
      } else if (eventRoleEditor.roleId) {
        await updateEventRoleDetails({
          eventId: eventRoleEditor.eventId,
          roleId: eventRoleEditor.roleId,
          managerId: profile.uid,
          name: nextName,
          tasks,
          expectedRevision: eventRoleEditor.expectedRevision,
        });
      }
      closeEventRoleEditor();
    } catch (error) {
      Alert.alert('Unable to save role', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setRoleMutationBusyKey(null);
    }
  };

  const confirmDeleteEventRole = (event: DispatchEvent, role: EventRole) => {
    if (!profile?.uid) return;

    Alert.alert(
      'Delete role?',
      `Delete ${role.name} from ${event.name}? Assigned workers and tasks for this role will be removed from the event.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const busyKey = `${event.id}:${role.id}:delete`;
            if (roleMutationBusyKey === busyKey) return;

            try {
              setRoleMutationBusyKey(busyKey);
              await deleteEventRole({
                eventId: event.id,
                roleId: role.id,
                managerId: profile.uid,
              });
              setInviteDrawer((current) => (current.eventId === event.id && current.roleId === role.id ? INITIAL_DRAWER : current));
              setReplaceDrawer((current) => (current.eventId === event.id && current.roleId === role.id ? INITIAL_DRAWER : current));
              setEventRoleEditor((current) => (current.eventId === event.id && current.roleId === role.id ? INITIAL_EVENT_ROLE_EDITOR : current));
            } catch (error) {
              Alert.alert('Unable to delete role', error instanceof Error ? error.message : 'Please try again.');
            } finally {
              setRoleMutationBusyKey(null);
            }
          },
        },
      ]
    );
  };

  const renderManagerRole = (event: DispatchEvent, role: EventRole) => {
    const assignedIds = role.assignedWorkerIds || [];
    const waitlistedCount = new Set([
      ...(role.waitlistWorkerIds || []),
      ...(role.waitlistInviteWorkerIds || []),
    ]).size;
    const countLines = (
      <View style={styles.roleCountStack}>
        <Text style={[styles.roleMeta, isDarkMode ? styles.roleMetaDark : styles.roleMetaLight]}>{assignedIds.length} assigned</Text>
        <Text style={[styles.roleMeta, isDarkMode ? styles.roleMetaDark : styles.roleMetaLight]}>{waitlistedCount} waitlist</Text>
      </View>
    );
    const roleExpandKey = `${event.id}:${role.id}`;
    const roleTasksExpanded = !!expandedRoleTaskIds[roleExpandKey];
    const pendingInviteWorkerIds = pendingInviteWorkerIdsByRoleKey[roleExpandKey] || [];
    const renderTaskDetail = (task: EventTask, darkMode: boolean) => {
      const photoAttachments = (task.attachments || []).filter((attachment) => attachment.kind === 'photo' && attachment.url?.trim());
      const documentAttachments = (task.attachments || []).filter((attachment) => attachment.kind === 'document' && attachment.url?.trim());

      return (
        <View key={task.id} style={styles.managerTaskDetailRow}>
          <Text style={[styles.taskName, darkMode ? styles.taskNameDark : styles.taskNameLight]}>
            {'\u2022'} {task.name} - due {formatTaskDueTime(event, task)}{task.optional ? ' (optional)' : ''}
          </Text>
          <View style={styles.managerTaskActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open description for ${task.name}`}
              hitSlop={6}
              onPress={(pressEvent) => {
                pressEvent.stopPropagation();
                openTaskDescription(task);
              }}>
              <Text style={styles.managerTaskDescriptionLink}>Description</Text>
            </Pressable>
            {photoAttachments.length ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open photos for ${task.name}`}
                hitSlop={6}
                onPress={(pressEvent) => {
                  pressEvent.stopPropagation();
                  openTaskAttachment(task.name, photoAttachments);
                }}>
                <MaterialIcons name="photo" size={17} color="#F98D2F" />
              </Pressable>
            ) : null}
            {documentAttachments.length ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open attachments for ${task.name}`}
                hitSlop={6}
                onPress={(pressEvent) => {
                  pressEvent.stopPropagation();
                  openTaskAttachment(task.name, documentAttachments);
                }}>
                <MaterialIcons name="attach-file" size={17} color="#F98D2F" />
              </Pressable>
            ) : null}
          </View>
        </View>
      );
    };

    if (!isDarkMode) {
      return (
        <View key={role.id} style={[styles.roleCard, styles.roleCardLightFigma]}>
          <View style={styles.roleHeader}>
            <Text style={[styles.roleTitle, styles.roleTitleLight]}>{role.name}</Text>
            <View style={styles.roleHeaderActions}>
              {countLines}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${role.name} role`}
                hitSlop={8}
                style={[styles.templateTaskIconButton, styles.createEventEditButtonLight]}
                onPress={(pressEvent) => {
                  pressEvent.stopPropagation();
                  openEventRoleEditor(event, role);
                }}>
                <MaterialIcons name="edit" size={20} color="#F98D2F" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${role.name} role`}
                hitSlop={8}
                style={[
                  styles.templateTaskIconButton,
                  styles.createEventDeleteButtonLight,
                  roleMutationBusyKey === `${event.id}:${role.id}:delete` && styles.templateActionButtonDisabled,
                ]}
                onPress={(pressEvent) => {
                  pressEvent.stopPropagation();
                  confirmDeleteEventRole(event, role);
                }}
                disabled={roleMutationBusyKey === `${event.id}:${role.id}:delete`}>
                <MaterialIcons name="delete-outline" size={20} color="#F7F7F7" />
              </Pressable>
            </View>
          </View>

          <View style={styles.avatarRowLightFigma}>
            {assignedIds.length ? (
              assignedIds.map((workerId) => {
                const initial = workerLabel(workerId).slice(0, 1).toUpperCase();
                const inviteStatus = getInviteStatusForRoleWorker(event.id, role.id, workerId);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open chat with ${workerLabel(workerId)}`}
                    key={`${event.id}-${role.id}-${workerId}`}
                    style={styles.avatarChipLightFigma}
                    onPress={(pressEvent) => {
                      pressEvent.stopPropagation();
                      openWorkerTeamChat(event, workerId);
                    }}
                    hitSlop={6}>
                    <View style={[styles.avatarCircle, styles.avatarCircleAssignedLightFigma]}>
                      <Text style={styles.avatarTextAssignedLightFigma}>{initial}</Text>
                    </View>
                    <Text style={[styles.avatarNameLightFigma]} numberOfLines={2}>{workerLabel(workerId)}</Text>
                  </Pressable>
                );
              })
            ) : pendingInviteWorkerIds.length ? (
              pendingInviteWorkerIds.map((workerId) => {
                const initial = workerLabel(workerId).slice(0, 1).toUpperCase();
                const inviteStatus = getInviteStatusForRoleWorker(event.id, role.id, workerId);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open chat with ${workerLabel(workerId)}`}
                    key={`${event.id}-${role.id}-invite-${workerId}`}
                    style={styles.avatarChipLightFigma}
                    onPress={(pressEvent) => {
                      pressEvent.stopPropagation();
                      openWorkerTeamChat(event, workerId);
                    }}
                    hitSlop={6}>
                    <View style={[styles.avatarCircle, styles.avatarCircleLightFigma, getAvatarStatusRingStyle(inviteStatus)]}>
                      <Text style={styles.avatarTextLightFigma}>{initial}</Text>
                    </View>
                    <Text style={[styles.avatarNameLightFigma]} numberOfLines={2}>{workerLabel(workerId)}</Text>
                  </Pressable>
                );
              })
            ) : (
              <Text style={[styles.roleEmpty, styles.roleEmptyLight]}>No workers assigned yet.</Text>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${roleTasksExpanded ? 'Hide' : 'Show'} tasks for ${role.name}`}
            style={styles.roleTaskToggle}
            onPress={(pressEvent) => {
              pressEvent.stopPropagation();
              toggleRoleTaskExpanded(event.id, role.id);
            }}>
            <Text style={styles.expandHintLightFigma}>
              {roleTasksExpanded ? 'Hide Tasks ▲' : `Show Tasks (${role.tasks.length}) ▼`}
            </Text>
          </Pressable>

          {roleTasksExpanded ? (
            <View style={styles.taskListLightFigma}>
              {role.tasks.map((task) => renderTaskDetail(task, false))}
            </View>
          ) : null}

          <Pressable
            style={[styles.drawerButton, styles.drawerButtonLightFigma]}
            onPress={(pressEvent) => {
              pressEvent.stopPropagation();
              setInviteDrawer({ open: true, eventId: event.id, roleId: role.id });
            }}>
            <Text style={styles.drawerButtonTextLightFigma}>Edit Invites</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View key={role.id} style={[styles.roleCard, styles.roleCardDarkFigma]}>
        <View style={styles.roleHeader}>
          <Text style={[styles.roleTitle, isDarkMode ? styles.roleTitleDark : styles.roleTitleLight]}>{role.name}</Text>
          <View style={styles.roleHeaderActions}>
            {countLines}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${role.name} role`}
              hitSlop={8}
              style={[styles.templateTaskIconButton, styles.createEventEditButtonDark]}
              onPress={(pressEvent) => {
                pressEvent.stopPropagation();
                openEventRoleEditor(event, role);
              }}>
              <MaterialIcons name="edit" size={20} color="#F98D2F" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete ${role.name} role`}
              hitSlop={8}
              style={[
                styles.templateTaskIconButton,
                styles.createEventDeleteButtonDark,
                roleMutationBusyKey === `${event.id}:${role.id}:delete` && styles.templateActionButtonDisabled,
              ]}
              onPress={(pressEvent) => {
                pressEvent.stopPropagation();
                confirmDeleteEventRole(event, role);
              }}
              disabled={roleMutationBusyKey === `${event.id}:${role.id}:delete`}>
              <MaterialIcons name="delete-outline" size={20} color="#12274D" />
            </Pressable>
          </View>
        </View>

        <View style={styles.avatarRowLightFigma}>
          {assignedIds.length ? (
            assignedIds.map((workerId) => {
              const initial = workerLabel(workerId).slice(0, 1).toUpperCase();
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open chat with ${workerLabel(workerId)}`}
                  key={`${event.id}-${role.id}-${workerId}`}
                  style={styles.avatarChipLightFigma}
                  onPress={(pressEvent) => {
                    pressEvent.stopPropagation();
                    openWorkerTeamChat(event, workerId);
                  }}
                  hitSlop={6}
                >
                  <View style={[styles.avatarCircle, styles.avatarCircleAssignedDarkFigma]}>
                    <Text style={styles.avatarTextAssignedDarkFigma}>{initial}</Text>
                  </View>
                  <Text style={[styles.avatarNameLightFigma, styles.avatarNameDarkFigma]} numberOfLines={2}>{workerLabel(workerId)}</Text>
                </Pressable>
              );
            })
          ) : pendingInviteWorkerIds.length ? (
            pendingInviteWorkerIds.map((workerId) => {
              const initial = workerLabel(workerId).slice(0, 1).toUpperCase();
              const inviteStatus = getInviteStatusForRoleWorker(event.id, role.id, workerId);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open chat with ${workerLabel(workerId)}`}
                  key={`${event.id}-${role.id}-invite-${workerId}`}
                  style={styles.avatarChipLightFigma}
                  onPress={(pressEvent) => {
                    pressEvent.stopPropagation();
                    openWorkerTeamChat(event, workerId);
                  }}
                  hitSlop={6}
                >
                  <View style={[styles.avatarCircle, styles.avatarCircleDarkFigma, getAvatarStatusRingStyle(inviteStatus)]}>
                    <Text style={styles.avatarTextDarkFigma}>{initial}</Text>
                  </View>
                  <Text style={[styles.avatarNameLightFigma, styles.avatarNameDarkFigma]} numberOfLines={2}>{workerLabel(workerId)}</Text>
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
          onPress={(pressEvent) => {
            pressEvent.stopPropagation();
            toggleRoleTaskExpanded(event.id, role.id);
          }}>
          <Text style={styles.expandHintDarkFigma}>
            {roleTasksExpanded ? 'Hide tasks ▲' : `Show tasks (${role.tasks.length}) ▼`}
          </Text>
        </Pressable>

        {roleTasksExpanded ? (
          <View style={styles.taskListDarkFigma}>
            {role.tasks.map((task) => renderTaskDetail(task, true))}
          </View>
        ) : null}

        <Pressable
          style={[styles.drawerButton, styles.drawerButtonDarkFigma]}
          onPress={(pressEvent) => {
            pressEvent.stopPropagation();
            setInviteDrawer({ open: true, eventId: event.id, roleId: role.id });
          }}>
          <Text style={styles.drawerButtonTextDarkFigma}>Edit Invites</Text>
        </Pressable>
      </View>
    );
  };

  const replaceTarget = findRoleForDrawer(replaceDrawer);
  const inviteTarget = findRoleForDrawer(inviteDrawer);
  const eventRoleEditorTarget = findRoleForDrawer(eventRoleEditor);
  const eventRoleEditorBusyKey = `${eventRoleEditor.eventId}:${eventRoleEditor.roleId || 'new'}:${eventRoleEditor.mode}`;
  const eventRoleEditorBusy = roleMutationBusyKey === eventRoleEditorBusyKey;
  const selectedTemplate = templateOptions.find((template) => template.id === selectedTemplateId) || templateOptions[0];
  const rolePickerTarget = createEventRolesDraft.find((role) => role.id === rolePickerRoleId) || null;
  const isEditingTemplate = !!editingTemplateId;

  const openAddCreateEventRoleEditor = () => {
    setCreateEventDrawerOpen(false);
    setCreateEventRoleEditor({ open: true, mode: 'add', roleId: null, name: '' });
  };

  const openAddEventRoleEditor = (event: DispatchEvent) => {
    setEventRoleEditor({
      open: true,
      eventId: event.id,
      roleId: null,
      mode: 'add',
      name: '',
      editingTasks: false,
      tasks: [],
      expectedRevision: event.revision ?? 0,
    });
  };

  const openEditCreateEventRoleEditor = (role: CreateEventRoleDraft) => {
    setCreateEventDrawerOpen(false);
    setCreateEventRoleEditor({ open: true, mode: 'edit', roleId: role.id, name: role.name });
  };

  const closeCreateEventRoleEditor = () => {
    setCreateEventRoleEditor(INITIAL_CREATE_EVENT_ROLE_EDITOR);
    resumeCreateEventAfterRoleEditorRef.current = true;
    setCreateEventDrawerOpen(true);
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
    const deletingFromEditor = createEventRoleEditor.open && createEventRoleEditor.roleId === roleId;
    setCreateEventRolesDraft((prev) => prev.filter((role) => role.id !== roleId));
    setRolePickerRoleId((prev) => (prev === roleId ? null : prev));
    setCreateEventRoleEditor((prev) => (prev.roleId === roleId ? INITIAL_CREATE_EVENT_ROLE_EDITOR : prev));
    if (deletingFromEditor) {
      resumeCreateEventAfterRoleEditorRef.current = true;
      setCreateEventDrawerOpen(true);
    }
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
    setInviteSelectedWorkerIds((prev) => toggleEditableInviteWorker(prev, workerId));
  };

  const toggleInviteTeamExpanded = (teamId: string) => {
    setExpandedInviteTeamIds((prev) => ({ ...prev, [teamId]: !prev[teamId] }));
  };

  const toggleInviteTeamAllSelection = (workerIds: string[]) => {
    const uniqueWorkerIds = [...new Set(workerIds.filter(Boolean))];
    if (!uniqueWorkerIds.length) return;
    setInviteSelectedWorkerIds((prev) => toggleEditableInviteTeam(prev, uniqueWorkerIds));
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

    const roleKey = `${inviteTarget.event.id}:${inviteTarget.role.id}`;
    setInviteSelectedWorkerIds(buildEditInviteSelection(
      inviteTarget.role.assignedWorkerIds || [],
      pendingInviteWorkerIdsByRoleKey[roleKey] || []
    ));
    setExpandedInviteTeamIds({});
  }, [
    inviteDrawer.open,
    inviteTarget?.event.id,
    inviteTarget?.role.id,
    inviteTarget?.role.assignedWorkerIds?.join(','),
    inviteTarget ? pendingInviteWorkerIdsByRoleKey[`${inviteTarget.event.id}:${inviteTarget.role.id}`]?.join(',') : '',
    managerTeams,
  ]);

  const handleSendRoleInvites = async () => {
    if (!profile?.uid || !inviteTarget || inviteSubmitBusy) return;

    const currentlyAssigned = new Set(inviteTarget.role.assignedWorkerIds || []);
    const roleKey = `${inviteTarget.event.id}:${inviteTarget.role.id}`;
    const currentlyPending = new Set(pendingInviteWorkerIdsByRoleKey[roleKey] || []);
    const { toInvite: toAssign, toRemoveAssigned, toWithdraw: toWithdrawPending } = buildEditInviteChanges({
      selectedWorkerIds: inviteSelectedWorkerIds,
      assignedWorkerIds: currentlyAssigned,
      pendingWorkerIds: currentlyPending,
    });

    if (!toAssign.length && !toRemoveAssigned.length && !toWithdrawPending.length) {
      Alert.alert('No changes', 'Select different workers to send invites.');
      return;
    }

    try {
      setInviteSubmitBusy(true);

      for (const workerId of toRemoveAssigned) {
        await updateEventRoleAssignment({
          eventId: inviteTarget.event.id,
          roleId: inviteTarget.role.id,
          managerId: profile.uid,
          workerId,
          action: 'remove',
        });
      }

      for (const workerId of toAssign) {
        await updateEventRoleAssignment({
          eventId: inviteTarget.event.id,
          roleId: inviteTarget.role.id,
          managerId: profile.uid,
          workerId,
          action: 'assign',
        });
      }

      for (const workerId of toWithdrawPending) {
        await withdrawPendingEventRoleInvite({
          eventId: inviteTarget.event.id,
          roleId: inviteTarget.role.id,
          managerId: profile.uid,
          workerId,
        });
      }

      const updates = [
        toAssign.length ? `sent ${toAssign.length} new invite${toAssign.length === 1 ? '' : 's'}` : '',
        toRemoveAssigned.length ? `removed ${toRemoveAssigned.length} assigned Worker${toRemoveAssigned.length === 1 ? '' : 's'}` : '',
        toWithdrawPending.length ? `withdrew ${toWithdrawPending.length} pending invite${toWithdrawPending.length === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      Alert.alert('Invites updated', `${updates.join(', ')}. Waitlisted Workers are notified when a role opens.`);
      setInviteDrawer(INITIAL_DRAWER);
    } catch (error) {
      Alert.alert('Unable to send invites', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setInviteSubmitBusy(false);
    }
  };

  useEffect(() => {
    if (!createEventDrawerOpen || !selectedTemplate) return;
    if (resumeCreateEventAfterRoleEditorRef.current) {
      resumeCreateEventAfterRoleEditorRef.current = false;
      return;
    }
    setEventTimeDraft(selectedTemplate.defaultTime || '');
    setShowDatePicker(false);
    setShowTimePicker(false);
    setEventLocationDraft(selectedTemplate.defaultLocation || '');
    setEventLocationPlaceIdDraft(selectedTemplate.defaultLocationPlaceId || '');
    setEventDescriptionDraft(selectedTemplate.defaultDescription || '');
    setCreateEventRolesDraft(buildCreateEventRoleDrafts(selectedTemplate));
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

  const handleJoinRoleWaitlist = async (notificationId: string) => {
    if (!profile?.uid || notificationBusyId === notificationId) return;
    try {
      setNotificationBusyId(notificationId);
      await joinRoleWaitlist({ notificationId, workerId: profile.uid });
      Alert.alert('Added to waitlist', 'You will be invited if this role opens up.');
    } catch (error) {
      Alert.alert('Unable to join waitlist', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setNotificationBusyId(null);
    }
  };

  const handleJoinEventRoleWaitlist = async (eventId: string, roleId: string) => {
    if (!profile) return;

    const busyKey = `${eventId}:${roleId}`;
    setNotificationBusyId(busyKey);
    try {
      await joinEventRoleWaitlist({ eventId, roleId, workerId: profile.uid });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to join the waitlist right now.';
      Alert.alert('Waitlist Failed', message);
    } finally {
      setNotificationBusyId((current) => (current === busyKey ? null : current));
    }
  };

  const handleAcceptEventRoleWaitlistInvite = async (eventId: string, roleId: string) => {
    if (!profile) return;

    const busyKey = `${eventId}:${roleId}`;
    setNotificationBusyId(busyKey);
    try {
      await acceptEventRoleWaitlistInvite({ eventId, roleId, workerId: profile.uid });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to accept the invite right now.';
      Alert.alert('Invite Failed', message);
    } finally {
      setNotificationBusyId((current) => (current === busyKey ? null : current));
    }
  };

  const togglePendingNotificationExpanded = (notificationId: string) => {
    setExpandedPendingNotificationIds((current) => ({
      ...current,
      [notificationId]: !current[notificationId],
    }));
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
        locationPlaceId: eventLocationPlaceIdDraft,
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

  const openEventEditDrawer = (event: DispatchEvent) => {
    const startsAt = new Date(event.startsAt);
    const validStart = !Number.isNaN(startsAt.getTime());
    swipeableRefs.current[event.id]?.close();
    setEventEdit({
      open: true,
      eventId: event.id,
      name: event.name,
      date: validStart ? formatEventDateDraft(startsAt) : '',
      time: validStart
        ? `${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`
        : '',
      location: event.location || '',
      locationPlaceId: event.locationPlaceId || '',
      description: event.description || '',
      expectedRevision: event.revision ?? 0,
    });
  };

  const closeEventEditDrawer = () => {
    if (eventEditBusy) return;
    setEventEdit(INITIAL_EVENT_EDIT_STATE);
  };

  const saveEventEdit = async () => {
    if (!profile?.uid || !eventEdit.eventId || eventEditBusy) return;
    try {
      setEventEditBusy(true);
      await updateDispatchEventDetails({
        eventId: eventEdit.eventId,
        managerId: profile.uid,
        expectedRevision: eventEdit.expectedRevision,
        draft: {
          name: eventEdit.name,
          date: eventEdit.date,
          time: eventEdit.time,
          location: eventEdit.location,
          locationPlaceId: eventEdit.locationPlaceId,
          description: eventEdit.description,
        },
      });
      setEventEdit(INITIAL_EVENT_EDIT_STATE);
    } catch (error) {
      Alert.alert('Unable to save event', error instanceof Error ? error.message : 'Please review the event details and try again.');
    } finally {
      setEventEditBusy(false);
    }
  };

  const hasEventSchedule = eventDateDraft.trim().length > 0 && eventTimeDraft.trim().length > 0;
  const canCreateEventNow = !!selectedTemplate && hasEventSchedule && eventLocationDraft.trim().length > 0 && eventLocationPlaceIdDraft.trim().length > 0 && eventDescriptionDraft.trim().length > 0;
  const eventsRangeLabel = formatEventsRangeLabel(selectedWeekStart);

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      {isDarkMode ? (
        <View style={[styles.eventsDarkHeader, { paddingTop: insets.top }]}>
          <View style={styles.eventsDarkTopRow}>
                <Image source={darkEventsLogoSource} style={styles.eventsDarkLogo} resizeMode="contain" />
            {canCreateEvent ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add event"
                style={styles.eventsDarkAddButton}
                onPress={openCreateEventDrawer}>
                <Text style={styles.eventsDarkAddButtonIcon}>+</Text>
              </Pressable>
            ) : <View />}
          </View>
          <View style={styles.eventsDarkDateRow}>
            <View style={styles.eventsDarkDateChip}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous week" style={styles.eventsDarkArrowButton} onPress={() => shiftSelectedWeek(-1)}>
                <MaterialIcons name="chevron-left" size={22} color="#F98D2F" />
              </Pressable>
              <Text style={styles.eventsDarkDateChipText} maxFontSizeMultiplier={ACCESSIBLE_TEXT_MAX_MULTIPLIER}>{eventsRangeLabel}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Next week" style={styles.eventsDarkArrowButton} onPress={() => shiftSelectedWeek(1)}>
                <MaterialIcons name="chevron-right" size={22} color="#F98D2F" />
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose week"
              style={styles.eventsDarkCalendarButton}
              onPress={() => setShowEventsWeekPicker(true)}>
              <MaterialIcons name="calendar-month" size={30} color="#F98D2F" />
            </Pressable>
          </View>
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
      ) : (
        <View style={[styles.eventsLightHeader, { paddingTop: insets.top }]}>
          <View style={styles.eventsLightTopRow}>
                <Image source={lightEventsLogoSource} style={styles.eventsLightLogo} resizeMode="contain" />
            {canCreateEvent ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add event"
                style={styles.eventsLightAddButton}
                onPress={openCreateEventDrawer}>
                <Text style={styles.eventsLightAddButtonIcon}>+</Text>
              </Pressable>
            ) : <View />}
          </View>
          <View style={styles.eventsLightDateRow}>
            <View style={styles.eventsLightDateChip}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous week" style={styles.eventsLightArrowButton} onPress={() => shiftSelectedWeek(-1)}>
                <MaterialIcons name="chevron-left" size={22} color="#F98D2F" />
              </Pressable>
              <Text style={styles.eventsLightDateChipText} maxFontSizeMultiplier={ACCESSIBLE_TEXT_MAX_MULTIPLIER}>{eventsRangeLabel}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Next week" style={styles.eventsLightArrowButton} onPress={() => shiftSelectedWeek(1)}>
                <MaterialIcons name="chevron-right" size={22} color="#F98D2F" />
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose week"
              style={styles.eventsLightCalendarButton}
              onPress={() => setShowEventsWeekPicker(true)}>
              <MaterialIcons name="calendar-month" size={30} color="#F98D2F" />
            </Pressable>
          </View>
        </View>
      )}
      {profile?.role === 'worker' && actionableRoleNotifications.length ? (
        <View style={[styles.pendingNotificationsCard, isDarkMode ? styles.pendingNotificationsCardDark : styles.pendingNotificationsCardLight]}>
          <Text style={[styles.pendingNotificationsTitle, isDarkMode ? styles.pendingNotificationsTitleDark : styles.pendingNotificationsTitleLight]}>
            Role updates need your response
          </Text>
          <ScrollView
            style={styles.pendingNotificationsList}
            contentContainerStyle={styles.pendingNotificationsListContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator={actionableRoleNotifications.length > 2}>
          {actionableRoleNotifications.map((notification) => {
            const busy = notificationBusyId === notification.id;
            const expanded = !!expandedPendingNotificationIds[notification.id];
            const roleAction = getWorkerRoleActionFromNotification(notification, profile.uid);
            const roleIsFull = notification.action === 'assign'
              && !notification.roleAssignedWorkerIds?.includes(profile.uid)
              && roleAction !== 'accept';
            return (
              <View key={notification.id} style={styles.pendingNotificationRow}>
                <View style={styles.pendingNotificationHeader}>
                  <View style={styles.pendingNotificationTitleText}>
                    <Text style={[styles.pendingNotificationText, styles.pendingNotificationEventText, isDarkMode ? styles.titleDark : styles.titleLight]}>
                      {notification.eventName || 'Event'}
                    </Text>
                    <Text style={[styles.pendingNotificationDateTimeText, isDarkMode ? styles.metaDark : styles.metaLight]}>
                      {formatNotificationStartsAt(notification.eventStartsAt)}
                    </Text>
                    <Text style={[styles.pendingNotificationRoleText, isDarkMode ? styles.metaDark : styles.metaLight]}>
                      Role: {notification.roleName?.trim() || 'TBD'}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${expanded ? 'Hide' : 'Show'} invite details`}
                    hitSlop={6}
                    onPress={() => togglePendingNotificationExpanded(notification.id)}>
                    <Text style={[styles.pendingNotificationExpandText, isDarkMode ? styles.pendingNotificationExpandTextDark : styles.pendingNotificationExpandTextLight]}>
                      {expanded ? 'Hide details ▲' : 'Show details ▼'}
                    </Text>
                  </Pressable>
                </View>
                {expanded ? (
                  <View style={styles.pendingNotificationDetails}>
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
                  </View>
                ) : null}
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
                      {busy ? '...' : roleIsFull ? 'Cancel' : 'Decline'}
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={busy}
                    style={[
                      styles.pendingActionButton,
                      roleIsFull
                        ? (isDarkMode ? styles.pendingActionWaitlistDark : styles.pendingActionWaitlistLight)
                        : (isDarkMode ? styles.pendingActionAcceptDark : styles.pendingActionAcceptLight),
                      styles.pendingActionPreferred,
                      busy && styles.drawerCloseDisabled,
                    ]}
                    onPress={() => roleIsFull ? handleJoinRoleWaitlist(notification.id) : handleRoleNotificationResponse(notification.id, 'accept')}>
                    <Text style={[
                      styles.pendingActionButtonText,
                      roleIsFull
                        ? (isDarkMode ? styles.pendingActionWaitlistTextDark : styles.pendingActionWaitlistTextLight)
                        : (isDarkMode ? styles.pendingActionAcceptTextDark : styles.pendingActionAcceptTextLight),
                    ]}>
                      {busy ? '...' : roleIsFull ? 'Join Waitlist' : 'Accept'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          </ScrollView>
        </View>
      ) : null}

      <FlatList
        data={eventsWeekRows}
        keyExtractor={(item) => item.key}
        style={styles.eventsList}
        contentContainerStyle={isDarkMode ? styles.eventsDarkListContent : styles.eventsLightListContent}
        renderItem={({ item: row }) => {
          if (row.type === 'day') {
            return (
              <View style={isDarkMode ? styles.eventsDarkDayDivider : styles.eventsLightDayDivider}>
                <Text style={isDarkMode ? styles.eventsDarkDayLabel : styles.eventsLightDayLabel}>{row.date.getDate()}</Text>
                <View style={isDarkMode ? styles.eventsDarkDayLine : styles.eventsLightDayLine} />
              </View>
            );
          }

          const event = row.event;
          const item = event;
          const expanded = !!expandedIds[event.id];
          const managerLabel = managerNames[event.managerId] || 'Manager';
          const startsAtDate = new Date(event.startsAt);
          const eventDate = startsAtDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
          const eventTime = startsAtDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const workerRoleSubtitle = getWorkerRoleSubtitle(event);
          const eventStatus = isCompletedEvent(event) ? 'Completed' : 'Upcoming';

          const card = (
            <Pressable
              style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}
              onPress={() => toggleExpanded(event.id)}>
              <View style={styles.row}>
                <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>{event.name}</Text>
                <View
                  style={[
                    styles.statusPill,
                    isDarkMode
                      ? eventStatus === 'Completed'
                        ? styles.statusPillCompletedDark
                        : styles.statusPillUpcomingDark
                      : eventStatus === 'Completed'
                        ? styles.statusPillCompletedLight
                        : styles.statusPillUpcomingLight,
                  ]}>
                  <Text
                    style={[
                      styles.statusText,
                      isDarkMode
                        ? eventStatus === 'Completed'
                          ? styles.statusTextCompletedDark
                          : styles.statusTextUpcomingDark
                        : eventStatus === 'Completed'
                          ? styles.statusTextCompletedLight
                          : styles.statusTextUpcomingLight,
                    ]}>
                    {eventStatus}
                  </Text>
                </View>
              </View>

              <Text style={[styles.eventDateTimeSubtitle, isDarkMode ? styles.eventDateTimeSubtitleDark : styles.eventDateTimeSubtitleLight]}>
                {eventDate} - {eventTime}
              </Text>
              {profile?.role === 'worker' && workerRoleSubtitle ? (
                <Text style={[styles.workerRoleSubtitle, isDarkMode ? styles.eventDateTimeSubtitleDark : styles.eventDateTimeSubtitleLight]}>
                  {workerRoleSubtitle}
                </Text>
              ) : null}

              {renderLocationMeta(item.location, item.locationPlaceId, eventDate, eventTime)}

              {profile?.role === 'worker' ? (
                <>
                  <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>Assigned by: {managerLabel}</Text>
                  <Text style={[styles.expandHint, isDarkMode ? styles.expandHintDark : styles.expandHintLight]}>{expanded ? 'Hide tasks ▲' : 'Show tasks ▼'}</Text>
                  {expanded && renderWorkerTaskList(item)}
                </>
              ) : (
                <>
                  <Text style={[styles.expandHint, isDarkMode ? styles.expandHintDark : styles.expandHintLight]}>{expanded ? 'Hide role details ▲' : 'Show role details ▼'}</Text>
                  {expanded ? (
                    <View style={styles.managerExpanded}>
                      {item.roles.map((role) => renderManagerRole(item, role))}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Add role to ${item.name}`}
                        style={[styles.drawerButton, isDarkMode ? styles.drawerButtonDarkFigma : styles.drawerButtonLightFigma]}
                        onPress={(pressEvent) => {
                          pressEvent.stopPropagation();
                          openAddEventRoleEditor(item);
                        }}>
                        <Text style={isDarkMode ? styles.drawerButtonTextDarkFigma : styles.drawerButtonTextLightFigma}>+ Add Role</Text>
                      </Pressable>
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
              renderLeftActions={() => (
                <Pressable style={styles.swipeEditAction} onPress={() => openEventEditDrawer(item)}>
                  <Text style={styles.swipeEditActionText}>Edit</Text>
                </Pressable>
              )}
              renderRightActions={() => (
                <Pressable style={styles.swipeDeleteAction} onPress={() => handleDeleteEvent(item)}>
                  <Text style={styles.swipeDeleteActionText}>Delete</Text>
                </Pressable>
              )}
              leftThreshold={40}
              rightThreshold={40}
              overshootLeft={false}
              overshootRight={false}>
              {card}
            </Swipeable>
          );
        }}
      />

      {showEventsWeekPicker ? (
        <View style={[styles.pickerCard, isDarkMode ? styles.pickerCardDark : styles.pickerCardLight]}>
          <DateTimePicker
            value={selectedWeekStart}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={handleEventsWeekChange}
            {...pickerSharedProps}
          />
          <View style={styles.pickerActionRow}>
            <Pressable style={[styles.pickerActionButton, isDarkMode ? styles.pickerActionButtonDark : styles.pickerActionButtonLight]} onPress={() => setShowEventsWeekPicker(false)}>
              <Text style={[styles.pickerActionText, isDarkMode ? styles.pickerActionTextDark : styles.pickerActionTextLight]}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.pickerActionButton, styles.pickerActionButtonToday]} onPress={() => applyWeekFromDate(new Date())}>
              <Text style={styles.pickerActionTextToday}>Today</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Modal visible={eventEdit.open} animationType="slide" transparent onRequestClose={closeEventEditDrawer}>
        <Pressable style={styles.drawerBackdrop} onPress={closeEventEditDrawer}>
          <KeyboardAvoidingView
            style={styles.keyboardAvoidingFill}
            behavior={EVENT_ROLE_DRAWER_KEYBOARD_BEHAVIOR}
            keyboardVerticalOffset={drawerKeyboardOffset}>
            <Pressable style={[styles.drawer, isDarkMode ? styles.createEventDrawerDark : styles.createEventDrawerLight]} onPress={() => null}>
              <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
              <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>Edit Event</Text>
              <Text style={[styles.drawerSub, isDarkMode ? styles.drawerSubDark : styles.drawerSubLight]}>Update the event details for every Manager and assigned Worker.</Text>
              <ScrollView style={styles.createEventScroll} contentContainerStyle={styles.createEventScrollContent} keyboardShouldPersistTaps="handled">
                <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
                  <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Event name</Text>
                  <TextInput
                    value={eventEdit.name}
                    onChangeText={(name) => setEventEdit((current) => ({ ...current, name }))}
                    placeholder="Event name"
                    placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.45)' : '#64748b'}
                    style={[styles.templateInput, isDarkMode ? styles.createEventTextInputDark : styles.createEventTextInputLight]}
                  />
                </View>
                <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
                  <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Event date</Text>
                  <TextInput
                    value={eventEdit.date}
                    onChangeText={(date) => setEventEdit((current) => ({ ...current, date }))}
                    placeholder="YYYY-MM-DD"
                    autoCapitalize="none"
                    placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.45)' : '#64748b'}
                    style={[styles.templateInput, isDarkMode ? styles.createEventTextInputDark : styles.createEventTextInputLight]}
                  />
                </View>
                <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
                  <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Event time</Text>
                  <TextInput
                    value={eventEdit.time}
                    onChangeText={(time) => setEventEdit((current) => ({ ...current, time }))}
                    placeholder="HH:MM"
                    autoCapitalize="none"
                    placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.45)' : '#64748b'}
                    style={[styles.templateInput, isDarkMode ? styles.createEventTextInputDark : styles.createEventTextInputLight]}
                  />
                </View>
                <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
                  <LocationAutocompleteField
                    label="Location"
                    value={eventEdit.location}
                    onChangeText={(location) => setEventEdit((current) => ({ ...current, location }))}
                    selectedPlaceId={eventEdit.locationPlaceId}
                    onPlaceIdChange={(locationPlaceId) => setEventEdit((current) => ({ ...current, locationPlaceId: locationPlaceId || '' }))}
                    placeholder="Event location"
                    isDarkMode={isDarkMode}
                  />
                </View>
                <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
                  <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Description</Text>
                  <TextInput
                    value={eventEdit.description}
                    onChangeText={(description) => setEventEdit((current) => ({ ...current, description }))}
                    placeholder="Event description"
                    multiline
                    placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.45)' : '#64748b'}
                    style={[styles.templateTextArea, isDarkMode ? styles.createEventTextAreaDark : styles.createEventTextAreaLight]}
                  />
                </View>
                <Pressable
                  style={[styles.drawerClose, eventEditBusy && styles.drawerCloseDisabled]}
                  onPress={saveEventEdit}
                  disabled={eventEditBusy}>
                  <Text style={styles.drawerCloseText}>{eventEditBusy ? 'Saving...' : 'Save Event'}</Text>
                </Pressable>
                <Pressable
                  style={[styles.drawerSecondaryButton, isDarkMode ? styles.drawerSecondaryButtonDark : styles.drawerSecondaryButtonLight]}
                  onPress={closeEventEditDrawer}
                  disabled={eventEditBusy}>
                  <Text style={[styles.drawerSecondaryButtonText, isDarkMode ? styles.drawerSecondaryButtonTextDark : styles.drawerSecondaryButtonTextLight]}>Cancel</Text>
                </Pressable>
              </ScrollView>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <Modal visible={replaceDrawer.open} animationType="slide" transparent onRequestClose={() => setReplaceDrawer(INITIAL_DRAWER)}>
        <Pressable style={styles.drawerBackdrop} onPress={() => setReplaceDrawer(INITIAL_DRAWER)}>
          <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => null}>
            <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
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
          <Pressable style={[styles.drawer, isDarkMode ? styles.createEventDrawerDark : styles.createEventDrawerLight]} onPress={() => null}>
            <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
            <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>Invite Worker</Text>
            <Text style={[styles.drawerSub, isDarkMode ? styles.drawerSubDark : styles.drawerSubLight]}>Role: {inviteTarget?.role.name || 'Unknown role'}</Text>
            <ScrollView style={styles.drawerList}>
              {eventInviteTeamOptions.length ? eventInviteTeamOptions.map((team) => {
                const teamWorkerIds = [...new Set((team.workerIds || []).filter(Boolean))];
                const assignedWorkerIds = new Set(inviteTarget?.role.assignedWorkerIds || []);
                const selectedCount = teamWorkerIds.filter((workerId) => inviteSelectedWorkerIds.includes(workerId)).length;
                const allSelected = teamWorkerIds.length > 0
                  && teamWorkerIds.every((workerId) => inviteSelectedWorkerIds.includes(workerId));
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
                          const assigned = assignedWorkerIds.has(workerId);
                          return (
                            <Pressable
                              key={`invite-${team.id}-${workerId}`}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: selected, disabled: inviteSubmitBusy || !inviteTarget }}
                              style={styles.inviteMemberRow}
                              disabled={inviteSubmitBusy || !inviteTarget}
                              onPress={() => toggleInviteWorkerSelection(workerId)}>
                              <View style={[styles.inviteCheckbox, selected && styles.inviteCheckboxSelected]}>
                                <Text style={styles.inviteCheckboxMark}>{selected ? '✓' : ''}</Text>
                              </View>
                              <View style={styles.inviteWorkerLabel}>
                                <Text style={[styles.drawerName, isDarkMode ? styles.drawerNameDark : styles.drawerNameLight]}>{workerLabel(workerId)}</Text>
                                {assigned ? <Text style={[styles.drawerMeta, isDarkMode ? styles.drawerMetaDark : styles.drawerMetaLight]}>Accepted · assigned</Text> : null}
                              </View>
                            </Pressable>
                          );
                        }) : (
                          <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No members in this team.</Text>
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              }) : <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No organization workers available.</Text>}
            </ScrollView>
            <Pressable
              style={[styles.inviteSubmitButton, inviteSubmitBusy && styles.drawerCloseDisabled]}
              onPress={handleSendRoleInvites}
              disabled={!inviteTarget || inviteSubmitBusy}>
              <Text style={styles.inviteSubmitButtonText}>{inviteSubmitBusy ? 'Sending…' : 'Send invite updates'}</Text>
            </Pressable>
            <Pressable
              style={[styles.inviteCloseButton, isDarkMode ? styles.inviteCloseButtonDark : styles.inviteCloseButtonLight]}
              onPress={() => setInviteDrawer(INITIAL_DRAWER)}>
              <Text style={[styles.inviteCloseButtonText, isDarkMode ? styles.inviteCloseButtonTextDark : styles.inviteCloseButtonTextLight]}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={eventRoleEditor.open} animationType="slide" transparent onRequestClose={eventRoleTaskEditor.open ? closeEventRoleTaskEditor : closeEventRoleEditor}>
        <Pressable style={styles.drawerBackdrop} onPress={eventRoleTaskEditor.open ? closeEventRoleTaskEditor : closeEventRoleEditor}>
          <KeyboardAvoidingView
            style={styles.keyboardAvoidingFill}
            behavior={getEventRoleEditorKeyboardBehavior(Platform.OS)}
            keyboardVerticalOffset={EVENT_ROLE_EDITOR_KEYBOARD_VERTICAL_OFFSET}>
            <Pressable style={[styles.drawer, isDarkMode ? styles.createEventDrawerDark : styles.createEventDrawerLight]} onPress={() => null}>
              <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
              <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>
                {eventRoleTaskEditor.open
                  ? (eventRoleTaskEditor.mode === 'edit' ? 'Edit Task' : 'Add Task')
                  : eventRoleEditor.mode === 'add' ? 'Add Role' : 'Edit Role'}
              </Text>
              <Text style={[styles.drawerSub, isDarkMode ? styles.drawerSubDark : styles.drawerSubLight]}>
                {eventRoleTaskEditor.open
                  ? (eventRoleTaskEditor.mode === 'edit' ? 'Update the task details, then save your changes.' : 'Add the task details, then confirm it for this role.')
                  : eventRoleEditorTarget?.event.name || events.find((event) => event.id === eventRoleEditor.eventId)?.name || 'Event role'}
              </Text>
              {eventRoleTaskEditor.open ? (
                <ScrollView
                  automaticallyAdjustKeyboardInsets={false}
                  style={styles.createEventScroll}
                  contentContainerStyle={styles.eventRoleEditorScrollContent}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag">
                  <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
                    <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Task name</Text>
                    <TextInput
                      value={eventRoleTaskEditor.name}
                      onChangeText={(value) => setEventRoleTaskEditor((prev) => ({ ...prev, name: value }))}
                      placeholder="Task name"
                      placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.33)' : 'rgba(33,33,33,0.5)'}
                      autoFocus
                      style={[styles.templateInput, isDarkMode ? styles.createEventTextInputDark : styles.createEventTextInputLight]}
                    />
                  </View>

                  <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
                    <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Task description</Text>
                    <TextInput
                      value={eventRoleTaskEditor.description}
                      onChangeText={(value) => setEventRoleTaskEditor((prev) => ({ ...prev, description: value }))}
                      placeholder="Task description"
                      placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.33)' : 'rgba(33,33,33,0.5)'}
                      multiline
                      style={[styles.templateTextArea, isDarkMode ? styles.createEventTextAreaDark : styles.createEventTextAreaLight]}
                    />
                  </View>

                  <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: eventRoleTaskEditor.includeCountdownTimer }}
                      style={styles.countdownToggleRow}
                      onPress={() => {
                        setTemplateTaskOffsetSelectorPart(null);
                        setEventRoleTaskEditor((current) => ({ ...current, includeCountdownTimer: !current.includeCountdownTimer }));
                      }}>
                      <MaterialIcons
                        name={eventRoleTaskEditor.includeCountdownTimer ? 'check-box' : 'check-box-outline-blank'}
                        size={24}
                        color={eventRoleTaskEditor.includeCountdownTimer ? '#0EC3C9' : isDarkMode ? '#CBD5E1' : '#475569'}
                      />
                      <Text style={[styles.countdownToggleLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>
                        Include Countdown Timer
                      </Text>
                    </Pressable>
                    {eventRoleTaskEditor.includeCountdownTimer ? (
                      <>
                        <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Offset From Event Start</Text>
                        <View style={styles.templateDurationPickerRow}>
                      {(['hours', 'minutes', 'seconds'] as const).map((part) => {
                        const parts = parseTemplateTaskOffsetParts(eventRoleTaskEditor.expectedOffsetText);
                        const value = parts[part];
                        const label = part === 'hours' ? 'Hours' : part === 'minutes' ? 'Min' : 'Sec';
                        const isOpen = templateTaskOffsetSelectorPart === part;
                        return (
                          <View key={part} style={styles.templateDurationSelectorWrap}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Choose ${label.toLowerCase()} offset`}
                              style={[
                                styles.templateDurationSelector,
                                isDarkMode ? styles.createEventFieldInputDark : styles.createEventFieldInputLight,
                                isOpen && styles.templateDurationSelectorActive,
                              ]}
                              onPress={() => setTemplateTaskOffsetSelectorPart((prev) => prev === part ? null : part)}>
                              <Text style={[styles.templateDurationValue, isDarkMode ? styles.createEventInputValueDark : styles.createEventInputValueLight]}>{value}</Text>
                              <Text style={[styles.templateDurationLabel, isDarkMode ? styles.createEventRoleMetaDark : styles.createEventRoleMetaLight]}>{label}</Text>
                              <MaterialIcons name={isOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={18} color={isDarkMode ? '#F7F7F7' : '#121212'} />
                            </Pressable>
                            {isOpen ? (
                              <View style={[styles.templateDurationDropdown, isDarkMode ? styles.templateTaskRowDark : styles.templateTaskRowLight]}>
                                <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                                  {Array.from({ length: part === 'hours' ? 24 : 60 }, (_, option) => (
                                    <Pressable
                                      key={`event-role-${part}-${option}`}
                                      style={[
                                        styles.templateDurationOption,
                                        value === option && (isDarkMode ? styles.templateDurationOptionActiveDark : styles.templateDurationOptionActiveLight),
                                      ]}
                                      onPress={() => {
                                        setEventRoleTaskOffsetPart(part, option);
                                        setTemplateTaskOffsetSelectorPart(null);
                                      }}>
                                      <Text style={[styles.templateDurationOptionText, isDarkMode ? styles.createEventInputValueDark : styles.createEventInputValueLight]}>{option}</Text>
                                    </Pressable>
                                  ))}
                                </ScrollView>
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                        </View>
                      </>
                    ) : null}
                  </View>

                  <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
                    <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Attachments</Text>
                    <View style={styles.templateTaskAttachmentButtons}>
                      <Pressable
                        style={[styles.templateActionButton, isDarkMode ? styles.createEventAddPillDark : styles.createEventAddPillLight, templateAttachmentBusyKey && styles.templateActionButtonDisabled]}
                        disabled={!!templateAttachmentBusyKey}
                        onPress={() => addEventRoleTaskEditorAttachment('photo')}>
                        <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventAddPillTextDark : styles.createEventAddPillTextLight]}>+ Photo</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.templateActionButton, isDarkMode ? styles.createEventAddPillDark : styles.createEventAddPillLight, templateAttachmentBusyKey && styles.templateActionButtonDisabled]}
                        disabled={!!templateAttachmentBusyKey}
                        onPress={() => addEventRoleTaskEditorAttachment('document')}>
                        <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventAddPillTextDark : styles.createEventAddPillTextLight]}>+ Document</Text>
                      </Pressable>
                    </View>
                    {eventRoleTaskEditor.attachments.length ? (
                      <View style={styles.templateAttachmentList}>
                        {eventRoleTaskEditor.attachments.map((attachment) => (
                          <View key={attachment.id} style={[styles.templateAttachmentItem, isDarkMode ? styles.templateTaskRowDark : styles.templateTaskRowLight]}>
                            <Text style={[styles.templateAttachmentName, isDarkMode ? styles.createEventInputValueDark : styles.createEventInputValueLight]} numberOfLines={1}>
                              {attachment.kind === 'photo' ? 'Photo' : 'Document'} {attachment.name}
                            </Text>
                            <Pressable onPress={() => removeEventRoleTaskEditorAttachment(attachment.id)}>
                              <Text style={isDarkMode ? styles.createEventDeleteButtonTextDark : styles.createEventDeleteButtonTextLight}>Remove</Text>
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No attachments yet.</Text>
                    )}
                  </View>

                  <Pressable
                    style={[isDarkMode ? styles.createEventPrimaryButtonDark : styles.createEventPrimaryButtonLight, (!eventRoleTaskEditor.name.trim().length) && styles.drawerCloseDisabled]}
                    onPress={saveEventRoleTaskEditor}
                    disabled={!eventRoleTaskEditor.name.trim().length}>
                    <Text style={styles.drawerCloseText}>{eventRoleTaskEditor.mode === 'edit' ? 'Save Task' : 'Confirm Task'}</Text>
                  </Pressable>
                  <Pressable style={isDarkMode ? styles.createEventCancelButtonDark : styles.createEventCancelButtonLight} onPress={closeEventRoleTaskEditor}>
                    <Text style={isDarkMode ? styles.createEventCancelButtonTextDark : styles.createEventCancelButtonTextLight}>Cancel</Text>
                  </Pressable>
                </ScrollView>
              ) : (
                <ScrollView
                  automaticallyAdjustKeyboardInsets={false}
                  style={styles.createEventScroll}
                  contentContainerStyle={styles.eventRoleEditorScrollContent}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag">
                  <View style={[styles.templateRoleEditor, isDarkMode ? styles.templateRoleEditorDark : styles.templateRoleEditorLight]}>
                    <View style={styles.templateRoleHeader}>
                      <Text style={[styles.rolePreviewName, isDarkMode ? styles.createEventRoleNameDark : styles.createEventRoleNameLight]}>{eventRoleEditor.mode === 'add' ? 'New Role' : 'Role'}</Text>
                      <Text style={[styles.rolePreviewMeta, isDarkMode ? styles.createEventRoleMetaDark : styles.createEventRoleMetaLight]}>
                        {eventRoleEditor.tasks.length} tasks
                      </Text>
                    </View>

                    <TextInput
                      value={eventRoleEditor.name}
                      onChangeText={(value) => setEventRoleEditor((current) => ({ ...current, name: value }))}
                      placeholder="Role name"
                      placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.45)' : '#64748b'}
                      style={[styles.templateInput, isDarkMode ? styles.createEventTextInputDark : styles.createEventTextInputLight]}
                    />

                    {eventRoleEditor.tasks.length ? (
                      <View style={[styles.taskList, isDarkMode ? styles.taskListDarkFigma : styles.taskListLightFigma]}>
                        {eventRoleEditor.tasks.map((task, taskIndex) => (
                          <View key={`${eventRoleEditor.roleId}-summary-${task.id}`} style={styles.templateTaskSummaryCard}>
                            <View style={styles.taskRow}>
                              <View style={styles.templateTaskSummaryMain}>
                                <Text style={[styles.taskName, isDarkMode ? styles.taskNameDark : styles.taskNameLight]}>
                                  • {task.name || `Task ${taskIndex + 1}`} · {Number.isFinite(task.expectedOffsetMinutes) ? formatOffsetHhMmSs(task.expectedOffsetMinutes || 0) : 'No countdown'}
                                </Text>
                                {task.description?.trim() ? (
                                  <Pressable onPress={() => showTemplateTaskDescription(task.name || `Task ${taskIndex + 1}`, task.description)} hitSlop={6}>
                                    <Text style={[styles.templateTaskSummaryLink, isDarkMode ? styles.createEventEditButtonTextDark : styles.createEventEditButtonTextLight]}>
                                      Description
                                    </Text>
                                  </Pressable>
                                ) : null}
                              </View>
                              <View style={styles.templateTaskSummaryRight}>
                                <Pressable
                                  style={[styles.templateActionButton, isDarkMode ? styles.createEventEditButtonDark : styles.createEventEditButtonLight]}
                                  onPress={() => editEventRoleTaskEditor(task)}>
                                  <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventEditButtonTextDark : styles.createEventEditButtonTextLight]}>Edit</Text>
                                </Pressable>
                                {task.attachments?.length ? (
                                  <Pressable onPress={() => openTaskAttachment(task.name || `Task ${taskIndex + 1}`, task.attachments || [])} hitSlop={6}>
                                    <Text style={styles.taskAttachmentIcon}>Attachment</Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    <View style={styles.templateRoleTaskHeader}>
                      <Text style={[styles.rolePreviewMeta, isDarkMode ? styles.createEventRoleMetaDark : styles.createEventRoleMetaLight]}>{eventRoleEditor.tasks.length} tasks configured</Text>
                      <Pressable
                        accessibilityLabel={`Add task to ${eventRoleEditor.name || 'role'}`}
                        style={[styles.templateActionButton, isDarkMode ? styles.createEventAddPillDark : styles.createEventAddPillLight]}
                        onPress={openEventRoleTaskEditor}>
                        <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventAddPillTextDark : styles.createEventAddPillTextLight]}>+ Add Task</Text>
                      </Pressable>
                    </View>
                  </View>

                  <Pressable
                    style={[
                      isDarkMode ? styles.createEventPrimaryButtonDark : styles.createEventPrimaryButtonLight,
                      eventRoleEditorBusy && styles.drawerCloseDisabled,
                    ]}
                    onPress={saveEventRoleEditor}
                    disabled={eventRoleEditorBusy}>
                    <Text style={styles.drawerCloseText}>{eventRoleEditorBusy ? 'Saving...' : eventRoleEditor.mode === 'add' ? 'Add Role' : 'Save Role'}</Text>
                  </Pressable>
                  <Pressable style={[styles.drawerSecondaryButton, isDarkMode ? styles.drawerSecondaryButtonDark : styles.drawerSecondaryButtonLight]} onPress={closeEventRoleEditor}>
                    <Text style={[styles.drawerSecondaryButtonText, isDarkMode ? styles.drawerSecondaryButtonTextDark : styles.drawerSecondaryButtonTextLight]}>Cancel</Text>
                  </Pressable>
                </ScrollView>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <Modal visible={createEventDrawerOpen} animationType="slide" transparent onRequestClose={closeCreateEventDrawer}>
        <Pressable style={styles.drawerBackdrop} onPress={closeCreateEventDrawer}>
          <KeyboardAvoidingView
            style={styles.keyboardAvoidingFill}
            behavior={Platform.select({ ios: 'padding', android: 'height' })}
            keyboardVerticalOffset={drawerKeyboardOffset}>
            <Pressable style={[styles.drawer, isDarkMode ? styles.createEventDrawerDark : styles.createEventDrawerLight]} onPress={Keyboard.dismiss}>
            <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
            <Text style={[styles.drawerTitle, isDarkMode ? styles.createEventDrawerTitleDark : styles.createEventDrawerTitleLight]}>Create Event</Text>
            <Text style={[styles.drawerSub, isDarkMode ? styles.createEventDrawerSubDark : styles.createEventDrawerSubLight]}>Choose a template to start your event setup</Text>

            <ScrollView
              ref={createEventScrollRef}
              style={styles.createEventScroll}
              contentContainerStyle={styles.createEventScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator>
            <View style={isDarkMode ? styles.templateSection : styles.createEventSectionLight}>
              <View style={styles.templateHeaderRow}>
                <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Event Template</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create new template"
                  style={[styles.templateAddButton, isDarkMode ? styles.createEventAddPillDark : styles.createEventAddPillLight]}
                  onPress={() => openCreateTemplateDrawerFromCreateEvent()}>
                  <Text style={[styles.templateAddButtonText, isDarkMode ? styles.createEventAddPillTextDark : styles.createEventAddPillTextLight]}>+ New Template</Text>
                </Pressable>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open template selector"
                style={[styles.templateSelectTrigger, isDarkMode ? styles.createEventSelectTriggerDark : styles.createEventSelectTriggerLight]}
                onPress={openTemplatePickerFromCreateEvent}>
                <View>
                  <Text style={[styles.templateName, isDarkMode ? styles.createEventTemplateNameDark : styles.createEventTemplateNameLight]}>{selectedTemplate?.name || 'Select template'}</Text>
                  {selectedTemplate ? (
                    <Text style={[styles.templateMeta, isDarkMode ? styles.createEventTemplateMetaDark : styles.templateMetaLight]}>
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
                    style={[styles.templateActionButton, isDarkMode ? styles.createEventEditButtonDark : styles.createEventEditButtonLight]}>
                    <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventEditButtonTextDark : styles.createEventEditButtonTextLight]}>Edit</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${selectedTemplate.name} template`}
                    onPress={() => deleteTemplate(selectedTemplate)}
                    disabled={templateOptions.length <= 1}
                    style={[
                      styles.templateActionButton,
                      isDarkMode ? styles.createEventDeleteButtonDark : styles.createEventDeleteButtonLight,
                      templateOptions.length <= 1 && styles.templateActionButtonDisabled,
                    ]}>
                    <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventDeleteButtonTextDark : styles.createEventDeleteButtonTextLight]}>Delete</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <View style={isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight}>
              <View style={styles.templateHeaderRow}>
                <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Roles needed for this event</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add role to event"
                  style={[styles.templateAddButton, isDarkMode ? styles.createEventAddPillDark : styles.createEventAddPillLight]}
                  onPress={openAddCreateEventRoleEditor}>
                  <Text style={[styles.templateAddButtonText, isDarkMode ? styles.createEventAddPillTextDark : styles.createEventAddPillTextLight]}>+ Add Role</Text>
                </Pressable>
              </View>
              <View style={[styles.rolePreviewContainer, isDarkMode ? styles.createEventRoleListDark : styles.createEventRoleListLight]}>
                {createEventRolesDraft.length ? (
                  createEventRolesDraft.map((role, index) => {
                    const roleOffset = role.tasks.length
                      ? Math.min(...role.tasks.map((task) => Math.max(0, Math.round(task.expectedOffsetMinutes || 0))))
                      : 0;

                    return (
                      <View
                        key={`${selectedTemplate?.id}-${role.id}`}
                        style={[
                          styles.rolePreviewRow,
                          isDarkMode ? styles.createEventRoleRowDark : styles.createEventRoleRowLight,
                          index < createEventRolesDraft.length - 1 && (isDarkMode ? styles.createEventRoleRowDividerDark : styles.createEventRoleRowDividerLight),
                        ]}>
                      <View style={isDarkMode ? styles.createEventRoleInfoDark : styles.createEventRoleInfoLight}>
                        <Text style={[styles.rolePreviewName, isDarkMode ? styles.createEventRoleNameDark : styles.createEventRoleNameLight]}>{role.name}</Text>
                      </View>
                        <Text style={styles.createEventRoleMetaHiddenLight}>
                          {role.tasks.length} tasks · Offset {formatOffsetHhMmSs(roleOffset)}
                        </Text>
                        {!isDarkMode ? (
                          <View style={styles.createEventRoleMetaStackLight}>
                            <Text style={[styles.rolePreviewMeta, styles.createEventRoleMetaLight]}>
                              {role.tasks.length} tasks
                            </Text>
                            <Text style={[styles.rolePreviewMeta, styles.createEventRoleMetaLight]}>
                              {formatRoleDurationLabel(role.tasks)}
                            </Text>
                          </View>
                        ) : null}
                        {isDarkMode ? (
                          <View style={styles.createEventRoleMetaStackDark}>
                            <Text style={[styles.rolePreviewMeta, styles.createEventRoleMetaDark]}>
                              {role.tasks.length} tasks
                            </Text>
                            <Text style={[styles.rolePreviewMeta, styles.createEventRoleMetaDark]}>
                              {formatRoleDurationLabel(role.tasks)}
                            </Text>
                          </View>
                        ) : null}
                        <View style={[styles.templateActionRow, isDarkMode ? styles.createEventRoleActionsDark : styles.createEventRoleActionsLight]}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Edit ${role.name} role`}
                            onPress={() => openEditCreateEventRoleEditor(role)}
                            style={[styles.templateActionButton, isDarkMode ? styles.createEventEditButtonDark : styles.createEventEditButtonLight]}>
                            <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventEditButtonTextDark : styles.createEventEditButtonTextLight]}>Edit</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${role.name} role`}
                            onPress={() => deleteCreateEventRoleDraft(role.id)}
                            style={[styles.templateActionButton, isDarkMode ? styles.createEventDeleteButtonDark : styles.createEventDeleteButtonLight]}>
                            <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventDeleteButtonTextDark : styles.createEventDeleteButtonTextLight]}>Delete</Text>
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

            <View style={isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Event Date</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Pick event date"
                style={[styles.templateSelectTrigger, isDarkMode ? styles.createEventFieldInputDark : styles.createEventFieldInputLight]}
                onPress={() => {
                  Keyboard.dismiss();
                  setEventDatePickerDraft(parseEventDate());
                  setShowDatePicker(true);
                }}>
                <View style={styles.createEventIconInputRow}>
                  <MaterialIcons name="calendar-month" size={24} color="#F98D2F" />
                  <Text style={[styles.templateName, isDarkMode ? (eventDateDraft ? styles.createEventInputValueDark : styles.createEventInputPlaceholderDark) : (eventDateDraft ? styles.createEventInputValueLight : styles.createEventInputPlaceholderLight)]}>
                    {eventDateDraft || 'Select Date'}
                  </Text>
                </View>
              </Pressable>
              {showDatePicker ? (
                <View style={[styles.inlinePickerWrap, isDarkMode ? styles.inlinePickerWrapDark : styles.inlinePickerWrapLight]}>
                  <DateTimePicker
                    value={eventDatePickerDraft}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    onChange={handleDateChange}
                    {...pickerSharedProps}
                  />
                  <View style={styles.pickerActionRow}>
                    <Pressable style={[styles.pickerActionButton, isDarkMode ? styles.pickerActionButtonDark : styles.pickerActionButtonLight]} onPress={() => setShowDatePicker(false)}>
                      <Text style={[styles.pickerActionText, isDarkMode ? styles.pickerActionTextDark : styles.pickerActionTextLight]}>Cancel</Text>
                    </Pressable>
                    <Pressable style={[styles.pickerActionButton, styles.pickerActionButtonToday]} onPress={handleSelectEventDate}>
                      <Text style={styles.pickerActionTextToday}>Select</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Event Time</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Pick event time"
                style={[styles.templateSelectTrigger, isDarkMode ? styles.createEventFieldInputDark : styles.createEventFieldInputLight]}
                onPress={() => {
                  Keyboard.dismiss();
                  setShowTimePicker(true);
                }}>
                <View style={styles.createEventIconInputRow}>
                  <MaterialIcons name="access-time" size={22} color="#F98D2F" />
                  <Text style={[styles.templateName, isDarkMode ? (eventTimeDraft ? styles.createEventInputValueDark : styles.createEventInputPlaceholderDark) : (eventTimeDraft ? styles.createEventInputValueLight : styles.createEventInputPlaceholderLight)]}>
                    {eventTimeDraft || 'Select Time'}
                  </Text>
                </View>
              </Pressable>
              {showTimePicker ? (
                <View style={[styles.inlinePickerWrap, isDarkMode ? styles.inlinePickerWrapDark : styles.inlinePickerWrapLight]}>
                  <DateTimePicker
                    value={parseEventTime()}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={handleTimeChange}
                    {...pickerSharedProps}
                  />
                  <View style={styles.pickerActionRow}>
                    <Pressable style={[styles.pickerActionButton, isDarkMode ? styles.pickerActionButtonDark : styles.pickerActionButtonLight]} onPress={() => setShowTimePicker(false)}>
                      <Text style={[styles.pickerActionText, isDarkMode ? styles.pickerActionTextDark : styles.pickerActionTextLight]}>Cancel</Text>
                    </Pressable>
                    <Pressable style={[styles.pickerActionButton, styles.pickerActionButtonToday]} onPress={() => setShowTimePicker(false)}>
                      <Text style={styles.pickerActionTextToday}>Select</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>

            <View
              style={isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight}
              onLayout={(event) => {
                eventLocationYRef.current = event.nativeEvent.layout.y;
              }}>
              <LocationAutocompleteField
                label="Location"
                value={eventLocationDraft}
                onChangeText={setEventLocationDraft}
                selectedPlaceId={eventLocationPlaceIdDraft}
                onPlaceIdChange={(placeId) => setEventLocationPlaceIdDraft(placeId || '')}
                placeholder="Location"
                isDarkMode={isDarkMode}
                onFocus={() => scrollCreateEventFieldAboveKeyboard(eventLocationYRef.current)}
              />
            </View>

            <View
              style={isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight}
              onLayout={(event) => {
                eventDescriptionYRef.current = event.nativeEvent.layout.y;
              }}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Description</Text>
              <TextInput
                value={eventDescriptionDraft}
                onChangeText={setEventDescriptionDraft}
                placeholder="Description"
                placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.33)' : '#94a3b8'}
                multiline
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                blurOnSubmit
                onFocus={() => scrollCreateEventFieldAboveKeyboard(eventDescriptionYRef.current)}
                style={[styles.templateTextArea, isDarkMode ? styles.createEventTextAreaDark : styles.createEventTextAreaLight]}
              />
            </View>

            <Pressable
              style={[isDarkMode ? styles.createEventPrimaryButtonDark : styles.createEventPrimaryButtonLight, !canCreateEventNow && styles.drawerCloseDisabled]}
              disabled={!canCreateEventNow}
              onPress={handleCreateEvent}>
              <Text style={styles.drawerCloseText}>Create Event</Text>
            </Pressable>
            <Pressable style={[isDarkMode ? styles.createEventCancelButtonDark : styles.createEventCancelButtonLight]} onPress={closeCreateEventDrawer}>
              <Text style={[isDarkMode ? styles.createEventCancelButtonTextDark : styles.createEventCancelButtonTextLight]}>Cancel</Text>
            </Pressable>
            </ScrollView>
          </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <Modal visible={templatePickerOpen} animationType="slide" transparent onRequestClose={closeTemplatePicker}>
        <Pressable style={styles.drawerBackdrop} onPress={closeTemplatePicker}>
          <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => null}>
            <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
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
            <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
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
            <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
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
        <Pressable style={styles.drawerBackdrop} onPress={templateTaskEditor.open ? closeTemplateTaskEditor : closeCreateTemplateDrawer}>
          <KeyboardAvoidingView
            style={styles.keyboardAvoidingFill}
            behavior={Platform.OS === 'android' ? 'height' : undefined}
            keyboardVerticalOffset={drawerKeyboardOffset}>
            <Pressable style={[styles.drawer, isDarkMode ? styles.createEventDrawerDark : styles.createEventDrawerLight]} onPress={Keyboard.dismiss}>
            <DrawerBottomFill backgroundColor={drawerSurfaceColor} />
            <Text style={[styles.drawerTitle, isDarkMode ? styles.createEventDrawerTitleDark : styles.createEventDrawerTitleLight]}>
              {templateTaskEditor.open ? (templateTaskEditor.mode === 'edit' ? 'Edit Task' : 'Add Task') : isEditingTemplate ? 'Edit Template' : 'Create Template'}
            </Text>
            <Text style={[styles.drawerSub, isDarkMode ? styles.createEventDrawerSubDark : styles.createEventDrawerSubLight]}>
              {templateTaskEditor.open
                ? (templateTaskEditor.mode === 'edit' ? 'Update the task details, then save your changes.' : 'Add the task details, then confirm to attach it to this role.')
                : isEditingTemplate
                  ? 'Update this template. Changes are saved permanently.'
                  : 'Add a template you can reuse while creating events.'}
            </Text>

            <ScrollView
              ref={createTemplateScrollRef}
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              style={styles.createEventScroll}
              contentContainerStyle={styles.createEventScrollContent}
              onScroll={(event) => {
                createTemplateScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator>
            {templateTaskEditor.open ? (
              <>
                <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
                  <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Task name</Text>
                  <TextInput
                    value={templateTaskEditor.name}
                    onChangeText={(value) => setTemplateTaskEditor((prev) => ({ ...prev, name: value }))}
                    placeholder="Task name"
                    placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.33)' : 'rgba(33,33,33,0.5)'}
                    autoFocus
                    style={[styles.templateInput, isDarkMode ? styles.createEventTextInputDark : styles.createEventTextInputLight]}
                  />
                </View>

                <View
                  style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}
                  onLayout={(event) => {
                    templateTaskDescriptionYRef.current = event.nativeEvent.layout.y;
                  }}>
                  <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Task description</Text>
                  <TextInput
                    value={templateTaskEditor.description}
                    onChangeText={(value) => setTemplateTaskEditor((prev) => ({ ...prev, description: value }))}
                    placeholder="Task description"
                    placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.33)' : 'rgba(33,33,33,0.5)'}
                    multiline
                    onFocus={() => scrollCreateTemplateFieldAboveKeyboard(templateTaskDescriptionYRef.current)}
                    style={[styles.templateTextArea, isDarkMode ? styles.createEventTextAreaDark : styles.createEventTextAreaLight]}
                  />
                </View>

                <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: templateTaskEditor.includeCountdownTimer }}
                    style={styles.countdownToggleRow}
                    onPress={() => {
                      setTemplateTaskOffsetSelectorPart(null);
                      setTemplateTaskEditor((current) => ({ ...current, includeCountdownTimer: !current.includeCountdownTimer }));
                    }}>
                    <MaterialIcons
                      name={templateTaskEditor.includeCountdownTimer ? 'check-box' : 'check-box-outline-blank'}
                      size={24}
                      color={templateTaskEditor.includeCountdownTimer ? '#0EC3C9' : isDarkMode ? '#CBD5E1' : '#475569'}
                    />
                    <Text style={[styles.countdownToggleLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>
                      Include Countdown Timer
                    </Text>
                  </Pressable>
                  {templateTaskEditor.includeCountdownTimer ? (
                    <>
                      <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Offset From Event Start</Text>
                      <View style={styles.templateDurationPickerRow}>
                    {(['hours', 'minutes', 'seconds'] as const).map((part) => {
                      const parts = parseTemplateTaskOffsetParts(templateTaskEditor.expectedOffsetText);
                      const value = parts[part];
                      const label = part === 'hours' ? 'Hours' : part === 'minutes' ? 'Min' : 'Sec';
                      const isOpen = templateTaskOffsetSelectorPart === part;
                      return (
                        <View key={part} style={styles.templateDurationSelectorWrap}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Choose ${label.toLowerCase()} offset`}
                            style={[
                              styles.templateDurationSelector,
                              isDarkMode ? styles.createEventFieldInputDark : styles.createEventFieldInputLight,
                              isOpen && styles.templateDurationSelectorActive,
                            ]}
                            onPress={() => setTemplateTaskOffsetSelectorPart((prev) => prev === part ? null : part)}>
                            <Text style={[styles.templateDurationValue, isDarkMode ? styles.createEventInputValueDark : styles.createEventInputValueLight]}>
                              {value}
                            </Text>
                            <Text style={[styles.templateDurationLabel, isDarkMode ? styles.createEventRoleMetaDark : styles.createEventRoleMetaLight]}>
                              {label}
                            </Text>
                            <MaterialIcons name={isOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={18} color={isDarkMode ? '#F7F7F7' : '#121212'} />
                          </Pressable>
                          {isOpen ? (
                            <View style={[styles.templateDurationDropdown, isDarkMode ? styles.templateTaskRowDark : styles.templateTaskRowLight]}>
                              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                                {Array.from({ length: part === 'hours' ? 24 : 60 }, (_, option) => (
                                  <Pressable
                                    key={`${part}-${option}`}
                                    style={[
                                      styles.templateDurationOption,
                                      value === option && (isDarkMode ? styles.templateDurationOptionActiveDark : styles.templateDurationOptionActiveLight),
                                    ]}
                                    onPress={() => {
                                      setTemplateTaskOffsetPart(part, option);
                                      setTemplateTaskOffsetSelectorPart(null);
                                    }}>
                                    <Text style={[styles.templateDurationOptionText, isDarkMode ? styles.createEventInputValueDark : styles.createEventInputValueLight]}>
                                      {option}
                                    </Text>
                                  </Pressable>
                                ))}
                              </ScrollView>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                      </View>
                    </>
                  ) : null}
                </View>

                <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
                  <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Attachments</Text>
                  <View style={styles.templateTaskAttachmentButtons}>
                    <Pressable
                      style={[styles.templateActionButton, isDarkMode ? styles.createEventAddPillDark : styles.createEventAddPillLight, templateAttachmentBusyKey && styles.templateActionButtonDisabled]}
                      disabled={!!templateAttachmentBusyKey}
                      onPress={() => addTemplateTaskEditorAttachment('photo')}>
                      <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventAddPillTextDark : styles.createEventAddPillTextLight]}>+ Photo</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.templateActionButton, isDarkMode ? styles.createEventAddPillDark : styles.createEventAddPillLight, templateAttachmentBusyKey && styles.templateActionButtonDisabled]}
                      disabled={!!templateAttachmentBusyKey}
                      onPress={() => addTemplateTaskEditorAttachment('document')}>
                      <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventAddPillTextDark : styles.createEventAddPillTextLight]}>+ Document</Text>
                    </Pressable>
                  </View>
                  {templateTaskEditor.attachments.length ? (
                    <View style={styles.templateAttachmentList}>
                      {templateTaskEditor.attachments.map((attachment) => (
                        <View key={attachment.id} style={[styles.templateAttachmentItem, isDarkMode ? styles.templateTaskRowDark : styles.templateTaskRowLight]}>
                          <Text style={[styles.templateAttachmentName, isDarkMode ? styles.createEventInputValueDark : styles.createEventInputValueLight]} numberOfLines={1}>
                            {attachment.kind === 'photo' ? '🖼️' : '📄'} {attachment.name}
                          </Text>
                          <Pressable onPress={() => removeTemplateTaskEditorAttachment(attachment.id)}>
                            <Text style={isDarkMode ? styles.createEventDeleteButtonTextDark : styles.createEventDeleteButtonTextLight}>Remove</Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No attachments yet.</Text>
                  )}
                </View>

                <Pressable
                  style={[isDarkMode ? styles.createEventPrimaryButtonDark : styles.createEventPrimaryButtonLight, (!templateTaskEditor.name.trim().length) && styles.drawerCloseDisabled]}
                  onPress={saveTemplateTaskEditor}
                  disabled={!templateTaskEditor.name.trim().length}>
                  <Text style={styles.drawerCloseText}>{templateTaskEditor.mode === 'edit' ? 'Save Task' : 'Confirm Task'}</Text>
                </Pressable>
                <Pressable style={isDarkMode ? styles.createEventCancelButtonDark : styles.createEventCancelButtonLight} onPress={closeTemplateTaskEditor}>
                  <Text style={isDarkMode ? styles.createEventCancelButtonTextDark : styles.createEventCancelButtonTextLight}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <>
            <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Template name</Text>
              <TextInput
                value={templateNameDraft}
                onChangeText={setTemplateNameDraft}
                placeholder="Example: Saturday Street Crew"
                placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.33)' : 'rgba(33,33,33,0.5)'}
                style={[styles.templateInput, isDarkMode ? styles.createEventTextInputDark : styles.createEventTextInputLight]}
              />
            </View>


            <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Default event time (optional)</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Pick default event time"
                style={[styles.templateSelectTrigger, isDarkMode ? styles.createEventSelectTriggerDark : styles.createEventSelectTriggerLight]}
                onPress={() => {
                  Keyboard.dismiss();
                  setShowTemplateDefaultTimePicker(true);
                }}>
                <Text style={templateDefaultTimeDraft ? [styles.templateName, isDarkMode ? styles.createEventInputValueDark : styles.createEventInputValueLight] : [styles.templateName, isDarkMode ? styles.createEventInputPlaceholderDark : styles.createEventInputPlaceholderLight]}>
                  {templateDefaultTimeDraft || 'Select time'}
                </Text>
              </Pressable>
              {showTemplateDefaultTimePicker ? (
                <View style={[styles.inlinePickerWrap, isDarkMode ? styles.inlinePickerWrapDark : styles.inlinePickerWrapLight]}>
                  <DateTimePicker
                    value={parseTemplateDefaultTime()}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={handleTemplateDefaultTimeChange}
                    {...pickerSharedProps}
                  />
                  <View style={styles.pickerActionRow}>
                    <Pressable style={[styles.pickerActionButton, isDarkMode ? styles.pickerActionButtonDark : styles.pickerActionButtonLight]} onPress={() => setShowTemplateDefaultTimePicker(false)}>
                      <Text style={[styles.pickerActionText, isDarkMode ? styles.pickerActionTextDark : styles.pickerActionTextLight]}>Cancel</Text>
                    </Pressable>
                    <Pressable style={[styles.pickerActionButton, styles.pickerActionButtonToday]} onPress={() => setShowTemplateDefaultTimePicker(false)}>
                      <Text style={styles.pickerActionTextToday}>Select</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>

            <View
              style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}
              onLayout={(event) => {
                templateDefaultLocationYRef.current = event.nativeEvent.layout.y;
              }}>
              <LocationAutocompleteField
                label="Default location (optional)"
                value={templateDefaultLocationDraft}
                onChangeText={setTemplateDefaultLocationDraft}
                selectedPlaceId={templateDefaultLocationPlaceIdDraft}
                onPlaceIdChange={(placeId) => setTemplateDefaultLocationPlaceIdDraft(placeId || '')}
                placeholder="Downtown"
                isDarkMode={isDarkMode}
                onFocus={() => scrollCreateTemplateFieldAboveKeyboard(templateDefaultLocationYRef.current)}
              />
            </View>

            <View
              style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}
              onLayout={(event) => {
                templateDefaultDescriptionYRef.current = event.nativeEvent.layout.y;
              }}>
              <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Default description (optional)</Text>
              <TextInput
                value={templateDefaultDescriptionDraft}
                onChangeText={setTemplateDefaultDescriptionDraft}
                placeholder="Describe this template"
                placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.33)' : 'rgba(33,33,33,0.5)'}
                multiline
                onFocus={() => scrollCreateTemplateFieldAboveKeyboard(templateDefaultDescriptionYRef.current)}
                style={[styles.templateTextArea, isDarkMode ? styles.createEventTextAreaDark : styles.createEventTextAreaLight]}
              />
            </View>
            <View style={[styles.formField, isDarkMode ? styles.createEventSectionDark : styles.createEventSectionLight]}>
              <View style={styles.templateHeaderRow}>
                <Text style={[styles.templateLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>Roles</Text>
                <Pressable
                  accessibilityLabel="Add role to template"
                  style={[styles.templateAddButton, isDarkMode ? styles.createEventAddPillDark : styles.createEventAddPillLight]}
                  onPress={addTemplateRoleDraft}>
                  <Text style={[styles.templateAddButtonText, isDarkMode ? styles.createEventAddPillTextDark : styles.createEventAddPillTextLight]}>+ Add Role</Text>
                </Pressable>
              </View>
              <View style={[styles.rolePreviewContainer, isDarkMode ? styles.createEventRoleListDark : styles.createEventRoleListLight]}>
                {templateRolesDraft.length ? templateRolesDraft.map((role, index) => (
                  <View
                    key={role.id}
                    style={[styles.templateRoleEditor, isDarkMode ? styles.templateRoleEditorDark : styles.templateRoleEditorLight]}
                    onLayout={(event) => {
                      templateRoleYByIdRef.current[role.id] = event.nativeEvent.layout.y;
                    }}>
                    <View style={styles.templateRoleHeader}>
                      <Text style={[styles.rolePreviewName, isDarkMode ? styles.createEventRoleNameDark : styles.createEventRoleNameLight]}>Role {index + 1}</Text>
                      <Pressable
                        accessibilityLabel={`Delete role ${role.name || index + 1}`}
                        style={[styles.templateActionButton, isDarkMode ? styles.createEventDeleteButtonDark : styles.createEventDeleteButtonLight]}
                        onPress={() => removeTemplateRoleDraft(role.id)}>
                        <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventDeleteButtonTextDark : styles.createEventDeleteButtonTextLight]}>Delete</Text>
                      </Pressable>
                    </View>

                    <TextInput
                      value={role.name}
                      onChangeText={(value) => updateTemplateRoleDraftName(role.id, value)}
                      placeholder={`Role ${index + 1}`}
                      placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.33)' : 'rgba(33,33,33,0.5)'}
                      style={[styles.templateInput, isDarkMode ? styles.createEventTextInputDark : styles.createEventTextInputLight]}
                    />

                    {role.tasks.length ? (
                      <View style={[styles.taskList, isDarkMode ? styles.taskListDarkFigma : styles.taskListLightFigma]}>
                        {preserveTemplateTaskOrder(role.tasks).map((task, taskIndex) => (
                          <View key={`${role.id}-summary-${task.id}`} style={styles.templateTaskSummaryCard}>
                            <View style={styles.taskRow}>
                              <View style={styles.templateTaskSummaryMain}>
                                <Text style={[styles.taskName, isDarkMode ? styles.taskNameDark : styles.taskNameLight]}>
                                  • {task.name || `Task ${taskIndex + 1}`} · {Number.isFinite(task.expectedOffsetMinutes) ? formatOffsetHhMmSs(task.expectedOffsetMinutes || 0) : 'No countdown'}
                                </Text>
                                {task.description?.trim() ? (
                                  <Pressable onPress={() => showTemplateTaskDescription(task.name || `Task ${taskIndex + 1}`, task.description)} hitSlop={6}>
                                    <Text style={[styles.templateTaskSummaryLink, isDarkMode ? styles.createEventEditButtonTextDark : styles.createEventEditButtonTextLight]}>
                                      Description
                                    </Text>
                                  </Pressable>
                                ) : null}
                              </View>
                              <View style={styles.templateTaskSummaryRight}>
                                <Pressable
                                  accessibilityLabel={`Edit task ${task.name || taskIndex + 1} in ${role.name || `role ${index + 1}`}`}
                                  accessibilityRole="button"
                                  hitSlop={6}
                                  style={[styles.templateTaskIconButton, isDarkMode ? styles.createEventEditButtonDark : styles.createEventEditButtonLight]}
                                  onPress={() => editTemplateTaskEditor(role.id, task)}>
                                  <MaterialIcons name="edit" size={20} color={isDarkMode ? '#F98D2F' : '#F98D2F'} />
                                </Pressable>
                                <Pressable
                                  accessibilityLabel={`Delete task ${task.name || taskIndex + 1} from ${role.name || `role ${index + 1}`}`}
                                  accessibilityRole="button"
                                  hitSlop={6}
                                  style={[styles.templateTaskIconButton, isDarkMode ? styles.createEventDeleteButtonDark : styles.createEventDeleteButtonLight]}
                                  onPress={() => removeTemplateTaskDraft(role.id, task.id)}>
                                  <MaterialIcons name="delete-outline" size={20} color={isDarkMode ? '#12274D' : '#F7F7F7'} />
                                </Pressable>
                                {task.attachments?.length ? (
                                  <Pressable onPress={() => openTaskAttachment(task.name || `Task ${taskIndex + 1}`, task.attachments)} hitSlop={6}>
                                    <Text style={styles.taskAttachmentIcon}>📎</Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    <View style={styles.templateRoleTaskHeader}>
                      <Text style={[styles.rolePreviewMeta, isDarkMode ? styles.createEventRoleMetaDark : styles.createEventRoleMetaLight]}>{role.tasks.length} tasks configured</Text>
                      <Pressable
                        accessibilityLabel={`Add task to ${role.name || `role ${index + 1}`}`}
                        style={[styles.templateActionButton, isDarkMode ? styles.createEventAddPillDark : styles.createEventAddPillLight]}
                        onPress={() => openTemplateTaskEditor(role.id)}>
                        <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventAddPillTextDark : styles.createEventAddPillTextLight]}>+ Add Task</Text>
                      </Pressable>
                    </View>

                    {false ? role.tasks.map((task, taskIndex) => (
                      <View key={task.id} style={[styles.templateTaskRow, isDarkMode ? styles.templateTaskRowDark : styles.templateTaskRowLight]}>
                        <Text style={[styles.templateTaskLabel, isDarkMode ? styles.createEventRoleMetaDark : styles.createEventRoleMetaLight]}>Task {taskIndex + 1}</Text>
                        <TextInput
                          value={task.name}
                          onChangeText={(value) => updateTemplateTaskDraft(role.id, task.id, { name: value })}
                          placeholder="Task name"
                          placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.33)' : 'rgba(33,33,33,0.5)'}
                          style={[styles.templateInput, isDarkMode ? styles.createEventTextInputDark : styles.createEventTextInputLight]}
                        />
                        <TextInput
                          value={task.description || ''}
                          onChangeText={(value) => updateTemplateTaskDraft(role.id, task.id, { description: value })}
                          placeholder="Task description"
                          placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.33)' : 'rgba(33,33,33,0.5)'}
                          multiline
                          style={[styles.templateTextArea, isDarkMode ? styles.createEventTextAreaDark : styles.createEventTextAreaLight]}
                        />
                        <View style={styles.templateTaskAttachmentSection}>
                          <Text style={[styles.rolePreviewMeta, isDarkMode ? styles.createEventRoleMetaDark : styles.createEventRoleMetaLight]}>Attachments</Text>
                          <View style={styles.templateTaskAttachmentButtons}>
                            <Pressable
                              style={[styles.templateActionButton, isDarkMode ? styles.createEventAddPillDark : styles.createEventAddPillLight, templateAttachmentBusyKey && styles.templateActionButtonDisabled]}
                              disabled={!!templateAttachmentBusyKey}
                              onPress={() => addTemplateTaskAttachment(role.id, task.id, 'photo')}>
                              <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventAddPillTextDark : styles.createEventAddPillTextLight]}>
                                + Photo
                              </Text>
                            </Pressable>
                            <Pressable
                              style={[styles.templateActionButton, isDarkMode ? styles.createEventAddPillDark : styles.createEventAddPillLight, templateAttachmentBusyKey && styles.templateActionButtonDisabled]}
                              disabled={!!templateAttachmentBusyKey}
                              onPress={() => addTemplateTaskAttachment(role.id, task.id, 'document')}>
                              <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventAddPillTextDark : styles.createEventAddPillTextLight]}>
                                + Document
                              </Text>
                            </Pressable>
                          </View>
                          {(task.attachments || []).length ? (
                            <View style={styles.templateAttachmentList}>
                              {(task.attachments || []).map((attachment) => (
                                <View key={attachment.id} style={[styles.templateAttachmentItem, isDarkMode ? styles.templateTaskRowDark : styles.templateTaskRowLight]}>
                                  <Text style={[styles.templateAttachmentName, isDarkMode ? styles.createEventInputValueDark : styles.createEventInputValueLight]} numberOfLines={1}>
                                    {attachment.kind === 'photo' ? '🖼️' : '📄'} {attachment.name}
                                  </Text>
                                  <Pressable onPress={() => removeTemplateTaskAttachment(role.id, task.id, attachment.id)}>
                                    <Text style={[styles.createEventDeleteButtonTextLight, isDarkMode && styles.createEventDeleteButtonTextDark]}>Remove</Text>
                                  </Pressable>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </View>
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: Number.isFinite(task.expectedOffsetMinutes) }}
                          style={styles.countdownToggleRow}
                          onPress={() => setTemplateTaskCountdownEnabled(role.id, task.id, !Number.isFinite(task.expectedOffsetMinutes))}>
                          <MaterialIcons
                            name={Number.isFinite(task.expectedOffsetMinutes) ? 'check-box' : 'check-box-outline-blank'}
                            size={24}
                            color={Number.isFinite(task.expectedOffsetMinutes) ? '#0EC3C9' : isDarkMode ? '#CBD5E1' : '#475569'}
                          />
                          <Text style={[styles.countdownToggleLabel, isDarkMode ? styles.createEventFieldLabelDark : styles.createEventFieldLabelLight]}>
                            Include Countdown Timer
                          </Text>
                        </Pressable>
                        {Number.isFinite(task.expectedOffsetMinutes) ? (
                          <TextInput
                            value={templateTaskOffsetDrafts[`${role.id}:${task.id}`] ?? formatOffsetHhMmSs(task.expectedOffsetMinutes || 0)}
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
                              setTemplateTaskOffsetDrafts((prev) => ({ ...prev, [key]: formatOffsetHhMmSs(task.expectedOffsetMinutes || 0) }));
                            }}
                            keyboardType="numbers-and-punctuation"
                            returnKeyType="done"
                            onSubmitEditing={Keyboard.dismiss}
                            blurOnSubmit
                            placeholder="HH:MM:SS"
                            placeholderTextColor={isDarkMode ? 'rgba(247,247,247,0.33)' : 'rgba(33,33,33,0.5)'}
                            style={[styles.templateInput, isDarkMode ? styles.createEventTextInputDark : styles.createEventTextInputLight]}
                          />
                        ) : null}
                        <Pressable
                          accessibilityLabel={`Delete task ${task.name || taskIndex + 1} from ${role.name || `role ${index + 1}`}`}
                          style={[styles.templateActionButton, isDarkMode ? styles.createEventDeleteButtonDark : styles.createEventDeleteButtonLight]}
                          onPress={() => removeTemplateTaskDraft(role.id, task.id)}>
                          <Text style={[styles.templateActionButtonText, isDarkMode ? styles.createEventDeleteButtonTextDark : styles.createEventDeleteButtonTextLight]}>Delete Task</Text>
                        </Pressable>
                      </View>
                    )) : null}
                  </View>
                )) : <Text style={[styles.roleEmpty, isDarkMode ? styles.roleEmptyDark : styles.roleEmptyLight]}>No roles yet. Add at least one role for this template.</Text>}
              </View>
            </View>

            <Pressable
              style={[isDarkMode ? styles.createEventPrimaryButtonDark : styles.createEventPrimaryButtonLight, (!templateNameDraft.trim().length) && styles.drawerCloseDisabled]}
              onPress={saveTemplate}
              disabled={!templateNameDraft.trim().length}>
              <Text style={styles.drawerCloseText}>{isEditingTemplate ? 'Save Changes' : 'Create Template'}</Text>
            </Pressable>
            <Pressable style={isDarkMode ? styles.createEventCancelButtonDark : styles.createEventCancelButtonLight} onPress={closeCreateTemplateDrawer}>
              <Text style={isDarkMode ? styles.createEventCancelButtonTextDark : styles.createEventCancelButtonTextLight}>Cancel</Text>
            </Pressable>
              </>
            )}
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
  containerLight: { backgroundColor: '#DBE2F9' },
  containerDark: { backgroundColor: '#061229' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  eventsLightHeader: { gap: 14, marginBottom: 8 },
  eventsLightTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eventsLightLogo: { width: 64, height: 64 },
  eventsDarkHeader: { gap: 14, marginBottom: 8 },
  eventsDarkTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eventsDarkLogo: { width: 64, height: 64 },
  eventsDarkAddButton: {
    width: 44,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: '#0EC3C9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventsDarkAddButtonIcon: { color: '#F7F7F7', fontSize: 24, lineHeight: 24, fontWeight: '500', marginTop: -1 },
  eventsDarkDateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  eventsDarkDateChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#F98D2F',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    backgroundColor: '#061229',
    flexDirection: 'row',
  },
  eventsDarkDateChipText: { color: '#F98D2F', fontSize: 20, lineHeight: 24, fontFamily: 'Inter', fontWeight: '700' },
  eventsDarkCalendarButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  eventsDarkArrowButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  eventsLightAddButton: {
    width: 44,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: '#0EC3C9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventsLightAddButtonText: { color: '#F7F7F7', fontSize: 14, lineHeight: 18, fontWeight: '700' },
  eventsLightAddButtonIcon: { color: '#F7F7F7', fontSize: 24, lineHeight: 24, fontWeight: '500', marginTop: -1 },
  eventsLightDateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  eventsLightDateChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#F98D2F',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    backgroundColor: '#DBE2F9',
    flexDirection: 'row',
  },
  eventsLightDateChipText: { color: '#F98D2F', fontSize: 20, lineHeight: 24, fontFamily: 'Inter', fontWeight: '700' },
  eventsLightCalendarButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  eventsLightCalendarButtonPassive: { opacity: 0.7 },
  eventsLightArrowButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  eventsLightCalendarBadge: {
    position: 'absolute',
    top: 1,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#F98D2F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventsLightCalendarBadgeText: { color: '#F7F7F7', fontSize: 11, lineHeight: 12, fontWeight: '700' },
  eventsList: { flex: 1 },
  eventsDarkListContent: { paddingBottom: 24, flexGrow: 1 },
  eventsLightListContent: { paddingBottom: 24, flexGrow: 1 },
  eventsLightDayDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 10 },
  eventsLightDayLabel: { color: 'rgba(249,141,47,0.5)', fontSize: 16, lineHeight: 20, fontFamily: 'Inter', fontWeight: '700' },
  eventsLightDayLine: { flex: 1, height: 1, backgroundColor: 'rgba(249,141,47,0.25)' },
  eventsDarkDayDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 10 },
  eventsDarkDayLabel: { color: 'rgba(249,141,47,0.5)', fontSize: 16, lineHeight: 20, fontFamily: 'Inter', fontWeight: '700' },
  eventsDarkDayLine: { flex: 1, height: 1, backgroundColor: 'rgba(249,141,47,0.25)' },
  filter: { fontWeight: '600' },
  filterLight: { color: '#334155' },
  filterDark: { color: '#F4F8FF', display: 'none' },
  createButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
    display: 'none',
  },
  createButtonText: { color: '#F7F7F7', fontSize: 24, lineHeight: 24, fontWeight: '500', marginTop: -1 },
  empty: { marginTop: 20 },
  emptyLight: { color: '#64748b' },
  emptyDark: { color: '#F4F8FF' },
  pendingNotificationsCard: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10, gap: 8 },
  pendingNotificationsCardLight: { borderColor: '#F7F7F7', backgroundColor: '#F7F7F7' },
  pendingNotificationsCardDark: { borderColor: '#12274D', backgroundColor: '#12274D' },
  pendingNotificationsTitle: { fontWeight: '700', fontSize: 13 },
  pendingNotificationsTitleLight: { color: '#232832' },
  pendingNotificationsTitleDark: { color: '#F4F8FF' },
  pendingNotificationsList: { maxHeight: 360 },
  pendingNotificationsListContent: { gap: 8 },
  pendingNotificationRow: { gap: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#334155' },
  pendingNotificationHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  pendingNotificationText: { fontSize: 12, fontWeight: '600' },
  pendingNotificationTitleText: { flex: 1 },
  pendingNotificationDateTimeText: { marginTop: 2, fontSize: 12, fontWeight: '700' },
  pendingNotificationEventText: { fontSize: 13, fontWeight: '800' },
  pendingNotificationRoleText: { marginTop: 3, fontSize: 12, fontWeight: '700' },
  pendingNotificationDetails: { gap: 8 },
  pendingNotificationDetail: { fontSize: 12 },
  pendingNotificationExpandText: { fontSize: 12, fontWeight: '700' },
  pendingNotificationExpandTextLight: { color: '#F98D2F' },
  pendingNotificationExpandTextDark: { color: '#F98D2F' },
  pendingNotificationActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pendingActionButton: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  pendingActionButtonText: { fontSize: 13, fontWeight: '700' },
  pendingActionDeclineLight: { borderColor: '#F98D2F', borderWidth: 1, backgroundColor: '#F7F7F7' },
  pendingActionDeclineDark: { borderColor: '#F98D2F', borderWidth: 1, backgroundColor: '#12274D' },
  pendingActionDeclineTextLight: { color: '#F98D2F' },
  pendingActionDeclineTextDark: { color: '#F98D2F' },
  pendingActionAcceptLight: { borderColor: '#F98D2F', borderWidth: 1, backgroundColor: '#F98D2F' },
  pendingActionAcceptDark: { borderColor: '#F98D2F', borderWidth: 1, backgroundColor: '#F98D2F' },
  pendingActionAcceptTextLight: { color: '#F7F7F7' },
  pendingActionAcceptTextDark: { color: '#12274D' },
  pendingActionWaitlistLight: { borderColor: '#0EC3C9', borderWidth: 1, backgroundColor: '#0EC3C9' },
  pendingActionWaitlistDark: { borderColor: '#0EC3C9', borderWidth: 1, backgroundColor: '#0EC3C9' },
  pendingActionWaitlistTextLight: { color: '#F7F7F7' },
  pendingActionWaitlistTextDark: { color: '#12274D' },
  pendingActionPreferred: { shadowColor: '#F98D2F', shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  pickerCard: { marginTop: 8, marginBottom: 12, borderRadius: 16, borderWidth: 1, padding: 8 },
  pickerCardLight: { backgroundColor: '#F7F7F7', borderColor: '#0EC3C9' },
  pickerCardDark: { backgroundColor: '#12274D', borderColor: '#0EC3C9' },
  inlinePickerWrap: { marginTop: 10, borderRadius: 14, borderWidth: 1, padding: 8 },
  inlinePickerWrapLight: { backgroundColor: '#F7F7F7', borderColor: 'rgba(14,195,201,0.35)' },
  inlinePickerWrapDark: { backgroundColor: '#12274D', borderColor: 'rgba(14,195,201,0.45)' },
  pickerActionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  pickerActionButton: { minHeight: 36, borderRadius: 18, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  pickerActionButtonLight: { backgroundColor: '#F7F7F7', borderColor: '#CBD5E1' },
  pickerActionButtonDark: { backgroundColor: '#12274D', borderColor: '#2E559D' },
  pickerActionButtonToday: { backgroundColor: '#0EC3C9', borderColor: '#0EC3C9' },
  pickerActionText: { fontSize: 12, fontWeight: '700' },
  pickerActionTextLight: { color: '#121212' },
  pickerActionTextDark: { color: '#F7F7F7' },
  pickerActionTextToday: { color: '#061229', fontSize: 12, fontWeight: '700' },
  card: { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1 },
  cardLight: { backgroundColor: '#F7F7F7', borderColor: '#F7F7F7', borderRadius: 16, padding: 16, marginBottom: 12 },
  swipeEditAction: {
    marginBottom: 10,
    borderRadius: 12,
    width: 92,
    backgroundColor: '#0E9FA6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeEditActionText: { color: '#F7F7F7', fontWeight: '700' },
  swipeDeleteAction: {
    marginBottom: 10,
    borderRadius: 12,
    width: 92,
    backgroundColor: '#b91c1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeDeleteActionText: { color: '#fee2e2', fontWeight: '700' },
  cardDark: { backgroundColor: '#12274D', borderColor: '#12274D', borderRadius: 16, padding: 16, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontWeight: '700', fontSize: 20, flex: 1, marginRight: 8 },
  titleLight: { color: '#232832' },
  titleDark: { color: '#F4F8FF' },
  eventDateTimeSubtitle: { fontSize: 14, fontWeight: '700', marginTop: -2, marginBottom: 2 },
  eventDateTimeSubtitleLight: { color: '#232832' },
  eventDateTimeSubtitleDark: { color: '#F4F8FF' },
  workerRoleSubtitle: { fontSize: 13, fontWeight: '800', marginBottom: 2 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusPillLight: { backgroundColor: '#e2e8f0' },
  statusPillCompletedLight: { backgroundColor: '#F7F7F7', borderWidth: 1, borderColor: '#F98D2F' },
  statusPillUpcomingLight: { backgroundColor: '#F7F7F7', borderWidth: 1, borderColor: '#0EC3C9' },
  statusPillDark: { backgroundColor: '#001A4D' },
  statusPillCompletedDark: { backgroundColor: '#12274D', borderWidth: 1, borderColor: '#F98D2F' },
  statusPillUpcomingDark: { backgroundColor: '#12274D', borderWidth: 1, borderColor: '#0EC3C9' },
  statusText: { fontSize: 11, fontWeight: '700' },
  statusTextLight: { color: '#475569' },
  statusTextCompletedLight: { color: '#F98D2F', fontWeight: '400' },
  statusTextUpcomingLight: { color: '#0EC3C9', fontWeight: '400' },
  statusTextDark: { color: '#F4F8FF' },
  statusTextCompletedDark: { color: '#F98D2F', fontWeight: '400' },
  statusTextUpcomingDark: { color: '#0EC3C9', fontWeight: '400' },
  meta: { marginTop: 6, fontSize: 12 },
  metaLight: { color: '#232832', opacity: 0.72 },
  metaDark: { color: '#F4F8FF', opacity: 0.72 },
  locationMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationMetaText: { flex: 1 },
  mapIconButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, borderRadius: MINIMUM_TOUCH_TARGET / 2, alignItems: 'center', justifyContent: 'center' },
  expandHint: { marginTop: 8, fontSize: 12, fontWeight: '600' },
  expandHintLight: { color: '#F98D2F' },
  expandHintLightFigma: { marginTop: 0, fontSize: 12, lineHeight: 16, fontWeight: '700', color: '#0EC3C9' },
  expandHintDark: { color: '#F98D2F' },
  expandHintCardDark: { color: '#F98D2F' },
  expandHintTaskDark: { color: '#0EC3C9' },
  expandHintDarkFigma: { marginTop: 0, fontSize: 12, lineHeight: 16, fontWeight: '700', color: '#0EC3C9' },
  managerExpanded: { marginTop: 10, gap: 10 },
  roleCard: { borderWidth: 1, borderRadius: 10, padding: 10 },
  roleCardLight: { borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  roleCardLightFigma: { borderColor: '#DBE2F9', backgroundColor: '#EDF0FC', borderRadius: 8, padding: 8, gap: 12 },
  roleCardDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  roleCardDarkFigma: { borderColor: '#061229', backgroundColor: '#203E75', borderRadius: 8, padding: 8, gap: 12 },
  roleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  roleHeaderActions: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 6, flexShrink: 0 },
  roleCountStack: { alignItems: 'flex-end', gap: 2, minWidth: 72 },
  roleIconButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, borderRadius: MINIMUM_TOUCH_TARGET / 2, alignItems: 'center', justifyContent: 'center' },
  roleIconButtonLight: { backgroundColor: '#F7F7F7' },
  roleIconButtonDark: { backgroundColor: '#12274D' },
  roleTitle: { flex: 1, flexShrink: 1, fontWeight: '700', fontSize: 14, lineHeight: 18 },
  roleTitleLight: { color: '#232832' },
  roleTitleDark: { color: '#F4F8FF' },
  roleMeta: { fontSize: 12, fontWeight: '600' },
  roleMetaLight: { color: '#64748b' },
  roleMetaDark: { color: '#F4F8FF', opacity: 0.8 },
  roleMetaDarkFigma: { color: '#F4F8FF', opacity: 0.8 },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  avatarRowLightFigma: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 0 },
  avatarChip: { alignItems: 'center', width: 66 },
  avatarChipLightFigma: { alignItems: 'center', width: 38 },
  avatarCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarCircleLight: { backgroundColor: '#F7F7F7' },
  avatarCircleLightFigma: { backgroundColor: '#F7F7F7', borderWidth: 2, borderColor: '#F98D2F' },
  avatarCircleAssignedLightFigma: { backgroundColor: '#F7F7F7', borderWidth: 2, borderColor: '#0EC3C9' },
  avatarCircleDark: { backgroundColor: '#12274D' },
  avatarCircleDarkFigma: { backgroundColor: '#12274D', borderWidth: 2, borderColor: '#F98D2F' },
  avatarCircleAssignedDarkFigma: { backgroundColor: '#12274D', borderWidth: 2, borderColor: '#0EC3C9' },
  avatarCircleRingAcceptedLight: { borderWidth: 2, borderColor: '#0EC3C9' },
  avatarCircleRingAcceptedDark: { borderWidth: 2, borderColor: '#0EC3C9' },
  avatarCircleRingDeclinedLight: { borderWidth: 2, borderColor: '#dc2626' },
  avatarCircleRingDeclinedDark: { borderWidth: 2, borderColor: '#fb7185' },
  avatarCircleRingWaitlistedLight: { borderWidth: 2, borderColor: '#2563eb' },
  avatarCircleRingWaitlistedDark: { borderWidth: 2, borderColor: '#60a5fa' },
  avatarCircleRingPendingLight: { borderWidth: 2, borderColor: '#F98D2F' },
  avatarCircleRingPendingDark: { borderWidth: 2, borderColor: '#F98D2F' },
  avatarText: { fontWeight: '700', color: '#bfdbfe' },
  avatarTextLightFigma: { fontWeight: '700', color: 'rgba(249,141,47,0.25)', fontSize: 16 },
  avatarTextAssignedLightFigma: { fontWeight: '700', color: 'rgba(14,195,201,0.35)', fontSize: 16 },
  avatarTextDarkFigma: { fontWeight: '700', color: 'rgba(249,141,47,0.55)', fontSize: 16 },
  avatarTextAssignedDarkFigma: { fontWeight: '700', color: '#0EC3C9', fontSize: 16 },
  avatarName: { marginTop: 4, fontSize: 11 },
  avatarNameLight: { color: '#334155' },
  avatarNameLightFigma: { marginTop: 4, fontSize: 10, lineHeight: 12, color: '#121212', textAlign: 'center' },
  avatarNameDark: { color: '#F4F8FF' },
  avatarNameDarkFigma: { color: '#F7F7F7' },
  roleTaskToggle: { marginTop: 10, alignSelf: 'flex-start' },
  roleActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  drawerButton: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  drawerButtonLight: { backgroundColor: '#e2e8f0' },
  drawerButtonLightFigma: { backgroundColor: '#F7F7F7', borderWidth: 1, borderColor: '#F98D2F', alignSelf: 'flex-start' },
  drawerButtonDark: { backgroundColor: '#001A4D' },
  drawerButtonDarkFigma: { backgroundColor: '#12274D', borderWidth: 1, borderColor: '#F98D2F', alignSelf: 'flex-start' },
  drawerButtonText: { fontSize: 12, fontWeight: '700' },
  drawerButtonTextLight: { color: '#334155' },
  drawerButtonTextLightFigma: { color: '#F98D2F' },
  drawerButtonTextDark: { color: '#F4F8FF' },
  drawerButtonTextDarkFigma: { color: '#F98D2F' },
  drawerDestructiveButton: { marginBottom: 10, backgroundColor: '#7f1d1d' },
  drawerDestructiveButtonText: { color: '#fecaca', textAlign: 'center', fontWeight: '700' },
  taskList: { marginTop: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8, gap: 8 },
  taskListLightFigma: { marginTop: 0, borderTopWidth: 1, borderTopColor: 'rgba(18,18,18,0.2)', paddingTop: 10, gap: 6, width: '100%' },
  taskListDarkFigma: { marginTop: 0, borderTopWidth: 1, borderTopColor: 'rgba(247,247,247,0.2)', paddingTop: 10, gap: 6, width: '100%' },
  managerTaskDetailRow: { gap: 5 },
  managerTaskActions: { minHeight: 26, flexDirection: 'row', alignItems: 'center', gap: 12 },
  managerTaskDescriptionLink: { color: '#F98D2F', fontSize: 12, fontWeight: '700' },
  taskRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  taskName: { flex: 1, fontSize: 13 },
  taskNameLight: { color: '#232832' },
  taskNameDark: { color: '#F4F8FF' },
  taskAttachmentIcon: { fontSize: 16, marginLeft: 8 },
  taskStatus: { fontSize: 12, fontWeight: '600' },
  taskStatusDone: { color: '#22c55e' },
  workerCancelRoleButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  workerCancelRoleButtonLight: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  workerCancelRoleButtonDark: { borderColor: '#7f1d1d', backgroundColor: '#2f1018' },
  workerCancelRoleText: { fontSize: 12, fontWeight: '700' },
  workerCancelRoleTextLight: { color: '#b91c1c' },
  workerCancelRoleTextDark: { color: '#fecaca' },
  pendingInviteRoleCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderRadius: 10, borderWidth: 1, padding: 10 },
  pendingInviteRoleCardLight: { backgroundColor: '#F7F7F7', borderColor: 'rgba(14,195,201,0.35)' },
  pendingInviteRoleCardDark: { backgroundColor: '#12274D', borderColor: 'rgba(14,195,201,0.45)' },
  pendingInviteRoleInfo: { flex: 1, gap: 2 },
  pendingInviteWaitlistButton: { minWidth: 112, borderRadius: 10, borderWidth: 1, paddingVertical: 9, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
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
  createEventRoleListLight: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#EDF0FC', borderRadius: 8, padding: 8, gap: 0 },
  createEventRoleRowLight: { paddingVertical: 8 },
  createEventRoleRowDividerLight: { borderBottomWidth: 1, borderBottomColor: 'rgba(6,18,41,0.1)' },
  createEventRoleInfoLight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  createEventRoleNameLight: { color: '#121212', fontSize: 12, fontWeight: '700', flexShrink: 0 },
  createEventRoleMetaLight: { color: '#121212', opacity: 0.8, fontSize: 12, fontWeight: '300', flex: 1 },
  createEventRoleMetaStackLight: { flex: 1, gap: 2 },
  createEventRoleMetaHiddenLight: { display: 'none' },
  createEventRoleMetaStackDark: { flex: 1, gap: 2 },
  createEventRoleActionsLight: { marginTop: 0, flexShrink: 0 },
  createEventRoleListDark: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#203E75', borderRadius: 8, padding: 8, gap: 0 },
  createEventRoleRowDark: { paddingVertical: 8 },
  createEventRoleRowDividerDark: { borderBottomWidth: 1, borderBottomColor: 'rgba(247,247,247,0.12)' },
  createEventRoleInfoDark: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  createEventRoleNameDark: { color: '#F7F7F7', fontSize: 12, fontWeight: '700', flexShrink: 0 },
  createEventRoleMetaDark: { color: '#F7F7F7', opacity: 0.8, fontSize: 12, fontWeight: '300', flex: 1 },
  createEventRoleActionsDark: { marginTop: 0, flexShrink: 0 },
  rolePreviewLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  rolePreviewAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rolePreviewAvatarLight: { backgroundColor: '#EDF0FC' },
  rolePreviewAvatarDark: { backgroundColor: '#203E75' },
  rolePreviewAvatarAssignedLight: { backgroundColor: '#EDF0FC' },
  rolePreviewAvatarAssignedDark: { backgroundColor: '#203E75' },
  rolePreviewAvatarText: { fontSize: 11, fontWeight: '700', color: '#bfdbfe' },
  rolePreviewName: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  rolePreviewNameLight: { color: '#232832' },
  rolePreviewNameDark: { color: '#F4F8FF' },
  rolePreviewMeta: { fontSize: 12 },
  rolePreviewMetaLight: { color: '#64748b' },
  rolePreviewMetaDark: { color: '#F4F8FF' },
  templateRoleEditor: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 10, marginBottom: 8 },
  templateRoleEditorLight: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#DBE2F9' },
  templateRoleEditorDark: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#12274D' },
  templateRoleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  templateRoleTaskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  templateTaskRow: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 6 },
  templateTaskRowLight: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#F7F7F7' },
  templateTaskRowDark: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#12274D' },
  templateTaskLabel: { fontSize: 12, fontWeight: '700' },
  countdownToggleRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  countdownToggleLabel: { flex: 1, fontSize: 13, fontWeight: '700' },
  templateDurationPickerRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  templateDurationSelectorWrap: { flex: 1 },
  templateDurationSelector: { minHeight: 72, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 10, paddingHorizontal: 8 },
  templateDurationSelectorActive: { borderColor: '#0EC3C9' },
  templateDurationDropdown: { marginTop: 6, borderWidth: 1, borderColor: 'rgba(6,18,41,0.1)', borderRadius: 8, maxHeight: 180, overflow: 'hidden' },
  templateDurationOption: { paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  templateDurationOptionActiveLight: { backgroundColor: '#DBE2F9' },
  templateDurationOptionActiveDark: { backgroundColor: '#203E75' },
  templateDurationOptionText: { fontSize: 14, fontWeight: '700' },
  templateDurationValue: { fontSize: 24, fontWeight: '700' },
  templateDurationLabel: { fontSize: 11, fontWeight: '600' },
  templateTaskSummaryCard: { gap: 6 },
  templateTaskSummaryMain: { flex: 1, gap: 4 },
  templateTaskSummaryDescription: { fontSize: 12, lineHeight: 16, paddingLeft: 10 },
  templateTaskSummaryLink: { fontSize: 12, fontWeight: '700', paddingLeft: 10 },
  templateTaskSummaryRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  templateTaskIconButton: { width: MINIMUM_TOUCH_TARGET, height: MINIMUM_TOUCH_TARGET, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
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
  eventRoleEditorScrollContent: { paddingBottom: DRAWER_KEYBOARD_CONTENT_GAP },
  createTemplateScrollContent: { paddingBottom: 16 },
  drawerLight: { backgroundColor: '#fff' },
  drawerDark: { backgroundColor: '#1A2540' },
  createEventDrawerLight: { backgroundColor: '#F7F7F7', borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16, maxHeight: '89%' },
  createEventDrawerDark: { backgroundColor: '#12274D', borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16, maxHeight: '89%' },
  drawerTitle: { fontWeight: '700', fontSize: 18 },
  drawerTitleLight: { color: '#232832' },
  drawerTitleDark: { color: '#F4F8FF' },
  createEventDrawerTitleLight: { color: '#121212', fontSize: 16 },
  createEventDrawerTitleDark: { color: '#F7F7F7', fontSize: 16 },
  drawerSub: { fontSize: 12, marginTop: 4 },
  drawerSubLight: { color: '#64748b' },
  drawerSubDark: { color: '#F4F8FF' },
  createEventDrawerSubLight: { color: '#121212', opacity: 0.8, marginTop: 8, fontWeight: '300' },
  createEventDrawerSubDark: { color: '#F7F7F7', opacity: 0.8, marginTop: 8, fontWeight: '300' },
  drawerList: { marginTop: 12 },
  drawerRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  drawerName: { fontWeight: '600' },
  drawerNameLight: { color: '#232832' },
  drawerNameDark: { color: '#F4F8FF' },
  drawerMeta: { marginTop: 4, fontSize: 12 },
  drawerMetaLight: { color: '#64748b' },
  drawerMetaDark: { color: '#F4F8FF' },
  roleEditorSummary: { marginTop: 10, marginBottom: 12, gap: 2 },
  roleTaskEditorList: { maxHeight: 280, marginBottom: 10 },
  inviteTeamCard: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10 },
  inviteTeamCardLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  inviteTeamCardDark: { borderColor: '#061229', backgroundColor: '#203E75' },
  inviteTeamHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  inviteTeamMembers: { marginTop: 8, gap: 6 },
  inviteWorkerLabel: { flex: 1 },
  inviteMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  inviteCheckbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: '#64748b', alignItems: 'center', justifyContent: 'center' },
  inviteCheckboxSelected: { backgroundColor: '#0EC3C9', borderColor: '#0EC3C9' },
  inviteCheckboxMark: { color: '#fff', fontWeight: '700', fontSize: 12, lineHeight: 14 },
  inviteSubmitButton: { marginTop: 12, backgroundColor: '#0EC3C9', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  inviteSubmitButtonText: { color: '#F7F7F7', fontWeight: '700' },
  inviteCloseButton: { marginTop: 8, borderRadius: 8, alignItems: 'center', paddingVertical: 10, width: '100%', borderWidth: 1 },
  inviteCloseButtonLight: { backgroundColor: '#F7F7F7', borderColor: 'rgba(6,18,41,0.1)' },
  inviteCloseButtonDark: { backgroundColor: '#12274D', borderColor: 'rgba(6,18,41,0.1)' },
  inviteCloseButtonText: { fontWeight: '700' },
  inviteCloseButtonTextLight: { color: '#121212' },
  inviteCloseButtonTextDark: { color: '#F7F7F7' },
  templateSection: { marginTop: 14, gap: 8 },
  createEventSectionLight: { marginTop: 14, gap: 8 },
  createEventSectionDark: { marginTop: 14, gap: 8 },
  templateHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  templateSelectTrigger: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  templateSelectTriggerLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  templateSelectTriggerDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  createEventSelectTriggerLight: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#EDF0FC', borderRadius: 8, minHeight: 54 },
  createEventSelectTriggerDark: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#203E75', borderRadius: 8, minHeight: 54 },
  templateLabel: { fontSize: 13, fontWeight: '700', flex: 1 },
  createEventFieldLabelLight: { color: '#121212', fontSize: 12 },
  createEventFieldLabelDark: { color: '#F7F7F7', fontSize: 12 },
  templateAddButton: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  templateAddButtonLight: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  templateAddButtonDark: { borderColor: '#001A4D', backgroundColor: '#00133D' },
  createEventAddPillLight: { borderColor: '#0EC3C9', backgroundColor: '#0EC3C9', paddingHorizontal: 12, paddingVertical: 4 },
  createEventAddPillDark: { borderColor: '#0EC3C9', backgroundColor: '#0EC3C9', paddingHorizontal: 12, paddingVertical: 4 },
  templateAddButtonText: { fontSize: 12, fontWeight: '700' },
  templateAddButtonTextLight: { color: '#1d4ed8' },
  templateAddButtonTextDark: { color: '#F4F8FF' },
  createEventAddPillTextLight: { color: '#F7F7F7' },
  createEventAddPillTextDark: { color: '#F7F7F7' },
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
  createEventTemplateNameLight: { color: '#121212', fontSize: 16, fontWeight: '400' },
  createEventTemplateNameDark: { color: '#F7F7F7', fontSize: 16, fontWeight: '400' },
  templateBadge: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  templateBadgeSelected: { color: '#bfdbfe' },
  templateMeta: { marginTop: 4, fontSize: 12 },
  templateMetaLight: { color: '#475569' },
  templateMetaDark: { color: '#F4F8FF' },
  createEventTemplateMetaLight: { color: '#121212', opacity: 0.8, marginTop: 2, fontWeight: '300' },
  createEventTemplateMetaDark: { color: '#F7F7F7', opacity: 0.8, marginTop: 2, fontWeight: '300' },
  templateActionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  templateActionButton: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  templateActionButtonLight: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  templateActionButtonDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  templateActionButtonDisabled: { opacity: 0.45 },
  templateActionButtonText: { fontSize: 12, fontWeight: '700' },
  templateActionButtonTextLight: { color: '#1d4ed8' },
  templateActionButtonTextDark: { color: '#F4F8FF' },
  createEventEditButtonLight: { borderColor: '#F98D2F', backgroundColor: '#DBE2F9', paddingHorizontal: 12, paddingVertical: 8 },
  createEventEditButtonTextLight: { color: '#F98D2F' },
  createEventDeleteButtonLight: { borderColor: '#F98D2F', backgroundColor: '#F98D2F', paddingHorizontal: 12, paddingVertical: 8 },
  createEventDeleteButtonTextLight: { color: '#F7F7F7' },
  createEventEditButtonDark: { borderColor: '#F98D2F', backgroundColor: '#12274D', paddingHorizontal: 12, paddingVertical: 8 },
  createEventEditButtonTextDark: { color: '#F98D2F' },
  createEventDeleteButtonDark: { borderColor: '#F98D2F', backgroundColor: '#F98D2F', paddingHorizontal: 12, paddingVertical: 8 },
  createEventDeleteButtonTextDark: { color: '#12274D' },
  templateDeleteButtonLight: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  templateDeleteButtonDark: { borderColor: '#F98D2F', backgroundColor: '#00133D' },
  templateDeleteButtonTextLight: { color: '#b91c1c' },
  templateDeleteButtonTextDark: { color: '#F4F8FF' },
  formField: { marginTop: 14, gap: 8 },
  templateInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  templateTextArea: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 88, textAlignVertical: 'top' },
  templateInputLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc', color: '#232832' },
  templateInputDark: { borderColor: '#001A4D', backgroundColor: '#1A2540', color: '#F4F8FF' },
  createEventFieldInputLight: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#EDF0FC', borderRadius: 8, minHeight: 44 },
  createEventFieldInputDark: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#203E75', borderRadius: 8, minHeight: 44 },
  createEventIconInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  createEventInputValueLight: { color: '#121212', fontSize: 12, fontWeight: '700' },
  createEventInputPlaceholderLight: { color: 'rgba(33,33,33,0.5)', fontSize: 12, fontWeight: '700' },
  createEventTextInputLight: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#EDF0FC', color: '#121212', borderRadius: 8, minHeight: 44, fontSize: 12, fontWeight: '700' },
  createEventTextAreaLight: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#EDF0FC', color: '#121212', borderRadius: 8, minHeight: 76, fontSize: 12, fontWeight: '700' },
  createEventInputValueDark: { color: '#F7F7F7', fontSize: 12, fontWeight: '700' },
  createEventInputPlaceholderDark: { color: 'rgba(247,247,247,0.33)', fontSize: 12, fontWeight: '700' },
  createEventTextInputDark: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#203E75', color: '#F7F7F7', borderRadius: 8, minHeight: 44, fontSize: 12, fontWeight: '700' },
  createEventTextAreaDark: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#203E75', color: '#F7F7F7', borderRadius: 8, minHeight: 76, fontSize: 12, fontWeight: '700' },
  locationAutocompleteWrap: { gap: 8 },
  locationAutocompleteHint: { fontSize: 12, fontWeight: '600' },
  locationAutocompleteError: { color: '#dc2626' },
  locationSuggestions: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  locationSuggestionsLight: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#F7F7F7' },
  locationSuggestionsDark: { borderColor: 'rgba(247,247,247,0.14)', backgroundColor: '#12274D' },
  locationSuggestionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8 },
  locationSuggestionTextWrap: { flex: 1, minWidth: 0 },
  locationSuggestionTitle: { fontSize: 12, fontWeight: '800' },
  locationSuggestionMeta: { marginTop: 2, fontSize: 11 },
  drawerClose: { marginTop: 12, backgroundColor: '#1d4ed8', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerCloseDisabled: { opacity: 0.45 },
  drawerCloseText: { color: '#fff', fontWeight: '700' },
  createEventPrimaryButtonLight: { marginTop: 12, backgroundColor: '#0EC3C9', borderRadius: 8, alignItems: 'center', paddingVertical: 10, width: '100%' },
  createEventPrimaryButtonDark: { marginTop: 12, backgroundColor: '#0EC3C9', borderRadius: 8, alignItems: 'center', paddingVertical: 10, width: '100%' },
  drawerKeyboardDismiss: { marginTop: 12, borderWidth: 1, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
  drawerSecondaryButton: { marginTop: 10, borderWidth: 1, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerSecondaryButtonLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  drawerSecondaryButtonDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  drawerSecondaryButtonText: { fontWeight: '700' },
  drawerSecondaryButtonTextLight: { color: '#334155' },
  drawerSecondaryButtonTextDark: { color: '#F4F8FF' },
  createEventCancelButtonLight: { marginTop: 10, alignItems: 'center', paddingVertical: 12, width: '100%' },
  createEventCancelButtonTextLight: { color: '#121212', fontWeight: '700', fontSize: 12 },
  createEventCancelButtonDark: { marginTop: 10, alignItems: 'center', paddingVertical: 12, width: '100%' },
  createEventCancelButtonTextDark: { color: '#F7F7F7', fontWeight: '700', fontSize: 12 },
});
