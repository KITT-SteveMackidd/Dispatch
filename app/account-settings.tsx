import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '@/context/theme';

export default function AccountSettingsScreen() {
  const { themeMode, setThemeMode } = useThemeMode();

  const isDarkMode = themeMode === 'dark';

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
        <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Appearance</Text>
        <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>
          Choose how Dispatch looks for you.
        </Text>

        <View style={styles.options}>
          <Pressable
            onPress={() => setThemeMode('light')}
            style={[
              styles.option,
              isDarkMode ? styles.optionDark : styles.optionLight,
              themeMode === 'light' ? styles.optionSelected : null,
            ]}>
            <Text style={[styles.optionLabel, isDarkMode ? styles.optionLabelDark : styles.optionLabelLight]}>Light</Text>
          </Pressable>

          <Pressable
            onPress={() => setThemeMode('dark')}
            style={[
              styles.option,
              isDarkMode ? styles.optionDark : styles.optionLight,
              themeMode === 'dark' ? styles.optionSelected : null,
            ]}>
            <Text style={[styles.optionLabel, isDarkMode ? styles.optionLabelDark : styles.optionLabelLight]}>Dark</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#020617' },
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#0f172a', borderColor: '#1e293b' },
  title: { fontSize: 20, fontWeight: '700' },
  titleLight: { color: '#0f172a' },
  titleDark: { color: '#f8fafc' },
  subtitle: { marginTop: 4, marginBottom: 16 },
  subtitleLight: { color: '#64748b' },
  subtitleDark: { color: '#94a3b8' },
  options: { flexDirection: 'row', gap: 12 },
  option: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  optionLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  optionDark: { borderColor: '#334155', backgroundColor: '#111827' },
  optionSelected: { borderColor: '#2563eb', borderWidth: 2 },
  optionLabel: { fontWeight: '700' },
  optionLabelLight: { color: '#0f172a' },
  optionLabelDark: { color: '#f8fafc' },
});
