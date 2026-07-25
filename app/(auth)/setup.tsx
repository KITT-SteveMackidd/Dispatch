import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { headerLogoSource } from '@/constants/branding';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';
import { createOrganisationForManager, loadWorkerTeams } from '@/services/dispatch';
import type { AppRole, UserProfile } from '@/types/dispatch';

const TOTAL_STEPS = 5;

const illustrations = {
  welcome: require('../../assets/images/onboarding/onboarding-welcome.png'),
  manager: require('../../assets/images/onboarding/onboarding-manager.png'),
  worker: require('../../assets/images/onboarding/onboarding-worker.png'),
  role: require('../../assets/images/onboarding/onboarding-role.png'),
  ready: require('../../assets/images/onboarding/onboarding-ready.png'),
};

type MembershipSummary = {
  organizationName: string | null;
  teamNames: string[];
};

const emptyMembership: MembershipSummary = {
  organizationName: null,
  teamNames: [],
};

export default function SetupScreen() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const {
    authUser,
    profile,
    saveProfile,
    refreshProfile,
    completeOnboarding,
  } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const colors = isDarkMode ? darkColors : lightColors;

  const [step, setStep] = useState(profile?.onboardingCompleted === false ? 4 : 0);
  const [selectedRole, setSelectedRole] = useState<AppRole | null>(profile?.role || null);
  const [membership, setMembership] = useState<MembershipSummary>(emptyMembership);
  const [organizationName, setOrganizationName] = useState('');
  const [busy, setBusy] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(profile?.onboardingCompleted === false);
  const [errorMessage, setErrorMessage] = useState('');
  const resumeIncompleteProfile = useRef(profile?.onboardingCompleted === false);

  const displayName = useMemo(() => {
    const knownName = authUser?.displayName?.trim() || profile?.displayName?.trim();
    if (knownName) return knownName;

    const localPart = authUser?.email?.split('@')[0]?.split('+')[0] || '';
    return localPart
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(' ') || 'Dispatch User';
  }, [authUser?.displayName, authUser?.email, profile?.displayName]);

  const illustrationHeight = Math.min(330, Math.max(220, height * 0.34));

  useEffect(() => {
    if (!authUser) {
      router.replace('/(auth)/signin');
    }
  }, [authUser, router]);

  useEffect(() => {
    let active = true;

    if (!resumeIncompleteProfile.current || !profile || profile.onboardingCompleted !== false) {
      return () => {
        active = false;
      };
    }

    setSelectedRole(profile.role);
    setStep(4);
    setMembershipLoading(true);

    loadMembershipSummary(profile)
      .then((summary) => {
        if (active) setMembership(summary);
      })
      .catch(() => {
        if (active) {
          setMembership({
            organizationName: profile.organizationName || null,
            teamNames: [],
          });
        }
      })
      .finally(() => {
        if (active) setMembershipLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    profile?.uid,
    profile?.role,
    profile?.organizationId,
    profile?.organizationName,
    profile?.onboardingCompleted,
  ]);

  const moveForward = () => {
    setErrorMessage('');
    setStep((current) => Math.min(3, current + 1));
  };

  const moveBack = () => {
    setErrorMessage('');
    setStep((current) => Math.max(0, current - 1));
  };

  const continueWithRole = async () => {
    if (!selectedRole || !authUser || busy) return;

    try {
      setBusy(true);
      setErrorMessage('');
      await saveProfile({
        displayName,
        role: selectedRole,
        onboardingCompleted: false,
      });

      const nextProfile = await refreshProfile();
      if (!nextProfile) throw new Error('Your Dispatch profile could not be loaded.');

      setMembershipLoading(true);
      const summary = await loadMembershipSummary(nextProfile);
      setMembership(summary);
      setStep(4);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save your role. Please try again.');
    } finally {
      setMembershipLoading(false);
      setBusy(false);
    }
  };

  const finishOnboarding = async () => {
    if (!selectedRole || busy) return;

    try {
      setBusy(true);
      setErrorMessage('');

      if (selectedRole === 'manager' && !membership.organizationName) {
        const trimmedName = organizationName.trim();
        if (!trimmedName) {
          setErrorMessage('Enter an organization name to continue.');
          return;
        }
        if (!profile?.uid) throw new Error('Your manager profile is not ready yet.');

        await createOrganisationForManager({
          managerId: profile.uid,
          name: trimmedName,
        });
        await refreshProfile();
      }

      await completeOnboarding();
      router.replace('/(tabs)');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to finish setup. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const renderStepContent = () => {
    if (step === 0) {
      return (
        <OnboardingMessage
          colors={colors}
          eyebrow="Welcome"
          title={`Welcome to Dispatch${displayName === 'Dispatch User' ? '' : `, ${displayName.split(' ')[0]}`}`}
          body="Your event crew, roles, tasks, and updates stay together so everyone arrives knowing what comes next."
          points={['One shared event plan', 'Clear roles and task timing', 'Live updates across the crew']}
        />
      );
    }

    if (step === 1) {
      return (
        <OnboardingMessage
          colors={colors}
          eyebrow="The Manager role"
          title="Keep the whole crew moving"
          body="Managers organize the people and details behind each event, then see progress as the day unfolds."
          points={['Create organizations, teams, and events', 'Assign roles and invite workers', 'Follow live task and staffing updates']}
        />
      );
    }

    if (step === 2) {
      return (
        <OnboardingMessage
          colors={colors}
          eyebrow="The Worker role"
          title="Know exactly what comes next"
          body="Workers see the events they are part of, respond to role invites, and work through their live task list."
          points={['Accept roles or join a waitlist', 'See event details and task timing', 'Stay connected with managers and teammates']}
        />
      );
    }

    if (step === 3) {
      return (
        <View style={styles.messageBlock}>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>Choose your role</Text>
          <Text style={[styles.title, { color: colors.text }]}>How will you use Dispatch?</Text>
          <Text style={[styles.body, { color: colors.muted }]}>
            Choose the role that matches your work. You can update it later in Account Settings.
          </Text>

          <View style={styles.roleList}>
            <RoleOption
              label="Manager"
              description="Plan events, organize teams, assign roles, and follow progress."
              selected={selectedRole === 'manager'}
              colors={colors}
              onPress={() => {
                setErrorMessage('');
                setSelectedRole('manager');
              }}
            />
            <RoleOption
              label="Worker"
              description="Join teams, respond to role invites, and complete event tasks."
              selected={selectedRole === 'worker'}
              colors={colors}
              onPress={() => {
                setErrorMessage('');
                setSelectedRole('worker');
              }}
            />
          </View>
        </View>
      );
    }

    return renderFinalStep();
  };

  const renderFinalStep = () => {
    if (membershipLoading) {
      return (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.teal} size="large" />
          <Text style={[styles.loadingText, { color: colors.muted }]}>Checking your invitations...</Text>
        </View>
      );
    }

    if (selectedRole === 'manager') {
      if (membership.organizationName) {
        return (
          <OnboardingMessage
            colors={colors}
            eyebrow="Invitation confirmed"
            title={`You're joining ${membership.organizationName}`}
            body="Your manager account is connected to the organization. You can work across every team and start organizing events."
            points={['Organization access confirmed', 'All organization teams available', 'Ready to start managing']}
          />
        );
      }

      return (
        <View style={styles.messageBlock}>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>Create your workspace</Text>
          <Text style={[styles.title, { color: colors.text }]}>Create your organization</Text>
          <Text style={[styles.body, { color: colors.muted }]}>
            We did not find a manager invitation for this email. Name your organization to create it and get started.
          </Text>
          <Text style={[styles.inputLabel, { color: colors.text }]}>Organization name</Text>
          <TextInput
            accessibilityLabel="Organization name"
            autoCapitalize="words"
            editable={!busy}
            onChangeText={(value) => {
              setErrorMessage('');
              setOrganizationName(value);
            }}
            placeholder="Your organization"
            placeholderTextColor={colors.placeholder}
            returnKeyType="done"
            style={[
              styles.input,
              {
                backgroundColor: colors.input,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={organizationName}
          />
        </View>
      );
    }

    if (membership.teamNames.length) {
      const teamLabel = formatList(membership.teamNames);
      return (
        <OnboardingMessage
          colors={colors}
          eyebrow="Invitation confirmed"
          title={membership.teamNames.length === 1 ? 'Your team is ready' : 'Your teams are ready'}
          body={`You were invited to ${teamLabel}${membership.organizationName ? ` in ${membership.organizationName}` : ''}. Your account is linked and ready.`}
          points={membership.teamNames.map((name) => `Team: ${name}`)}
        />
      );
    }

    if (membership.organizationName) {
      return (
        <OnboardingMessage
          colors={colors}
          eyebrow="Organization confirmed"
          title={`You're joining ${membership.organizationName}`}
          body="Your organization invitation is confirmed. A manager can add you to a team from Dispatch."
          points={['Organization access confirmed', 'Team assignment still pending']}
        />
      );
    }

    return (
      <OnboardingMessage
        colors={colors}
        eyebrow="Account ready"
        title="No team invitation yet"
        body="We did not find an invitation for this email. Your account is ready, and Dispatch will connect you when a manager invites you."
        points={['Use the same email for your invitation', 'Team access appears after a manager invites you']}
      />
    );
  };

  const illustrationSource = step === 0
    ? illustrations.welcome
    : step === 1
      ? illustrations.manager
      : step === 2
        ? illustrations.worker
        : step === 3
          ? illustrations.role
          : illustrations.ready;

  const primaryLabel = step < 3
    ? step === 0 ? 'Get started' : 'Continue'
    : step === 3
      ? busy ? 'Saving role...' : 'Continue'
      : busy
        ? selectedRole === 'manager' && !membership.organizationName ? 'Creating organization...' : 'Getting Dispatch ready...'
        : selectedRole === 'manager' && !membership.organizationName
          ? 'Create organization and get started'
          : selectedRole === 'worker' && !membership.organizationName && !membership.teamNames.length
            ? 'Finish setup'
            : 'Join and get started';

  const primaryDisabled = busy
    || membershipLoading
    || (step === 3 && !selectedRole)
    || (step === 4 && selectedRole === 'manager' && !membership.organizationName && !organizationName.trim());

  const onPrimaryPress = step < 3
    ? moveForward
    : step === 3
      ? continueWithRole
      : finishOnboarding;

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', android: 'height' })}
      style={[styles.screen, { backgroundColor: colors.background }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Image source={headerLogoSource} resizeMode="contain" style={styles.logo} />
          <View style={styles.progress} accessibilityLabel={`Step ${step + 1} of ${TOTAL_STEPS}`}>
            {Array.from({ length: TOTAL_STEPS }).map((_, index) => (
              <View
                key={index}
                style={[
                  styles.progressDot,
                  {
                    backgroundColor: index <= step ? colors.accent : colors.progressTrack,
                    width: index === step ? 24 : 8,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={[styles.illustrationWrap, { height: illustrationHeight }]}>
            <Image
              accessibilityIgnoresInvertColors
              resizeMode="contain"
              source={illustrationSource}
              style={styles.illustration}
            />
          </View>

          {renderStepContent()}

          {errorMessage ? (
            <Text accessibilityRole="alert" style={styles.errorText}>{errorMessage}</Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={primaryDisabled}
              onPress={onPrimaryPress}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: colors.teal },
                primaryDisabled && styles.disabled,
                pressed && !primaryDisabled && styles.pressed,
              ]}>
              {busy ? <ActivityIndicator color="#06132A" size="small" /> : null}
              <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
            </Pressable>

            {step > 0 && step < 4 ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={moveBack}
                style={({ pressed }) => [
                  styles.backButton,
                  { borderColor: colors.border },
                  pressed && !busy && styles.pressed,
                ]}>
                <Text style={[styles.backButtonText, { color: colors.text }]}>Back</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function OnboardingMessage({
  colors,
  eyebrow,
  title,
  body,
  points,
}: {
  colors: Palette;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
}) {
  return (
    <View style={styles.messageBlock}>
      <Text style={[styles.eyebrow, { color: colors.accent }]}>{eyebrow}</Text>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.muted }]}>{body}</Text>
      <View style={styles.pointList}>
        {points.map((point) => (
          <View key={point} style={styles.pointRow}>
            <View style={[styles.pointMarker, { backgroundColor: colors.teal }]} />
            <Text style={[styles.pointText, { color: colors.text }]}>{point}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function RoleOption({
  label,
  description,
  selected,
  colors,
  onPress,
}: {
  label: string;
  description: string;
  selected: boolean;
  colors: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roleOption,
        {
          backgroundColor: selected ? colors.selectedSurface : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.radioOuter, { borderColor: selected ? colors.accent : colors.muted }]}>
        {selected ? <View style={[styles.radioInner, { backgroundColor: colors.accent }]} /> : null}
      </View>
      <View style={styles.roleCopy}>
        <Text style={[styles.roleLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.roleDescription, { color: colors.muted }]}>{description}</Text>
      </View>
    </Pressable>
  );
}

async function loadMembershipSummary(profile: UserProfile): Promise<MembershipSummary> {
  if (profile.role !== 'worker') {
    return {
      organizationName: profile.organizationName || null,
      teamNames: [],
    };
  }

  const teams = await loadWorkerTeams(profile.uid, profile.organizationId).catch(() => []);
  return {
    organizationName: profile.organizationName || teams[0]?.organizationName || null,
    teamNames: [...new Set(teams.map((team) => team.name).filter(Boolean))],
  };
}

function formatList(items: string[]) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

type Palette = {
  background: string;
  surface: string;
  selectedSurface: string;
  input: string;
  text: string;
  muted: string;
  placeholder: string;
  border: string;
  progressTrack: string;
  accent: string;
  teal: string;
};

const lightColors: Palette = {
  background: '#DBE2F9',
  surface: '#F7F9FF',
  selectedSurface: '#FEEAE2',
  input: '#F7F9FF',
  text: '#121212',
  muted: '#526078',
  placeholder: '#7C8799',
  border: '#B9C4DE',
  progressTrack: '#B9C4DE',
  accent: '#F98D2F',
  teal: '#0EC3C9',
};

const darkColors: Palette = {
  background: '#06132A',
  surface: '#12274D',
  selectedSurface: '#203E75',
  input: '#12274D',
  text: '#F7F7F7',
  muted: '#C6D2E8',
  placeholder: '#8FA1BF',
  border: '#38517E',
  progressTrack: '#38517E',
  accent: '#F98D2F',
  teal: '#0EC3C9',
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    minHeight: 64,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    width: 44,
    height: 52,
  },
  progress: {
    minWidth: 104,
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
  },
  progressDot: {
    height: 8,
    borderRadius: 4,
  },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  illustrationWrap: {
    width: '100%',
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustration: {
    width: '100%',
    height: '100%',
  },
  messageBlock: {
    width: '100%',
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 29,
    lineHeight: 35,
    fontWeight: '800',
    marginTop: 6,
  },
  body: {
    fontSize: 16,
    lineHeight: 23,
    marginTop: 10,
  },
  pointList: {
    gap: 9,
    marginTop: 18,
  },
  pointRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  pointMarker: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 7,
  },
  pointText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  roleList: {
    gap: 12,
    marginTop: 20,
  },
  roleOption: {
    minHeight: 92,
    borderRadius: 8,
    borderWidth: 2,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  roleCopy: {
    flex: 1,
  },
  roleLabel: {
    fontSize: 18,
    fontWeight: '800',
  },
  roleDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 5,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 22,
    marginBottom: 8,
  },
  input: {
    minHeight: 52,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  loadingBlock: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '700',
  },
  errorText: {
    color: '#B42318',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    marginTop: 14,
  },
  actions: {
    marginTop: 'auto',
    paddingTop: 24,
    gap: 10,
  },
  primaryButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryButtonText: {
    color: '#06132A',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  backButton: {
    width: '100%',
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.52,
  },
  pressed: {
    opacity: 0.78,
  },
});
