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
  subtitle: { marginTop: 6 },
  subtitleLight: { color: '#64748b' },
  subtitleDark: { color: '#F4F8FF' },
  link: {
    marginTop: 15,
    paddingVertical: 10,
    fontWeight: '700',
  },
  linkLight: { color: '#2563eb' },
  linkDark: { color: '#0EC3C9' },
});
