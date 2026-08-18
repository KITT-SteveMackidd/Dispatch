import { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Alert, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/context/session';
import { createOrganisationForManager, loadRoleAssignmentExport, markUserNotificationsRead, UserNotification, watchUserNotifications } from '@/services/dispatch';
import { useThemeMode } from '@/context/theme';
import { headerLogoSource } from '@/constants/branding';
import { buildWorkerRoleExport, shareWorkerRoleSpreadsheet } from '@/lib/worker-role-export';
import { canResetDispatchDatabase, resetDispatchDatabase } from '@/lib/admin-database-reset';
import { DISPATCH_PRIVACY_URL, DISPATCH_SUPPORT_URL } from '@/constants/legal';
import {
  KeyboardAwareDrawer,
  KeyboardAwareDrawerScrollView,
  KeyboardAwareDrawerTextInput,
} from '@/components/KeyboardAwareDrawer';

const lightEventsLogoSource = headerLogoSource;
const darkEventsLogoSource = headerLogoSource;

export default function ProfileScreen() {
  const { profile, authUser, deleteAccount, refreshProfile, signOut } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDarkMode = resolvedThemeMode === 'dark';
  const drawerSurfaceColor = isDarkMode ? '#12274D' : '#F7F7F7';
  const canManageTemplates = profile?.role === 'manager';
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [organisationModalOpen, setOrganisationModalOpen] = useState(false);
  const [organisationName, setOrganisationName] = useState('');
  const [creatingOrganisation, setCreatingOrganisation] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [resettingDatabase, setResettingDatabase] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportStartDate, setExportStartDate] = useState(startOfCurrentMonth);
  const [exportEndDate, setExportEndDate] = useState(() => new Date());
  const [activeDateField, setActiveDateField] = useState<'start' | 'end' | null>(null);
  const [exportingSpreadsheet, setExportingSpreadsheet] = useState(false);
  const organisationPromptShownRef = useRef<string | null>(null);
  const isManagerWithoutOrganisation = profile?.role === 'manager' && !profile.organizationId;
  const displayName = useMemo(
    () => getPreferredDisplayName(profile?.displayName, authUser?.displayName, authUser?.email),
    [authUser?.displayName, authUser?.email, profile?.displayName]
  );
  const canResetDatabase = canResetDispatchDatabase(authUser?.email);

  useEffect(() => {
    if (!profile?.uid) {
      setNotifications([]);
      return;
    }

    return watchUserNotifications(profile.uid, setNotifications);
  }, [profile?.uid]);

  useEffect(() => {
    if (!profile?.uid || !isManagerWithoutOrganisation) return;
    if (organisationPromptShownRef.current === profile.uid) return;

    organisationPromptShownRef.current = profile.uid;
    Alert.alert(
      'No organisation invite yet',
      'You have not been invited to an organisation. If you are a part of an existing organisation please wait to be invited by another manager. If you want to create a new organization you can click create.',
      [
        { text: 'Wait', style: 'cancel' },
        { text: 'Create', onPress: () => setOrganisationModalOpen(true) },
      ]
    );
  }, [isManagerWithoutOrganisation, profile?.uid]);

  const unreadIds = useMemo(() => notifications.filter((item) => !item.read).map((item) => item.id), [notifications]);

  const openNotifications = async () => {
    setNotificationsOpen(true);
    if (!profile?.uid || !unreadIds.length) return;

    const idsToMark = [...unreadIds];
    setNotifications((prev) => prev.map((item) => (idsToMark.includes(item.id) ? { ...item, read: true } : item)));

    try {
      await markUserNotificationsRead({ userId: profile.uid, notificationIds: idsToMark });
    } catch {
      setNotifications((prev) => prev.map((item) => (idsToMark.includes(item.id) ? { ...item, read: false } : item)));
    }
  };

  const openPublicPage = async (label: string, url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(`Unable to open ${label}`, url);
    }
  };

  const createOrganisation = async () => {
    if (!profile?.uid || !organisationName.trim()) {
      Alert.alert('Organization name required', 'Enter a name for the organization.');
      return;
    }

    try {
      setCreatingOrganisation(true);
      await createOrganisationForManager({ managerId: profile.uid, name: organisationName.trim() });
      await refreshProfile();
      setOrganisationModalOpen(false);
      setOrganisationName('');
      Alert.alert('Organization created', 'Your organization is ready.');
    } catch (error) {
      Alert.alert('Unable to create organization', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setCreatingOrganisation(false);
    }
  };

  const confirmDeleteAccount = () => {
    if (!profile?.uid || deletingAccount) return;

    const managerSoleOrgMessage = profile.role === 'manager' && profile.organizationId
      ? ' If you are the only manager in this organization, the organization will also be deleted and workers will no longer belong to it.'
      : '';

    Alert.alert(
      'Delete account?',
      `This permanently deletes your Dispatch account, messages, invitations, notifications, assignments, and uploaded files. This cannot be undone.${managerSoleOrgMessage}${usesAppleProvider(authUser) ? ' Apple will ask you to confirm your identity before deletion begins.' : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingAccount(true);
              await deleteAccount();
              router.replace('/(auth)/signin');
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unable to delete account.';
              const needsRecentLogin = /recent|requires-recent-login|auth\/requires-recent-login/i.test(message);
              Alert.alert(
                'Unable to delete account',
                needsRecentLogin ? 'For your security, please sign out, sign back in, and try deleting your account again.' : message
              );
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
  };

  const confirmDatabaseReset = () => {
    if (!canResetDatabase || resettingDatabase) return;

    Alert.alert(
      'Clear all Dispatch data?',
      'This permanently deletes every Firestore collection and every Firebase user account. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Final confirmation',
              'All Dispatch data and accounts, including your own account, will be permanently deleted.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete everything',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      setResettingDatabase(true);
                      await resetDispatchDatabase();
                      await signOut().catch(() => undefined);
                      router.replace('/(auth)/signin');
                      Alert.alert('Dispatch cleared', 'The database and all user accounts were deleted.');
                    } catch (error) {
                      Alert.alert(
                        'Unable to clear Dispatch',
                        error instanceof Error ? error.message : 'The database reset did not complete.'
                      );
                    } finally {
                      setResettingDatabase(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const onExportDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') setActiveDateField(null);
    if (event.type === 'dismissed' || !selectedDate || !activeDateField) return;

    if (activeDateField === 'start') {
      setExportStartDate(selectedDate);
      if (selectedDate > exportEndDate) setExportEndDate(selectedDate);
      return;
    }

    setExportEndDate(selectedDate);
    if (selectedDate < exportStartDate) setExportStartDate(selectedDate);
  };

  const exportWorkerRoles = async () => {
    if (!profile?.uid || profile.role !== 'manager') return;

    try {
      setExportingSpreadsheet(true);
      const data = await loadRoleAssignmentExport({
        managerId: profile.uid,
        organizationId: profile.organizationId,
        startDate: exportStartDate,
        endDate: exportEndDate,
      });
      const report = buildWorkerRoleExport(data.events, data.workers);
      await shareWorkerRoleSpreadsheet({ report, startDate: exportStartDate, endDate: exportEndDate });
      setExportModalOpen(false);
      setActiveDateField(null);
    } catch (error) {
      Alert.alert('Unable to export spreadsheet', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setExportingSpreadsheet(false);
    }
  };

  const closeExportModal = () => {
    if (exportingSpreadsheet) return;
    setExportModalOpen(false);
    setActiveDateField(null);
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      router.replace('/(auth)/signin');
    } catch (error) {
      console.warn('Unable to sign out safely.', error);
      Alert.alert(
        'Unable to sign out',
        'Dispatch could not complete sign-out safely. Check your connection and try again.'
      );
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <View style={[styles.topHeader, isDarkMode ? styles.topHeaderDark : styles.topHeaderLight, { paddingTop: insets.top + 16 }]}>
        <Image source={isDarkMode ? darkEventsLogoSource : lightEventsLogoSource} style={isDarkMode ? styles.darkLogo : styles.lightLogo} resizeMode="contain" />
        <Pressable
          disabled={signingOut}
          onPress={() => void handleSignOut()}
          style={[styles.signOutButton, isDarkMode ? styles.signOutButtonDark : styles.signOutButtonLight]}>
          <Text style={[styles.signOutButtonText, isDarkMode ? styles.signOutButtonTextDark : styles.signOutButtonTextLight]}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Text>
        </Pressable>
      </View>

      <ScrollView style={styles.profileScroll} contentContainerStyle={styles.profileContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
          <View style={[styles.avatar, isDarkMode ? styles.avatarDark : styles.avatarLight]}>
            <Text style={styles.avatarText}>{displayName.slice(0, 1).toUpperCase()}</Text>
          </View>
          <Text style={[styles.name, isDarkMode ? styles.nameDark : styles.nameLight]}>{displayName}</Text>
          <Text style={[styles.email, isDarkMode ? styles.emailDark : styles.emailLight]}>{authUser?.email || 'No email found'}</Text>
          {usesAppleProvider(authUser) ? (
            <Text style={[styles.inviteEmailHint, isDarkMode ? styles.emailDark : styles.emailLight]}>
              Apple may protect your address with Private Relay. Secure invitation links still connect to this account.
            </Text>
          ) : null}
          <Text style={[styles.email, isDarkMode ? styles.emailDark : styles.emailLight]}>
            {profile?.organizationName || 'No organisation yet'}
          </Text>
        </View>

        {isManagerWithoutOrganisation ? (
          <Pressable style={[styles.row, styles.createOrganisationRow]} onPress={() => setOrganisationModalOpen(true)}>
            <Text style={styles.createOrganisationText}>Create Organization</Text>
          </Pressable>
        ) : null}

      <Pressable style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={() => router.push('/account-settings')}>
        <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>Account Settings</Text>
      </Pressable>
      <Pressable style={[styles.row, styles.iconRow, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={() => router.push('/invite/index')}>
        <MaterialIcons name="vpn-key" size={22} color={isDarkMode ? '#0EC3C9' : '#0B7D82'} />
        <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>Use Invitation Code</Text>
      </Pressable>
      {canManageTemplates ? (
        <Pressable
          style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]}
          onPress={() => router.push({ pathname: '/(tabs)', params: { openTemplateDrawer: '1' } })}>
          <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>Manage Event Templates</Text>
        </Pressable>
      ) : null}
      {canManageTemplates ? (
        <Pressable
          accessibilityRole="button"
          style={[styles.row, styles.iconRow, isDarkMode ? styles.rowDark : styles.rowLight]}
          onPress={() => setExportModalOpen(true)}>
          <MaterialIcons name="file-download" size={22} color={isDarkMode ? '#0EC3C9' : '#0B7D82'} />
          <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>Export Worker Roles</Text>
        </Pressable>
      ) : null}
      <Pressable style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={openNotifications}>
        <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>
          Notifications {unreadIds.length ? `(${unreadIds.length} new)` : ''}
        </Text>
      </Pressable>
      <Pressable style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={() => void openPublicPage('Help & Support', DISPATCH_SUPPORT_URL)}>
        <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>Help & Support</Text>
      </Pressable>
      <Pressable style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={() => void openPublicPage('Privacy Policy', DISPATCH_PRIVACY_URL)}>
        <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>Privacy Policy</Text>
      </Pressable>
      {canResetDatabase ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear all Dispatch data and user accounts"
          style={[styles.row, isDarkMode ? styles.resetRowDark : styles.resetRowLight, resettingDatabase && styles.disabled]}
          onPress={confirmDatabaseReset}
          disabled={resettingDatabase}>
          <Text style={[styles.rowText, isDarkMode ? styles.resetRowTextDark : styles.resetRowTextLight]}>
            {resettingDatabase ? 'Clearing Dispatch...' : 'Clear Database & User Accounts'}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        style={[styles.row, isDarkMode ? styles.deleteRowDark : styles.deleteRowLight, deletingAccount && styles.disabled]}
        onPress={confirmDeleteAccount}
        disabled={deletingAccount}>
        <Text style={[styles.rowText, isDarkMode ? styles.deleteRowTextDark : styles.deleteRowTextLight]}>
          {deletingAccount ? 'Deleting account...' : 'Delete Account'}
        </Text>
      </Pressable>
      </ScrollView>

      <KeyboardAwareDrawer
        visible={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        backgroundColor={drawerSurfaceColor}
        surfaceStyle={[styles.modalCard, isDarkMode ? styles.cardDark : styles.cardLight]}>
            <Text style={[styles.name, isDarkMode ? styles.nameDark : styles.nameLight]}>Notifications</Text>
            <KeyboardAwareDrawerScrollView style={styles.modalScroll}>
              {notifications.length ? notifications.map((notification) => (
                <View key={notification.id} style={styles.notificationRow}>
                  <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>{notification.title}</Text>
                  <Text style={[styles.email, isDarkMode ? styles.emailDark : styles.emailLight]}>{notification.body}</Text>
                </View>
              )) : <Text style={[styles.email, isDarkMode ? styles.emailDark : styles.emailLight]}>No notifications yet.</Text>}
            </KeyboardAwareDrawerScrollView>
            <Pressable style={styles.closeBtn} onPress={() => setNotificationsOpen(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
      </KeyboardAwareDrawer>

      <KeyboardAwareDrawer
        visible={organisationModalOpen}
        onClose={() => setOrganisationModalOpen(false)}
        backgroundColor={drawerSurfaceColor}
        surfaceStyle={[styles.modalCard, isDarkMode ? styles.cardDark : styles.cardLight]}>
        <KeyboardAwareDrawerScrollView>
            <Text style={[styles.name, isDarkMode ? styles.nameDark : styles.nameLight]}>Create Organization</Text>
            <Text style={[styles.email, isDarkMode ? styles.emailDark : styles.emailLight]}>
              Create a new organization for your managers, workers, and teams.
            </Text>
            <KeyboardAwareDrawerTextInput
              value={organisationName}
              onChangeText={setOrganisationName}
              placeholder="Organization name"
              placeholderTextColor={isDarkMode ? '#94A3B8' : '#94a3b8'}
              style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
            />
            <Pressable style={[styles.closeBtn, creatingOrganisation && styles.disabled]} onPress={createOrganisation} disabled={creatingOrganisation}>
              <Text style={styles.closeBtnText}>{creatingOrganisation ? 'Creating...' : 'Create'}</Text>
            </Pressable>
            <Pressable style={[styles.secondaryBtn, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={() => setOrganisationModalOpen(false)}>
              <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>Cancel</Text>
            </Pressable>
        </KeyboardAwareDrawerScrollView>
      </KeyboardAwareDrawer>

      <KeyboardAwareDrawer
        visible={exportModalOpen}
        onClose={closeExportModal}
        backgroundColor={drawerSurfaceColor}
        surfaceStyle={[styles.modalCard, isDarkMode ? styles.cardDark : styles.cardLight]}>
        <KeyboardAwareDrawerScrollView>
            <Text style={[styles.name, isDarkMode ? styles.nameDark : styles.nameLight]}>Export Worker Roles</Text>
            <Text style={[styles.email, isDarkMode ? styles.emailDark : styles.emailLight]}>
              Choose the event date range to include in the spreadsheet.
            </Text>

            <View style={styles.dateFields}>
              <DateField
                label="Start date"
                value={exportStartDate}
                active={activeDateField === 'start'}
                isDarkMode={isDarkMode}
                onPress={() => setActiveDateField('start')}
              />
              <DateField
                label="End date"
                value={exportEndDate}
                active={activeDateField === 'end'}
                isDarkMode={isDarkMode}
                onPress={() => setActiveDateField('end')}
              />
            </View>

            {activeDateField ? (
              <DateTimePicker
                value={activeDateField === 'start' ? exportStartDate : exportEndDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                themeVariant={isDarkMode ? 'dark' : 'light'}
                onChange={onExportDateChange}
              />
            ) : null}

            <Pressable
              style={[styles.closeBtn, exportingSpreadsheet && styles.disabled]}
              onPress={exportWorkerRoles}
              disabled={exportingSpreadsheet}>
              <View style={styles.exportButtonContent}>
                <MaterialIcons name="file-download" size={21} color="#061229" />
                <Text style={styles.closeBtnText}>{exportingSpreadsheet ? 'Preparing...' : 'Export Spreadsheet'}</Text>
              </View>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, isDarkMode ? styles.rowDark : styles.rowLight]}
              onPress={closeExportModal}>
              <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>Cancel</Text>
            </Pressable>
        </KeyboardAwareDrawerScrollView>
      </KeyboardAwareDrawer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },
  containerLight: { backgroundColor: '#DBE2F9' },
  containerDark: { backgroundColor: '#061229' },
  topHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16 },
  topHeaderLight: { backgroundColor: '#DBE2F9' },
  topHeaderDark: { backgroundColor: '#061229' },
  lightLogo: { width: 64, height: 64 },
  darkLogo: { width: 64, height: 64 },
  signOutButton: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  signOutButtonLight: { backgroundColor: '#DBE2F9' },
  signOutButtonDark: { backgroundColor: '#12274D' },
  signOutButtonText: { fontWeight: '700', fontSize: 12 },
  signOutButtonTextLight: { color: '#334155' },
  signOutButtonTextDark: { color: '#F4F8FF' },
  profileScroll: { flex: 1 },
  profileContent: { paddingBottom: 8 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 16 },
  cardLight: { backgroundColor: '#F7F7F7', borderColor: '#F7F7F7' },
  cardDark: { backgroundColor: '#12274D', borderColor: '#12274D' },
  avatar: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#F98D2F' },
  avatarLight: { backgroundColor: '#F7F7F7' },
  avatarDark: { backgroundColor: '#12274D' },
  avatarText: { color: '#F98D2F', fontSize: 28, fontWeight: '700' },
  name: { marginTop: 10, fontSize: 22, fontWeight: '700' },
  nameLight: { color: '#232832' },
  nameDark: { color: '#F4F8FF' },
  email: { marginTop: 4 },
  inviteEmailHint: { marginTop: 4, fontSize: 12, fontWeight: '600' },
  emailLight: { color: '#64748b' },
  emailDark: { color: '#F4F8FF' },
  row: { borderWidth: 1, borderRadius: 10, padding: 16, marginBottom: 16 },
  rowLight: { backgroundColor: '#F7F7F7', borderColor: '#F7F7F7' },
  rowDark: { backgroundColor: '#12274D', borderColor: '#12274D' },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { fontWeight: '600' },
  rowTextLight: { color: '#1e293b' },
  rowTextDark: { color: '#F4F8FF' },
  deleteRowLight: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  deleteRowDark: { backgroundColor: '#2f1018', borderColor: '#7f1d1d' },
  deleteRowTextLight: { color: '#b91c1c' },
  deleteRowTextDark: { color: '#fecaca' },
  resetRowLight: { backgroundColor: '#fff7ed', borderColor: '#fdba74' },
  resetRowDark: { backgroundColor: '#2b1909', borderColor: '#c2410c' },
  resetRowTextLight: { color: '#c2410c' },
  resetRowTextDark: { color: '#fed7aa' },
  createOrganisationRow: { backgroundColor: '#0EC3C9', borderColor: '#0EC3C9' },
  createOrganisationText: { color: '#061229', fontWeight: '700' },
  input: { marginTop: 14, padding: 13, borderRadius: 12, borderWidth: 1 },
  inputLight: { backgroundColor: '#f8fafc', color: '#232832', borderColor: '#e2e8f0' },
  inputDark: { backgroundColor: '#1A2540', color: '#F4F8FF', borderColor: '#001A4D' },
  modalCard: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '70%' },
  modalScroll: { marginTop: 10 },
  dateFields: { flexDirection: 'row', gap: 10, marginTop: 16 },
  dateField: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 12 },
  dateFieldLight: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' },
  dateFieldDark: { backgroundColor: '#1A2540', borderColor: '#38517E' },
  dateFieldActive: { borderColor: '#0EC3C9', borderWidth: 2, padding: 11 },
  dateLabel: { color: '#64748B', fontSize: 12, fontWeight: '600', marginBottom: 5 },
  dateLabelDark: { color: '#CBD5E1' },
  dateValue: { color: '#232832', fontWeight: '700' },
  dateValueDark: { color: '#F4F8FF' },
  notificationRow: { borderBottomWidth: 1, borderBottomColor: '#334155', paddingVertical: 10 },
  closeBtn: { marginTop: 12, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: '#0EC3C9' },
  closeBtnText: { color: '#061229', fontWeight: '700' },
  exportButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secondaryBtn: { marginTop: 10, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  disabled: { opacity: 0.65 },
});

function DateField(props: {
  label: string;
  value: Date;
  active: boolean;
  isDarkMode: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label}: ${formatDisplayDate(props.value)}`}
      onPress={props.onPress}
      style={[
        styles.dateField,
        props.isDarkMode ? styles.dateFieldDark : styles.dateFieldLight,
        props.active && styles.dateFieldActive,
      ]}>
      <Text style={[styles.dateLabel, props.isDarkMode && styles.dateLabelDark]}>{props.label}</Text>
      <Text style={[styles.dateValue, props.isDarkMode && styles.dateValueDark]}>{formatDisplayDate(props.value)}</Text>
    </Pressable>
  );
}

