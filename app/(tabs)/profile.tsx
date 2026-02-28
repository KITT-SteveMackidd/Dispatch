import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/context/session';

export default function ProfileScreen() {
  const { profile, authUser } = useSession();

  const stub = (label: string) => Alert.alert(label, 'This panel is a UI placeholder for now.');

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(profile?.displayName || 'U').slice(0, 1).toUpperCase()}</Text></View>
        <Text style={styles.name}>{profile?.displayName || 'Dispatch User'}</Text>
        <Text style={styles.email}>{authUser?.email || 'No email found'}</Text>
      </View>

      <Pressable style={styles.row} onPress={() => stub('Account Settings')}><Text style={styles.rowText}>⚙️  Account Settings</Text></Pressable>
      <Pressable style={styles.row} onPress={() => stub('Notifications')}><Text style={styles.rowText}>🔔  Notifications</Text></Pressable>
      <Pressable style={styles.row} onPress={() => stub('Help & Support')}><Text style={styles.rowText}>❓  Help & Support</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eef2ff', padding: 16 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 18, alignItems: 'center', marginBottom: 14 },
  avatar: { width: 78, height: 78, borderRadius: 39, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#1d4ed8', fontSize: 28, fontWeight: '700' },
  name: { marginTop: 10, fontSize: 22, fontWeight: '700', color: '#0f172a' },
  email: { marginTop: 4, color: '#64748b' },
  row: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 14, marginBottom: 10 },
  rowText: { color: '#1e293b', fontWeight: '600' },
});
