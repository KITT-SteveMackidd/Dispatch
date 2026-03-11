import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useThemeMode } from '@/context/theme';
import { useSession } from '@/context/session';

export default function AccountSettingsScreen() {
  const router = useRouter();
  const { themeMode, resolvedThemeMode, setThemeMode } = useThemeMode();
  const { revokeSession } = useSession();

  const isDarkMode = resolvedThemeMode === 'dark';

  const onRevokeSession = async () => {
    try {
      await revokeSession();
      Alert.alert('Session revoked', 'You have been signed out of this device.');
      router.replace('/(auth)/signin');
    } catch (error) {
      Alert.alert('Unable to revoke', error instanceof Error ? error.message : 'Try again in a moment.');
    }
  };

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
        <Text style={[styles.eyebrow, isDarkMode ? styles.eyebrowDark : styles.eyebrowLight]}>Preferences</Text>
        <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Appearance</Text>
        <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>
          Choose how Events looks for you.
        </Text>

        <View style={styles.options}>
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <Pressable
              key={mode}
              onPress={() => setThemeMode(mode)}
              style={[
                styles.option,
                isDarkMode ? styles.optionDark : styles.optionLight,
                themeMode === mode ? styles.optionSelected : null,
              ]}>
              <Text style={[styles.optionLabel, isDarkMode ? styles.optionLabelDark : styles.optionLabelLight]}>
                {mode[0].toUpperCase() + mode.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.helper, isDarkMode ? styles.helperDark : styles.helperLight]}>
          Current mode: {themeMode === 'system' ? `System (${resolvedThemeMode})` : themeMode}
        </Text>
      </View>

      <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
        <Text style={[styles.eyebrow, isDarkMode ? styles.eyebrowDark : styles.eyebrowLight]}>Security</Text>
        <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Session control</Text>
        <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>
          Immediately revoke this device session. For emergency all-device revocation, use docs/security/firebase-session-revocation.md.
        </Text>

        <Pressable onPress={onRevokeSession} style={styles.dangerBtn}>
          <Text style={styles.dangerBtnText}>Revoke this session now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 14 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#101A2F' },
  card: { borderRadius: 16, borderWidth: 1, padding: 18 },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#1A2540', borderColor: '#001A4D' },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  eyebrowLight: { color: '#2563eb' },
  eyebrowDark: { color: '#0EC3C9' },
  title: { marginTop: 6, fontSize: 22, fontWeight: '700' },
  titleLight: { color: '#232832' },
  titleDark: { color: '#F4F8FF' },
  subtitle: { marginTop: 6, marginBottom: 16 },
  subtitleLight: { color: '#64748b' },
  subtitleDark: { color: '#F4F8FF' },
  options: { gap: 10 },
  option: { borderWidth: 1, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14 },
  optionLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  optionDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  optionSelected: { borderColor: '#2563eb', borderWidth: 2 },
  optionLabel: { fontWeight: '700' },
  optionLabelLight: { color: '#232832' },
  optionLabelDark: { color: '#F4F8FF' },
  helper: { marginTop: 12, fontSize: 12 },
  helperLight: { color: '#475569' },
  helperDark: { color: '#F4F8FF' },
  dangerBtn: { backgroundColor: '#b91c1c', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center' },
  dangerBtnText: { color: '#fff', fontWeight: '700' },
});
