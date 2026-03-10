import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { markUserNotificationsRead, UserNotification, watchUserNotifications } from '@/services/dispatch';
import { useThemeMode } from '@/context/theme';

export default function ProfileScreen() {
  const { profile, authUser } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const router = useRouter();
  const isDarkMode = resolvedThemeMode === 'dark';
  const canManageTemplates = profile?.role === 'manager';
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);

  useEffect(() => {
    if (!profile?.uid) {
      setNotifications([]);
      return;
    }

    return watchUserNotifications(profile.uid, setNotifications);
  }, [profile?.uid]);

  const unreadIds = useMemo(() => notifications.filter((item) => !item.read).map((item) => item.id), [notifications]);

  const openNotifications = async () => {
    setNotificationsOpen(true);
    if (!profile?.uid || !unreadIds.length) return;

    try {
      await markUserNotificationsRead({ userId: profile.uid, notificationIds: unreadIds });
    } catch {
      // noop
    }
  };

  const stub = (label: string) => Alert.alert(label, 'This panel is a UI placeholder for now.');

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(profile?.displayName || 'U').slice(0, 1).toUpperCase()}</Text></View>
        <Text style={[styles.name, isDarkMode ? styles.nameDark : styles.nameLight]}>{profile?.displayName || 'Dispatch User'}</Text>
        <Text style={[styles.email, isDarkMode ? styles.emailDark : styles.emailLight]}>{authUser?.email || 'No email found'}</Text>
      </View>

      <Pressable style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={() => router.push('/account-settings')}><Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>⚙️  Account Settings</Text></Pressable>
      {canManageTemplates ? (
        <Pressable
          style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]}
          onPress={() => router.push({ pathname: '/(tabs)/index', params: { openTemplateDrawer: '1' } })}>
          <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>🗂️  Manage Event Templates</Text>
        </Pressable>
      ) : null}
      <Pressable style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={openNotifications}>
        <Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>
          🔔  Notifications {unreadIds.length ? `(${unreadIds.length} new)` : ''}
        </Text>
      </Pressable>
      <Pressable style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={() => stub('Help & Support')}><Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>❓  Help & Support</Text></Pressable>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#020617' },
  card: { borderWidth: 1, borderRadius: 12, padding: 18, alignItems: 'center', marginBottom: 14 },
  cardLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#0f172a', borderColor: '#1e293b' },
  avatar: { width: 78, height: 78, borderRadius: 39, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#1d4ed8', fontSize: 28, fontWeight: '700' },
  name: { marginTop: 10, fontSize: 22, fontWeight: '700' },
  nameLight: { color: '#0f172a' },
  nameDark: { color: '#f8fafc' },
  email: { marginTop: 4 },
  emailLight: { color: '#64748b' },
  emailDark: { color: '#94a3b8' },
  row: { borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 10 },
  rowLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  rowDark: { backgroundColor: '#0f172a', borderColor: '#1e293b' },
  rowText: { fontWeight: '600' },
  rowTextLight: { color: '#1e293b' },
  rowTextDark: { color: '#e2e8f0' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.35)' },
  modalCard: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '70%' },
  modalScroll: { marginTop: 10 },
  notificationRow: { borderBottomWidth: 1, borderBottomColor: '#334155', paddingVertical: 10 },
  closeBtn: { marginTop: 12, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: '#1d4ed8' },
  closeBtnText: { color: '#fff', fontWeight: '700' },
});