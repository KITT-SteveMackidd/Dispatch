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
import { AppRole } from '@/types/dispatch';
import { useThemeMode } from '@/context/theme';
import { authPalettes, authStyles } from '@/components/auth/authStyles';

WebBrowser.maybeCompleteAuthSession();

const logoSource = require('../../assets/images/dispatch-splash-logo.jpg');

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp, signInWithGoogle, signInWithApple } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const palette = authPalettes[resolvedThemeMode === 'dark' ? 'dark' : 'light'];
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AppRole>('manager');
  const [loading, setLoading] = useState(false);
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const oauthEnabled = false;

  const isExpoGo = Constants.appOwnership === 'expo';

  const [googleRequest, googleResponse, promptGoogleAuth] = Google.useAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
    iosClientId: isExpoGo ? undefined : process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: isExpoGo ? undefined : process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

  useEffect(() => {
    const run = async () => {
      if (googleResponse?.type !== 'success') return;
      const authResult = googleResponse.authentication;
      const idToken = authResult?.idToken;

      if (!idToken) {
        Alert.alert('Google sign-up failed', 'No Google ID token was returned.');
        return;
      }

      setLoading(true);
      try {
        await signInWithGoogle({ idToken, accessToken: authResult?.accessToken, role });
        router.replace('/(tabs)');
      } catch (error) {
        Alert.alert('Google sign-up failed', error instanceof Error ? error.message : 'Unable to sign up with Google.');
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [googleResponse, role, router, signInWithGoogle]);

  const onGoogleSignUp = async () => {
    try {
      await promptGoogleAuth();
    } catch (error) {
      Alert.alert('Google sign-up failed', error instanceof Error ? error.message : 'Unable to start Google sign-up.');
    }
  };

  const onAppleSignUp = async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        Alert.alert('Apple sign-up failed', 'No Apple identity token returned.');
        return;
      }

      setLoading(true);
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ').trim();
      await signInWithApple({
        idToken: credential.identityToken,
        displayName: fullName || displayName.trim() || undefined,
        role,
      });
      router.replace('/(tabs)');
    } catch (error: any) {
      if (error?.code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert('Apple sign-up failed', error instanceof Error ? error.message : 'Unable to sign up with Apple.');
    } finally {
      setLoading(false);
    }
  };

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
            <Text style={[authStyles.eyebrow, { color: palette.accent }]}>Get started</Text>
            <Text style={[authStyles.title, { color: palette.text }]}>Create your account</Text>
            <Text style={[authStyles.subtitle, { color: palette.mutedText }]}>Set up your Dispatch workspace with a cleaner, faster path into your events.</Text>

            <View style={authStyles.form}>
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Full name"
                returnKeyType="next"
                onSubmitEditing={() => emailInputRef.current?.focus()}
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
                ref={emailInputRef}
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
                onSubmitEditing={onSignUp}
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

              <View style={authStyles.row}>
                {(['manager', 'worker'] as AppRole[]).map((r) => {
                  const active = role === r;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => setRole(r)}
                      style={[
                        authStyles.pill,
                        {
                          backgroundColor: active ? palette.pillActiveBackground : palette.pillBackground,
                          borderColor: active ? palette.pillActiveBorder : palette.pillBorder,
                        },
                      ]}>
                      <Text style={[authStyles.pillText, { color: active ? palette.primary : palette.pillText }]}>{r}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                style={({ pressed }) => [
                  authStyles.button,
                  { backgroundColor: palette.primary, opacity: loading ? 0.65 : 1 },
                  pressed && !loading ? authStyles.buttonPressed : null,
                ]}
                onPress={onSignUp}
                disabled={loading}>
                <Text style={authStyles.buttonText}>{loading ? 'Creating account…' : 'Create account'}</Text>
              </Pressable>

              {oauthEnabled ? (
                <>
                  <Pressable
                    style={[
                      authStyles.secondaryButton,
                      { backgroundColor: palette.inputBackground, borderColor: palette.inputBorder, opacity: !googleRequest || loading ? 0.65 : 1 },
                    ]}
                    onPress={onGoogleSignUp}
                    disabled={!googleRequest || loading}>
                    <Text style={[authStyles.secondaryButtonText, { color: palette.text }]}>Sign up with Google ({role})</Text>
                  </Pressable>

                  {Platform.OS === 'ios' ? (
                    <Pressable
                      style={[
                        authStyles.secondaryButton,
                        { backgroundColor: palette.inputBackground, borderColor: palette.inputBorder, opacity: loading ? 0.65 : 1 },
                      ]}
                      onPress={onAppleSignUp}
                      disabled={loading}>
                      <Text style={[authStyles.secondaryButtonText, { color: palette.text }]}>Sign up with Apple ({role})</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
            </View>

            <View style={authStyles.linkRow}>
              <Text style={[authStyles.linkLabel, { color: palette.mutedText }]}>Already have an account?</Text>
              <Link href="/(auth)/signin" style={[authStyles.linkText, { color: palette.accent }]}>Sign in</Link>
            </View>
          </View>
        </ScrollView>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
