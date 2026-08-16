import { useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';

export default function VerifyEmailScreen() {
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
  const { authUser, refreshAuthUser, sendVerificationEmail, signOut } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [resendLoading, setResendLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);

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

  const onResend = async () => {
    setResendLoading(true);
    try {
      await sendVerificationEmail();
      Alert.alert('Verification email sent', 'Check your inbox (and spam folder) for a new verification link.');
    } catch (error) {
      Alert.alert('Unable to send email', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshLoading(true);
    try {
      const isVerified = await refreshAuthUser();
      if (isVerified) {
        if (!returnToInvitation()) router.replace('/');
      } else {
        Alert.alert('Not verified yet', 'We still show this account as unverified. Open the link from your email, then try again.');
      }
    } catch (error) {
      Alert.alert('Unable to refresh', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setRefreshLoading(false);
    }
  };

  const onUseAnotherAccount = async () => {
    await signOut();
    router.replace(inviteAuthParams
      ? { pathname: '/(auth)/signin', params: inviteAuthParams }
      : '/(auth)/signin');
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}
      behavior={Platform.select({ ios: 'padding', android: 'height' })}>
      <Pressable style={styles.flex} onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
            <Text style={[styles.eyebrow, isDarkMode ? styles.eyebrowDark : styles.eyebrowLight]}>Security</Text>
            <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Verify your email</Text>
            <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>
              You must verify {authUser?.email || 'your account email'} before accessing manager or worker workflows.
            </Text>

            <Pressable style={[styles.btn, resendLoading && styles.disabled]} onPress={onResend} disabled={resendLoading}>
              <Text style={styles.btnText}>{resendLoading ? 'Sending...' : 'Resend verification email'}</Text>
            </Pressable>

            <Pressable style={[styles.btnSecondary, refreshLoading && styles.disabled]} onPress={onRefresh} disabled={refreshLoading}>
              <Text style={styles.btnSecondaryText}>{refreshLoading ? 'Checking...' : "I've verified, continue"}</Text>
            </Pressable>

            <Pressable onPress={onUseAnotherAccount}>
              <Text style={[styles.link, isDarkMode ? styles.linkDark : styles.linkLight]}>Use another account</Text>
            </Pressable>
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
  btn: { backgroundColor: '#2563eb', borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 8 },
  btnSecondary: { backgroundColor: '#1d4ed8', borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 10 },
  disabled: { opacity: 0.65 },
  btnText: { color: 'white', fontWeight: '700' },
  btnSecondaryText: { color: 'white', fontWeight: '700' },
  link: { marginTop: 14, fontWeight: '600', textAlign: 'center' },
  linkLight: { color: '#2563eb' },
  linkDark: { color: '#0EC3C9' },
});
