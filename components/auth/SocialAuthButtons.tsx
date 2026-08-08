import { useState } from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession, type SocialAuthResult } from '@/context/session';
import { getAuthErrorMessage } from '@/lib/auth-error-messages';

type AppleAuthenticationModule = typeof import('expo-apple-authentication');
type CryptoModule = typeof import('expo-crypto');

type SocialAuthButtonsProps = {
  mode: 'signin' | 'signup';
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
  const googleConfigured = Boolean(getGoogleClientId());
  const appleAvailable = Platform.OS === 'ios';
  const disabled = Boolean(props.disabled || loading);

  if (!googleConfigured && !appleAvailable) return null;

  const onAuthenticated = (result: SocialAuthResult) => props.onSuccess(result);

  return (
    <View style={styles.container}>
      <View style={styles.dividerRow}>
        <View style={[styles.divider, props.isDarkMode && styles.dividerDark]} />
        <Text style={[styles.dividerText, props.isDarkMode && styles.dividerTextDark]}>or</Text>
        <View style={[styles.divider, props.isDarkMode && styles.dividerDark]} />
      </View>

      {googleConfigured ? (
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
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      Alert.alert(
        'Development build required',
        'Google sign-in cannot run inside Expo Go because Dispatch needs its own secure callback. Open a Dispatch development or preview build to use Google sign-in.'
      );
      return;
    }

    try {
      props.onLoadingChange(true);
      const { GoogleSignin, isSuccessResponse } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
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
      accessibilityLabel={`${props.mode === 'signup' ? 'Create account' : 'Sign in'} with Google`}
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
    <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.googleIcon}>G</Text>
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
      accessibilityLabel={`${props.mode === 'signup' ? 'Sign up' : 'Sign in'} with Apple`}
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
        {props.mode === 'signup' ? 'Sign up with Apple' : 'Sign in with Apple'}
      </Text>
    </Pressable>
  );
}

function isAppleCancellation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_REQUEST_CANCELED';
}

function getGoogleClientId() {
  if (Platform.OS === 'ios') {
    return process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID;
  }
  if (Platform.OS === 'android') {
    return process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID;
  }
  return process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID;
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
  googleIcon: { color: '#4285F4', fontSize: 21, fontWeight: '800', lineHeight: 24 },
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
