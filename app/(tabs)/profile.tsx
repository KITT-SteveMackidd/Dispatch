import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/context/session';
import { createOrganisationForManager, markUserNotificationsRead, UserNotification, watchUserNotifications } from '@/services/dispatch';
import { useThemeMode } from '@/context/theme';
import { headerLogoSource } from '@/constants/branding';

const lightEventsLogoSource = headerLogoSource;
const darkEventsLogoSource = headerLogoSource;

export default function ProfileScreen() {
  const { profile, authUser, deleteAccount, refreshProfile, signOut } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDarkMode = resolvedThemeMode === 'dark';
  const canManageTemplates = profile?.role === 'manager';
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [organisationModalOpen, setOrganisationModalOpen] = useState(false);
  const [organisationName, setOrganisationName] = useState('');
  const [creatingOrganisation, setCreatingOrganisation] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const organisationPromptShownRef = useRef<string | null>(null);
  const isManagerWithoutOrganisation = profile?.role === 'manager' && !profile.organizationId;
  const displayName = useMemo(
    () => getPreferredDisplayName(profile?.displayName, authUser?.displayName, authUser?.email),
    [authUser?.displayName, authUser?.email, profile?.displayName]
  );

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

  const stub = (label: string) => Alert.alert(label, 'This panel is a UI placeholder for now.');

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
      `This permanently deletes your Dispatch account.${managerSoleOrgMessage}`,
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

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <View style={[styles.topHeader, isDarkMode ? styles.topHeaderDark : styles.topHeaderLight, { paddingTop: insets.top + 16 }]}>
        <Image source={isDarkMode ? darkEventsLogoSource : lightEventsLogoSource} style={isDarkMode ? styles.darkLogo : styles.lightLogo} resizeMode="contain" />
        <Pressable
          onPress={() => {
            void signOut();
            router.replace('/(auth)/signin');
          }}
          style={[styles.signOutButton, isDarkMode ? styles.signOutButtonDark : styles.signOutButtonLight]}>
          <Text style={[styles.signOutButtonText, isDarkMode ? styles.signOutButtonTextDark : styles.signOutButtonTextLight]}>Sign out</Text>
        </Pressable>
      </View>

      <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
        <View style={[styles.avatar, isDarkMode ? styles.avatarDark : styles.avatarLight]}>
          <Text style={styles.avatarText}>{displayName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={[styles.name, isDarkMode ? styles.nameDark : styles.nameLight]}>{displayName}</Text>
        <Text style={[styles.email, isDarkMode ? styles.emailDark : styles.emailLight]}>{authUser?.email || 'No email found'}</Text>
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
      {canManageTemplates ? (
        <Pressable
          style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]}
          onPress={() => router.push({ pathname: '/(tabs)', params: { openTemplateDrawer: '1' } })}>
          <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>Manage Event Templates</Text>
        </Pressable>
      ) : null}
      <Pressable style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={openNotifications}>
        <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>
          Notifications {unreadIds.length ? `(${unreadIds.length} new)` : ''}
        </Text>
      </Pressable>
      <Pressable style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={() => stub('Help & Support')}>
        <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>Help & Support</Text>
      </Pressable>
      <Pressable
        style={[styles.row, isDarkMode ? styles.deleteRowDark : styles.deleteRowLight, deletingAccount && styles.disabled]}
        onPress={confirmDeleteAccount}
        disabled={deletingAccount}>
        <Text style={[styles.rowText, isDarkMode ? styles.deleteRowTextDark : styles.deleteRowTextLight]}>
          {deletingAccount ? 'Deleting account...' : 'Delete Account'}
        </Text>
      </Pressable>

      <Modal visible={notificationsOpen} animationType="slide" transparent onRequestClose={() => setNotificationsOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setNotificationsOpen(false)}>
          <Pressable style={[styles.modalCard, isDarkMode ? styles.cardDark : styles.cardLight]} onPress={() => null}>
            <Text style={[styles.name, isDarkMode ? styles.nameDark : styles.nameLight]}>Notifications</Text>
            <ScrollView style={styles.modalScroll}>
              {notifications.length ? notifications.map((notification) => (
                <View key={notification.id} style={styles.notificationRow}>
                  <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>{notification.title}</Text>
                  <Text style={[styles.email, isDarkMode ? styles.emailDark : styles.emailLight]}>{notification.body}</Text>
                </View>
              )) : <Text style={[styles.email, isDarkMode ? styles.emailDark : styles.emailLight]}>No notifications yet.</Text>}
            </ScrollView>
            <Pressable style={styles.closeBtn} onPress={() => setNotificationsOpen(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={organisationModalOpen} animationType="slide" transparent onRequestClose={() => setOrganisationModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOrganisationModalOpen(false)}>
          <Pressable style={[styles.modalCard, isDarkMode ? styles.cardDark : styles.cardLight]} onPress={() => null}>
            <Text style={[styles.name, isDarkMode ? styles.nameDark : styles.nameLight]}>Create Organization</Text>
            <Text style={[styles.email, isDarkMode ? styles.emailDark : styles.emailLight]}>
              Create a new organization for your managers, workers, and teams.
            </Text>
            <TextInput
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
          </Pressable>
        </Pressable>
      </Modal>
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
  emailLight: { color: '#64748b' },
  emailDark: { color: '#F4F8FF' },
  row: { borderWidth: 1, borderRadius: 10, padding: 16, marginBottom: 16 },
  rowLight: { backgroundColor: '#F7F7F7', borderColor: '#F7F7F7' },
  rowDark: { backgroundColor: '#12274D', borderColor: '#12274D' },
  rowText: { fontWeight: '600' },
  rowTextLight: { color: '#1e293b' },
  rowTextDark: { color: '#F4F8FF' },
  deleteRowLight: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  deleteRowDark: { backgroundColor: '#2f1018', borderColor: '#7f1d1d' },
  deleteRowTextLight: { color: '#b91c1c' },
  deleteRowTextDark: { color: '#fecaca' },
  createOrganisationRow: { backgroundColor: '#0EC3C9', borderColor: '#0EC3C9' },
  createOrganisationText: { color: '#061229', fontWeight: '700' },
  input: { marginTop: 14, padding: 13, borderRadius: 12, borderWidth: 1 },
  inputLight: { backgroundColor: '#f8fafc', color: '#232832', borderColor: '#e2e8f0' },
  inputDark: { backgroundColor: '#1A2540', color: '#F4F8FF', borderColor: '#001A4D' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.35)' },
  modalCard: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '70%' },
  modalScroll: { marginTop: 10 },
  notificationRow: { borderBottomWidth: 1, borderBottomColor: '#334155', paddingVertical: 10 },
  closeBtn: { marginTop: 12, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: '#0EC3C9' },
  closeBtnText: { color: '#061229', fontWeight: '700' },
  secondaryBtn: { marginTop: 10, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  disabled: { opacity: 0.65 },
});

function getPreferredDisplayName(profileName?: string | null, authName?: string | null, email?: string | null) {
  const profileDisplayName = cleanName(profileName);
  if (profileDisplayName) return profileDisplayName;

  const authDisplayName = cleanName(authName);
  if (authDisplayName) return authDisplayName;

  const emailName = displayNameFromEmail(email);
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
