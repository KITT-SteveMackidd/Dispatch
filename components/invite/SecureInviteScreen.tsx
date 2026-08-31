import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SocialAuthButtons } from '@/components/auth/SocialAuthButtons';
import { headerLogoSource } from '@/constants/branding';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';
import {
  claimSecureDispatchInvite,
  getSecureDispatchInvite,
  secureInviteErrorMessage,
  type SecureInvitePreview,
} from '@/lib/secure-invites';

type SecureInviteScreenProps = {
  tokenOrCode: string;
  embedded?: boolean;
  inviteOnboarding?: boolean;
};

export function SecureInviteScreen({
  tokenOrCode,
  embedded = false,
  inviteOnboarding = false,
}: SecureInviteScreenProps) {
  const router = useRouter();
  const { authUser, refreshProfile, requiresEmailVerification, signOut } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [preview, setPreview] = useState<SecureInvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMessage('');
    getSecureDispatchInvite(tokenOrCode)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((error) => {
        if (active) setErrorMessage(secureInviteErrorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tokenOrCode]);

  const claimInvitation = async () => {
    if (!authUser || claiming) return;
    setClaiming(true);
    setErrorMessage('');
    try {
      await claimSecureDispatchInvite(tokenOrCode);
      await refreshProfile();
      router.replace('/(tabs)');
    } catch (error) {
      setErrorMessage(secureInviteErrorMessage(error));
    } finally {
      setClaiming(false);
    }
  };

  const useAnotherAccount = async () => {
    await signOut();
  };

  const destination = preview?.teamName || preview?.organizationName || 'Dispatch';
  const roleLabel = preview?.inviteKind === 'manager' ? 'Manager' : 'Worker';
  const canClaim = Boolean(preview?.canClaim);
  const authParams = {
    inviteToken: tokenOrCode,
    inviteOnboarding: inviteOnboarding ? '1' : '0',
  };

  const invitationCard = (
    <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
          <Text style={[styles.eyebrow, isDarkMode ? styles.tealText : styles.orangeText]}>Dispatch invitation</Text>
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#0EC3C9" />
              <Text style={[styles.body, isDarkMode ? styles.textDark : styles.textLight]}>Loading invitation...</Text>
            </View>
          ) : preview ? (
            <>
              <Text style={[styles.title, isDarkMode ? styles.textDark : styles.textLight]}>Join {destination}</Text>
              <Text style={[styles.body, isDarkMode ? styles.mutedDark : styles.mutedLight]}>
                You were invited as a {roleLabel}. Sign in using the account you want connected to Dispatch.
              </Text>
              <View style={[styles.summary, isDarkMode ? styles.summaryDark : styles.summaryLight]}>
                <SummaryRow label="Organization" value={preview.organizationName} isDarkMode={isDarkMode} />
                {preview.teamName ? <SummaryRow label="Team" value={preview.teamName} isDarkMode={isDarkMode} /> : null}
                <SummaryRow label="Role" value={roleLabel} isDarkMode={isDarkMode} />
                {preview.deliveryEmailHint ? <SummaryRow label="Sent to" value={preview.deliveryEmailHint} isDarkMode={isDarkMode} /> : null}
                {preview.expiresAt ? <SummaryRow label="Expires" value={formatExpiry(preview.expiresAt)} isDarkMode={isDarkMode} /> : null}
              </View>

              {!canClaim ? (
                <Text style={styles.errorText}>This invitation is {preview.status}. Ask the Manager to send a new one.</Text>
              ) : authUser ? (
                requiresEmailVerification ? (
                  <>
                    <Text style={[styles.body, isDarkMode ? styles.mutedDark : styles.mutedLight]}>
                      Verify {authUser.email || 'your email'} before joining this invitation.
                    </Text>
                    <Pressable
                      style={styles.primaryButton}
                      onPress={() => router.push({ pathname: '/(auth)/verify-email', params: authParams })}>
                      <Text style={styles.primaryButtonText}>Verify email</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={[styles.signedInText, isDarkMode ? styles.mutedDark : styles.mutedLight]}>
                      Signed in as {authUser.email || authUser.displayName || 'this account'}
                    </Text>
                    <Pressable style={[styles.primaryButton, claiming && styles.disabled]} disabled={claiming} onPress={claimInvitation}>
                      <Text style={styles.primaryButtonText}>{claiming ? 'Joining...' : 'Join and get started'}</Text>
                    </Pressable>
                    <Pressable style={styles.textButton} disabled={claiming} onPress={useAnotherAccount}>
                      <Text style={styles.textButtonLabel}>Use another account</Text>
                    </Pressable>
                  </>
                )
              ) : (
                <>
                  <SocialAuthButtons
                    mode="signup"
                    actionLabel="continue"
                    isDarkMode={isDarkMode}
                    onSuccess={() => undefined}
                  />
                  <Pressable
                    style={styles.primaryButton}
                    onPress={() => router.push({ pathname: '/(auth)/signin', params: authParams })}>
                    <Text style={styles.primaryButtonText}>Sign in with email</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.secondaryButton, isDarkMode ? styles.secondaryButtonDark : styles.secondaryButtonLight]}
                    onPress={() => router.push({ pathname: '/(auth)/signup', params: authParams })}>
                    <Text style={[styles.secondaryButtonText, isDarkMode ? styles.textDark : styles.textLight]}>Create account with email</Text>
                  </Pressable>
                </>
              )}
            </>
          ) : null}

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          <Pressable style={styles.textButton} onPress={() => router.push('/invite')}>
            <Text style={styles.textButtonLabel}>Enter a different invitation code</Text>
          </Pressable>
          {!embedded ? (
            <Pressable style={styles.textButton} onPress={() => router.replace('/')}>
              <Text style={styles.textButtonLabel}>Back to Dispatch</Text>
            </Pressable>
          ) : null}
    </View>
  );

  if (embedded) {
    return <View style={styles.embeddedContent}>{invitationCard}</View>;
  }

  return (
    <SafeAreaView style={[styles.screen, isDarkMode ? styles.screenDark : styles.screenLight]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Image source={headerLogoSource} style={styles.logo} resizeMode="contain" />
        {invitationCard}
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, isDarkMode }: { label: string; value: string; isDarkMode: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, isDarkMode ? styles.mutedDark : styles.mutedLight]}>{label}</Text>
      <Text style={[styles.summaryValue, isDarkMode ? styles.textDark : styles.textLight]}>{value}</Text>
    </View>
  );
}

