import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  Image,
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

const lightSignUpLogoSource = { uri: 'https://www.figma.com/api/mcp/asset/06d318be-c56a-407f-b246-a44af4358b61' };
const darkSignUpLogoSource = { uri: 'https://www.figma.com/api/mcp/asset/dc7443d8-94f1-481c-ae8b-d57ce362a259' };

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp, signInWithGoogle, signInWithApple } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const palette = authPalettes[isDarkMode ? 'dark' : 'light'];
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

  const renderLightScreen = () => (
    <>
      <View style={authStyles.lightLogoWrap}>
        <Image source={lightSignUpLogoSource} style={authStyles.lightHeroGraphic} resizeMode="cover" />
      </View>

      <View style={authStyles.lightCard}>
        <View style={{ gap: 10 }}>
          <Text style={authStyles.lightTitle}>Create your account</Text>
          <Text style={authStyles.lightSubtitle}>Set up your Dispatch workspace with a cleaner, faster path into your events.</Text>
        </View>

        <View style={authStyles.lightForm}>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Full Name"
            returnKeyType="next"
            onSubmitEditing={() => emailInputRef.current?.focus()}
            blurOnSubmit={false}
            placeholderTextColor="rgba(18,18,18,0.33)"
            style={[
              authStyles.lightInput,
              {
                backgroundColor: '#DBE2F9',
                color: '#121212',
              },
            ]}
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
            placeholderTextColor="rgba(18,18,18,0.33)"
            style={[
              authStyles.lightInput,
              {
                backgroundColor: '#DBE2F9',
                color: '#121212',
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
            placeholderTextColor="rgba(18,18,18,0.33)"
            style={[
              authStyles.lightInput,
              {
                backgroundColor: '#DBE2F9',
                color: '#121212',
              },
            ]}
          />
        </View>

        <View style={authStyles.lightActionGroup}>
          <View style={authStyles.lightRoleRow}>
            {(['manager', 'worker'] as AppRole[]).map((r) => {
              const active = role === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setRole(r)}
                  style={[
                    authStyles.lightRolePill,
                    active
                      ? { backgroundColor: '#F98D2F', borderColor: '#F98D2F' }
                      : { backgroundColor: '#FEEAE2', borderColor: '#F98D2F' },
                  ]}>
                  <Text
                    style={[
                      authStyles.lightRolePillText,
                      { color: active ? '#FEF4F1' : '#F98D2F', fontFamily: active ? 'Inter-Bold' : 'Inter' },
                    ]}>
                    {r === 'manager' ? 'Manager' : 'Worker'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={({ pressed }) => [
              authStyles.lightButton,
              { backgroundColor: '#0EC3C9', opacity: loading ? 0.65 : 1 },
              pressed && !loading ? authStyles.buttonPressed : null,
            ]}
            onPress={onSignUp}
            disabled={loading}>
            <Text style={authStyles.buttonText}>{loading ? 'Creating account...' : 'Create Account'}</Text>
          </Pressable>

          <View style={authStyles.lightFooterRow}>
            <Text style={authStyles.lightFooterLabel}>Already have an account?</Text>
            <Link href="/(auth)/signin" style={authStyles.lightFooterLink}>
              Sign In
            </Link>
          </View>
        </View>
      </View>
    </>
  );

  const renderDarkScreen = () => (
    <>
      <View style={authStyles.darkLogoWrap}>
        <Image source={darkSignUpLogoSource} style={authStyles.darkHeroGraphic} resizeMode="cover" />
      </View>

      <View style={authStyles.darkCard}>
        <View style={{ gap: 10 }}>
          <Text style={authStyles.darkTitle}>Create your account</Text>
          <Text style={authStyles.darkSubtitle}>Set up your Dispatch workspace with a cleaner, faster path into your events.</Text>
        </View>

        <View style={authStyles.darkForm}>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Full Name"
            returnKeyType="next"
            onSubmitEditing={() => emailInputRef.current?.focus()}
            blurOnSubmit={false}
            placeholderTextColor="rgba(247,247,247,0.33)"
            style={authStyles.darkInput}
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
            placeholderTextColor="rgba(247,247,247,0.33)"
            style={authStyles.darkInput}
          />
          <TextInput
            ref={passwordInputRef}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
            returnKeyType="go"
            onSubmitEditing={onSignUp}
            placeholderTextColor="rgba(247,247,247,0.33)"
            style={authStyles.darkInput}
          />

          <View style={authStyles.darkRoleRow}>
            {(['manager', 'worker'] as AppRole[]).map((r) => {
              const active = role === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setRole(r)}
                  style={[
                    authStyles.darkRolePill,
                    active
                      ? { backgroundColor: '#F98D2F', borderColor: '#F98D2F' }
                      : { backgroundColor: '#203E75', borderColor: '#F98D2F' },
                  ]}>
                  <Text
                    style={[
                      authStyles.darkRolePillText,
                      { color: active ? '#FEF4F1' : '#F98D2F', fontFamily: active ? 'Inter-Bold' : 'Inter' },
                    ]}>
                    {r === 'manager' ? 'Manager' : 'Worker'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={({ pressed }) => [
              authStyles.darkButton,
              { backgroundColor: '#0EC3C9', opacity: loading ? 0.65 : 1 },
              pressed && !loading ? authStyles.buttonPressed : null,
            ]}
            onPress={onSignUp}
            disabled={loading}>
            <Text style={authStyles.buttonText}>{loading ? 'Creating account...' : 'Create Account'}</Text>
          </Pressable>

          <View style={authStyles.darkFooterRow}>
            <Text style={authStyles.darkFooterLabel}>Already have an account?</Text>
            <Link href="/(auth)/signin" style={authStyles.darkFooterLink}>
              Sign In
            </Link>
          </View>
        </View>
      </View>
    </>
  );

  return (
    <KeyboardAvoidingView
      style={[authStyles.screen, { backgroundColor: isDarkMode ? '#061229' : '#DBE2F9' }]}
      behavior={Platform.select({ ios: 'padding', android: 'height' })}>
      <Pressable style={authStyles.flex} onPress={Keyboard.dismiss}>
        <ScrollView
          contentContainerStyle={isDarkMode ? authStyles.darkScrollContent : authStyles.lightScrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          {isDarkMode ? renderDarkScreen() : renderLightScreen()}
        </ScrollView>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
