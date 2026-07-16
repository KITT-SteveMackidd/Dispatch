import { useEffect, useState } from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSession, type SocialAuthResult } from '@/context/session';
import type { AppRole } from '@/types/dispatch';

type SocialAuthButtonsProps = {
  mode: 'signin' | 'signup';
  displayName?: string;
  isDarkMode: boolean;
  disabled?: boolean;
  onSuccess: () => void;
};

type ProviderButtonProps = SocialAuthButtonsProps & {
  onLoadingChange: (loading: boolean) => void;
  onAuthenticated: (result: SocialAuthResult) => void;
};

export function SocialAuthButtons(props: SocialAuthButtonsProps) {
  const { saveProfile } = useSession();
  const [loading, setLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<{ displayName: string } | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  const googleConfigured = Boolean(getGoogleClientId());
  const disabled = Boolean(props.disabled || loading || pendingProfile);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  if (!googleConfigured && !appleAvailable) return null;

  const onAuthenticated = (result: SocialAuthResult) => {
    if (result.needsRoleSelection) {
      setPendingProfile({ displayName: result.displayName });
      return;
    }

    props.onSuccess();
  };

  const selectRole = async (role: AppRole) => {
    if (!pendingProfile || savingRole) return;

    try {
      setSavingRole(true);
      await saveProfile({ displayName: pendingProfile.displayName, role });
      setPendingProfile(null);
      props.onSuccess();
    } catch (error) {
      Alert.alert('Unable to save role', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSavingRole(false);
    }
  };

  return (
    <>
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
          <AppleProviderButton {...props} disabled={disabled} onLoadingChange={setLoading} onAuthenticated={onAuthenticated} />
        ) : null}
      </View>

      <Modal visible={Boolean(pendingProfile)} transparent animationType="fade" onRequestClose={() => undefined}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.roleModal, props.isDarkMode ? styles.roleModalDark : styles.roleModalLight]}>
            <Text style={[styles.roleTitle, props.isDarkMode && styles.roleTitleDark]}>Select your role</Text>
            <Text style={[styles.roleDescription, props.isDarkMode && styles.roleDescriptionDark]}>
              How will you use Dispatch? You can change this later in Account Settings.
            </Text>
            <View style={styles.roleActions}>
              {(['manager', 'worker'] as AppRole[]).map((role) => (
                <Pressable
                  key={role}
                  accessibilityRole="button"
                  disabled={savingRole}
                  onPress={() => selectRole(role)}
                  style={({ pressed }) => [
                    styles.roleButton,
                    props.isDarkMode ? styles.roleButtonDark : styles.roleButtonLight,
                    savingRole && styles.disabled,
                    pressed && !savingRole && styles.pressed,
                  ]}>
                  <Text style={[styles.roleButtonText, props.isDarkMode && styles.roleButtonTextDark]}>
                    {savingRole ? 'Saving...' : role === 'manager' ? 'Manager' : 'Worker'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </>
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
      Alert.alert('Google authentication failed', error instanceof Error ? error.message : 'Unable to continue with Google.');
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
      <GoogleIcon size={21} />
      <Text style={[styles.providerText, props.isDarkMode && styles.providerTextDark]}>
        Continue with Google
      </Text>
    </Pressable>
  );
}

function GoogleIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no">
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
      Alert.alert('Apple authentication failed', error instanceof Error ? error.message : 'Unable to continue with Apple.');
    } finally {
      props.onLoadingChange(false);
    }
  };

  return (
    <View pointerEvents={props.disabled ? 'none' : 'auto'} style={props.disabled && styles.disabled}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonStyle={props.isDarkMode
          ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
          : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        buttonType={props.mode === 'signup'
          ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
          : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        cornerRadius={8}
        onPress={onApplePress}
        style={styles.appleButton}
      />
    </View>
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
  providerText: { color: '#232832', fontWeight: '700' },
  providerTextDark: { color: '#F4F8FF' },
  appleButton: { width: '100%', height: 44 },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6, 18, 41, 0.68)',
    padding: 24,
  },
  roleModal: {
    width: '100%',
    maxWidth: 390,
    borderRadius: 8,
    borderWidth: 1,
    padding: 22,
  },
  roleModalLight: { backgroundColor: '#FFFFFF', borderColor: '#CBD5E1' },
  roleModalDark: { backgroundColor: '#12274D', borderColor: '#38517E' },
  roleTitle: { color: '#121212', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  roleTitleDark: { color: '#F4F8FF' },
  roleDescription: { color: '#64748B', fontSize: 15, lineHeight: 21, marginTop: 8, textAlign: 'center' },
  roleDescriptionDark: { color: '#CBD5E1' },
  roleActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  roleButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  roleButtonLight: { backgroundColor: '#0EC3C9', borderColor: '#0EC3C9' },
  roleButtonDark: { backgroundColor: '#0EC3C9', borderColor: '#0EC3C9' },
  roleButtonText: { color: '#061229', fontSize: 16, fontWeight: '800' },
  roleButtonTextDark: { color: '#061229' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.78 },
});
