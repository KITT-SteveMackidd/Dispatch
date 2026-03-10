import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { AppRole } from '@/types/dispatch';
import { useThemeMode } from '@/context/theme';

export default function SetupScreen() {
  const router = useRouter();
  const { authUser, saveProfile } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [name, setName] = useState(authUser?.displayName || '');
  const [role, setRole] = useState<AppRole>('manager');
  const [saving, setSaving] = useState(false);

  const completeSetup = async () => {
    if (!authUser) return router.replace('/(auth)/signin');
    if (!name.trim()) return Alert.alert('Missing name', 'Please enter your name.');
    setSaving(true);
    try {
      await saveProfile({ displayName: name.trim(), role });
      router.replace('/(tabs)');
    } catch (error) {
      Alert.alert('Setup failed', error instanceof Error ? error.message : 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Complete Profile</Text>
      <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>One-time role setup for Dispatch access.</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Your name" style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]} placeholderTextColor={isDarkMode ? '#64748b' : '#8c9ac8'} />
      <View style={styles.row}>
        {(['manager', 'worker'] as AppRole[]).map((r) => (
          <Pressable key={r} onPress={() => setRole(r)} style={[styles.pill, isDarkMode ? styles.pillDark : styles.pillLight, role === r && styles.pillActive]}>
            <Text style={[styles.pillText, isDarkMode ? styles.pillTextDark : styles.pillTextLight]}>{r.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={[styles.btn, saving && { opacity: 0.65 }]} onPress={completeSetup} disabled={saving}>
        <Text style={styles.btnText}>{saving ? 'Saving...' : 'Continue'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#020617' },
  title: { fontSize: 36, fontWeight: '700' },
  titleLight: { color: '#0f172a' },
  titleDark: { color: 'white' },
  subtitle: { marginBottom: 20 },
  subtitleLight: { color: '#64748b' },
  subtitleDark: { color: '#94a3b8' },
  input: { padding: 14, borderRadius: 12, marginBottom: 16, borderWidth: 1 },
  inputLight: { backgroundColor: '#fff', color: '#0f172a', borderColor: '#cbd5e1' },
  inputDark: { backgroundColor: '#151c33', color: 'white', borderColor: '#334155' },
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  pill: { padding: 12, borderRadius: 10, borderWidth: 1 },
  pillLight: { backgroundColor: '#f1f5f9', borderColor: '#cbd5e1' },
  pillDark: { backgroundColor: '#151c33', borderColor: '#334155' },
  pillActive: { backgroundColor: '#3559ff', borderColor: '#3559ff' },
  pillText: { fontWeight: '600' },
  pillTextLight: { color: '#1e293b' },
  pillTextDark: { color: 'white' },
  btn: { backgroundColor: '#21c67a', borderRadius: 12, padding: 14, alignItems: 'center' },
  btnText: { color: '#07130d', fontWeight: '700' },
});