import { useEffect, useRef, useState } from 'react';
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
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, signInWithGoogle, signInWithApple, sendPasswordReset } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const passwordInputRef = useRef<TextInput>(null);

  const isExpoGo = Constants.appOwnership === 'expo';

  const [googleRequest, googleResponse, promptGoogleAuth] = Google.useAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
    iosClientId: isExpoGo ? undefined : process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: isExpoGo ? undefined : process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

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

  useEffect(() => {
    const run = async () => {
      if (googleResponse?.type !== 'success') return;
      const authResult = googleResponse.authentication;
      const idToken = authResult?.idToken;

      if (!idToken) {
        Alert.alert('Google sign-in failed', 'No Google ID token was returned.');
        return;
      }

      setLoading(true);
      try {
        await signInWithGoogle({ idToken, accessToken: authResult?.accessToken });
        router.replace('/(tabs)');
      } catch (error) {
        Alert.alert('Google sign-in failed', error instanceof Error ? error.message : 'Unable to sign in with Google.');
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [googleResponse, router, signInWithGoogle]);

  const onGoogleSignIn = async () => {
    try {
      await promptGoogleAuth();
    } catch (error) {
      Alert.alert('Google sign-in failed', error instanceof Error ? error.message : 'Unable to start Google sign-in.');
    }
  };

  const onAppleSignIn = async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        Alert.alert('Apple sign-in failed', 'No Apple identity token returned.');
        return;
      }

      setLoading(true);
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ').trim();
      await signInWithApple({ idToken: credential.identityToken, displayName: fullName || undefined });
      router.replace('/(tabs)');
    } catch (error: any) {
      if (error?.code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert('Apple sign-in failed', error instanceof Error ? error.message : 'Unable to sign in with Apple.');
    } finally {
      setLoading(false);
    }
  };

  const onForgotPassword = async () => {
    if (!email.trim()) {
      return Alert.alert('Email required', 'Enter your email first, then tap Forgot password.');
    }

    setResetting(true);
    try {
      await sendPasswordReset(email);
      Alert.alert('Reset email sent', 'Check your inbox for a password reset link.');
    } catch (error) {
      Alert.alert('Reset failed', error instanceof Error ? error.message : 'Unable to send password reset email.');
    } finally {
      setResetting(false);
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
              onSubmitEditing={onSignIn}
              placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'}
              style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
            />

            <Pressable onPress={onForgotPassword} disabled={resetting}>
              <Text style={[styles.link, isDarkMode ? styles.linkDark : styles.linkLight]}>{resetting ? 'Sending reset email...' : 'Forgot password?'}</Text>
            </Pressable>

            <Pressable style={[styles.btn, loading && styles.disabled]} onPress={onSignIn} disabled={loading}>
              <Text style={styles.btnText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
            </Pressable>

            <Pressable style={[styles.oauthBtn, !googleRequest && styles.disabled]} onPress={onGoogleSignIn} disabled={!googleRequest || loading}>
              <Text style={styles.oauthBtnText}>Continue with Google</Text>
            </Pressable>

            {Platform.OS === 'ios' ? (
              <Pressable style={styles.oauthBtn} onPress={onAppleSignIn} disabled={loading}>
                <Text style={styles.oauthBtnText}>Continue with Apple</Text>
              </Pressable>
            ) : null}

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
  btn: { backgroundColor: '#2563eb', borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 8 },
  oauthBtn: { backgroundColor: '#0f172a', borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 8 },
  oauthBtnText: { color: 'white', fontWeight: '700' },
  disabled: { opacity: 0.65 },
  btnText: { color: 'white', fontWeight: '700' },
  link: { marginTop: 12, fontWeight: '600' },
  linkLight: { color: '#2563eb' },
  linkDark: { color: '#0EC3C9' },
});
