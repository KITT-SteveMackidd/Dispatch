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
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';
import { authPalettes, authStyles } from '@/components/auth/authStyles';
import { SocialAuthButtons } from '@/components/auth/SocialAuthButtons';
import { authDarkLogoSource, authLightLogoSource } from '@/constants/branding';
import { firebaseConfigError, firebaseConfigWarnings } from '@/lib/firebase';
import { getAuthErrorMessage } from '@/lib/auth-error-messages';

const lightSignUpLogoSource = authLightLogoSource;
const darkSignUpLogoSource = authDarkLogoSource;

export default function SignUpScreen() {
  const router = useRouter();
  const {
    inviteToken: inviteTokenParam,
    inviteOnboarding: inviteOnboardingParam,
  } = useLocalSearchParams<{
    inviteToken?: string | string[];
    inviteOnboarding?: string | string[];
  }>();
  const inviteToken = Array.isArray(inviteTokenParam) ? inviteTokenParam[0] : inviteTokenParam;
  const inviteOnboardingValue = Array.isArray(inviteOnboardingParam)
    ? inviteOnboardingParam[0]
    : inviteOnboardingParam;
  const isInviteOnboarding = inviteOnboardingValue === '1';
  const inviteAuthParams = inviteToken
    ? { inviteToken, inviteOnboarding: isInviteOnboarding ? '1' : '0' }
    : null;
  const { signUp } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const palette = authPalettes[isDarkMode ? 'dark' : 'light'];
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);

  const scrollToActions = () => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
  };

  const returnToInvitation = () => {
    if (!inviteToken) return false;

    if (isInviteOnboarding) {
      router.replace({
        pathname: '/(auth)/setup',
        params: { inviteToken, inviteResume: '1' },
      });
    } else {
      router.replace({
        pathname: '/invite/[token]',
        params: { token: inviteToken, direct: '1' },
      });
    }
    return true;
  };

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
      scrollToActions();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const onSignUp = async () => {
    if (firebaseConfigError) {
      return Alert.alert('Firebase setup error', firebaseConfigError);
    }
    if (!displayName.trim() || !email.trim() || !password) {
      return Alert.alert('Missing fields', 'Enter name, email, and password.');
    }

    setLoading(true);
    try {
      const delivery = await signUp({ displayName: displayName.trim(), email, password });
      Alert.alert(
        delivery.queued ? 'Verify your email' : 'Account created',
        delivery.queued
          ? `We sent a verification link to ${email.trim()}. Check that inbox and its spam folder, then verify your email to continue.`
          : 'Your account was created, but the verification email could not be sent. Use Resend verification email on the next screen.'
      );
      router.replace(inviteToken
        ? { pathname: '/(auth)/verify-email', params: inviteAuthParams! }
        : '/(auth)/verify-email');
    } catch (error) {
      Alert.alert('Sign up failed', getAuthErrorMessage(error, 'signup'));
    } finally {
      setLoading(false);
    }
  };

  const renderLightScreen = () => (
    <>
      {!keyboardVisible ? (
        <View style={authStyles.lightLogoWrap}>
          <Image source={lightSignUpLogoSource} style={authStyles.lightHeroGraphic} resizeMode="contain" />
        </View>
      ) : null}

      <View style={authStyles.lightCard}>
        <View style={{ gap: 10 }}>
          <Text style={authStyles.lightTitle}>Create your account</Text>
          <Text style={authStyles.lightSubtitle}>Set up your Dispatch workspace with a cleaner, faster path into your events.</Text>
        </View>

        <View style={authStyles.lightForm}>
          {firebaseConfigError ? (
            <Text style={{ color: '#b42318', fontSize: 13, fontWeight: '700' }}>
              {firebaseConfigError}
            </Text>
          ) : null}
          {firebaseConfigWarnings.map((warning) => (
            <Text key={warning} style={{ color: '#b45309', fontSize: 13, fontWeight: '700' }}>
              {warning}
            </Text>
          ))}
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Full Name"
            returnKeyType="next"
            onSubmitEditing={() => emailInputRef.current?.focus()}
            onFocus={scrollToActions}
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
            onFocus={scrollToActions}
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
            onFocus={scrollToActions}
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
          <Pressable
            style={({ pressed }) => [
              authStyles.lightButton,
              { backgroundColor: '#0EC3C9', opacity: loading ? 0.65 : 1 },
              pressed && !loading ? authStyles.buttonPressed : null,
            ]}
            onPress={onSignUp}
            disabled={loading || Boolean(firebaseConfigError)}>
            <Text style={authStyles.buttonText}>{loading ? 'Creating account...' : 'Create Account'}</Text>
          </Pressable>

          <SocialAuthButtons
            mode="signup"
            displayName={displayName}
            isDarkMode={false}
            disabled={loading || Boolean(firebaseConfigError)}
            onSuccess={(result) => {
              if (!returnToInvitation()) {
                router.replace(result.needsRoleSelection ? '/(auth)/setup' : '/(tabs)');
              }
            }}
          />

          <Link href="/invite" style={authStyles.lightActionLink}>Use Invitation Code</Link>

          <View style={authStyles.lightFooterRow}>
            <Text style={authStyles.lightFooterLabel}>Already have an account?</Text>
            <Link href={inviteAuthParams ? { pathname: '/(auth)/signin', params: inviteAuthParams } : '/(auth)/signin'} style={authStyles.lightFooterLink}>
              Sign In
            </Link>
          </View>
        </View>
      </View>
    </>
  );

  const renderDarkScreen = () => (
    <>
      {!keyboardVisible ? (
        <View style={authStyles.darkLogoWrap}>
          <Image source={darkSignUpLogoSource} style={authStyles.darkHeroGraphic} resizeMode="contain" />
        </View>
      ) : null}

      <View style={authStyles.darkCard}>
        <View style={{ gap: 10 }}>
          <Text style={authStyles.darkTitle}>Create your account</Text>
          <Text style={authStyles.darkSubtitle}>Set up your Dispatch workspace with a cleaner, faster path into your events.</Text>
        </View>

        <View style={authStyles.darkForm}>
          {firebaseConfigError ? (
            <Text style={{ color: '#fca5a5', fontSize: 13, fontWeight: '700' }}>
              {firebaseConfigError}
            </Text>
          ) : null}
          {firebaseConfigWarnings.map((warning) => (
            <Text key={warning} style={{ color: '#fbbf24', fontSize: 13, fontWeight: '700' }}>
              {warning}
            </Text>
          ))}
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Full Name"
            returnKeyType="next"
            onSubmitEditing={() => emailInputRef.current?.focus()}
            onFocus={scrollToActions}
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
            onFocus={scrollToActions}
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
            onFocus={scrollToActions}
            placeholderTextColor="rgba(247,247,247,0.33)"
            style={authStyles.darkInput}
          />

          <Pressable
            style={({ pressed }) => [
              authStyles.darkButton,
              { backgroundColor: '#0EC3C9', opacity: loading ? 0.65 : 1 },
              pressed && !loading ? authStyles.buttonPressed : null,
            ]}
            onPress={onSignUp}
            disabled={loading || Boolean(firebaseConfigError)}>
            <Text style={authStyles.buttonText}>{loading ? 'Creating account...' : 'Create Account'}</Text>
          </Pressable>

          <SocialAuthButtons
            mode="signup"
            displayName={displayName}
            isDarkMode
            disabled={loading || Boolean(firebaseConfigError)}
            onSuccess={(result) => {
              if (!returnToInvitation()) {
                router.replace(result.needsRoleSelection ? '/(auth)/setup' : '/(tabs)');
              }
            }}
          />

          <Link href="/invite" style={authStyles.darkActionLink}>Use Invitation Code</Link>

          <View style={authStyles.darkFooterRow}>
            <Text style={authStyles.darkFooterLabel}>Already have an account?</Text>
            <Link href={inviteAuthParams ? { pathname: '/(auth)/signin', params: inviteAuthParams } : '/(auth)/signin'} style={authStyles.darkFooterLink}>
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
          ref={scrollRef}
          contentContainerStyle={[
            isDarkMode ? authStyles.darkScrollContent : authStyles.lightScrollContent,
            keyboardVisible && { justifyContent: 'flex-end', paddingBottom: 16 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          {isDarkMode ? renderDarkScreen() : renderLightScreen()}
        </ScrollView>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
