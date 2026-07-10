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
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';
import { authPalettes, authStyles } from '@/components/auth/authStyles';
import { authDarkLogoSource, authLightLogoSource } from '@/constants/branding';
import { firebaseConfigError, firebaseConfigWarnings } from '@/lib/firebase';

const lightSignInLogoSource = authLightLogoSource;
const darkSignInLogoSource = authDarkLogoSource;

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, sendPasswordReset } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const palette = authPalettes[isDarkMode ? 'dark' : 'light'];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const passwordInputRef = useRef<TextInput>(null);

  const scrollToActions = () => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
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
      {!keyboardVisible ? (
        <View style={authStyles.lightLogoWrap}>
          <Image source={lightSignInLogoSource} style={authStyles.lightHeroGraphic} resizeMode="contain" />
        </View>
      ) : null}

      <View style={authStyles.lightCard}>
        <View style={{ gap: 8 }}>
          <Text style={authStyles.lightTitle}>Welcome Back</Text>
          <Text style={authStyles.lightSubtitle}>Sign in to keep your events moving</Text>
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
            onSubmitEditing={onSignIn}
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
      {!keyboardVisible ? (
        <View style={authStyles.darkLogoWrap}>
          <Image source={darkSignInLogoSource} style={authStyles.darkHeroGraphic} resizeMode="contain" />
        </View>
      ) : null}

      <View style={authStyles.darkCard}>
        <View style={{ gap: 8 }}>
          <Text style={authStyles.darkTitle}>Welcome Back</Text>
          <Text style={authStyles.darkSubtitle}>Sign in to keep your events moving</Text>
        </View>

        <View style={authStyles.lightForm}>
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
            onSubmitEditing={onSignIn}
            onFocus={scrollToActions}
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
