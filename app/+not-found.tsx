import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '@/context/theme';

export default function NotFoundScreen() {
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';

  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
        <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
          <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>This screen doesn&apos;t exist.</Text>
          <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>
            The page might have moved or the link is out of date.
          </Text>

          <Link href="/" style={[styles.link, isDarkMode ? styles.linkDark : styles.linkLight]}>
            Go to home screen
          </Link>
        </View>
      </View>
    </>
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
  containerDark: { backgroundColor: '#020617' },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
  },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#0f172a', borderColor: '#1e293b' },
  title: { fontSize: 20, fontWeight: '700' },
  titleLight: { color: '#0f172a' },
  titleDark: { color: '#f8fafc' },
  subtitle: { marginTop: 6 },
  subtitleLight: { color: '#64748b' },
  subtitleDark: { color: '#94a3b8' },
  link: {
    marginTop: 15,
    paddingVertical: 10,
    fontWeight: '700',
  },
  linkLight: { color: '#2563eb' },
  linkDark: { color: '#93c5fd' },
});
