import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useSession();
  const { themeMode } = useThemeMode();
  const isDarkMode = themeMode === 'dark';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSignIn = async () => {
    if (!email.trim() || !password) return Alert.alert('Missing fields', 'Enter email and password.');
    setLoading(true);
    try {
      await signIn(email, password);
      router.replace('/(tabs)');
    } catch (error) {
      Alert.alert('Sign in failed', error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
        <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Welcome back</Text>
        <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>Sign in to continue managing your Dispatch events.</Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Email"
          placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
          style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
          placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
          style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
        />

        <Pressable style={[styles.btn, loading && { opacity: 0.65 }]} onPress={onSignIn} disabled={loading}>
          <Text style={styles.btnText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
        </Pressable>

        <Link href="/(auth)/signup" style={[styles.link, isDarkMode ? styles.linkDark : styles.linkLight]}>Create an account</Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center' },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#020617' },
  card: { borderRadius: 14, borderWidth: 1, padding: 18 },
  cardLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#0f172a', borderColor: '#1e293b' },
  title: { fontSize: 28, fontWeight: '700' },
  titleLight: { color: '#0f172a' },
  titleDark: { color: '#f8fafc' },
  subtitle: { marginBottom: 16, marginTop: 4 },
  subtitleLight: { color: '#64748b' },
  subtitleDark: { color: '#94a3b8' },
  input: { padding: 13, borderRadius: 10, marginBottom: 10, borderWidth: 1 },
  inputLight: { backgroundColor: '#f8fafc', color: '#0f172a', borderColor: '#e2e8f0' },
  inputDark: { backgroundColor: '#111827', color: '#f8fafc', borderColor: '#334155' },
  btn: { backgroundColor: '#2563eb', borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 6 },
  btnText: { color: 'white', fontWeight: '700' },
  link: { marginTop: 12, fontWeight: '600' },
  linkLight: { color: '#2563eb' },
  linkDark: { color: '#93c5fd' },
});
