import { useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const passwordInputRef = useRef<TextInput>(null);

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
    <KeyboardAvoidingView
      style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}
      behavior={Platform.select({ ios: 'padding', android: 'height' })}>
      <Pressable style={styles.flex} onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
            <Text style={[styles.eyebrow, isDarkMode ? styles.eyebrowDark : styles.eyebrowLight]}>Dispatch</Text>
            <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Welcome back</Text>
            <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>Sign in to keep your events moving.</Text>

            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Email"
              returnKeyType="next"
              onSubmitEditing={() => passwordInputRef.current?.focus()}
              blurOnSubmit={false}
              placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
              style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
            />
            <TextInput
              ref={passwordInputRef}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Password"
              returnKeyType="go"
              onSubmitEditing={onSignIn}
              placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
              style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
            />

            <Pressable style={[styles.btn, loading && styles.disabled]} onPress={onSignIn} disabled={loading}>
              <Text style={styles.btnText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
            </Pressable>

            <Link href="/(auth)/signup" style={[styles.link, isDarkMode ? styles.linkDark : styles.linkLight]}>
              Create an account
            </Link>
          </View>
        </ScrollView>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#020617' },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: { borderRadius: 18, borderWidth: 1, padding: 20 },
  cardLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#0f172a', borderColor: '#1e293b' },
  eyebrow: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  eyebrowLight: { color: '#2563eb' },
  eyebrowDark: { color: '#93c5fd' },
  title: { fontSize: 30, fontWeight: '700', marginTop: 4 },
  titleLight: { color: '#0f172a' },
  titleDark: { color: '#f8fafc' },
  subtitle: { marginBottom: 18, marginTop: 6 },
  subtitleLight: { color: '#64748b' },
  subtitleDark: { color: '#94a3b8' },
  input: { padding: 13, borderRadius: 12, marginBottom: 10, borderWidth: 1 },
  inputLight: { backgroundColor: '#f8fafc', color: '#0f172a', borderColor: '#e2e8f0' },
  inputDark: { backgroundColor: '#111827', color: '#f8fafc', borderColor: '#334155' },
  btn: { backgroundColor: '#2563eb', borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 8 },
  disabled: { opacity: 0.65 },
  btnText: { color: 'white', fontWeight: '700' },
  link: { marginTop: 12, fontWeight: '600' },
  linkLight: { color: '#2563eb' },
  linkDark: { color: '#93c5fd' },
});