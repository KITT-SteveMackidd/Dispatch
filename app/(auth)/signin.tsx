import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
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
import { authPalettes, authStyles } from '@/components/auth/authStyles';

WebBrowser.maybeCompleteAuthSession();

const logoSource = require('../../assets/images/dispatch-splash-logo.jpg');

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, signInWithGoogle, signInWithApple, sendPasswordReset } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const palette = authPalettes[resolvedThemeMode === 'dark' ? 'dark' : 'light'];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const passwordInputRef = useRef<TextInput>(null);
  const oauthEnabled = false;

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
      style={[authStyles.screen, { backgroundColor: palette.background }]}
      behavior={Platform.select({ ios: 'padding', android: 'height' })}>
      <View style={[authStyles.backgroundGlowTop, { backgroundColor: palette.glow }]} />
      <View style={[authStyles.backgroundGlowBottom, { backgroundColor: palette.glow }]} />
      <Pressable style={authStyles.flex} onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={authStyles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={authStyles.logoWrap}>
            <Image source={logoSource} style={authStyles.logo} resizeMode="cover" />
            <Text style={[authStyles.brand, { color: palette.accent }]}>Dispatch</Text>
          </View>

          <View
            style={[
              authStyles.card,
              {
                backgroundColor: palette.card,
                borderColor: palette.cardBorder,
                shadowColor: palette.shadowColor,
              },
            ]}>
            <Text style={[authStyles.eyebrow, { color: palette.accent }]}>Welcome back</Text>
            <Text style={[authStyles.title, { color: palette.text }]}>Sign in to Dispatch</Text>
            <Text style={[authStyles.subtitle, { color: palette.mutedText }]}>Manage your events, crew, and timelines from one polished workspace.</Text>

            <View style={authStyles.form}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email address"
                returnKeyType="next"
                onSubmitEditing={() => passwordInputRef.current?.focus()}
                blurOnSubmit={false}
                placeholderTextColor={palette.placeholder}
                style={[
                  authStyles.input,
                  {
                    backgroundColor: palette.inputBackground,
                    color: palette.text,
                    borderColor: palette.inputBorder,
                  },
                ]}
              />
              <TextInput
                ref={passwordInputRef}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="Password"
                returnKeyType="go"
                onSubmitEditing={onSignIn}
                placeholderTextColor={palette.placeholder}
                style={[
                  authStyles.input,
                  {
                    backgroundColor: palette.inputBackground,
                    color: palette.text,
                    borderColor: palette.inputBorder,
                  },
                ]}
              />

              <View style={authStyles.helperRow}>
                <Pressable onPress={onForgotPassword} disabled={resetting}>
                  <Text style={[authStyles.linkText, { color: palette.accent }]}>{resetting ? 'Sending reset email…' : 'Forgot password?'}</Text>
                </Pressable>
              </View>

              <Pressable
                style={({ pressed }) => [
                  authStyles.button,
                  { backgroundColor: palette.primary, opacity: loading ? 0.65 : 1 },
                  pressed && !loading ? authStyles.buttonPressed : null,
                ]}
                onPress={onSignIn}
                disabled={loading}>
                <Text style={authStyles.buttonText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
              </Pressable>

              {oauthEnabled ? (
                <>
                  <Pressable
                    style={[
                      authStyles.secondaryButton,
                      { backgroundColor: palette.inputBackground, borderColor: palette.inputBorder, opacity: !googleRequest || loading ? 0.65 : 1 },
                    ]}
                    onPress={onGoogleSignIn}
                    disabled={!googleRequest || loading}>
                    <Text style={[authStyles.secondaryButtonText, { color: palette.text }]}>Continue with Google</Text>
                  </Pressable>

                  {Platform.OS === 'ios' ? (
                    <Pressable
                      style={[
                        authStyles.secondaryButton,
                        { backgroundColor: palette.inputBackground, borderColor: palette.inputBorder, opacity: loading ? 0.65 : 1 },
                      ]}
                      onPress={onAppleSignIn}
                      disabled={loading}>
                      <Text style={[authStyles.secondaryButtonText, { color: palette.text }]}>Continue with Apple</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
            </View>

            <View style={authStyles.linkRow}>
              <Text style={[authStyles.linkLabel, { color: palette.mutedText }]}>New here?</Text>
              <Link href="/(auth)/signup" style={[authStyles.linkText, { color: palette.accent }]}>Create an account</Link>
            </View>
          </View>
        </ScrollView>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