function formatExpiry(value: number) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Soon';
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenLight: { backgroundColor: '#DBE2F9' },
  screenDark: { backgroundColor: '#061229' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingBottom: 36 },
  embeddedContent: { width: '100%' },
  logo: { alignSelf: 'center', width: 86, height: 86, marginBottom: 18 },
  card: { width: '100%', maxWidth: 560, alignSelf: 'center', borderRadius: 8, borderWidth: 1, padding: 20 },
  cardLight: { backgroundColor: '#F7F7F7', borderColor: 'rgba(6,18,41,0.12)' },
  cardDark: { backgroundColor: '#12274D', borderColor: 'rgba(247,247,247,0.16)' },
  eyebrow: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  tealText: { color: '#0EC3C9' },
  orangeText: { color: '#F98D2F' },
  title: { marginTop: 6, fontSize: 27, lineHeight: 32, fontWeight: '800' },
  body: { marginTop: 10, fontSize: 15, lineHeight: 22 },
  textLight: { color: '#121212' },
  textDark: { color: '#F7F7F7' },
  mutedLight: { color: '#64748B' },
  mutedDark: { color: '#CBD5E1' },
  loadingWrap: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 12 },
  summary: { marginTop: 18, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  summaryLight: { backgroundColor: '#EDF0FC' },
  summaryDark: { backgroundColor: '#203E75' },
  summaryRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  summaryLabel: { fontSize: 13, fontWeight: '600' },
  summaryValue: { flex: 1, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  signedInText: { marginTop: 16, fontSize: 13, textAlign: 'center' },
  primaryButton: { minHeight: 50, marginTop: 14, borderRadius: 8, backgroundColor: '#0EC3C9', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  primaryButtonText: { color: '#061229', fontSize: 16, fontWeight: '800' },
  secondaryButton: { minHeight: 50, marginTop: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryButtonLight: { borderColor: '#94A3B8', backgroundColor: '#F7F7F7' },
  secondaryButtonDark: { borderColor: '#64748B', backgroundColor: '#12274D' },
  secondaryButtonText: { fontSize: 15, fontWeight: '700' },
  textButton: { minHeight: 44, marginTop: 8, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { color: '#F98D2F', fontSize: 14, fontWeight: '700' },
  errorText: { marginTop: 14, color: '#B42318', fontSize: 14, lineHeight: 20, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.6 },
});
