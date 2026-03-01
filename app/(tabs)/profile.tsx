import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';

export default function ProfileScreen() {
  const { profile, authUser } = useSession();
  const { themeMode } = useThemeMode();
  const router = useRouter();
  const isDarkMode = themeMode === 'dark';

  const stub = (label: string) => Alert.alert(label, 'This panel is a UI placeholder for now.');

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(profile?.displayName || 'U').slice(0, 1).toUpperCase()}</Text></View>
        <Text style={[styles.name, isDarkMode ? styles.nameDark : styles.nameLight]}>{profile?.displayName || 'Dispatch User'}</Text>
        <Text style={[styles.email, isDarkMode ? styles.emailDark : styles.emailLight]}>{authUser?.email || 'No email found'}</Text>
      </View>

      <Pressable style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={() => router.push('/account-settings')}><Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>⚙️  Account Settings</Text></Pressable>
      <Pressable style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={() => stub('Notifications')}><Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>🔔  Notifications</Text></Pressable>
      <Pressable style={[styles.row, isDarkMode ? styles.rowDark : styles.rowLight]} onPress={() => stub('Help & Support')}><Text style={[styles.rowText, isDarkMode ? styles.rowTextDark : styles.rowTextLight]}>❓  Help & Support</Text></Pressable>
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
});
