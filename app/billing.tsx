import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';
import { isCustomerBeta } from '@/config/beta-mode';
import { firebaseEmulatorConfiguration } from '@/lib/firebase';
import {
  billingErrorMessage,
  removeOrganizationMember,
  prepareOrganizationSubscriptionChange,
  prepareOrganizationSubscriptionRestore,
  refreshOrganizationSubscription,
  watchOrganizationBilling,
} from '@/services/billing';
import {
  cancelSecureDispatchInvite,
  listOrganizationPendingInvites,
  secureInviteErrorMessage,
  type PendingOrganizationInvite,
} from '@/lib/secure-invites';
import { loadOrganizationMembers } from '@/services/dispatch';
import {
  getRevenueCatConfiguration,
  getRevenueCatPurchaseStore,
  loadDispatchRevenueCatOffering,
  openDispatchSubscriptionManagement,
  purchaseDispatchRevenueCatPackage,
  restoreDispatchPurchases,
  revenueCatErrorMessage,
  type DispatchRevenueCatPackage,
} from '@/services/revenuecat';
import {
  SUBSCRIPTION_PLANS,
  assertSubscriptionUpgradeVerified,
  canDowngradeToPlan,
  defaultOrganizationBilling,
  formatCadPrice,
  getAnnualSavingsPercent,
  getOrganizationSeatUsage,
  getSubscriptionPlan,
  getSubscriptionPlanChange,
  getSubscriptionVerificationMessage,
  isLivePaidSubscription,
  type OrganizationBilling,
  type SubscriptionBillingPeriod,
  type SubscriptionPlan,
  type SubscriptionPlanId,
} from '@/lib/subscriptions';
import type { Organisation, UserProfile } from '@/types/dispatch';

type BusyAction =
  | 'loading_offering'
  | 'managing'
  | 'restoring'
  | 'verifying'
  | `purchasing:${string}`
  | `removing:${string}`
  | `cancelling:${string}`
  | null;

export default function BillingScreen() {
  // A separate component prevents any billing hooks or SDK actions from mounting.
  return isCustomerBeta() ? <CustomerBetaBillingNotice /> : <OrganizationBillingScreen />;
}

function CustomerBetaBillingNotice() {
  const { resolvedThemeMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const colors = resolvedThemeMode === 'dark' ? darkColors : lightColors;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24 }}>
      <Stack.Screen options={{ title: 'Complimentary Beta' }} />
      <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 24, gap: 14 }}>
        <MaterialIcons name="science" size={32} color={colors.accent} />
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>Complimentary customer beta</Text>
        <Text style={{ color: colors.text, fontSize: 16, lineHeight: 24 }}>Your organization can try Dispatch during the beta without purchasing a subscription.</Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>Purchases, renewals, and subscription changes are disabled in this beta. Your normal Manager and team permissions still apply.</Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>Use email and password to sign in. Managers share invitation links or codes from Teams. Invitation emails and email reminders are unavailable during this beta.</Text>
      </View>
      <CustomerBetaMemberManagement />
    </ScrollView>
  );
}

