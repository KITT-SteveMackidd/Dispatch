import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { AppRole } from '@/types/dispatch';
import { useThemeMode } from '@/context/theme';

export default function SetupScreen() {
  const router = useRouter();
  const { authUser, profile, saveProfile } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [name, setName] = useState(authUser?.displayName || profile?.displayName || '');
  const [phoneNumber, setPhoneNumber] = useState(profile?.phoneNumber || '');
  const [role, setRole] = useState<AppRole>(profile?.role || 'manager');
  const [saving, setSaving] = useState(false);

  const completeSetup = async () => {
    if (!authUser) return router.replace('/(auth)/signin');
    if (!name.trim()) return Alert.alert('Missing name', 'Please enter your name.');
    setSaving(true);
    try {
      await saveProfile({ displayName: name.trim(), phoneNumber: phoneNumber.trim(), role });
      router.replace('/(tabs)');
    } catch (error) {
      Alert.alert('Setup failed', error instanceof Error ? error.message : 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}
      behavior={Platform.select({ ios: 'padding', android: 'height' })}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
          <Text style={[styles.eyebrow, isDarkMode ? styles.eyebrowDark : styles.eyebrowLight]}>Account Setup</Text>
          <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Complete Profile</Text>
          <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>Set your name, phone number, and role before entering Dispatch.</Text>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
            placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
          />

          <TextInput
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="Phone number"
            keyboardType="phone-pad"
            style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
            placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#101A2F' },
  scrollContent: { flexGrow: 1, padding: 20, justifyContent: 'center' },
  card: { borderRadius: 18, borderWidth: 1, padding: 20 },
  cardLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#1A2540', borderColor: '#001A4D' },
  eyebrow: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  eyebrowLight: { color: '#2563eb' },
  eyebrowDark: { color: '#0EC3C9' },
  title: { fontSize: 30, fontWeight: '700', marginTop: 4 },
  titleLight: { color: '#232832' },
  titleDark: { color: '#F4F8FF' },
  subtitle: { marginBottom: 18, marginTop: 6 },
  subtitleLight: { color: '#64748b' },
  subtitleDark: { color: '#F4F8FF' },
  input: { padding: 13, borderRadius: 12, marginBottom: 12, borderWidth: 1 },
  inputLight: { backgroundColor: '#f8fafc', color: '#232832', borderColor: '#e2e8f0' },
  inputDark: { backgroundColor: '#1A2540', color: '#F4F8FF', borderColor: '#001A4D' },
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  pill: { flex: 1, padding: 11, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  pillLight: { backgroundColor: '#f1f5f9', borderColor: '#e2e8f0' },
  pillDark: { backgroundColor: '#1A2540', borderColor: '#001A4D' },
  pillActiveLight: { backgroundColor: '#dbeafe', borderColor: '#93c5fd' },
  pillActiveDark: { backgroundColor: '#00133D', borderColor: '#0EC3C9' },
  pillText: { fontWeight: '700' },
  pillTextLight: { color: '#334155' },
  pillTextDark: { color: '#F4F8FF' },
  pillTextActive: { color: '#bfdbfe' },
  btn: { backgroundColor: '#2563eb', borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 8 },
  disabled: { opacity: 0.65 },
  btnText: { color: 'white', fontWeight: '700' },
});