function startOfCurrentMonth() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), 1);
}

function formatDisplayDate(value: Date) {
  return value.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getPreferredDisplayName(profileName?: string | null, authName?: string | null, email?: string | null) {
  const relayEmail = isApplePrivateRelayEmail(email);
  const emailName = displayNameFromEmail(email);
  const profileDisplayName = cleanName(profileName);
  if (profileDisplayName && !(relayEmail && profileDisplayName.toLowerCase() === emailName.toLowerCase())) {
    return profileDisplayName;
  }

  const authDisplayName = cleanName(authName);
  if (authDisplayName && !(relayEmail && authDisplayName.toLowerCase() === emailName.toLowerCase())) {
    return authDisplayName;
  }

  if (relayEmail) return 'Dispatch User';
  return emailName || 'Dispatch User';
}

function cleanName(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === 'dispatch user') return '';
  return trimmed;
}

function displayNameFromEmail(email?: string | null) {
  const local = email?.trim().toLowerCase().split('@')[0] || '';
  const withoutAlias = local.split('+')[0];
  const words = withoutAlias.split(/[._-]+/).filter(Boolean);
  if (!words.length) return '';
  return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(' ');
}

function isApplePrivateRelayEmail(email?: string | null) {
  const domain = email?.trim().toLowerCase().split('@')[1] || '';
  return domain === 'privaterelay.appleid.com' || domain === 'private.icloud.com';
}

function usesAppleProvider(user?: { providerData?: Array<{ providerId?: string }> } | null) {
  return Boolean(user?.providerData?.some((provider) => provider.providerId === 'apple.com'));
}
