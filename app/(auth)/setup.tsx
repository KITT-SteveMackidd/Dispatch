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
      <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
        <Text style={[styles.eyebrow, isDarkMode ? styles.eyebrowDark : styles.eyebrowLight]}>Account Setup</Text>
        <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Complete Profile</Text>
        <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>One-time role setup for Dispatch access.</Text>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
          placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
        />

        <View style={styles.row}>
          {(['manager', 'worker'] as AppRole[]).map((r) => (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              style={[
                styles.pill,
                isDarkMode ? styles.pillDark : styles.pillLight,
                role === r && (isDarkMode ? styles.pillActiveDark : styles.pillActiveLight),
              ]}>
              <Text
                style={[
                  styles.pillText,
                  role === r ? styles.pillTextActive : isDarkMode ? styles.pillTextDark : styles.pillTextLight,
                ]}>
                {r.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={[styles.btn, saving && styles.disabled]} onPress={completeSetup} disabled={saving}>
          <Text style={styles.btnText}>{saving ? 'Saving...' : 'Continue'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center' },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#181B24' },
  card: { borderRadius: 18, borderWidth: 1, padding: 20 },
  cardLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#232832', borderColor: '#1e293b' },
  eyebrow: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  eyebrowLight: { color: '#2563eb' },
  eyebrowDark: { color: '#93c5fd' },
  title: { fontSize: 30, fontWeight: '700', marginTop: 4 },
  titleLight: { color: '#232832' },
  titleDark: { color: '#f8fafc' },
  subtitle: { marginBottom: 18, marginTop: 6 },
  subtitleLight: { color: '#64748b' },
  subtitleDark: { color: '#94a3b8' },
  input: { padding: 13, borderRadius: 12, marginBottom: 12, borderWidth: 1 },
  inputLight: { backgroundColor: '#f8fafc', color: '#232832', borderColor: '#e2e8f0' },
  inputDark: { backgroundColor: '#232832', color: '#f8fafc', borderColor: '#334155' },
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  pill: { padding: 11, borderRadius: 10, borderWidth: 1 },
  pillLight: { backgroundColor: '#f1f5f9', borderColor: '#e2e8f0' },
  pillDark: { backgroundColor: '#232832', borderColor: '#334155' },
  pillActiveLight: { backgroundColor: '#dbeafe', borderColor: '#93c5fd' },
  pillActiveDark: { backgroundColor: '#1e3a8a', borderColor: '#3b82f6' },
  pillText: { fontWeight: '700' },
  pillTextLight: { color: '#334155' },
  pillTextDark: { color: '#cbd5e1' },
  pillTextActive: { color: '#bfdbfe' },
  btn: { backgroundColor: '#2563eb', borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 8 },
  disabled: { opacity: 0.65 },
  btnText: { color: 'white', fontWeight: '700' },
});
