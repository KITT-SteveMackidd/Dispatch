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

const lightSignInLogoSource = { uri: 'https://www.figma.com/api/mcp/asset/06d318be-c56a-407f-b246-a44af4358b61' };
const darkSignInLogoSource = { uri: 'https://www.figma.com/api/mcp/asset/dc7443d8-94f1-481c-ae8b-d57ce362a259' };

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, signInWithGoogle, signInWithApple, sendPasswordReset } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const palette = authPalettes[isDarkMode ? 'dark' : 'light'];
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

  const renderLightScreen = () => (
    <>
      <View style={authStyles.lightLogoWrap}>
        <Image source={lightSignInLogoSource} style={authStyles.lightHeroGraphic} resizeMode="cover" />
      </View>

      <View style={authStyles.lightCard}>
        <View style={{ gap: 8 }}>
          <Text style={authStyles.lightTitle}>Welcome Back</Text>
          <Text style={authStyles.lightSubtitle}>Sign in to keep your events moving</Text>
        </View>

        <View style={authStyles.lightForm}>
          <TextInput
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
            onSubmitEditing={onSignIn}
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
          <Link href="/(auth)/signup" style={authStyles.lightActionLink}>
            Create Account
          </Link>

          <Pressable
            style={({ pressed }) => [
              authStyles.lightButton,
              { backgroundColor: '#0EC3C9', opacity: loading ? 0.65 : 1 },
              pressed && !loading ? authStyles.buttonPressed : null,
            ]}
            onPress={onSignIn}
            disabled={loading}>
            <Text style={authStyles.buttonText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
          </Pressable>

          <Pressable onPress={onForgotPassword} disabled={resetting}>
            <Text style={authStyles.lightActionLink}>{resetting ? 'Sending reset email...' : 'Forgot Password?'}</Text>
          </Pressable>
        </View>
      </View>
    </>
  );

  const renderDarkScreen = () => (
    <>
      <View style={authStyles.darkLogoWrap}>
        <Image source={darkSignInLogoSource} style={authStyles.darkHeroGraphic} resizeMode="cover" />
      </View>

      <View style={authStyles.darkCard}>
        <View style={{ gap: 8 }}>
          <Text style={authStyles.darkTitle}>Welcome Back</Text>
          <Text style={authStyles.darkSubtitle}>Sign in to keep your events moving</Text>
        </View>

        <View style={authStyles.lightForm}>
          <TextInput
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
            onSubmitEditing={onSignIn}
            placeholderTextColor="rgba(247,247,247,0.33)"
            style={authStyles.darkInput}
          />
        </View>

        <View style={authStyles.lightActionGroup}>
          <Link href="/(auth)/signup" style={authStyles.darkActionLink}>
            Create Account
          </Link>

          <Pressable
            style={({ pressed }) => [
              authStyles.lightButton,
              { backgroundColor: palette.primary, opacity: loading ? 0.65 : 1 },
              pressed && !loading ? authStyles.buttonPressed : null,
            ]}
            onPress={onSignIn}
            disabled={loading}>
            <Text style={authStyles.buttonText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
          </Pressable>

          <Pressable onPress={onForgotPassword} disabled={resetting}>
            <Text style={authStyles.darkActionLink}>{resetting ? 'Sending reset email...' : 'Forgot Password?'}</Text>
          </Pressable>
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
