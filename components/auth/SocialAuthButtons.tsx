import { useState } from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSession, type SocialAuthResult } from '@/context/session';
import { getAuthErrorMessage } from '@/lib/auth-error-messages';
import { nativeGoogleSignInBlocker, optionalGoogleClientId } from '@/lib/optional-google-config';

type AppleAuthenticationModule = typeof import('expo-apple-authentication');
type CryptoModule = typeof import('expo-crypto');

type SocialAuthButtonsProps = {
  mode: 'signin' | 'signup';
  actionLabel?: 'default' | 'continue';
  displayName?: string;
  isDarkMode: boolean;
  disabled?: boolean;
  onSuccess: (result: SocialAuthResult) => void;
};

type ProviderButtonProps = SocialAuthButtonsProps & {
  onLoadingChange: (loading: boolean) => void;
  onAuthenticated: (result: SocialAuthResult) => void;
};

export function SocialAuthButtons(props: SocialAuthButtonsProps) {
  const [loading, setLoading] = useState(false);
  // Keep the native account choices visible in Expo Go and customer previews.
  // The press handler explains builds that cannot yet authenticate with Google.
  const googleAvailable = Platform.OS === 'ios' || Platform.OS === 'android';
  const appleAvailable = Platform.OS === 'ios';
  const disabled = Boolean(props.disabled || loading);

  if (!googleAvailable && !appleAvailable) return null;

  const onAuthenticated = (result: SocialAuthResult) => props.onSuccess(result);

  return (
    <View style={styles.container}>
      <View style={styles.dividerRow}>
        <View style={[styles.divider, props.isDarkMode && styles.dividerDark]} />
        <Text style={[styles.dividerText, props.isDarkMode && styles.dividerTextDark]}>or</Text>
        <View style={[styles.divider, props.isDarkMode && styles.dividerDark]} />
      </View>

      {googleAvailable ? (
        <GoogleProviderButton {...props} disabled={disabled} onLoadingChange={setLoading} onAuthenticated={onAuthenticated} />
      ) : null}

      {appleAvailable ? (
        <AppleProviderButton
          {...props}
          disabled={disabled}
          onLoadingChange={setLoading}
          onAuthenticated={onAuthenticated}
        />
      ) : null}
    </View>
  );
}

function GoogleProviderButton(props: ProviderButtonProps) {
  const { signInWithGoogle } = useSession();

  const onGooglePress = async () => {
    const blocker = nativeGoogleSignInBlocker({
      platform: Platform.OS,
      isExpoGo: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    });
    if (blocker === 'expo-go') {
      Alert.alert(
        'Development build required',
        'Google sign-in cannot run inside Expo Go. Use email and password here, or open a Dispatch build with Google sign-in configured.'
      );
      return;
    }
    if (blocker) {
      Alert.alert(
        'Google sign-in is not configured',
        'Google sign-in is not available in this build yet. Please use email and password to continue.'
      );
      return;
    }

    try {
      props.onLoadingChange(true);
      const { GoogleSignin, isSuccessResponse } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({
        webClientId: optionalGoogleClientId(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
        iosClientId: optionalGoogleClientId(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
        offlineAccess: false,
      });
      if (Platform.OS === 'android') {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }

      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) return;

      const idToken = response.data.idToken;
      if (!idToken) throw new Error('Google did not return an ID token.');

      const result = await signInWithGoogle({
        idToken,
        displayName: props.displayName?.trim() || response.data.user.name || undefined,
        mode: props.mode,
      });
      props.onAuthenticated(result);
    } catch (error) {
      Alert.alert('Google authentication failed', getAuthErrorMessage(error, 'google'));
    } finally {
      props.onLoadingChange(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.actionLabel === 'continue' ? 'Continue' : props.mode === 'signup' ? 'Create account' : 'Sign in'} with Google`}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={onGooglePress}
      style={({ pressed }) => [
        styles.providerButton,
        props.isDarkMode ? styles.providerButtonDark : styles.providerButtonLight,
        props.disabled && styles.disabled,
        pressed && !props.disabled && styles.pressed,
      ]}>
      <GoogleIcon />
      <Text style={[styles.providerText, props.isDarkMode && styles.providerTextDark]}>
        Continue with Google
      </Text>
    </Pressable>
  );
}

function GoogleIcon() {
  return (
    <Svg width={21} height={21} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

function AppleProviderButton(props: ProviderButtonProps) {
  const { signInWithApple } = useSession();

  const onApplePress = async () => {
    try {
      props.onLoadingChange(true);
      // Keep optional native modules completely off the startup render path.
      // Any linking problem now occurs inside this guarded user action instead
      // of becoming a fatal production exception at the splash screen.
      const AppleAuthentication = require('expo-apple-authentication') as AppleAuthenticationModule;
      const Crypto = require('expo-crypto') as CryptoModule;
      const available = await AppleAuthentication.isAvailableAsync();
      if (!available) throw new Error('Apple authentication is not available on this device.');

      const rawNonce = Crypto.randomUUID();
      const nonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const result = await AppleAuthentication.signInAsync({
        nonce,
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!result.identityToken) throw new Error('Apple did not return an identity token.');
      const appleName = [result.fullName?.givenName, result.fullName?.familyName].filter(Boolean).join(' ').trim();

      const authResult = await signInWithApple({
        idToken: result.identityToken,
        rawNonce,
        displayName: props.displayName?.trim() || appleName || undefined,
        mode: props.mode,
      });
      props.onAuthenticated(authResult);
    } catch (error) {
      if (isAppleCancellation(error)) return;
      Alert.alert('Apple authentication failed', getAuthErrorMessage(error, 'apple'));
    } finally {
      props.onLoadingChange(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.actionLabel === 'continue' ? 'Continue' : props.mode === 'signup' ? 'Sign up' : 'Sign in'} with Apple`}
      disabled={props.disabled}
      onPress={onApplePress}
      style={({ pressed }) => [
        styles.appleButton,
        props.isDarkMode ? styles.appleButtonOnDark : styles.appleButtonOnLight,
        props.disabled && styles.disabled,
        pressed && !props.disabled && styles.pressed,
      ]}>
      <Text style={[styles.appleLogo, props.isDarkMode && styles.appleContentOnDark]}></Text>
      <Text style={[styles.appleText, props.isDarkMode && styles.appleContentOnDark]}>
        {props.actionLabel === 'continue' ? 'Continue with Apple' : props.mode === 'signup' ? 'Sign up with Apple' : 'Sign in with Apple'}
      </Text>
    </Pressable>
  );
}

function isAppleCancellation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_REQUEST_CANCELED';
}

const styles = StyleSheet.create({
  container: { gap: 10, marginTop: 4 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 },
  divider: { flex: 1, height: 1, backgroundColor: '#CBD5E1' },
  dividerDark: { backgroundColor: '#38517E' },
  dividerText: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  dividerTextDark: { color: '#CBD5E1' },
  providerButton: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 14,
  },
  providerButtonLight: { backgroundColor: '#FFFFFF', borderColor: '#CBD5E1' },
  providerButtonDark: { backgroundColor: '#12274D', borderColor: '#38517E' },
  providerText: { color: '#232832', fontWeight: '700' },
  providerTextDark: { color: '#F4F8FF' },
  appleButton: {
    width: '100%',
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 14,
  },
  appleButtonOnLight: { backgroundColor: '#000000', borderColor: '#000000' },
  appleButtonOnDark: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  appleLogo: { color: '#FFFFFF', fontSize: 21, lineHeight: 24 },
  appleText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  appleContentOnDark: { color: '#000000' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.78 },
});
