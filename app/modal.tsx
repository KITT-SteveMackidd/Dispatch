import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '@/context/theme';

export default function ModalScreen() {
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
        <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Modal</Text>
        <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>
          This modal now follows the selected appearance mode.
        </Text>
      </View>

      <StatusBar style={isDarkMode || Platform.OS === 'ios' ? 'light' : 'dark'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#101A2F' },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
  },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#1A2540', borderColor: '#001A4D' },
  title: { fontSize: 20, fontWeight: '700' },
  titleLight: { color: '#232832' },
  titleDark: { color: '#F4F8FF' },
  subtitle: { marginTop: 8 },
  subtitleLight: { color: '#64748b' },
  subtitleDark: { color: '#F4F8FF' },
});