function CustomerBetaMemberManagement() {
  const { profile } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const colors = resolvedThemeMode === 'dark' ? darkColors : lightColors;
  const organizationId = profile?.organizationId || null;
  const managerId = profile?.role === 'manager' ? profile.uid : null;
  const [roster, setRoster] = useState<{ organization: Organisation; members: UserProfile[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const busyRef = useRef(false);
  const requestVersion = useRef(0);

  useEffect(() => {
    const version = ++requestVersion.current;
    setRoster(null);
    setError(null);
    setNotice(null);
    if (!organizationId || !managerId) { setLoading(false); return; }
    setLoading(true);
    loadOrganizationMembers(organizationId)
      .then((result) => { if (version === requestVersion.current) setRoster(result); })
      .catch((failure) => { if (version === requestVersion.current) setError(billingErrorMessage(failure)); })
      .finally(() => { if (version === requestVersion.current) setLoading(false); });
    return () => { requestVersion.current += 1; };
  }, [managerId, organizationId]);

  if (!managerId || !organizationId) return null;
  const isCurrentManager = roster?.organization.id === organizationId && roster.organization.managerIds.includes(managerId);
  const currentManagers = roster?.members.filter(member => member.role === 'manager' && roster.organization.managerIds.includes(member.uid)) || [];
  const canRemove = (member: UserProfile) => Boolean(isCurrentManager && member.uid !== managerId
    && (member.role !== 'manager' || currentManagers.length > 1));
  const confirmRemoval = (member: UserProfile) => {
    if (!canRemove(member) || busyRef.current) return;
    const version = requestVersion.current;
    Alert.alert(`Remove ${member.displayName}?`, `${member.displayName} will lose access to this organization and its teams.`, [
      { text: 'Keep member', style: 'cancel' },
      { text: 'Remove member', style: 'destructive', onPress: () => {
        if (busyRef.current || version !== requestVersion.current) return;
        busyRef.current = true;
        setRemovingId(member.uid);
        setError(null);
        void (async () => {
          try {
            await removeOrganizationMember(member.uid);
            const result = await loadOrganizationMembers(organizationId);
            if (version !== requestVersion.current) return;
            setRoster(result);
            setNotice(`${member.displayName} was removed from the organization.`);
          } catch (failure) {
            if (version === requestVersion.current) setError(billingErrorMessage(failure));
          } finally {
            busyRef.current = false;
            setRemovingId(null);
          }
        })();
      } },
    ]);
  };

  return (
    <View style={[styles.capacityManagementCard, { marginTop: 18, backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>Organization members</Text>
      <Text style={[styles.sectionSubtitle, { color: colors.muted }]}>Managers can remove other members. Your organization must keep at least one Manager.</Text>
      {loading ? <ActivityIndicator accessibilityLabel="Loading organization members" color={colors.accent} /> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: colors.dangerText, marginTop: 12 }}>{error}</Text> : null}
      {notice ? <Text style={{ color: colors.successText, marginTop: 12 }}>{notice}</Text> : null}
      {roster?.members.map(member => (
        <View key={member.uid} style={[styles.capacityRow, { borderTopColor: colors.border }]}>
          <View style={styles.flex}>
            <Text style={[styles.capacityRowTitle, { color: colors.text }]}>{member.displayName}{member.uid === managerId ? ' (You)' : ''}</Text>
            <Text style={[styles.capacityRowDetail, { color: colors.muted }]}>{member.role === 'manager' ? 'Manager' : 'Crew member'}</Text>
          </View>
          {canRemove(member) ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${member.displayName}`} disabled={Boolean(removingId)} onPress={() => confirmRemoval(member)} style={[styles.capacityAction, { borderColor: colors.danger }, Boolean(removingId) && styles.disabled]}>
            <Text style={[styles.capacityActionText, { color: colors.dangerText }]}>{removingId === member.uid ? 'Removing…' : 'Remove'}</Text>
          </Pressable> : null}
        </View>
      ))}
    </View>
  );
}

function OrganizationBillingScreen() {
  const { authUser, profile } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDarkMode = resolvedThemeMode === 'dark';
  const colors = isDarkMode ? darkColors : lightColors;
  const organizationId = profile?.organizationId || null;

  const [organization, setOrganization] = useState<Organisation | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingOrganizationInvite[]>([]);
  const [billing, setBilling] = useState<OrganizationBilling>(defaultOrganizationBilling());
  const [selectedPeriod, setSelectedPeriod] = useState<SubscriptionBillingPeriod>('annual');
  const [revenueCatPackages, setRevenueCatPackages] = useState<DispatchRevenueCatPackage[]>([]);
  const [loadingOrganization, setLoadingOrganization] = useState(true);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null);

  const revenueCatConfiguration = getRevenueCatConfiguration();
  const billingManagerId = organization?.billingManagerId || null;
  const isBillingManager = Boolean(profile?.uid && billingManagerId === profile.uid);
  const hasLivePaidSubscription = isLivePaidSubscription(billing);
  const storePayerBelongsToAnotherAccount = Boolean(
    hasLivePaidSubscription &&
    billing.purchaserUserId && billing.purchaserUserId !== profile?.uid
  );
  const currentPurchaseStore = getRevenueCatPurchaseStore();
  const activeStoreBelongsToAnotherPlatform = Boolean(
    hasLivePaidSubscription
    && billing.sourceStore
    && currentPurchaseStore
    && billing.sourceStore !== currentPurchaseStore
  );
  const canUseStoreActions = isBillingManager
    && !storePayerBelongsToAnotherAccount
    && !activeStoreBelongsToAnotherPlatform;

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.uid, member])),
    [members]
  );
  const billingManager = billingManagerId ? memberById.get(billingManagerId) : null;
  const seatUsage = useMemo(() => getOrganizationSeatUsage({
    managerIds: organization?.managerIds || [],
    workerIds: organization?.workerIds || [],
    billing,
  }), [billing, organization?.managerIds, organization?.workerIds]);
  const currentPlan = getSubscriptionPlan(billing.planId);
  const packageByKey = useMemo(() => new Map(
    revenueCatPackages.map((item) => [`${item.planId}:${item.billingPeriod}`, item])
  ), [revenueCatPackages]);

  useEffect(() => {
    if (billing.billingPeriod) setSelectedPeriod(billing.billingPeriod);
  }, [billing.billingPeriod]);

  useEffect(() => {
    if (!organizationId) {
      setLoadingOrganization(false);
      setOrganization(null);
      setMembers([]);
      return;
    }

    let active = true;
    setLoadingOrganization(true);
    setScreenError(null);

    loadOrganizationMembers(organizationId)
      .then((result) => {
        if (!active) return;
        setOrganization(result.organization);
        setMembers(result.members);
      })
      .catch((error) => {
        if (!active) return;
        setScreenError(error instanceof Error ? error.message : 'Unable to load organization billing.');
      })
      .finally(() => {
        if (active) setLoadingOrganization(false);
      });

    const unsubscribe = watchOrganizationBilling(
      organizationId,
      (nextBilling) => {
        if (active) setBilling(nextBilling);
      },
      (error) => {
        if (active) setScreenError(error.message);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [organizationId]);

  useEffect(() => {
    if (!isBillingManager) {
      setPendingInvites([]);
      return;
    }
    let active = true;
    listOrganizationPendingInvites()
      .then((invites) => {
        if (active) setPendingInvites(invites);
      })
      .catch((error) => {
        if (active) setScreenError(secureInviteErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [isBillingManager]);

  useEffect(() => {
    if (!authUser?.uid || !isBillingManager) {
      setRevenueCatPackages([]);
      return;
    }
    if (!revenueCatConfiguration.configured) {
      setRevenueCatPackages([]);
      return;
    }

    let active = true;
    setBusyAction('loading_offering');
    loadDispatchRevenueCatOffering(authUser.uid)
      .then(({ packages }) => {
        if (!active) return;
        setRevenueCatPackages(packages);
        if (!packages.length) {
          setScreenError('The RevenueCat offering has no matching Dispatch subscription packages yet.');
        }
      })
      .catch((error) => {
        if (active) setScreenError(revenueCatErrorMessage(error));
      })
      .finally(() => {
        if (active) setBusyAction(null);
      });

    return () => {
      active = false;
    };
  }, [authUser?.uid, isBillingManager, revenueCatConfiguration.configured]);

  const confirmPlanChange = (plan: SubscriptionPlan) => {
    if (plan.id === 'free' || plan.id === 'enterprise') return;
    const paidPlanId = plan.id as Exclude<SubscriptionPlanId, 'free' | 'enterprise'>;
    const selectedPackage = packageByKey.get(`${plan.id}:${selectedPeriod}`);
    if (!selectedPackage || busyAction) return;

    const changeTiming = getSubscriptionPlanChange(
      currentPlan.id,
      plan.id,
      billing.billingPeriod,
      selectedPeriod,
      billing.status
    );
    if (changeTiming === 'none' || changeTiming === 'contact_sales') return;
    const price = selectedPackage.revenueCatPackage.product.priceString;
    Alert.alert(
      changeTiming === 'immediate' ? `Upgrade to ${plan.name}?` : `Schedule ${plan.name} at renewal?`,
      changeTiming === 'immediate'
        ? `${price} ${selectedPeriod === 'annual' ? 'per year' : 'per month'}. Your organization moves to ${plan.memberCap} seats only after the store confirms the purchase and Dispatch verifies the entitlement.`
        : `${price} ${selectedPeriod === 'annual' ? 'per year' : 'per month'}. Existing members keep access until renewal, but new invitations are limited to the ${plan.memberCap}-seat target as soon as the downgrade is scheduled.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: changeTiming === 'immediate' ? 'Continue' : 'Schedule', onPress: () => void runPlanChange(paidPlanId) },
      ]
    );
  };

  const runPlanChange = async (planId: Exclude<SubscriptionPlanId, 'free' | 'enterprise'>) => {
    if (!authUser?.uid || !billingManagerId || !canUseStoreActions || !revenueCatConfiguration.configured) return;
    const purchaseStore = getRevenueCatPurchaseStore();
    if (!purchaseStore) {
      setScreenError('Apple and Google subscription changes require the iOS or Android app.');
      return;
    }
    let preflightCompleted = false;
    let verificationCompleted = false;
    try {
      setBusyAction(`purchasing:${planId}`);
      setScreenError(null);
      setWorkflowMessage('Checking organization eligibility…');
      const preflight = await prepareOrganizationSubscriptionChange({
        planId,
        billingPeriod: selectedPeriod,
        purchaseStore,
      });
      preflightCompleted = true;

      setWorkflowMessage('Waiting for store confirmation…');
      await purchaseDispatchRevenueCatPackage({
        firebaseUid: authUser.uid,
        billingManagerId,
        packageIdentifier: preflight.packageIdentifier,
        changeTiming: preflight.changeTiming,
        currentProductIdentifier: preflight.currentProductIdentifier,
        currentSourceStore: preflight.currentSourceStore,
      });

      setWorkflowMessage(preflight.changeTiming === 'immediate'
        ? 'Purchase confirmed. Verifying the organization subscription…'
        : 'Plan change submitted. Verifying its renewal schedule…');
      const verifiedBilling = await refreshOrganizationSubscription(purchaseStore);
      verificationCompleted = true;
      if (preflight.changeTiming === 'immediate') {
        assertSubscriptionUpgradeVerified({
          billing: verifiedBilling,
          planId: preflight.planId,
          billingPeriod: preflight.billingPeriod,
        });
      }
      setWorkflowMessage(preflight.changeTiming === 'immediate'
        ? 'Subscription verified. Organization access now reflects the store entitlement.'
        : 'Plan change submitted. Dispatch will limit seat growth only after RevenueCat confirms the renewal schedule.');
    } catch (error) {
      if (preflightCompleted && !verificationCompleted) {
        await refreshOrganizationSubscription(purchaseStore).catch(() => undefined);
      }
      setWorkflowMessage(null);
      setScreenError(revenueCatErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const restorePurchases = async () => {
    if (!authUser?.uid || !billingManagerId || !canUseStoreActions || !revenueCatConfiguration.configured || busyAction) return;
    const purchaseStore = getRevenueCatPurchaseStore();
    if (!purchaseStore) {
      setScreenError('Apple and Google purchase restoration requires the iOS or Android app.');
      return;
    }
    let restorePrepared = false;
    try {
      setBusyAction('restoring');
      setScreenError(null);
      setWorkflowMessage('Checking this store account for Dispatch purchases…');
      await prepareOrganizationSubscriptionRestore(purchaseStore);
      restorePrepared = true;
      await restoreDispatchPurchases({ firebaseUid: authUser.uid, billingManagerId });
      setWorkflowMessage('Purchase history found. Verifying the organization subscription…');
      const verifiedBilling = await refreshOrganizationSubscription(purchaseStore);
      setWorkflowMessage(isLivePaidSubscription(verifiedBilling)
        ? `Restore complete. ${getSubscriptionPlan(verifiedBilling.planId).name} is active for this organization.`
        : getSubscriptionVerificationMessage(verifiedBilling));
    } catch (error) {
      if (restorePrepared) {
        await refreshOrganizationSubscription(purchaseStore).catch(() => undefined);
      }
      setWorkflowMessage(null);
      setScreenError(revenueCatErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const verifySubscription = async () => {
    // Server verification reads the existing payer across stores; it does not
    // open a purchase sheet or restore a different store's transactions.
    if (!isBillingManager || busyAction) return;
    const purchaseStore = getRevenueCatPurchaseStore();
    if (!purchaseStore) {
      setScreenError('Apple and Google subscription verification requires the iOS or Android app.');
      return;
    }
    try {
      setBusyAction('verifying');
      setScreenError(null);
      setWorkflowMessage('Verifying the current RevenueCat subscriber with Dispatch…');
      const verifiedBilling = await refreshOrganizationSubscription(purchaseStore);
      setWorkflowMessage(getSubscriptionVerificationMessage(verifiedBilling));
    } catch (error) {
      setWorkflowMessage(null);
      setScreenError(billingErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const confirmOpenSubscriptionManagement = (cancelToFree = false) => {
    if (!canUseStoreActions || busyAction) return;
    if (cancelToFree && !canDowngradeToPlan('free', seatUsage.seatUsage)) {
      setScreenError(`Reduce accepted members and pending invitations to 5 before moving to Free. Current usage is ${seatUsage.seatUsage}.`);
      return;
    }

    Alert.alert(
      cancelToFree ? 'Move to Free at the end of this period?' : 'Open store subscription settings?',
      cancelToFree
        ? `Dispatch will open the subscription settings for the paying Apple or Google account. Cancel renewal there. Paid access remains until ${formatBillingDate(billing.currentPeriodEndsAt) || 'the verified expiry date'}, while new invitations stay limited to 5 seats. Dispatch moves the organization to Free after RevenueCat confirms expiry.`
        : 'Dispatch will open the subscription settings owned by the paying Apple or Google account.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Open settings',
          onPress: () => void openSubscriptionManagement(cancelToFree),
        },
      ]
    );
  };

  const openSubscriptionManagement = async (cancelToFree: boolean) => {
    try {
      setBusyAction('managing');
      setScreenError(null);
      setWorkflowMessage(null);
      await openDispatchSubscriptionManagement(billing.managementURL);
      setWorkflowMessage(cancelToFree
        ? 'Store settings opened. Dispatch will schedule Free only after RevenueCat verifies cancellation.'
        : 'Store subscription settings opened.');
    } catch (error) {
      setScreenError(revenueCatErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const reloadCapacityManagement = async () => {
    if (!organizationId) return;
    const [organizationResult, invites] = await Promise.all([
      loadOrganizationMembers(organizationId),
      listOrganizationPendingInvites(),
    ]);
    setOrganization(organizationResult.organization);
    setMembers(organizationResult.members);
    setPendingInvites(invites);
  };

  const confirmRemoveMember = (member: UserProfile) => {
    if (!isBillingManager || member.uid === billingManagerId || busyAction) return;
    Alert.alert(
      `Remove ${member.displayName}?`,
      `${member.displayName} will lose access to this organization and its teams. This frees one accepted member seat.`,
      [
        { text: 'Keep member', style: 'cancel' },
        {
          text: 'Remove member',
          style: 'destructive',
          onPress: () => void (async () => {
            try {
              setBusyAction(`removing:${member.uid}`);
              setScreenError(null);
              await removeOrganizationMember(member.uid);
              await reloadCapacityManagement();
              setWorkflowMessage(`${member.displayName} was removed. Subscription capacity has been recalculated.`);
            } catch (error) {
              setScreenError(billingErrorMessage(error));
            } finally {
              setBusyAction(null);
            }
          })(),
        },
      ]
    );
  };

  const confirmCancelInvitation = (invite: PendingOrganizationInvite) => {
    if (!isBillingManager || busyAction) return;
    Alert.alert(
      'Cancel pending invitation?',
      `Cancel the ${invite.inviteKind} invitation for ${invite.deliveryEmailHint}? This immediately releases its reserved member seat.`,
      [
        { text: 'Keep invitation', style: 'cancel' },
        {
          text: 'Cancel invitation',
          style: 'destructive',
          onPress: () => void (async () => {
            try {
              setBusyAction(`cancelling:${invite.inviteId}`);
              setScreenError(null);
              await cancelSecureDispatchInvite(invite.inviteId);
              await reloadCapacityManagement();
              setWorkflowMessage('Invitation cancelled. The reserved member seat is available again.');
            } catch (error) {
              setScreenError(secureInviteErrorMessage(error));
            } finally {
              setBusyAction(null);
            }
          })(),
        },
      ]
    );
  };

  if (loadingOrganization) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={[styles.loadingText, { color: colors.muted }]}>Loading organization billing…</Text>
      </View>
    );
  }

  if (!organizationId || !organization) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background, paddingBottom: insets.bottom }]}>
        <MaterialIcons name="business" size={42} color={colors.muted} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No organization billing yet</Text>
        <Text style={[styles.emptyBody, { color: colors.muted }]}>Join or create an organization before choosing a plan.</Text>
        <Pressable style={[styles.primaryButton, { backgroundColor: colors.accent }]} onPress={() => router.back()}>
          <Text style={styles.primaryButtonText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Organization Billing' }} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <View style={[styles.titleIcon, { backgroundColor: colors.accentSoft }]}>
            <MaterialIcons name="payments" size={26} color={colors.accentText} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.title, { color: colors.text }]}>{organization.name}</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>One subscription covers the organization.</Text>
          </View>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.summaryHeader}>
            <View>
              <Text style={[styles.eyebrow, { color: colors.muted }]}>CURRENT PLAN</Text>
              <Text style={[styles.planTitle, { color: colors.text }]}>{currentPlan.name}</Text>
            </View>
            <StatusPill status={billing.status} colors={colors} />
          </View>
          <Text style={[styles.usageText, { color: colors.text }]}>
            {seatUsage.acceptedSeats} accepted{seatUsage.reservedSeats ? ` + ${seatUsage.reservedSeats} pending` : ''} of {seatUsage.memberCap ?? 'custom'} seats
          </Text>
          <View style={[styles.usageTrack, { backgroundColor: colors.track }]}>
            <View
              style={[
                styles.usageFill,
                {
                  backgroundColor: seatUsage.isOverLimit ? colors.danger : colors.accent,
                  width: `${seatUsage.memberCap
                    ? Math.min(100, (seatUsage.seatUsage / seatUsage.memberCap) * 100)
                    : 100}%`,
                },
              ]}
            />
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <InfoRow
            icon="admin-panel-settings"
            label="Billing Manager"
            value={billingManagerId === profile?.uid ? 'You' : billingManager?.displayName || 'Organization Manager'}
            colors={colors}
          />
          <InfoRow
            icon="event"
            label={billing.willRenew ? 'Renews' : billing.planId === 'free' ? 'Renewal' : 'Paid access ends'}
            value={formatBillingDate(billing.currentPeriodEndsAt) || (billing.planId === 'free' ? 'Not applicable' : 'Pending store verification')}
            colors={colors}
          />
          {billing.pendingPlanId ? (
            <InfoRow
              icon="schedule"
              label="Scheduled change"
              value={`${getSubscriptionPlan(billing.pendingPlanId).name} ${formatBillingDate(billing.pendingPlanEffectiveAt) ? `on ${formatBillingDate(billing.pendingPlanEffectiveAt)}` : 'at renewal'}`}
              colors={colors}
            />
          ) : null}
        </View>

        {!isBillingManager ? (
          <Callout
            icon="visibility"
            text={`${billingManager?.displayName || 'The Billing Manager'} controls purchases and plan changes. You can view the organization plan and usage.`}
            colors={colors}
          />
        ) : storePayerBelongsToAnotherAccount ? (
          <Callout
            icon="person-off"
            text="A previous Billing Manager still owns the active Apple or Google subscription. Duplicate checkout is locked until that paid entitlement ends."
            colors={colors}
            warning
          />
        ) : activeStoreBelongsToAnotherPlatform ? (
          <Callout
            icon="phonelink-off"
            text={billing.sourceStore === 'rc_billing'
              ? 'This organization is subscribed through the Dispatch web app. Manage upgrades and cancellation there, then tap Verify current subscription here. Your organization shares the same seats on web and mobile.'
              : `This subscription belongs to ${billing.sourceStore === 'app_store' ? 'Apple' : billing.sourceStore === 'play_store' ? 'Google Play' : 'RevenueCat Test Store'}. Open Billing on that original store device and account to change or cancel it. You can verify its status here.`}
            colors={colors}
            warning
          />
        ) : !revenueCatConfiguration.configured ? (
          <Callout
            icon="science"
            text={revenueCatConfiguration.message}
            colors={colors}
            warning
          />
        ) : revenueCatConfiguration.preview ? (
          <Callout
            icon="science"
            text={firebaseEmulatorConfiguration.enabled
              ? `Local billing test mode is active: RevenueCat Test Store plus isolated Firebase emulators at ${firebaseEmulatorConfiguration.host}. Apple and Google billing are not involved.`
              : 'RevenueCat Test Store is available, but checkout is locked until the isolated demo-project Firebase emulators are enabled. Apple and Google billing are not involved.'}
            colors={colors}
            warning={!firebaseEmulatorConfiguration.enabled}
          />
        ) : null}

        {billing.accessMode === 'read_only' ? (
          <View style={[styles.messageCard, { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder }]}>
            <MaterialIcons name="lock-outline" size={20} color={colors.danger} />
            <Text style={[styles.messageText, { color: colors.dangerText }]}>
              This organization is read-only. Its events, teams, roles, templates, and messages remain available, but organization changes are blocked until billing or Free-plan capacity is resolved.
            </Text>
          </View>
        ) : billing.status === 'grace' ? (
          <Callout
            icon="warning-amber"
            text={`A store payment needs attention. Full access continues through ${formatBillingDate(billing.gracePeriodExpiresAt) || 'the verified grace period'}. The Billing Manager should update the payment method in store settings.`}
            colors={colors}
            warning
          />
        ) : null}

        {billing.pendingPlanId === 'free' && billing.status !== 'free' ? (
          <Callout
            icon="schedule"
            text={`Cancellation is verified. Paid access remains through ${formatBillingDate(billing.pendingPlanEffectiveAt) || 'the current paid period'}, new invitations are limited to 5 seats, and then the organization moves to Free.`}
            colors={colors}
          />
        ) : billing.pendingPlanId && billing.pendingPlanId !== 'free' ? (
          <Callout
            icon="schedule"
            text="To reverse or replace this scheduled change, use Manage store subscription below, make the change with the paying Apple or Google account, then tap Verify current subscription. The temporary target cap clears only after RevenueCat confirms the new schedule or current product."
            colors={colors}
          />
        ) : null}

        {screenError ? (
          <View style={[styles.messageCard, { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder }]}>
            <MaterialIcons name="error-outline" size={20} color={colors.danger} />
            <Text style={[styles.messageText, { color: colors.dangerText }]}>{screenError}</Text>
          </View>
        ) : null}
        {workflowMessage ? (
          <View style={[styles.messageCard, { backgroundColor: colors.successSoft, borderColor: colors.successBorder }]}>
            {busyAction ? <ActivityIndicator size="small" color={colors.success} /> : <MaterialIcons name="check-circle" size={20} color={colors.success} />}
            <Text style={[styles.messageText, { color: colors.successText }]}>{workflowMessage}</Text>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Choose your plan</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.muted }]}>Upgrades are immediate; eligible downgrades wait until renewal.</Text>
          </View>
        </View>

        <View style={[styles.periodControl, { backgroundColor: colors.controlBackground }]}>
          {(['monthly', 'annual'] as const).map((period) => (
            <Pressable
              key={period}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedPeriod === period }}
              onPress={() => setSelectedPeriod(period)}
              style={[
                styles.periodButton,
                selectedPeriod === period && { backgroundColor: colors.surface },
              ]}>
              <Text style={[styles.periodText, { color: selectedPeriod === period ? colors.text : colors.muted }]}>
                {period === 'monthly' ? 'Monthly' : 'Annual'}
              </Text>
              {period === 'annual' ? <Text style={[styles.savingsText, { color: colors.success }]}>Save ~17%</Text> : null}
            </Pressable>
          ))}
        </View>

        {SUBSCRIPTION_PLANS.filter((plan) => plan.storePurchasable).map((plan) => {
          const changeTiming = getSubscriptionPlanChange(
            currentPlan.id,
            plan.id,
            billing.billingPeriod,
            selectedPeriod,
            billing.status
          );
          const isUpgrade = changeTiming === 'immediate';
          const isScheduledChange = changeTiming === 'next_renewal';
          const selectedPackage = packageByKey.get(`${plan.id}:${selectedPeriod}`);
          const isCurrentSelection = changeTiming === 'none';
          const isCurrentPlan = plan.id === currentPlan.id;
          const downgradeFits = !isScheduledChange || canDowngradeToPlan(plan.id, seatUsage.seatUsage);
          const fallbackCents = selectedPeriod === 'annual' ? plan.annualCadCents : plan.monthlyCadCents;
          const price = selectedPackage?.revenueCatPackage.product.priceString || `${formatCadPrice(fallbackCents)} CAD`;
          const unavailable = !canUseStoreActions
            || !revenueCatConfiguration.configured
            || !selectedPackage
            || isCurrentSelection
            || !downgradeFits
            || Boolean(busyAction);
          return (
            <View key={plan.id} style={[styles.planCard, { backgroundColor: colors.surface, borderColor: isCurrentPlan ? colors.accent : colors.border }]}>
              <View style={styles.planCardHeader}>
                <View style={styles.flex}>
                  <Text style={[styles.planName, { color: colors.text }]}>{plan.name}</Text>
                  <Text style={[styles.planDescription, { color: colors.muted }]}>{plan.description}</Text>
                </View>
                <View style={[styles.capacityBadge, { backgroundColor: colors.accentSoft }]}>
                  <Text style={[styles.capacityText, { color: colors.accentText }]}>{plan.memberCap} people</Text>
                </View>
              </View>
              <View style={styles.priceRow}>
                <Text style={[styles.price, { color: colors.text }]}>{price}</Text>
                <Text style={[styles.priceSuffix, { color: colors.muted }]}>/{selectedPeriod === 'annual' ? 'year' : 'month'}</Text>
              </View>
              {selectedPeriod === 'annual' ? (
                <Text style={[styles.annualNote, { color: colors.success }]}>Save {getAnnualSavingsPercent(plan.id)}% compared with monthly</Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={unavailable}
                onPress={() => confirmPlanChange(plan)}
                style={[
                  styles.planButton,
                  { backgroundColor: isUpgrade || (isScheduledChange && downgradeFits) ? colors.accent : colors.controlBackground },
                  unavailable && styles.disabled,
                ]}>
                {busyAction === `purchasing:${plan.id}` ? <ActivityIndicator size="small" color="#061229" /> : null}
                <Text style={[styles.planButtonText, { color: isUpgrade || (isScheduledChange && downgradeFits) ? '#061229' : colors.muted }]}>
                  {isCurrentSelection
                    ? 'Current plan'
                    : !downgradeFits
                      ? `Reduce to ${plan.memberCap} people first`
                      : isUpgrade
                        ? `Upgrade to ${plan.name}`
                        : isCurrentPlan
                          ? `Switch to ${selectedPeriod} at renewal`
                          : `Move to ${plan.name} at renewal`}
                </Text>
              </Pressable>
            </View>
          );
        })}

        {currentPlan.id !== 'free' ? (
          <View style={[styles.planCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.planCardHeader}>
              <View style={styles.flex}>
                <Text style={[styles.planName, { color: colors.text }]}>Free</Text>
                <Text style={[styles.planDescription, { color: colors.muted }]}>Cancel store renewal and keep up to 5 accepted and pending people.</Text>
              </View>
              <View style={[styles.capacityBadge, { backgroundColor: colors.accentSoft }]}>
                <Text style={[styles.capacityText, { color: colors.accentText }]}>5 people</Text>
              </View>
            </View>
            <Text style={[styles.freePrice, { color: colors.text }]}>$0</Text>
            {!canDowngradeToPlan('free', seatUsage.seatUsage) ? (
              <Text style={[styles.capacityWarning, { color: colors.warningText }]}>
                Current usage is {seatUsage.seatUsage}. Remove members or cancel pending invitations until 5 remain.
              </Text>
            ) : (
              <Text style={[styles.annualNote, { color: colors.muted }]}>Paid access remains until RevenueCat verifies expiry; new invitations stay limited to 5 seats.</Text>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={!canUseStoreActions || !canDowngradeToPlan('free', seatUsage.seatUsage) || Boolean(busyAction)}
              onPress={() => confirmOpenSubscriptionManagement(true)}
              style={[
                styles.planButton,
                { backgroundColor: colors.controlBackground },
                (!canUseStoreActions || !canDowngradeToPlan('free', seatUsage.seatUsage) || Boolean(busyAction)) && styles.disabled,
              ]}>
              <Text style={[styles.planButtonText, { color: colors.text }]}>Move to Free at paid expiry</Text>
            </Pressable>
          </View>
        ) : null}

        {isBillingManager ? (
          <View style={[styles.capacityManagementCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.actionsTitle, { color: colors.text }]}>Manage seats for a downgrade</Text>
            <Text style={[styles.actionsBody, { color: colors.muted }]}>
              Accepted members and active invitations each use one seat. Remove only people who no longer need access; cancelling an invitation releases its reservation immediately.
            </Text>
            <Text style={[styles.capacityGroupTitle, { color: colors.text }]}>Accepted members</Text>
            {members
              .filter((member) => member.uid !== billingManagerId)
              .sort((left, right) => left.displayName.localeCompare(right.displayName))
              .map((member) => {
                const removing = busyAction === `removing:${member.uid}`;
                return (
                  <View key={member.uid} style={[styles.capacityRow, { borderColor: colors.border }]}>
                    <View style={styles.flex}>
                      <Text style={[styles.capacityRowTitle, { color: colors.text }]}>{member.displayName}</Text>
                      <Text style={[styles.capacityRowDetail, { color: colors.muted }]}>{member.role === 'manager' ? 'Manager' : 'Worker'} · {member.email || 'No email shown'}</Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      disabled={Boolean(busyAction)}
                      onPress={() => confirmRemoveMember(member)}
                      style={[styles.capacityAction, { borderColor: colors.dangerBorder }, busyAction && styles.disabled]}>
                      {removing ? <ActivityIndicator size="small" color={colors.danger} /> : <Text style={[styles.capacityActionText, { color: colors.danger }]}>Remove</Text>}
                    </Pressable>
                  </View>
                );
              })}
            {members.filter((member) => member.uid !== billingManagerId).length === 0 ? (
              <Text style={[styles.capacityEmpty, { color: colors.muted }]}>No other accepted members.</Text>
            ) : null}

            <Text style={[styles.capacityGroupTitle, { color: colors.text }]}>Pending invitations</Text>
            {pendingInvites.map((invite) => {
              const cancelling = busyAction === `cancelling:${invite.inviteId}`;
              return (
                <View key={invite.inviteId} style={[styles.capacityRow, { borderColor: colors.border }]}>
                  <View style={styles.flex}>
                    <Text style={[styles.capacityRowTitle, { color: colors.text }]}>{invite.deliveryEmailHint}</Text>
                    <Text style={[styles.capacityRowDetail, { color: colors.muted }]}>
                      {invite.inviteKind === 'manager' ? 'Manager' : 'Worker'} invitation{invite.teamName ? ` · ${invite.teamName}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={Boolean(busyAction)}
                    onPress={() => confirmCancelInvitation(invite)}
                    style={[styles.capacityAction, { borderColor: colors.dangerBorder }, busyAction && styles.disabled]}>
                    {cancelling ? <ActivityIndicator size="small" color={colors.danger} /> : <Text style={[styles.capacityActionText, { color: colors.danger }]}>Cancel</Text>}
                  </Pressable>
                </View>
              );
            })}
            {!pendingInvites.length ? (
              <Text style={[styles.capacityEmpty, { color: colors.muted }]}>No active pending invitations.</Text>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.planCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.planCardHeader}>
            <View style={styles.flex}>
              <Text style={[styles.planName, { color: colors.text }]}>Enterprise</Text>
              <Text style={[styles.planDescription, { color: colors.muted }]}>More than 100 people with annual invoicing and custom terms.</Text>
            </View>
            <Text style={[styles.customPrice, { color: colors.text }]}>Custom</Text>
          </View>
        </View>

        {isBillingManager ? (
          <View style={[styles.actionsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.actionsTitle, { color: colors.text }]}>Manage and recover</Text>
            <Text style={[styles.actionsBody, { color: colors.muted }]}>{billing.sourceStore === 'rc_billing'
              ? 'Manage this subscription from Billing in the Dispatch web app. Verify here after a web change. Mobile Restore purchases does not restore browser payments.'
              : 'Store settings belong to the original paying account. Use them to reverse or replace a scheduled change, then verify here. Restore only when that account\'s purchase is missing.'}</Text>
            {billing.planId !== 'free' ? (
              <Pressable
                accessibilityRole="button"
                disabled={!canUseStoreActions || Boolean(busyAction)}
                onPress={() => confirmOpenSubscriptionManagement(false)}
                style={[styles.secondaryButton, { borderColor: colors.accent }, (!canUseStoreActions || Boolean(busyAction)) && styles.disabled]}>
                {busyAction === 'managing' ? <ActivityIndicator size="small" color={colors.accentText} /> : <MaterialIcons name="open-in-new" size={20} color={colors.accentText} />}
                <Text style={[styles.secondaryButtonText, { color: colors.accentText }]}>{billing.pendingPlanId && billing.pendingPlanId !== 'free' ? 'Manage or reverse scheduled change' : 'Manage store subscription'}</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={!canUseStoreActions || !revenueCatConfiguration.configured || Boolean(busyAction)}
              onPress={() => void restorePurchases()}
              style={[styles.secondaryButton, { borderColor: colors.accent }, (!canUseStoreActions || !revenueCatConfiguration.configured || Boolean(busyAction)) && styles.disabled]}>
              {busyAction === 'restoring' ? <ActivityIndicator size="small" color={colors.accentText} /> : <MaterialIcons name="restore" size={20} color={colors.accentText} />}
              <Text style={[styles.secondaryButtonText, { color: colors.accentText }]}>Restore purchases</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!isBillingManager || Boolean(busyAction)}
              onPress={() => void verifySubscription()}
              style={[styles.textButton, (!isBillingManager || Boolean(busyAction)) && styles.disabled]}>
              <Text style={[styles.textButtonText, { color: colors.accentText }]}>Verify current subscription</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={[styles.footnote, { color: colors.muted }]}>
          The subscription remains with its original purchaser and payment provider. Passing the Dispatch Billing Manager role does not transfer the payment account.
        </Text>
      </ScrollView>
    </>
  );
}

function InfoRow(props: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: string;
  colors: typeof lightColors;
}) {
  return (
    <View style={styles.infoRow}>
      <MaterialIcons name={props.icon} size={19} color={props.colors.accentText} />
      <Text style={[styles.infoLabel, { color: props.colors.muted }]}>{props.label}</Text>
      <Text style={[styles.infoValue, { color: props.colors.text }]}>{props.value}</Text>
    </View>
  );
}

function Callout(props: {
  icon: keyof typeof MaterialIcons.glyphMap;
  text: string;
  colors: typeof lightColors;
  warning?: boolean;
}) {
  return (
    <View style={[
      styles.callout,
      {
        backgroundColor: props.warning ? props.colors.warningSoft : props.colors.accentSoft,
        borderColor: props.warning ? props.colors.warningBorder : props.colors.accentBorder,
      },
    ]}>
      <MaterialIcons name={props.icon} size={21} color={props.warning ? props.colors.warning : props.colors.accentText} />
      <Text style={[styles.calloutText, { color: props.warning ? props.colors.warningText : props.colors.text }]}>{props.text}</Text>
    </View>
  );
}

function StatusPill(props: { status: OrganizationBilling['status']; colors: typeof lightColors }) {
  const active = ['free', 'trialing', 'active'].includes(props.status);
  const warning = ['grace', 'billing_retry'].includes(props.status);
  return (
    <View style={[
      styles.statusPill,
      { backgroundColor: active ? props.colors.successSoft : warning ? props.colors.warningSoft : props.colors.dangerSoft },
    ]}>
      <Text style={[
        styles.statusText,
        { color: active ? props.colors.successText : warning ? props.colors.warningText : props.colors.dangerText },
      ]}>{statusLabel(props.status)}</Text>
    </View>
  );
}

function statusLabel(status: OrganizationBilling['status']) {
  return status.split('_').map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(' ');
}

function formatBillingDate(value: OrganizationBilling['currentPeriodEndsAt']) {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value instanceof Date ? value : value.toDate?.();
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const lightColors = {
  background: '#DBE2F9',
  surface: '#F7F7F7',
  text: '#1E293B',
  muted: '#64748B',
  border: '#CBD5E1',
  accent: '#0EC3C9',
  accentText: '#0B7D82',
  accentSoft: '#DDF8F8',
  accentBorder: '#73DDE0',
  controlBackground: '#E8EDF9',
  track: '#E2E8F0',
  success: '#15803D',
  successText: '#166534',
  successSoft: '#DCFCE7',
  successBorder: '#86EFAC',
  warning: '#C2410C',
  warningText: '#9A3412',
  warningSoft: '#FFF7ED',
  warningBorder: '#FDBA74',
  danger: '#B91C1C',
  dangerText: '#991B1B',
  dangerSoft: '#FEF2F2',
  dangerBorder: '#FCA5A5',
};

const darkColors: typeof lightColors = {
  background: '#061229',
  surface: '#12274D',
  text: '#F4F8FF',
  muted: '#B8C8E5',
  border: '#38517E',
  accent: '#0EC3C9',
  accentText: '#5BE4E8',
  accentSoft: '#0C394A',
  accentBorder: '#147985',
  controlBackground: '#1A315A',
  track: '#243B65',
  success: '#4ADE80',
  successText: '#BBF7D0',
  successSoft: '#123B2A',
  successBorder: '#237A4A',
  warning: '#FB923C',
  warningText: '#FED7AA',
  warningSoft: '#43270F',
  warningBorder: '#9A4A14',
  danger: '#F87171',
  dangerText: '#FECACA',
  dangerSoft: '#411A24',
  dangerBorder: '#8B2C3D',
};

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  loadingText: { marginTop: 12, fontSize: 15, fontWeight: '600' },
  emptyTitle: { marginTop: 14, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  emptyBody: { marginTop: 8, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  content: { padding: 16, gap: 14 },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 2 },
  titleIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800' },
  subtitle: { marginTop: 2, fontSize: 14 },
  summaryCard: { borderWidth: 1, borderRadius: 16, padding: 16 },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  planTitle: { marginTop: 3, fontSize: 28, fontWeight: '900' },
  usageText: { marginTop: 16, fontSize: 15, fontWeight: '700' },
  usageTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 8 },
  usageFill: { height: 8, borderRadius: 4 },
  divider: { height: 1, marginVertical: 16 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { fontSize: 12, fontWeight: '800' },
  infoRow: { flexDirection: 'row', alignItems: 'center', minHeight: 28, gap: 8 },
  infoLabel: { fontSize: 13, fontWeight: '600' },
  infoValue: { flex: 1, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  callout: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 12, padding: 13 },
  calloutText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  messageCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 12, padding: 13 },
  messageText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 },
  sectionTitle: { fontSize: 20, fontWeight: '800' },
  sectionSubtitle: { marginTop: 3, fontSize: 13 },
  periodControl: { flexDirection: 'row', borderRadius: 12, padding: 4 },
  periodButton: { flex: 1, minHeight: 49, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  periodText: { fontSize: 14, fontWeight: '800' },
  savingsText: { marginTop: 1, fontSize: 10, fontWeight: '800' },
  planCard: { borderWidth: 1, borderRadius: 15, padding: 16 },
  planCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  planName: { fontSize: 20, fontWeight: '900' },
  planDescription: { marginTop: 4, fontSize: 13, lineHeight: 18 },
  capacityBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  capacityText: { fontSize: 11, fontWeight: '800' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 16 },
  price: { fontSize: 26, fontWeight: '900' },
  freePrice: { marginTop: 16, fontSize: 26, fontWeight: '900' },
  priceSuffix: { marginLeft: 4, fontSize: 13, fontWeight: '600' },
  annualNote: { marginTop: 3, fontSize: 12, fontWeight: '700' },
  capacityWarning: { marginTop: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  customPrice: { fontSize: 18, fontWeight: '900' },
  planButton: { minHeight: 46, marginTop: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 12 },
  planButtonText: { fontSize: 14, fontWeight: '900' },
  capacityManagementCard: { borderWidth: 1, borderRadius: 15, padding: 16 },
  capacityGroupTitle: { marginTop: 16, marginBottom: 4, fontSize: 13, fontWeight: '900' },
  capacityRow: { minHeight: 58, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  capacityRowTitle: { fontSize: 14, fontWeight: '800' },
  capacityRowDetail: { marginTop: 2, fontSize: 11, lineHeight: 16 },
  capacityAction: { minWidth: 70, minHeight: 38, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  capacityActionText: { fontSize: 12, fontWeight: '900' },
  capacityEmpty: { paddingVertical: 10, fontSize: 12, fontStyle: 'italic' },
  actionsCard: { borderWidth: 1, borderRadius: 15, padding: 16 },
  actionsTitle: { fontSize: 17, fontWeight: '800' },
  actionsBody: { marginTop: 5, fontSize: 13, lineHeight: 19 },
  secondaryButton: { marginTop: 14, minHeight: 46, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  secondaryButtonText: { fontSize: 14, fontWeight: '800' },
  textButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  textButtonText: { fontSize: 13, fontWeight: '800' },
  primaryButton: { marginTop: 18, minHeight: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  primaryButtonText: { color: '#061229', fontWeight: '900' },
  footnote: { fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 8 },
  disabled: { opacity: 0.5 },
});
