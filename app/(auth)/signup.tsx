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
import { AppRole } from '@/types/dispatch';
import { useThemeMode } from '@/context/theme';

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AppRole>('manager');
  const [loading, setLoading] = useState(false);
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);

  const onSignUp = async () => {
    if (!displayName.trim() || !email.trim() || !password) {
      return Alert.alert('Missing fields', 'Enter name, email, and password.');
    }

    setLoading(true);
    try {
      await signUp({ displayName: displayName.trim(), email, password, role });
      Alert.alert('Verify your email', 'We sent a verification link to your inbox. Verify your email to continue.');
      router.replace('/(auth)/verify-email');
    } catch (error) {
      Alert.alert('Sign up failed', error instanceof Error ? error.message : 'Unable to create account.');
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
            <Text style={[styles.eyebrow, isDarkMode ? styles.eyebrowDark : styles.eyebrowLight]}>Get Started</Text>
            <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Create your account</Text>
            <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>Set up your events workspace and role.</Text>

            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Full name"
              returnKeyType="next"
              onSubmitEditing={() => emailInputRef.current?.focus()}
              blurOnSubmit={false}
              placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
              style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
            />
            <TextInput
              ref={emailInputRef}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Email"
              returnKeyType="next"
              onSubmitEditing={() => passwordInputRef.current?.focus()}
              blurOnSubmit={false}
              placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
              style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
            />
            <TextInput
              ref={passwordInputRef}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Password"
              returnKeyType="go"
              onSubmitEditing={onSignUp}
              placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
              style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
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
                  <Text style={[styles.pillText, role === r ? styles.pillTextActive : isDarkMode ? styles.pillTextDark : styles.pillTextLight]}>{r.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable style={[styles.btn, loading && styles.disabled]} onPress={onSignUp} disabled={loading}>
              <Text style={styles.btnText}>{loading ? 'Creating...' : 'Create Account'}</Text>
            </Pressable>

            <Link href="/(auth)/signin" style={[styles.link, isDarkMode ? styles.linkDark : styles.linkLight]}>Already have an account? Sign in</Link>
          </View>
        </ScrollView>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#101A2F' },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
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
  input: { padding: 13, borderRadius: 12, marginBottom: 10, borderWidth: 1 },
  inputLight: { backgroundColor: '#f8fafc', color: '#232832', borderColor: '#e2e8f0' },
  inputDark: { backgroundColor: '#1A2540', color: '#F4F8FF', borderColor: '#001A4D' },
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  pill: { padding: 11, borderRadius: 10, borderWidth: 1 },
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
  link: { marginTop: 12, fontWeight: '600' },
  linkLight: { color: '#2563eb' },
  linkDark: { color: '#0EC3C9' },
});