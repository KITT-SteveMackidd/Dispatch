const crypto = require('node:crypto');
const functionsV1 = require('firebase-functions/v1');
const { logger, setGlobalOptions } = require('firebase-functions/v2');
const { onInit } = require('firebase-functions/v2/core');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { HttpsError, onCall, onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onObjectFinalized } = require('firebase-functions/v2/storage');
const {
  deleteAllAuthUsers,
  deleteAllFirestoreCollections,
  isAuthorizedAdminEmail,
} = require('./lib/admin-reset');
const { deleteDispatchUserData } = require('./lib/account-deletion');
const {
  accountDeletionCleanupStatus,
  accountDeletionLeaseIsActive,
  accountDeletionMutationIsAllowed,
  accountDeletionTombstoneIsActive,
} = require('./lib/account-deletion-lifecycle');
const {
  resolveBillingManagerId,
  validateBillingManagerTransfer,
} = require('./lib/billing-manager');
const {
  planOrganizationMemberRemoval,
  removeOrganizationMemberFromChatThread,
} = require('./lib/organization-membership');
const { removeWorkerFromEventMembership } = require('./lib/event-membership');
const { planWorkerEventAction } = require('./lib/worker-event-actions');
const { assertOrganizationMutationAccess, assertCustomerBetaOrganizationWritable } = require('./lib/organization-mutation-access');
const { customerBetaPolicyEnabled, getFunctionsRegion, isCustomerBetaProject, organizationHasManagerAuthority } = require('./lib/customer-beta-policy');
const { legacyOrganizationRecordUpdate } = require('./lib/legacy-organization-records');
const {
  accessModeForBillingAndSeatUsage,
  calculateSeatUsage,
  defaultOrganizationBilling,
  mergeAcceptedOrganizationProfiles,
  releaseInvitationSeat,
  reserveInvitationSeat,
  seatReservationKey,
} = require('./lib/subscriptions');
const {
  REVENUECAT_ENTITLEMENT_ID,
  activeRevenueCatPayerMustResolveSubscription,
  activeRevenueCatStoreIntentForUser,
  applyRevenueCatLifecyclePolicy,
  constantTimeEqual,
  deriveOrganizationBillingFromSubscriber,
  deriveTransferredAwayOrganizationBilling,
  fetchRevenueCatSubscriber,
  fetchRevenueCatCustomerAliases,
  hashedDocumentId,
  isLivePaidRevenueCatProjection,
  packageIdentifierForPlan,
  partitionRevenueCatTransferIdentities,
  revenueCatBillingSnapshotIsCurrent,
  revenueCatCustomerDeletionDecision,
  revenueCatMappingAllowsPaidRefresh,
  revenueCatMappingSnapshotIsCurrent,
  revenueCatProductChangeState,
  revenueCatMappingCanMutateBilling,
  resolveRevenueCatProduct,
  validateRevenueCatPurchaseStoreEnvironment,
  validateRevenueCatWebhookEnvironment,
  verifyRevenueCatWebhookSignature,
  webhookIdentityCandidates,
} = require('./lib/revenuecat');
const {
  firebaseIdTokenFromAuthorizationHeader,
  revokeAppleAuthorization,
} = require('./lib/apple-account-revocation');
const {
  chatPushContent,
  chatPushRecipientIds,
  documentKey,
  eventReminderTargets,
  normalizeExpoPushTokens,
  pushMessageForUser,
  rolePushContent,
  rolePushRecipientId,
  uniqueStrings,
} = require('./lib/push-content');
const {
  buildRoleNotificationState,
  roleNotificationStateChanged,
  roleStateFingerprint,
} = require('./lib/role-state');
const {
  normalizePushTokenRegistration,
  stalePushTokenOwnerIds,
} = require('./lib/push-token-ownership');
const { lateTaskNotificationDocuments } = require('./lib/late-task-notifications');
const { eventAccessForRoleInvitation } = require('./lib/event-role-access');
const { buildEventRoleResponse } = require('./lib/event-role-response');
const { MAX_CHAT_PARTICIPANTS, buildChatMessageMutation } = require('./lib/chat-message');
const {
  INVITE_TTL_MS,
  buildInviteUrls,
  buildSecureInviteEmail,
  canAdoptInviteRole,
  generateInviteSecrets,
  hashInviteCode,
  hashInviteToken,
  isValidEmail,
  maskEmail,
  normalizeEmail,
} = require('./lib/secure-invites');
const {
  LegacyInviteOrganizationConflictError,
  buildLegacyInviteAdoptionPlan,
} = require('./lib/legacy-invites');
const {
  buildDispatchVerificationLink,
  buildVerificationEmail,
  normalizeVerificationInviteToken,
  verificationCooldownSeconds,
} = require('./lib/email-verification');

setGlobalOptions({ region: getFunctionsRegion(runtimeProjectId()), maxInstances: 10 });

let db;
let FieldValue;
let adminAuth;
let storageBucket;

const RECENT_AUTH_MAX_AGE_SECONDS = 5 * 60;
const ACCOUNT_DELETION_TOMBSTONE_MS = 2 * 60 * 60 * 1000;
const ACCOUNT_DELETION_LOCK_MS = 12 * 60 * 1000;
const revenueCatWebhookAuthorization = subscriptionParameter(() => defineSecret('REVENUECAT_WEBHOOK_AUTHORIZATION'));
const revenueCatWebhookSigningSecret = subscriptionParameter(() => defineSecret('REVENUECAT_WEBHOOK_SIGNING_SECRET'));
const revenueCatSecretApiKey = subscriptionParameter(() => defineSecret('REVENUECAT_SECRET_API_KEY'));
const revenueCatV2SecretApiKey = subscriptionParameter(() => defineSecret('REVENUECAT_V2_SECRET_API_KEY'));
const revenueCatAllowedAppIds = subscriptionParameter(() => defineSecret('REVENUECAT_ALLOWED_APP_IDS'));
const revenueCatExpectedEnvironment = subscriptionParameter(() => defineString('REVENUECAT_EXPECTED_ENVIRONMENT'));
const revenueCatProjectId = subscriptionParameter(() => defineString('REVENUECAT_PROJECT_ID'));

onInit(() => {
  const { initializeApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getStorage } = require('firebase-admin/storage');
  const firestore = require('firebase-admin/firestore');
  const app = initializeApp();
  adminAuth = getAuth(app);
  db = firestore.getFirestore(app);
  storageBucket = getStorage(app).bucket();
  FieldValue = firestore.FieldValue;
});
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const PROCESSING_LEASE_MS = 5 * 60 * 1000;
const MAX_PUSH_TOKEN_OWNERS = 450;

function runtimeProjectId() {
  return process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
}

function subscriptionSecrets(secrets) {
  return isCustomerBetaProject(runtimeProjectId()) ? [] : secrets;
}

function subscriptionParameter(declareParameter) {
  // Firebase discovers all declared params, including unbound secrets. Do not
  // register billing credentials at all for the dedicated customer project.
  if (!isCustomerBetaProject(runtimeProjectId())) return declareParameter();
  return Object.freeze({
    value() { throw new Error('RevenueCat parameters are unavailable in the customer beta project.'); },
  });
}

async function customerBetaAccessEnabled(transaction) {
  const projectId = runtimeProjectId();
  if (!isCustomerBetaProject(projectId)) return false;
  const policyRef = db.collection('dispatchConfig').doc('billing');
  const policySnapshot = transaction ? await transaction.get(policyRef) : await policyRef.get();
  const enabled = customerBetaPolicyEnabled({ projectId, policy: policySnapshot.exists ? policySnapshot.data() : null });
  if (!enabled) throw new HttpsError('failed-precondition', 'Customer beta access has not been configured for this environment.');
  return true;
}

async function assertSubscriptionsAvailable() {
  // Fail closed for the dedicated customer project even if its policy is absent.
  if (isCustomerBetaProject(runtimeProjectId())) {
    throw new HttpsError('failed-precondition', 'Subscriptions are unavailable during the complimentary customer beta.');
  }
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function normalizedRole(value) {
  const role = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return role === 'manager' || role === 'worker' ? role : null;
}

function requiredDocumentId(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > 200 || normalized.includes('/')) {
    throw new HttpsError('invalid-argument', `${label} is invalid.`);
  }
  return normalized;
}

function escapeMailHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function workerEventReminderMail({ event, role, workerId, email }) {
  if (isCustomerBetaProject(runtimeProjectId())) return null;
  const normalizedEmail = normalizeEmail(email);
  const startsAt = new Date(event?.startsAt);
  if (!normalizedEmail || Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) return null;
  const eventName = String(event?.name || 'Dispatch event').trim().slice(0, 160) || 'Dispatch event';
  const roleName = String(role?.name || 'assigned role').trim().slice(0, 160) || 'assigned role';
  const location = String(event?.location || 'Location TBD').trim().slice(0, 300) || 'Location TBD';
  const eventDate = startsAt.toLocaleString('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Edmonton',
  });
  const configuredLink = String(process.env.DISPATCH_INVITE_BASE_URL || '').trim();
  const appLink = /^https:\/\//i.test(configuredLink)
    ? configuredLink
    : 'https://dispatchcrewmanager.com';
  return {
    to: [normalizedEmail],
    delivery: {
      startTime: new Date(Math.max(Date.now(), startsAt.getTime() - 12 * 60 * 60 * 1000)),
    },
    message: {
      subject: `Dispatch reminder: ${eventName} today`,
      text: `Reminder: you are assigned to ${roleName} for ${eventName} at ${eventDate}. Location: ${location}. Open Dispatch: ${appLink}`,
      html: `<p>Reminder: you are assigned to <strong>${escapeMailHtml(roleName)}</strong> for <strong>${escapeMailHtml(eventName)}</strong>.</p><p><strong>When:</strong> ${escapeMailHtml(eventDate)}<br/><strong>Where:</strong> ${escapeMailHtml(location)}</p><p><a href="${escapeMailHtml(appLink)}">Open Dispatch</a></p>`,
    },
    dispatchEventReminder: {
      eventId: event.id,
      roleId: role.id,
      workerId,
      eventName,
      roleName,
      appLink,
      email: normalizedEmail,
    },
  };
}

function expectedRevenueCatEnvironment() {
  const value = typeof revenueCatExpectedEnvironment.value() === 'string'
    ? revenueCatExpectedEnvironment.value().trim().toLowerCase()
    : '';
  if (!['sandbox', 'production'].includes(value)) {
    throw new Error('REVENUECAT_EXPECTED_ENVIRONMENT must be configured as sandbox or production.');
  }
  return value;
}

function revenueCatPurchaseStoreForCallable(value) {
  try {
    return validateRevenueCatPurchaseStoreEnvironment({
      purchaseStore: value,
      expectedEnvironment: expectedRevenueCatEnvironment(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RevenueCat store environment is not configured.';
    const code = message === 'Choose a valid RevenueCat purchase store.'
      ? 'invalid-argument'
      : 'failed-precondition';
    throw new HttpsError(code, message);
  }
}

function configuredRevenueCatProjectId() {
  const value = typeof revenueCatProjectId.value() === 'string'
    ? revenueCatProjectId.value().trim()
    : '';
  if (!value) throw new Error('REVENUECAT_PROJECT_ID must be configured for customer alias evidence review.');
  return value;
}

function organizationWithAcceptedProfiles(organization, querySnapshot) {
  return mergeAcceptedOrganizationProfiles(
    organization,
    (querySnapshot?.docs || []).map((document) => ({ ...document.data(), uid: document.id }))
  );
}

async function assertAccountDeletionNotStarted(transaction, userId) {
  await assertAccountDeletionMutationLeaseAvailable(transaction);
  const tombstoneRef = db.collection('accountDeletionTombstones').doc(userId);
  const snapshot = transaction
    ? await transaction.get(tombstoneRef)
    : await tombstoneRef.get();
  if (snapshot.exists && accountDeletionTombstoneIsActive(snapshot.data())) {
    throw new HttpsError('failed-precondition', 'Account deletion is already in progress. No further account changes are allowed.');
  }
}

async function assertOrganizationMutationAllowed(transaction, userId, organizationId) {
  await assertAccountDeletionNotStarted(transaction, userId);
  const customerBeta = await customerBetaAccessEnabled(transaction);
  if (typeof organizationId !== 'string' || !organizationId.trim()) {
    throw new HttpsError('failed-precondition', 'This record has no organization authority.');
  }
  const [userSnapshot, organizationSnapshot, billingSnapshot] = await transaction.getAll(
    db.collection('users').doc(userId),
    db.collection('organizations').doc(organizationId),
    db.collection('organizationBilling').doc(organizationId)
  );
  assertOrganizationMutationAccess({
    userId,
    organizationId,
    user: userSnapshot.exists ? userSnapshot.data() : null,
    organization: organizationSnapshot.exists ? organizationSnapshot.data() : null,
    billing: billingSnapshot.exists ? billingSnapshot.data() : null,
    customerBeta,
  });
}

function accountDeletionLockRef() {
  return db.collection('maintenanceLocks').doc('accountDeletion');
}

async function assertAccountDeletionMutationLeaseAvailable(transaction) {
  const lockRef = accountDeletionLockRef();
  const snapshot = transaction
    ? await transaction.get(lockRef)
    : await lockRef.get();
  if (snapshot.exists && accountDeletionLeaseIsActive(snapshot.data())) {
    throw new HttpsError(
      'unavailable',
      'Account maintenance is finishing safely. Wait a moment and try again.'
    );
  }
}

async function migrateLegacyManagerOrganizationRecords({ managerId, organizationId }) {
  const organizationRef = db.collection('organizations').doc(organizationId);
  const managerRef = db.collection('users').doc(managerId);
  const organizationSnapshot = await organizationRef.get();
  if (!organizationSnapshot.exists) return { migratedTeams: 0, migratedEvents: 0 };
  if (
    organizationSnapshot.data().createdBy !== managerId
    || resolveBillingManagerId(organizationSnapshot.data()) !== managerId
  ) {
    return { migratedTeams: 0, migratedEvents: 0, skippedNonCreator: true };
  }
  const [teamsSnapshot, eventsSnapshot] = await Promise.all([
    db.collection('teams').where('managerId', '==', managerId).get(),
    db.collection('events').where('managerId', '==', managerId).get(),
  ]);
  const updates = [];
  teamsSnapshot.docs.forEach((snapshot) => {
    const update = legacyOrganizationRecordUpdate({
      kind: 'team',
      record: snapshot.data(),
      managerId,
      organizationId,
    });
    if (update) updates.push({ kind: 'team', ref: snapshot.ref });
  });
  eventsSnapshot.docs.forEach((snapshot) => {
    const update = legacyOrganizationRecordUpdate({
      kind: 'event',
      record: snapshot.data(),
      managerId,
      organizationId,
    });
    if (update) updates.push({ kind: 'event', ref: snapshot.ref });
  });

  let migratedTeams = 0;
  let migratedEvents = 0;
  for (const group of chunks(updates, 400)) {
    const migrated = await db.runTransaction(async (transaction) => {
      await assertAccountDeletionNotStarted(transaction, managerId);
      const snapshots = await transaction.getAll(
        organizationRef,
        managerRef,
        ...group.map((item) => item.ref)
      );
      const [freshOrganizationSnapshot, freshManagerSnapshot] = snapshots;
      if (
        !freshOrganizationSnapshot.exists
        || !freshManagerSnapshot.exists
        || freshManagerSnapshot.data().organizationId !== organizationId
        || normalizedRole(freshManagerSnapshot.data().role) !== 'manager'
        || freshOrganizationSnapshot.data().createdBy !== managerId
        || resolveBillingManagerId(freshOrganizationSnapshot.data()) !== managerId
      ) {
        return { teams: 0, events: 0 };
      }
      const [organizationMembers, organizationTeams] = await Promise.all([
        transaction.get(db.collection('users').where('organizationId', '==', organizationId)),
        transaction.get(db.collection('teams').where('organizationId', '==', organizationId)),
      ]);
      const allowedMemberIds = organizationMembers.docs.map((snapshot) => snapshot.id);
      const allowedTeamIds = new Set(organizationTeams.docs.map((snapshot) => snapshot.id));
      const freshSnapshots = snapshots.slice(2);
      const plannedUpdates = [];
      freshSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) return;
        const item = group[index];
        if (item.kind !== 'team') return;
        const update = legacyOrganizationRecordUpdate({
          kind: item.kind,
          record: snapshot.data(),
          managerId,
          organizationId,
          organizationName: freshOrganizationSnapshot.data().name || null,
          allowedMemberIds,
        });
        if (!update) return;
        allowedTeamIds.add(snapshot.id);
        plannedUpdates.push({ ...item, snapshot, update });
      });
      freshSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) return;
        const item = group[index];
        if (item.kind !== 'event') return;
        const update = legacyOrganizationRecordUpdate({
          kind: item.kind,
          record: snapshot.data(),
          managerId,
          organizationId,
          organizationName: freshOrganizationSnapshot.data().name || null,
          allowedMemberIds,
          allowedTeamIds: [...allowedTeamIds],
        });
        if (!update) return;
        plannedUpdates.push({ ...item, snapshot, update });
      });
      plannedUpdates.forEach(({ snapshot, update }) => {
        transaction.set(snapshot.ref, {
          ...update,
          legacyOrganizationMigratedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      return {
        teams: plannedUpdates.filter((item) => item.kind === 'team').length,
        events: plannedUpdates.filter((item) => item.kind === 'event').length,
      };
    });
    migratedTeams += migrated.teams;
    migratedEvents += migrated.events;
  }
  return { migratedTeams, migratedEvents };
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}

async function acquireAccountDeletionLock(userId) {
  const lockRef = accountDeletionLockRef();
  const lockToken = crypto.randomUUID();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    const lock = snapshot.exists ? snapshot.data() : null;
    if (lock && timestampMillis(lock.leaseExpiresAt) > Date.now()) {
      throw new HttpsError(
        'resource-exhausted',
        'Another account deletion is finishing safely. Wait a moment and try again.'
      );
    }
    transaction.set(lockRef, {
      lockToken,
      ownerUserId: userId,
      leaseExpiresAt: new Date(Date.now() + ACCOUNT_DELETION_LOCK_MS),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ref: lockRef, lockToken };
}

async function releaseAccountDeletionLock(lock) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lock.ref);
    if (snapshot.exists && snapshot.data().lockToken === lock.lockToken) {
      transaction.delete(lock.ref);
    }
  });
}

async function completeLocalAccountDeletionCleanup(tombstoneRef) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(tombstoneRef);
    if (!snapshot.exists) throw new Error('Account-deletion tombstone disappeared during cleanup.');
    const customerBeta = isCustomerBetaProject(runtimeProjectId())
      && snapshot.data().revenueCatDeletionPolicy === 'not_applicable_customer_beta';
    const status = customerBeta
      ? (snapshot.data().authUserDeleted === true ? 'completed' : 'ready_for_auth_deletion')
      : 'manual_revenuecat_review';
    transaction.set(tombstoneRef, {
      status,
      dataCleanupCompletedAt: FieldValue.serverTimestamp(),
      revenueCatCustomerDeleted: false,
      revenueCatDeletionPending: false,
      revenueCatManualReviewRequired: !customerBeta,
      revenueCatDeletionPolicy: customerBeta ? 'not_applicable_customer_beta' : 'manual_alias_review',
      revenueCatDeletionOwnershipVerified: false,
      authUserDeleted: snapshot.data().authUserDeleted === true,
      authDeletionPending: snapshot.data().authUserDeleted !== true,
      cleanupAuthUser: FieldValue.delete(),
      localCleanupRetryAfter: FieldValue.delete(),
      localCleanupLastFailedAt: FieldValue.delete(),
      remoteCleanupUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { status, automaticDeletion: false };
  });
}

async function finalizeRemoteAccountDeletion({
  tombstoneRef,
  revenueCatAttempt = null,
  revenueCatCustomerDeleted = false,
  authUserDeleted = false,
}) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(tombstoneRef);
    if (!snapshot.exists || snapshot.data().status === 'deleting') return null;
    const tombstone = snapshot.data();
    const currentGeneration = Math.max(0, Math.floor(Number(tombstone.revenueCatDeletionGeneration) || 0));
    const acceptsRevenueCatResult = Boolean(
      revenueCatAttempt
      && revenueCatAttempt.generation === currentGeneration
      && revenueCatAttempt.attemptToken === tombstone.revenueCatDeletionAttemptToken
    );
    const effectiveRevenueCatDeleted = tombstone.revenueCatCustomerDeleted === true
      || (acceptsRevenueCatResult && revenueCatCustomerDeleted === true);
    const effectiveAuthDeleted = tombstone.authUserDeleted === true || authUserDeleted === true;
    const status = accountDeletionCleanupStatus({
      revenueCatCustomerDeleted: effectiveRevenueCatDeleted,
      authUserDeleted: effectiveAuthDeleted,
      revenueCatDeletionPolicy: tombstone.revenueCatDeletionPolicy,
      customerBeta: isCustomerBetaProject(runtimeProjectId()),
    });
    const purgeAt = status === 'completed'
      ? new Date(Date.now() + ACCOUNT_DELETION_TOMBSTONE_MS)
      : null;
    transaction.set(tombstoneRef, {
      status,
      revenueCatCustomerDeleted: effectiveRevenueCatDeleted,
      revenueCatDeletionPending: status === 'ready_for_revenuecat_deletion',
      revenueCatManualReviewRequired: status === 'manual_revenuecat_review',
      authUserDeleted: effectiveAuthDeleted,
      authDeletionPending: !effectiveAuthDeleted,
      remoteCleanupUpdatedAt: FieldValue.serverTimestamp(),
      ...(acceptsRevenueCatResult ? {
        revenueCatDeletionAttemptToken: FieldValue.delete(),
        revenueCatDeletionAttemptStartedAt: FieldValue.delete(),
      } : {}),
      ...(purgeAt ? {
        completedAt: FieldValue.serverTimestamp(),
        denyUntil: purgeAt,
        purgeAt,
      } : {
        completedAt: FieldValue.delete(),
        purgeAt: FieldValue.delete(),
      }),
    }, { merge: true });
    return {
      status,
      revenueCatCustomerDeleted: effectiveRevenueCatDeleted,
      authUserDeleted: effectiveAuthDeleted,
      revenueCatResultAccepted: acceptsRevenueCatResult,
    };
  });
}

function accountDeletionAuthSnapshot(authUser) {
  return {
    uid: authUser.uid,
    email: authUser.email || null,
    emailVerified: authUser.emailVerified === true,
    displayName: authUser.displayName || null,
    providerData: (authUser.providerData || []).map((provider) => ({
      providerId: provider.providerId || null,
      uid: provider.uid || null,
      email: provider.email || null,
      displayName: provider.displayName || null,
    })),
  };
}

function storedAccountDeletionAuthUser(userId, tombstone = {}) {
  const stored = tombstone.cleanupAuthUser || {};
  return {
    uid: userId,
    email: stored.email || null,
    emailVerified: stored.emailVerified === true,
    displayName: stored.displayName || null,
    providerData: Array.isArray(stored.providerData) ? stored.providerData : [],
  };
}

function callableDocumentId(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > 512 || normalized.includes('/')) {
    throw new HttpsError('invalid-argument', `A valid ${label} is required.`);
  }
  return normalized;
}

function invitationPreview(invite, currentUserId = null) {
  return {
    inviteKind: invite.inviteKind,
    organizationName: invite.organizationName || 'Dispatch organization',
    teamName: invite.teamName || null,
    deliveryEmailHint: maskEmail(invite.deliveryEmail),
    status: invite.status,
    canClaim: invite.status === 'active'
      || (invite.status === 'claimed' && Boolean(currentUserId) && invite.claimedBy === currentUserId),
    expiresAt: timestampMillis(invite.expiresAt) || null,
  };
}

async function resolveSecureInvite(lookupValue) {
  const value = typeof lookupValue === 'string' ? lookupValue.trim() : '';
  if (value.length < 8 || value.length > 256) return null;

  const tokenHash = hashInviteToken(value);
  const tokenRef = db.collection('secureInvites').doc(tokenHash);
  const tokenSnapshot = await tokenRef.get();
  if (tokenSnapshot.exists) {
    return { ref: tokenRef, snapshot: tokenSnapshot, inviteHash: tokenHash };
  }

  const codeHash = hashInviteCode(value);
  const codeSnapshot = await db.collection('secureInviteCodes').doc(codeHash).get();
  if (!codeSnapshot.exists || !codeSnapshot.data()?.inviteHash) return null;
  const inviteHash = codeSnapshot.data().inviteHash;
  const inviteRef = db.collection('secureInvites').doc(inviteHash);
  const inviteSnapshot = await inviteRef.get();
  return inviteSnapshot.exists
    ? { ref: inviteRef, snapshot: inviteSnapshot, inviteHash }
    : null;
}

async function loadLegacyInviteCandidates(authEmail) {
  const normalizedEmail = normalizeEmail(authEmail);
  if (!normalizedEmail) return { workerInvites: [], managerInvites: [] };
  const collections = ['workerInvites', 'managerInvites'];
  const emailFields = ['email', 'normalizedEmail', 'canonicalEmail', 'deliveryEmail'];
  const snapshots = await Promise.all(collections.flatMap((collectionName) => (
    emailFields.map((fieldName) => db.collection(collectionName).where(fieldName, '==', normalizedEmail).get())
  )));
  const byCollection = { workerInvites: new Map(), managerInvites: new Map() };
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((document) => {
      byCollection[document.ref.parent.id]?.set(document.id, { id: document.id, ...document.data() });
    });
  });
  return {
    workerInvites: [...byCollection.workerInvites.values()],
    managerInvites: [...byCollection.managerInvites.values()],
  };
}

function communicationThreadIds(organizationId, workerId) {
  return {
    organization: `organization:${organizationId}:all`,
    managers: `organization:${organizationId}:managers:${workerId}`,
  };
}

async function ensureRoleInviteEventAccess(notification, userId) {
  const eventRef = db.collection('events').doc(notification.eventId);
  return db.runTransaction(async (transaction) => {
    const eventSnapshot = await transaction.get(eventRef);
    if (!eventSnapshot.exists) throw new HttpsError('not-found', 'The invited Event no longer exists.');

    await assertOrganizationMutationAllowed(transaction, userId, eventSnapshot.data().organizationId);
    let access;
    try {
      access = eventAccessForRoleInvitation(notification, eventSnapshot.data(), userId);
    } catch (error) {
      throw new HttpsError('failed-precondition', error.message);
    }
    if (access.changed) {
      transaction.update(eventRef, {
        workerIds: access.workerIds,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return { eventId: notification.eventId, repaired: access.changed };
  });
}

exports.prepareEventRoleInviteResponse = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in before responding to a role invitation.');
  const notificationId = typeof request.data?.notificationId === 'string'
    ? request.data.notificationId.trim()
    : '';
  if (!notificationId || notificationId.length > 160) {
    throw new HttpsError('invalid-argument', 'A valid role invitation is required.');
  }

  const notificationSnapshot = await db.collection('roleAssignmentNotifications').doc(notificationId).get();
  if (!notificationSnapshot.exists) throw new HttpsError('not-found', 'The role invitation no longer exists.');
  const notification = { id: notificationSnapshot.id, ...notificationSnapshot.data() };
  if (notification.workerId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'This role invitation belongs to another user.');
  }
  if (notification.action !== 'assign') {
    return { eventId: notification.eventId, repaired: false };
  }
  if (notification.status === 'accepted') {
    return { eventId: notification.eventId, repaired: false };
  }

  return ensureRoleInviteEventAccess(notification, request.auth.uid);
});

exports.respondToEventRoleInvite = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in before responding to a role invitation.');
  const notificationId = typeof request.data?.notificationId === 'string'
    ? request.data.notificationId.trim()
    : '';
  const response = request.data?.response;
  if (!notificationId || notificationId.length > 160 || !['accept', 'decline'].includes(response)) {
    throw new HttpsError('invalid-argument', 'A valid role invitation and response are required.');
  }

  const result = await db.runTransaction(async (transaction) => {
    const notificationRef = db.collection('roleAssignmentNotifications').doc(notificationId);
    const notificationSnapshot = await transaction.get(notificationRef);
    if (!notificationSnapshot.exists) throw new HttpsError('not-found', 'The role invitation no longer exists.');
    const notification = { id: notificationSnapshot.id, ...notificationSnapshot.data() };
    if (notification.workerId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'This role invitation belongs to another user.');
    }

    const eventRef = db.collection('events').doc(notification.eventId);
    const workerRef = db.collection('users').doc(request.auth.uid);
    const [eventSnapshot, workerSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(workerRef),
    ]);
    if (!eventSnapshot.exists) throw new HttpsError('not-found', 'The invited Event no longer exists.');
    await assertOrganizationMutationAllowed(transaction, request.auth.uid, eventSnapshot.data().organizationId);
    await assertOrganizationMutationAllowed(transaction, notification.managerId, eventSnapshot.data().organizationId);
    const workerName = workerSnapshot.exists ? workerSnapshot.data().displayName : 'Worker';

    let mutation;
    try {
      mutation = buildEventRoleResponse({
        notification,
        event: eventSnapshot.data(),
        workerId: request.auth.uid,
        workerName,
        response,
      });
    } catch (error) {
      throw new HttpsError('failed-precondition', error.message);
    }
    if (mutation.alreadyHandled) return mutation;

    if (mutation.eventPatch) {
      transaction.update(eventRef, {
        ...mutation.eventPatch,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(notificationRef, {
      ...mutation.notificationPatch,
      respondedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(db.collection('userNotifications').doc(), {
      ...mutation.managerNotification,
      createdAt: FieldValue.serverTimestamp(),
    });
    return mutation;
  });

  return {
    eventId: result.eventId,
    roleId: result.roleId,
    shouldQueueReminder: result.shouldQueueReminder,
    alreadyHandled: result.alreadyHandled,
  };
});

exports.sendChatMessage = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in before sending a message.');
  const threadId = callableDocumentId(request.data?.threadId, 'chat');
  const threadRef = db.collection('chatThreads').doc(threadId);
  const senderRef = db.collection('users').doc(request.auth.uid);
  const messageRef = threadRef.collection('messages').doc();

  return db.runTransaction(async (transaction) => {
    const [threadSnapshot, senderSnapshot] = await Promise.all([
      transaction.get(threadRef),
      transaction.get(senderRef),
    ]);
    if (!threadSnapshot.exists) throw new HttpsError('not-found', 'This chat no longer exists.');

    const thread = { id: threadSnapshot.id, ...threadSnapshot.data() };
    for (const userId of uniqueStrings([request.auth.uid, ...uniqueStrings(thread.participants)])) {
      await assertOrganizationMutationAllowed(transaction, userId, thread.organizationId);
    }
    const senderName = senderSnapshot.exists
      ? senderSnapshot.data().displayName
      : request.auth.token.name;
    let mutation;
    try {
      mutation = buildChatMessageMutation({
        thread,
        senderId: request.auth.uid,
        senderName,
        text: request.data?.text,
        attachments: request.data?.attachments,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send this message.';
      const code = message.includes('not a member') ? 'permission-denied' : 'invalid-argument';
      throw new HttpsError(code, message);
    }

    transaction.create(messageRef, {
      ...mutation.message,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(threadRef, {
      ...mutation.threadPatch,
      updatedAt: FieldValue.serverTimestamp(),
    });
    mutation.recipientIds.forEach((userId) => {
      transaction.set(db.collection('chatUnread').doc(`${userId}__${threadId}`), {
        userId,
        threadId,
        teamId: mutation.message.teamId,
        unreadCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    return { messageId: messageRef.id, recipientCount: mutation.recipientIds.length };
  });
});

exports.addCustomChatParticipants = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in before changing chat members.');
  const threadId = callableDocumentId(request.data?.threadId, 'chat');
  const participantIds = uniqueStrings(request.data?.participantIds);
  if (!participantIds.length || participantIds.length > MAX_CHAT_PARTICIPANTS) {
    throw new HttpsError('invalid-argument', 'Select valid organization members.');
  }

  const threadRef = db.collection('chatThreads').doc(threadId);
  const senderRef = db.collection('users').doc(request.auth.uid);
  const participantRefs = participantIds.map((userId) => db.collection('users').doc(callableDocumentId(userId, 'user')));
  return db.runTransaction(async (transaction) => {
    const [threadSnapshot, senderSnapshot, ...participantSnapshots] = await Promise.all([
      transaction.get(threadRef),
      transaction.get(senderRef),
      ...participantRefs.map((participantRef) => transaction.get(participantRef)),
    ]);
    if (!threadSnapshot.exists) throw new HttpsError('not-found', 'This chat no longer exists.');
    const thread = { id: threadSnapshot.id, ...threadSnapshot.data() };
    const currentParticipants = uniqueStrings(thread.participants);
    if (thread.kind !== 'custom') throw new HttpsError('failed-precondition', 'Default chat membership cannot be changed here.');
    if (!currentParticipants.includes(request.auth.uid)) throw new HttpsError('permission-denied', 'You are not a member of this chat.');
    if (!senderSnapshot.exists || senderSnapshot.data().organizationId !== thread.organizationId) {
      throw new HttpsError('permission-denied', 'You are no longer a member of this organization.');
    }
    if (participantSnapshots.some((snapshot) => !snapshot.exists || snapshot.data().organizationId !== thread.organizationId)) {
      throw new HttpsError('permission-denied', 'Only members of this organization can be added.');
    }

    const nextParticipants = uniqueStrings([...currentParticipants, ...participantIds]);
    for (const userId of uniqueStrings([request.auth.uid, ...nextParticipants])) {
      await assertOrganizationMutationAllowed(transaction, userId, thread.organizationId);
    }
    if (nextParticipants.length > MAX_CHAT_PARTICIPANTS) {
      throw new HttpsError('resource-exhausted', 'This chat has too many participants.');
    }
    transaction.update(threadRef, {
      participants: nextParticipants,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { participantIds: nextParticipants };
  });
});

async function syncClaimedInvitationChats(organizationId, guardUserId) {
  const organizationRef = db.collection('organizations').doc(organizationId);
  await db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, guardUserId);
    const [organizationSnapshot, usersSnapshot, teamsSnapshot] = await Promise.all([
      transaction.get(organizationRef),
      transaction.get(db.collection('users').where('organizationId', '==', organizationId)),
      transaction.get(db.collection('teams').where('organizationId', '==', organizationId)),
    ]);
    if (!organizationSnapshot.exists) return;

    const tombstoneRefs = usersSnapshot.docs.map((userDocument) => (
      db.collection('accountDeletionTombstones').doc(userDocument.id)
    ));
    const tombstoneSnapshots = tombstoneRefs.length
      ? await transaction.getAll(...tombstoneRefs)
      : [];
    const deletionFencedUserIds = new Set(tombstoneSnapshots
      .filter((snapshot) => snapshot.exists && accountDeletionTombstoneIsActive(snapshot.data()))
      .map((snapshot) => snapshot.id));
    const organization = organizationSnapshot.data();
    const users = usersSnapshot.docs
      .filter((userDocument) => !deletionFencedUserIds.has(userDocument.id))
      .map((userDocument) => ({ id: userDocument.id, ...userDocument.data() }));
    const usersById = new Map(users.map((user) => [user.id, user]));
    const managerIds = uniqueStrings([
      ...uniqueStrings(organization.managerIds).filter((userId) => usersById.has(userId)),
      ...users.filter((user) => normalizedRole(user.role) === 'manager').map((user) => user.id),
    ]);
    const workerIds = uniqueStrings([
      ...uniqueStrings(organization.workerIds).filter((userId) => usersById.has(userId)),
      ...users.filter((user) => normalizedRole(user.role) === 'worker').map((user) => user.id),
    ]);
    const participantIds = uniqueStrings([...managerIds, ...workerIds]);
    const now = FieldValue.serverTimestamp();

    if (participantIds.length) {
      const organizationThreadId = communicationThreadIds(organizationId, '').organization;
      transaction.set(db.collection('chatThreads').doc(organizationThreadId), {
        id: organizationThreadId,
        organizationId,
        title: organization.name || 'Organization',
        kind: 'organization',
        participants: participantIds,
        updatedAt: now,
      }, { merge: true });
    }

    workerIds.forEach((workerId) => {
      const threadId = communicationThreadIds(organizationId, workerId).managers;
      const worker = usersById.get(workerId);
      transaction.set(db.collection('chatThreads').doc(threadId), {
        id: threadId,
        organizationId,
        title: worker?.displayName || 'Worker',
        kind: 'manager',
        participants: uniqueStrings([workerId, ...managerIds]),
        updatedAt: now,
      }, { merge: true });
    });

    teamsSnapshot.docs.forEach((teamDocument) => {
      const team = teamDocument.data();
      const teamWorkerIds = uniqueStrings(team.workerIds).filter((userId) => usersById.has(userId));
      const teamParticipants = uniqueStrings([...managerIds, ...teamWorkerIds]);
      const threadId = `team:${teamDocument.id}:all`;
      transaction.update(teamDocument.ref, { managerIds, updatedAt: now });
      transaction.set(db.collection('chatThreads').doc(threadId), {
        id: threadId,
        teamId: teamDocument.id,
        organizationId,
        teamName: team.name || null,
        title: team.name || 'Team',
        kind: 'team',
        participants: teamParticipants,
        createdByTeamSync: true,
        updatedAt: now,
      }, { merge: true });
    });
  });
}

exports.createDispatchInvite = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to send a Dispatch invitation.');
  }

  const inviteKind = request.data?.inviteKind === 'manager' ? 'manager' : request.data?.inviteKind === 'worker' ? 'worker' : null;
  const deliveryEmail = normalizeEmail(request.data?.deliveryEmail);
  const teamId = typeof request.data?.teamId === 'string' && request.data.teamId.trim()
    ? request.data.teamId.trim()
    : null;
  if (!inviteKind) throw new HttpsError('invalid-argument', 'Choose whether this invitation is for a Worker or Manager.');
  if (!isValidEmail(deliveryEmail)) throw new HttpsError('invalid-argument', 'Enter a valid delivery email address.');
  if (inviteKind === 'manager' && teamId) throw new HttpsError('invalid-argument', 'Managers join the organization rather than one Team.');

  const callerRef = db.collection('users').doc(request.auth.uid);
  const callerSnapshot = await callerRef.get();
  if (!callerSnapshot.exists || normalizedRole(callerSnapshot.data().role) !== 'manager') {
    throw new HttpsError('permission-denied', 'Only a Dispatch Manager can send invitations.');
  }

  const caller = callerSnapshot.data();
  const organizationId = caller.organizationId;
  if (!organizationId) throw new HttpsError('failed-precondition', 'Create or join an organization before inviting people.');
  const organizationRef = db.collection('organizations').doc(organizationId);
  const organizationSnapshot = await organizationRef.get();
  if (!organizationSnapshot.exists) throw new HttpsError('not-found', 'Organization not found.');
  const organization = organizationSnapshot.data();
  if (!Array.isArray(organization.managerIds) || !organization.managerIds.includes(request.auth.uid)) {
    throw new HttpsError('permission-denied', 'You are not an active Manager in this organization.');
  }

  let team = null;
  const teamRef = teamId ? db.collection('teams').doc(teamId) : null;
  if (teamId) {
    const teamSnapshot = await teamRef.get();
    if (!teamSnapshot.exists || teamSnapshot.data().organizationId !== organizationId) {
      throw new HttpsError('permission-denied', 'That Team is not part of your organization.');
    }
    team = { id: teamSnapshot.id, ...teamSnapshot.data() };
  }

  const { token, code } = generateInviteSecrets();
  const inviteHash = hashInviteToken(token);
  const codeHash = hashInviteCode(code);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const customerBetaProject = isCustomerBetaProject(runtimeProjectId());
  const { webUrl, appUrl } = buildInviteUrls(token, process.env.DISPATCH_INVITE_BASE_URL, { projectId: runtimeProjectId() });
  const appLink = webUrl || appUrl;
  const inviteRef = db.collection('secureInvites').doc(inviteHash);
  const codeRef = db.collection('secureInviteCodes').doc(codeHash);
  const sourceRef = db.collection(inviteKind === 'worker' ? 'workerInvites' : 'managerInvites').doc();
  const mailRef = customerBetaProject ? null : db.collection('mail').doc();
  const now = FieldValue.serverTimestamp();

  const activeOrganizationInvitesQuery = db.collection('secureInvites')
    .where('organizationId', '==', organizationId)
    .where('status', '==', 'active');
  const organizationMembersQuery = db.collection('users').where('organizationId', '==', organizationId);
  const billingRef = db.collection('organizationBilling').doc(organizationId);
  let capacityResult;

  await db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    const customerBeta = await customerBetaAccessEnabled(transaction);
    const documentRefs = [callerRef, organizationRef, billingRef, ...(teamRef ? [teamRef] : [])];
    const documentSnapshots = await transaction.getAll(...documentRefs);
    const [freshCallerSnapshot, freshOrganizationSnapshot, billingSnapshot, freshTeamSnapshot] = documentSnapshots;
    const [organizationInvites, organizationMembers] = await Promise.all([
      transaction.get(activeOrganizationInvitesQuery),
      transaction.get(organizationMembersQuery),
    ]);
    if (!freshCallerSnapshot.exists
      || normalizedRole(freshCallerSnapshot.data().role) !== 'manager'
      || freshCallerSnapshot.data().organizationId !== organizationId) {
      throw new HttpsError('permission-denied', 'Only an active organization Manager can send invitations.');
    }
    if (!freshOrganizationSnapshot.exists) throw new HttpsError('not-found', 'Organization not found.');
    const freshOrganization = organizationWithAcceptedProfiles(
      freshOrganizationSnapshot.data(),
      organizationMembers
    );
    if (customerBeta) assertCustomerBetaOrganizationWritable(freshOrganizationSnapshot.data());
    if (!Array.isArray(freshOrganization.managerIds) || !freshOrganization.managerIds.includes(request.auth.uid)) {
      throw new HttpsError('permission-denied', 'You are not an active Manager in this organization.');
    }
    if (teamRef && (!freshTeamSnapshot?.exists || freshTeamSnapshot.data().organizationId !== organizationId)) {
      throw new HttpsError('permission-denied', 'That Team is not part of your organization.');
    }
    const freshCaller = freshCallerSnapshot.data();
    const freshTeam = freshTeamSnapshot?.exists ? freshTeamSnapshot.data() : null;
    const organizationName = freshOrganization.name
      || freshCaller.organizationName
      || 'Dispatch organization';
    const teamName = freshTeam?.name || null;

    const nowMs = Date.now();
    const billing = billingSnapshot.exists
      ? { ...billingSnapshot.data() }
      : defaultOrganizationBilling(nowMs);
    const seededReservations = { ...(billing.seatReservations || {}) };
    organizationInvites.docs.forEach((document) => {
      const pendingInvite = document.data();
      const expiresAtMs = timestampMillis(pendingInvite.expiresAt);
      if (pendingInvite.status !== 'active' || expiresAtMs <= nowMs || !pendingInvite.deliveryEmail) return;
      seededReservations[seatReservationKey(pendingInvite.deliveryEmail)] = {
        inviteHash: document.id,
        sourceInviteId: pendingInvite.sourceInviteId || null,
        inviteKind: pendingInvite.inviteKind,
        expiresAtMs,
      };
    });

    if (!customerBeta && billing.accessMode === 'read_only') {
      const usage = calculateSeatUsage({
        organization: freshOrganization,
        billing: { ...billing, seatReservations: seededReservations },
        nowMs,
      });
      throw new HttpsError(
        'failed-precondition',
        'This organization is read-only. Resolve billing or Free-plan capacity before inviting another member.',
        {
          reason: 'organization-read-only',
          planId: billing.planId || 'free',
          pendingPlanId: billing.pendingPlanId || null,
          billingManagerId: resolveBillingManagerId(freshOrganization),
          memberCap: usage.memberCap,
          seatUsage: usage.seatUsage,
          acceptedSeats: usage.acceptedSeats,
          reservedSeats: usage.reservedSeats,
        }
      );
    }

    const replacedInvites = organizationInvites.docs.filter((document) => (
      document.data().deliveryEmail === deliveryEmail
    ));
    const replacedRelatedRefs = new Map();
    replacedInvites.forEach((document) => {
      const previous = document.data();
      if (['workerInvites', 'managerInvites'].includes(previous.sourceCollection)
        && typeof previous.sourceInviteId === 'string') {
        const ref = db.collection(previous.sourceCollection).doc(previous.sourceInviteId);
        replacedRelatedRefs.set(ref.path, ref);
      }
      if (typeof previous.codeHash === 'string' && previous.codeHash) {
        const ref = db.collection('secureInviteCodes').doc(previous.codeHash);
        replacedRelatedRefs.set(ref.path, ref);
      }
    });
    const replacedRelatedSnapshots = replacedRelatedRefs.size
      ? await transaction.getAll(...replacedRelatedRefs.values())
      : [];
    const replacedRelatedSnapshotByPath = new Map(
      replacedRelatedSnapshots.map((snapshot) => [snapshot.ref.path, snapshot])
    );

    capacityResult = reserveInvitationSeat({
      customerBeta,
      organization: freshOrganization,
      billing: { ...billing, seatReservations: seededReservations },
      deliveryEmail,
      inviteHash,
      inviteKind,
      sourceInviteId: sourceRef.id,
      expiresAtMs: expiresAt.getTime(),
      nowMs,
    });
    if (!capacityResult.ok) {
      throw new HttpsError('resource-exhausted', capacityResult.message, {
        reason: capacityResult.code,
        planId: billing.planId || 'free',
        pendingPlanId: billing.pendingPlanId || null,
        billingManagerId: resolveBillingManagerId(freshOrganization),
        memberCap: capacityResult.memberCap,
        seatUsage: capacityResult.seatUsage,
        acceptedSeats: capacityResult.acceptedSeats,
        reservedSeats: capacityResult.reservedSeats,
      });
    }

    if (!customerBeta) {
      transaction.set(billingRef, {
        ...capacityResult.billing,
        ...(billingSnapshot.exists ? {} : { createdAt: now }),
        updatedAt: now,
      }, { merge: true });
    }

    replacedInvites.forEach((document) => {
      const previous = document.data();
      const revokedState = {
        status: 'revoked',
        statusReason: 'Replaced by a newer invitation.',
        revokedAt: now,
        updatedAt: now,
      };
      transaction.update(document.ref, revokedState);
      if (['workerInvites', 'managerInvites'].includes(previous.sourceCollection)
        && typeof previous.sourceInviteId === 'string') {
        const previousSourceRef = db.collection(previous.sourceCollection).doc(previous.sourceInviteId);
        if (replacedRelatedSnapshotByPath.get(previousSourceRef.path)?.exists) {
          transaction.update(previousSourceRef, revokedState);
        }
      }
      if (typeof previous.codeHash === 'string' && previous.codeHash) {
        const previousCodeRef = db.collection('secureInviteCodes').doc(previous.codeHash);
        if (replacedRelatedSnapshotByPath.get(previousCodeRef.path)?.exists) {
          transaction.update(previousCodeRef, revokedState);
        }
      }
    });

    transaction.set(inviteRef, {
    inviteKind,
    inviterId: request.auth.uid,
    inviterName: freshCaller.displayName || 'A Dispatch manager',
    organizationId,
    organizationName,
    teamId,
    teamName,
    deliveryEmail,
    sourceInviteId: sourceRef.id,
    sourceCollection: inviteKind === 'worker' ? 'workerInvites' : 'managerInvites',
    codeHash,
    status: 'active',
    expiresAt,
    claimedBy: null,
    createdAt: now,
    updatedAt: now,
    });
    transaction.set(codeRef, {
    inviteHash,
    status: 'active',
    expiresAt,
    createdAt: now,
    updatedAt: now,
    });

    if (inviteKind === 'worker') {
      transaction.set(sourceRef, {
      managerId: request.auth.uid,
      teamId,
      teamName: teamName || (teamId ? 'Dispatch Team' : 'Solo worker'),
      organizationId,
      organizationName,
      appLink,
      deliveryEmail,
      workerId: null,
      claimRequired: true,
      secureInviteId: inviteHash,
      deliveryChannel: customerBeta ? 'share' : 'email',
      emailDelivery: customerBeta ? 'not_sent_customer_beta' : 'firebase-mail-collection',
      status: customerBeta ? 'created' : 'delivery_queued',
      statusReason: customerBeta
        ? 'Share the invitation link or code with the recipient. No email was sent.'
        : 'Secure invitation link queued for email delivery.',
      sendCount: customerBeta ? 0 : 1,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      lastSentAt: customerBeta ? null : now,
      });
    } else {
      transaction.set(sourceRef, {
      inviterId: request.auth.uid,
      organizationId,
      organizationName,
      deliveryEmail,
      managerUserId: null,
      claimRequired: true,
      secureInviteId: inviteHash,
      appLink,
      ...(customerBeta ? { deliveryChannel: 'share', emailDelivery: 'not_sent_customer_beta' } : {}),
      status: 'pending',
      statusReason: customerBeta
        ? 'Share the invitation link or code with the recipient. No email was sent.'
        : 'Waiting for the recipient to claim this secure invitation.',
      createdAt: now,
      updatedAt: now,
      expiresAt,
      });
    }

    if (!customerBeta) transaction.set(mailRef, {
      ...buildSecureInviteEmail({
        deliveryEmail,
        inviteKind,
        organizationName,
        teamName,
        inviterName: freshCaller.displayName,
        inviteId: sourceRef.id,
        webUrl,
        appUrl,
        code,
      }),
      createdAt: now,
    });
  });

  logger.info('Created secure Dispatch invitation.', {
    inviteKind,
    organizationId,
    teamId,
    inviterId: request.auth.uid,
    sourceInviteId: sourceRef.id,
    seatUsage: capacityResult?.seatUsage,
    memberCap: capacityResult?.memberCap,
  });
  return {
    inviteId: sourceRef.id,
    inviteCode: code,
    appLink,
    expiresAt: expiresAt.toISOString(),
    deliveryQueued: !customerBetaProject,
    deliveryChannel: customerBetaProject ? 'share' : 'email',
    reused: false,
    seatUsage: capacityResult?.seatUsage,
    memberCap: capacityResult?.memberCap,
  };
});

exports.getDispatchInvite = onCall({ maxInstances: 20 }, async (request) => {
  const resolved = await resolveSecureInvite(request.data?.tokenOrCode);
  if (!resolved) throw new HttpsError('not-found', 'This Dispatch invitation could not be found.');

  let invite = resolved.snapshot.data();
  if (invite.status === 'active' && timestampMillis(invite.expiresAt) <= Date.now()) {
    invite = await db.runTransaction(async (transaction) => {
      await assertAccountDeletionMutationLeaseAvailable(transaction);
      const freshInviteSnapshot = await transaction.get(resolved.ref);
      if (!freshInviteSnapshot.exists) {
        throw new HttpsError('not-found', 'This Dispatch invitation could not be found.');
      }
      const freshInvite = freshInviteSnapshot.data();
      if (freshInvite.status !== 'active' || timestampMillis(freshInvite.expiresAt) > Date.now()) {
        return freshInvite;
      }
      const sourceRef = ['workerInvites', 'managerInvites'].includes(freshInvite.sourceCollection)
        && typeof freshInvite.sourceInviteId === 'string'
        ? db.collection(freshInvite.sourceCollection).doc(freshInvite.sourceInviteId)
        : null;
      const codeRef = typeof freshInvite.codeHash === 'string' && freshInvite.codeHash
        ? db.collection('secureInviteCodes').doc(freshInvite.codeHash)
        : null;
      const billingRef = typeof freshInvite.organizationId === 'string' && freshInvite.organizationId
        ? db.collection('organizationBilling').doc(freshInvite.organizationId)
        : null;
      const relatedRefs = [sourceRef, codeRef, billingRef].filter(Boolean);
      const relatedSnapshots = relatedRefs.length ? await transaction.getAll(...relatedRefs) : [];
      const snapshotByPath = new Map(relatedSnapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
      const billingSnapshot = billingRef ? snapshotByPath.get(billingRef.path) : null;
      const now = FieldValue.serverTimestamp();
      transaction.update(resolved.ref, {
        status: 'expired',
        statusReason: 'Invitation expired before it was claimed.',
        expiredAt: now,
        updatedAt: now,
      });
      if (sourceRef && snapshotByPath.get(sourceRef.path)?.exists) {
        transaction.update(sourceRef, {
          status: 'expired',
          statusReason: 'Invitation expired before it was claimed.',
          expiredAt: now,
          updatedAt: now,
        });
      }
      if (codeRef && snapshotByPath.get(codeRef.path)?.exists) {
        transaction.update(codeRef, {
          status: 'expired',
          expiredAt: now,
          updatedAt: now,
        });
      }
      if (billingRef && billingSnapshot?.exists && freshInvite.deliveryEmail) {
        const billing = billingSnapshot.data();
        const reservationId = seatReservationKey(freshInvite.deliveryEmail);
        const matchingReservation = billing.seatReservations?.[reservationId]?.inviteHash === resolved.inviteHash;
        const nextBilling = matchingReservation
          ? releaseInvitationSeat({ billing, deliveryEmail: freshInvite.deliveryEmail })
          : billing;
        transaction.update(billingRef, { ...nextBilling, updatedAt: now });
      }
      return { ...freshInvite, status: 'expired' };
    });
  }
  return invitationPreview(invite, request.auth?.uid || null);
});

exports.cancelDispatchInvite = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before cancelling an invitation.');
  const sourceInviteId = typeof request.data?.inviteId === 'string' ? request.data.inviteId.trim() : '';
  if (!sourceInviteId) throw new HttpsError('invalid-argument', 'Invitation ID is required.');

  const [callerSnapshot, secureInvitesSnapshot] = await Promise.all([
    db.collection('users').doc(request.auth.uid).get(),
    db.collection('secureInvites').where('sourceInviteId', '==', sourceInviteId).limit(2).get(),
  ]);
  const organizationId = callerSnapshot.data()?.organizationId;
  if (!callerSnapshot.exists || normalizedRole(callerSnapshot.data()?.role) !== 'manager' || !organizationId) {
    throw new HttpsError('permission-denied', 'Only an active organization Manager can cancel invitations.');
  }
  if (secureInvitesSnapshot.empty) throw new HttpsError('not-found', 'Invitation not found.');
  const secureInviteSnapshot = secureInvitesSnapshot.docs[0];
  const secureInviteRef = secureInviteSnapshot.ref;
  const billingRef = db.collection('organizationBilling').doc(organizationId);
  const organizationMembersQuery = db.collection('users').where('organizationId', '==', organizationId);

  await db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    const freshInviteSnapshot = await transaction.get(secureInviteRef);
    if (!freshInviteSnapshot.exists) throw new HttpsError('not-found', 'Invitation not found.');
    const invite = freshInviteSnapshot.data();
    const sourceRef = ['workerInvites', 'managerInvites'].includes(invite.sourceCollection)
      && typeof invite.sourceInviteId === 'string'
      ? db.collection(invite.sourceCollection).doc(invite.sourceInviteId)
      : null;
    const codeRef = typeof invite.codeHash === 'string' && invite.codeHash
      ? db.collection('secureInviteCodes').doc(invite.codeHash)
      : null;
    const relatedRefs = [
      db.collection('organizations').doc(organizationId),
      billingRef,
      ...(sourceRef ? [sourceRef] : []),
      ...(codeRef ? [codeRef] : []),
    ];
    const relatedSnapshots = await transaction.getAll(...relatedRefs);
    const [organizationSnapshot, billingSnapshot] = relatedSnapshots;
    const snapshotByPath = new Map(relatedSnapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
    const organizationMembers = await transaction.get(organizationMembersQuery);
    const organization = organizationSnapshot.exists ? organizationSnapshot.data() : null;
    if (
      invite.organizationId !== organizationId ||
      !Array.isArray(organization?.managerIds) ||
      !organization.managerIds.includes(request.auth.uid)
    ) {
      throw new HttpsError('permission-denied', 'This invitation is not part of your organization.');
    }
    if (invite.status !== 'active') {
      throw new HttpsError('failed-precondition', `This invitation is already ${invite.status}.`);
    }

    const now = FieldValue.serverTimestamp();
    const cancelledState = {
      status: 'cancelled',
      statusReason: 'Cancelled by an organization Manager.',
      cancelledAt: now,
      updatedAt: now,
    };
    transaction.update(secureInviteRef, cancelledState);
    if (sourceRef && snapshotByPath.get(sourceRef.path)?.exists) {
      transaction.update(sourceRef, cancelledState);
    }
    if (codeRef && snapshotByPath.get(codeRef.path)?.exists) {
      transaction.update(codeRef, cancelledState);
    }
    if (billingSnapshot.exists && invite.deliveryEmail) {
      const billing = { ...defaultOrganizationBilling(), ...billingSnapshot.data() };
      const reservationId = seatReservationKey(invite.deliveryEmail);
      const nextBilling = billing.seatReservations?.[reservationId]?.inviteHash === secureInviteSnapshot.id
        ? releaseInvitationSeat({ billing, deliveryEmail: invite.deliveryEmail })
        : billing;
      const usage = calculateSeatUsage({
        organization: organizationWithAcceptedProfiles(organization, organizationMembers),
        billing: nextBilling,
      });
      transaction.update(billingRef, {
        ...nextBilling,
        accessMode: accessModeForBillingAndSeatUsage(nextBilling, usage.seatUsage),
        updatedAt: now,
      });
    }
  });

  return { cancelled: true, inviteId: sourceInviteId };
});

exports.claimDispatchInvite = onCall({ maxInstances: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before joining this Dispatch invitation.');
  const resolved = await resolveSecureInvite(request.data?.tokenOrCode);
  if (!resolved) throw new HttpsError('not-found', 'This Dispatch invitation could not be found.');
  const authUser = await adminAuth.getUser(request.auth.uid);

  const claimResult = await db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    const inviteSnapshot = await transaction.get(resolved.ref);
    if (!inviteSnapshot.exists) throw new HttpsError('not-found', 'This Dispatch invitation could not be found.');
    const invite = inviteSnapshot.data();

    if (invite.status === 'claimed' && invite.claimedBy === request.auth.uid) {
      return { ...invitationPreview(invite, request.auth.uid), organizationId: invite.organizationId, teamId: invite.teamId || null };
    }
    if (invite.status !== 'active') throw new HttpsError('failed-precondition', `This invitation is ${invite.status}.`);
    if (timestampMillis(invite.expiresAt) <= Date.now()) throw new HttpsError('deadline-exceeded', 'This invitation has expired. Ask the Manager for a new invitation.');

    const organizationRef = db.collection('organizations').doc(invite.organizationId);
    const userRef = db.collection('users').doc(request.auth.uid);
    if (!['workerInvites', 'managerInvites'].includes(invite.sourceCollection)
      || typeof invite.sourceInviteId !== 'string'
      || typeof invite.inviterId !== 'string'
      || !invite.inviterId) {
      throw new HttpsError('failed-precondition', 'The underlying invitation is invalid.');
    }
    const sourceRef = db.collection(invite.sourceCollection).doc(invite.sourceInviteId);
    const codeRef = db.collection('secureInviteCodes').doc(invite.codeHash);
    const billingRef = db.collection('organizationBilling').doc(invite.organizationId);
    const inviterRef = db.collection('users').doc(invite.inviterId);
    const organizationMembersQuery = db.collection('users').where('organizationId', '==', invite.organizationId);
    const refs = [organizationRef, userRef, sourceRef, billingRef, codeRef, inviterRef];
    const teamRef = invite.teamId ? db.collection('teams').doc(invite.teamId) : null;
    if (teamRef) refs.push(teamRef);
    const snapshots = await transaction.getAll(...refs);
    const organizationMembers = await transaction.get(organizationMembersQuery);
    const organizationSnapshot = snapshots[0];
    const customerBeta = await customerBetaAccessEnabled(transaction);
    const userSnapshot = snapshots[1];
    const sourceSnapshot = snapshots[2];
    const billingSnapshot = snapshots[3];
    const codeSnapshot = snapshots[4];
    const inviterSnapshot = snapshots[5];
    const teamSnapshot = teamRef ? snapshots[6] : null;
    if (!organizationSnapshot.exists) throw new HttpsError('not-found', 'The invited organization no longer exists.');
    if (!sourceSnapshot.exists) throw new HttpsError('not-found', 'The underlying invitation no longer exists.');
    if (teamRef && (!teamSnapshot?.exists || teamSnapshot.data().organizationId !== invite.organizationId)) {
      throw new HttpsError('failed-precondition', 'The invited Team is no longer available.');
    }

    const source = sourceSnapshot.data();
    const organizationData = organizationSnapshot.data();
    const inviter = inviterSnapshot.exists ? inviterSnapshot.data() : null;
    const sourceInviterId = invite.sourceCollection === 'workerInvites'
      ? source.managerId
      : source.inviterId;
    if (!inviter
      || normalizedRole(inviter.role) !== 'manager'
      || inviter.organizationId !== invite.organizationId
      || !Array.isArray(organizationData.managerIds)
      || !organizationData.managerIds.includes(invite.inviterId)
      || sourceInviterId !== invite.inviterId) {
      throw new HttpsError(
        'failed-precondition',
        'The Manager who issued this invitation is no longer authorized. Ask a current Manager for a new invitation.'
      );
    }
    if (['revoked', 'cancelled', 'declined', 'expired'].includes(source.status)) {
      throw new HttpsError('failed-precondition', `This invitation is ${source.status}.`);
    }
    const targetRole = invite.inviteKind === 'manager' ? 'manager' : 'worker';
    const existingUser = userSnapshot.exists ? userSnapshot.data() : null;
    const existingRole = normalizedRole(existingUser?.role);
    if (!canAdoptInviteRole({
      currentRole: existingRole,
      targetRole,
      currentOrganizationId: existingUser?.organizationId,
    })) {
      throw new HttpsError('failed-precondition', `This account is already connected to an organization as a ${existingRole}. Use an unaffiliated account or leave that organization before accepting a ${targetRole} invitation.`);
    }
    if (existingUser?.organizationId && existingUser.organizationId !== invite.organizationId) {
      throw new HttpsError('failed-precondition', 'This account already belongs to a different Dispatch organization.');
    }

    const organization = organizationWithAcceptedProfiles(
      organizationData,
      organizationMembers
    );
    if (customerBeta) assertCustomerBetaOrganizationWritable(organizationData);
    const nowMs = Date.now();
    const billing = billingSnapshot.exists
      ? { ...billingSnapshot.data() }
      : defaultOrganizationBilling(nowMs);
    if (!customerBeta && billing.accessMode === 'read_only') {
      throw new HttpsError(
        'failed-precondition',
        'This organization is read-only. Ask the Billing Manager to resolve billing before claiming this invitation.'
      );
    }
    const usage = calculateSeatUsage({ organization, billing, nowMs, customerBeta });
    const reservationId = seatReservationKey(invite.deliveryEmail);
    const reservation = usage.reservations[reservationId];
    const hasMatchingReservation = reservation?.inviteHash === resolved.inviteHash;
    const isAlreadyAcceptedMember = usage.acceptedMemberIds.includes(request.auth.uid);
    if (
      !isAlreadyAcceptedMember &&
      !hasMatchingReservation &&
      usage.memberCap !== null &&
      usage.seatUsage >= usage.memberCap
    ) {
      throw new HttpsError(
        'resource-exhausted',
        `This organization has used all ${usage.memberCap} member seats. Ask a Billing Manager to upgrade before claiming this invitation.`,
        { reason: 'capacity-exceeded', memberCap: usage.memberCap, seatUsage: usage.seatUsage }
      );
    }
    const nextBilling = hasMatchingReservation
      ? releaseInvitationSeat({ billing, deliveryEmail: invite.deliveryEmail, nowMs })
      : { ...billing, seatReservations: usage.reservations };
    const authEmail = normalizeEmail(authUser.email);
    const displayName = authUser.displayName?.trim()
      || existingUser?.displayName?.trim()
      || (authEmail.endsWith('@privaterelay.appleid.com') ? 'Dispatch User' : authEmail.split('@')[0])
      || 'Dispatch User';
    const now = FieldValue.serverTimestamp();
    if (!customerBeta) {
      transaction.set(billingRef, {
        ...nextBilling,
        ...(billingSnapshot.exists ? {} : { createdAt: now }),
        updatedAt: now,
      }, { merge: true });
    }
    transaction.set(userRef, {
      uid: request.auth.uid,
      displayName,
      role: targetRole,
      onboardingCompleted: true,
      organizationId: invite.organizationId,
      organizationName: invite.organizationName || organization.name || null,
      email: authEmail || null,
      canonicalEmail: authEmail || null,
      createdAt: existingUser?.createdAt || now,
      updatedAt: now,
    }, { merge: true });

    if (targetRole === 'worker') {
      transaction.set(organizationRef, {
        workerIds: FieldValue.arrayUnion(request.auth.uid),
        lastAcceptedInviteId: invite.sourceInviteId,
        updatedAt: now,
      }, { merge: true });
      if (teamRef) {
        transaction.set(teamRef, {
          workerIds: FieldValue.arrayUnion(request.auth.uid),
          lastAcceptedInviteId: invite.sourceInviteId,
          updatedAt: now,
        }, { merge: true });
      }
      transaction.set(sourceRef, {
        workerId: request.auth.uid,
        status: 'accepted',
        statusReason: 'Worker claimed the secure invitation link.',
        acceptedAt: now,
        consumedAt: now,
        updatedAt: now,
      }, { merge: true });
    } else {
      transaction.set(organizationRef, {
        managerIds: FieldValue.arrayUnion(request.auth.uid),
        updatedAt: now,
      }, { merge: true });
      transaction.set(sourceRef, {
        managerUserId: request.auth.uid,
        status: 'accepted',
        statusReason: 'Manager claimed the secure invitation link.',
        acceptedAt: now,
        updatedAt: now,
      }, { merge: true });
    }

    transaction.set(resolved.ref, {
      status: 'claimed',
      claimedBy: request.auth.uid,
      claimedAt: now,
      updatedAt: now,
    }, { merge: true });
    if (codeSnapshot.exists) {
      transaction.update(codeRef, { status: 'claimed', claimedAt: now, updatedAt: now });
    }
    const notificationRef = db.collection('userNotifications').doc();
    transaction.set(notificationRef, {
      userId: invite.inviterId,
      pushAuthorized: true,
      kind: invite.inviteKind === 'manager' ? 'manager_organisation_invite' : 'worker_team_invite',
      title: `${targetRole === 'manager' ? 'Manager' : 'Worker'} invitation accepted`,
      body: `${displayName} joined ${invite.teamName || invite.organizationName || 'your organization'}.`,
      relatedRoleId: invite.sourceInviteId,
      read: false,
      createdAt: now,
    });

    return { ...invitationPreview({ ...invite, status: 'claimed', claimedBy: request.auth.uid }, request.auth.uid), organizationId: invite.organizationId, teamId: invite.teamId || null };
  });

  await syncClaimedInvitationChats(claimResult.organizationId, request.auth.uid).catch((error) => {
    logger.error('Invitation claimed but communication-thread sync failed.', {
      organizationId: claimResult.organizationId,
      claimantId: request.auth.uid,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  logger.info('Claimed secure Dispatch invitation.', {
    claimantId: request.auth.uid,
    inviteKind: claimResult.inviteKind,
    organizationId: claimResult.organizationId,
    teamId: claimResult.teamId,
  });
  return { ...claimResult, claimed: true };
});

exports.adoptLegacyDispatchInvites = onCall({ maxInstances: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before linking an invitation.');
  const authUser = await adminAuth.getUser(request.auth.uid);
  if (authUser.emailVerified !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verify this account email before linking a legacy invitation.'
    );
  }
  const authEmail = normalizeEmail(authUser.email);
  if (!authEmail) return { adopted: false };

  const candidates = await loadLegacyInviteCandidates(authEmail);
  let initialPlan;
  try {
    initialPlan = buildLegacyInviteAdoptionPlan({
      authEmail,
      userId: request.auth.uid,
      ...candidates,
    });
  } catch (error) {
    if (error instanceof LegacyInviteOrganizationConflictError) {
      throw new HttpsError('failed-precondition', 'Legacy invitations target multiple organizations. Ask a Manager to revoke and reissue one secure invitation.');
    }
    throw error;
  }
  if (!initialPlan) return { adopted: false };

  const userRef = db.collection('users').doc(request.auth.uid);
  const organizationRef = db.collection('organizations').doc(initialPlan.organizationId);
  const billingRef = db.collection('organizationBilling').doc(initialPlan.organizationId);
  const sourceRefs = initialPlan.sourceInvites.map((invite) => db.collection(invite.collection).doc(invite.inviteId));
  const teamRefs = initialPlan.teamIds.map((teamId) => db.collection('teams').doc(teamId));
  const inviterRefs = [...new Set(initialPlan.sourceInvites.map((invite) => invite.inviterId))]
    .map((inviterId) => db.collection('users').doc(inviterId));
  const organizationMembersQuery = db.collection('users').where('organizationId', '==', initialPlan.organizationId);

  const result = await db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    const snapshots = await transaction.getAll(
      userRef,
      organizationRef,
      billingRef,
      ...sourceRefs,
      ...teamRefs,
      ...inviterRefs
    );
    const organizationMembers = await transaction.get(organizationMembersQuery);
    const [userSnapshot, organizationSnapshot, billingSnapshot] = snapshots;
    const customerBeta = await customerBetaAccessEnabled(transaction);
    if (!userSnapshot.exists || !organizationSnapshot.exists) {
      throw new HttpsError('not-found', 'The invited account or organization no longer exists.');
    }
    const freshWorkerInvites = [];
    const freshManagerInvites = [];
    snapshots.slice(3, 3 + sourceRefs.length).forEach((snapshot) => {
      const invite = { id: snapshot.id, ...snapshot.data() };
      if (snapshot.ref.parent.id === 'workerInvites') freshWorkerInvites.push(invite);
      if (snapshot.ref.parent.id === 'managerInvites') freshManagerInvites.push(invite);
    });
    let plan;
    try {
      plan = buildLegacyInviteAdoptionPlan({
        authEmail,
        userId: request.auth.uid,
        workerInvites: freshWorkerInvites,
        managerInvites: freshManagerInvites,
      });
    } catch (error) {
      if (error instanceof LegacyInviteOrganizationConflictError) {
        throw new HttpsError('failed-precondition', 'Legacy invitations target multiple organizations. Ask a Manager to revoke and reissue one secure invitation.');
      }
      throw error;
    }
    if (!plan || plan.organizationId !== initialPlan.organizationId) {
      throw new HttpsError('failed-precondition', 'This legacy invitation changed. Sign in again or ask for a new secure invitation.');
    }

    const inviterStart = 3 + sourceRefs.length + teamRefs.length;
    const inviterSnapshotsById = new Map(
      snapshots.slice(inviterStart).map((snapshot) => [snapshot.id, snapshot])
    );
    const organizationData = organizationSnapshot.data();
    const currentManagerIds = new Set(
      Array.isArray(organizationData.managerIds) ? organizationData.managerIds : []
    );
    const unauthorizedInviter = plan.sourceInvites.find((invite) => {
      const inviterSnapshot = inviterSnapshotsById.get(invite.inviterId);
      const inviter = inviterSnapshot?.exists ? inviterSnapshot.data() : null;
      return !inviter
        || normalizedRole(inviter.role) !== 'manager'
        || inviter.organizationId !== plan.organizationId
        || !currentManagerIds.has(invite.inviterId);
    });
    if (unauthorizedInviter) {
      throw new HttpsError(
        'failed-precondition',
        'The Manager who issued this legacy invitation is no longer authorized. Ask a current Manager for a new secure invitation.'
      );
    }

    const existingUser = userSnapshot.data();
    if (existingUser.organizationId && existingUser.organizationId !== plan.organizationId) {
      throw new HttpsError('failed-precondition', 'Leave the current organization before accepting another organization invitation.');
    }
    if (!canAdoptInviteRole({
      currentRole: existingUser.role,
      targetRole: plan.targetRole,
      currentOrganizationId: existingUser.organizationId,
    })) {
      throw new HttpsError('failed-precondition', 'This invitation role conflicts with the current organization membership.');
    }

    const organization = organizationWithAcceptedProfiles(organizationSnapshot.data(), organizationMembers);
    if (customerBeta) assertCustomerBetaOrganizationWritable(organizationSnapshot.data());
    const billing = billingSnapshot.exists
      ? { ...defaultOrganizationBilling(), ...billingSnapshot.data() }
      : defaultOrganizationBilling();
    if (!customerBeta && billing.accessMode === 'read_only') {
      throw new HttpsError('failed-precondition', 'This organization is read-only. Ask the Billing Manager to resolve billing or capacity before joining.');
    }
    const usage = calculateSeatUsage({ organization, billing, customerBeta });
    const alreadyAccepted = usage.acceptedMemberIds.includes(request.auth.uid);
    if (!alreadyAccepted && usage.memberCap !== null && usage.seatUsage >= usage.memberCap) {
      throw new HttpsError('resource-exhausted', `This organization has used all ${usage.memberCap} member seats. Ask the Billing Manager to upgrade.`, {
        reason: 'capacity-exceeded',
        memberCap: usage.memberCap,
        seatUsage: usage.seatUsage,
      });
    }

    const managerIds = [...new Set([...(organization.managerIds || []), ...(plan.targetRole === 'manager' ? [request.auth.uid] : [])])]
      .filter((userId) => plan.targetRole === 'manager' || userId !== request.auth.uid);
    const workerIds = [...new Set([...(organization.workerIds || []), ...(plan.targetRole === 'worker' ? [request.auth.uid] : [])])]
      .filter((userId) => plan.targetRole === 'worker' || userId !== request.auth.uid);
    const now = FieldValue.serverTimestamp();
    transaction.set(userRef, {
      role: plan.targetRole,
      organizationId: plan.organizationId,
      organizationName: organizationData.name || null,
      email: authEmail,
      canonicalEmail: authEmail,
      updatedAt: now,
    }, { merge: true });
    transaction.update(organizationRef, {
      managerIds,
      workerIds,
      pendingManagerInviteEmails: FieldValue.arrayRemove(plan.normalizedEmail),
      pendingManagerInviteCanonicalEmails: FieldValue.arrayRemove(plan.canonicalEmail),
      updatedAt: now,
    });
    const nextSeatUsage = usage.seatUsage + (alreadyAccepted ? 0 : 1);
    if (!customerBeta) {
      transaction.set(billingRef, {
        ...billing,
        accessMode: billing.planId === 'free' && nextSeatUsage > 5 ? 'read_only' : billing.accessMode,
        ...(billingSnapshot.exists ? {} : { createdAt: now }),
        updatedAt: now,
      }, { merge: true });
    }
    snapshots.slice(3 + sourceRefs.length, inviterStart).forEach((teamSnapshot) => {
      if (!teamSnapshot.exists || teamSnapshot.data().organizationId !== plan.organizationId || plan.targetRole !== 'worker') return;
      transaction.update(teamSnapshot.ref, {
        workerIds: FieldValue.arrayUnion(request.auth.uid),
        updatedAt: now,
      });
    });
    snapshots.slice(3, 3 + sourceRefs.length).forEach((inviteSnapshot) => {
      transaction.update(inviteSnapshot.ref, {
        status: 'accepted',
        statusReason: 'Pre-secure invitation adopted by the authenticated account through a server migration path.',
        ...(inviteSnapshot.ref.parent.id === 'workerInvites'
          ? { workerId: request.auth.uid }
          : { managerUserId: request.auth.uid }),
        acceptedAt: now,
        consumedAt: now,
        updatedAt: now,
      });
    });
    return { adopted: true, organizationId: plan.organizationId, role: plan.targetRole };
  });

  await syncClaimedInvitationChats(result.organizationId, request.auth.uid).catch((error) => {
    logger.error('Legacy invitation adopted but communication-thread sync failed.', {
      organizationId: result.organizationId,
      claimantId: request.auth.uid,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  return result;
});

exports.transferOrganizationBillingManager = onCall({
  maxInstances: 10,
  secrets: subscriptionSecrets([revenueCatSecretApiKey]),
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to transfer billing responsibility.');
  }
  await assertSubscriptionsAvailable();

  const targetManagerId = typeof request.data?.targetManagerId === 'string'
    ? request.data.targetManagerId.trim()
    : '';
  if (!targetManagerId) {
    throw new HttpsError('invalid-argument', 'Choose another Manager for billing responsibility.');
  }

  const callerRef = db.collection('users').doc(request.auth.uid);
  const callerSnapshot = await callerRef.get();
  const organizationId = callerSnapshot.data()?.organizationId;
  if (!callerSnapshot.exists || normalizedRole(callerSnapshot.data()?.role) !== 'manager' || !organizationId) {
    throw new HttpsError('permission-denied', 'Only an active organization Manager can transfer billing responsibility.');
  }

  const organizationRef = db.collection('organizations').doc(organizationId);
  const billingRef = db.collection('organizationBilling').doc(organizationId);
  const targetRef = db.collection('users').doc(targetManagerId);
  const auditRef = db.collection('billingAuditEvents').doc();
  const notificationRef = db.collection('userNotifications').doc();
  const organizationMembersQuery = db.collection('users').where('organizationId', '==', organizationId);
  const verificationBillingSnapshot = await billingRef.get();
  const verificationBilling = verificationBillingSnapshot.exists
    ? { ...defaultOrganizationBilling(), ...verificationBillingSnapshot.data() }
    : defaultOrganizationBilling();
  const verificationPayerId = verificationBilling.purchaserUserId
    || verificationBilling.purchaseIntent?.purchaserUserId
    || null;
  const verificationCustomerRef = verificationPayerId
    ? db.collection('revenueCatCustomers').doc(hashedDocumentId(verificationPayerId))
    : null;
  let verifiedProjection = null;
  if (verificationPayerId) {
    try {
      const subscriber = await fetchRevenueCatSubscriber({
        appUserId: verificationPayerId,
        secretApiKey: revenueCatSecretApiKey.value(),
      });
      verifiedProjection = deriveOrganizationBillingFromSubscriber({
        subscriber,
        currentBilling: verificationBilling,
        expectedEnvironment: expectedRevenueCatEnvironment(),
      });
    } catch (error) {
      throw new HttpsError('unavailable', error instanceof Error ? error.message : 'RevenueCat could not verify the current payer.');
    }
  }

  const result = await db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    await assertAccountDeletionNotStarted(transaction, targetManagerId);
    if (verificationPayerId && verificationPayerId !== request.auth.uid && verificationPayerId !== targetManagerId) {
      await assertAccountDeletionNotStarted(transaction, verificationPayerId);
    }
    const snapshots = await transaction.getAll(
      callerRef,
      organizationRef,
      targetRef,
      billingRef,
      ...(verificationCustomerRef ? [verificationCustomerRef] : [])
    );
    const [freshCallerSnapshot, organizationSnapshot, targetSnapshot, billingSnapshot] = snapshots;
    const verificationCustomerSnapshot = verificationCustomerRef ? snapshots[4] : null;
    const organizationMembers = await transaction.get(organizationMembersQuery);
    if (!revenueCatBillingSnapshotIsCurrent({
      preloadedExists: verificationBillingSnapshot.exists,
      preloadedBilling: verificationBillingSnapshot.exists ? verificationBillingSnapshot.data() : {},
      freshExists: billingSnapshot.exists,
      freshBilling: billingSnapshot.exists ? billingSnapshot.data() : {},
    })) {
      throw new HttpsError('aborted', 'Billing changed during RevenueCat verification. Refresh and try again.');
    }
    if (!organizationSnapshot.exists) throw new HttpsError('not-found', 'Organization not found.');
    if (
      !freshCallerSnapshot.exists ||
      freshCallerSnapshot.data().organizationId !== organizationId ||
      normalizedRole(freshCallerSnapshot.data().role) !== 'manager'
    ) {
      throw new HttpsError('permission-denied', 'Your Manager membership changed. Refresh and try again.');
    }

    const organization = { id: organizationSnapshot.id, ...organizationSnapshot.data() };
    const targetUser = targetSnapshot.exists ? targetSnapshot.data() : null;
    const validation = validateBillingManagerTransfer({
      organization,
      callerId: request.auth.uid,
      targetManagerId,
      targetUser,
    });
    if (!validation.ok) throw new HttpsError(validation.code, validation.message);

    const billing = billingSnapshot.exists
      ? { ...defaultOrganizationBilling(), ...billingSnapshot.data() }
      : defaultOrganizationBilling();
    const billingVerificationPayerId = billing.purchaserUserId
      || billing.purchaseIntent?.purchaserUserId
      || null;
    if (billingVerificationPayerId !== verificationPayerId) {
      throw new HttpsError('aborted', 'Billing ownership changed during verification. Refresh and try again.');
    }
    const usage = calculateSeatUsage({
      organization: organizationWithAcceptedProfiles(organization, organizationMembers),
      billing,
    });
    const verifiedBilling = verifiedProjection
      ? {
          ...billing,
          ...applyRevenueCatLifecyclePolicy({
            billing,
            projection: verifiedProjection,
            seatUsage: usage.seatUsage,
          }),
          purchaserUserId: isLivePaidRevenueCatProjection(verifiedProjection)
            ? verificationPayerId
            : billing.purchaserUserId,
        }
      : billing;
    const livePaidPayerId = verifiedBilling.planId !== 'free'
      && ['trialing', 'active', 'grace'].includes(verifiedBilling.status)
      ? verifiedBilling.purchaserUserId
      : null;
    if (livePaidPayerId && targetManagerId !== livePaidPayerId) {
      throw new HttpsError(
        'failed-precondition',
        'The active Apple or Google payer must remain the Billing Manager. Cancel renewal and wait for paid access to end before passing the role.'
      );
    }

    const now = FieldValue.serverTimestamp();
    const releasesStalePayer = Boolean(
      verifiedProjection
      && verificationPayerId
      && !isLivePaidRevenueCatProjection(verifiedProjection)
      && targetManagerId !== verificationPayerId
    );
    if (verifiedProjection) {
      transaction.set(billingRef, {
        ...verifiedBilling,
        ...(releasesStalePayer ? {
          purchaserUserId: null,
          purchaseIntent: FieldValue.delete(),
        } : {}),
        updatedAt: now,
      }, { merge: true });
    }
    if (
      releasesStalePayer
      && verificationCustomerRef
      && verificationCustomerSnapshot?.exists
      && verificationCustomerSnapshot.data().organizationId === organizationId
    ) {
      transaction.set(verificationCustomerRef, {
        active: false,
        state: 'released',
        releasedReason: 'billing_manager_transferred_after_expiry',
        releasedAt: now,
        updatedAt: now,
      }, { merge: true });
    }
    transaction.update(organizationRef, {
      billingManagerId: targetManagerId,
      billingManagerTransferredBy: request.auth.uid,
      billingManagerTransferredAt: now,
      updatedAt: now,
    });
    transaction.create(auditRef, {
      organizationId,
      kind: 'billing_manager_transferred',
      actorUserId: request.auth.uid,
      previousBillingManagerId: validation.currentBillingManagerId,
      nextBillingManagerId: targetManagerId,
      createdAt: now,
    });
    transaction.create(notificationRef, {
      userId: targetManagerId,
      pushAuthorized: true,
      kind: 'billing_manager_transfer',
      title: 'You are now the Billing Manager',
      body: `You now manage Dispatch billing for ${organization.name || 'your organization'}.`,
      read: false,
      createdAt: now,
    });

    return {
      organizationId,
      previousBillingManagerId: validation.currentBillingManagerId,
      billingManagerId: targetManagerId,
    };
  });

  logger.info('Transferred Dispatch Billing Manager responsibility.', {
    organizationId: result.organizationId,
    previousBillingManagerId: result.previousBillingManagerId,
    billingManagerId: result.billingManagerId,
  });
  return result;
});

exports.removeOrganizationMember = onCall({
  maxInstances: 10,
  secrets: subscriptionSecrets([revenueCatSecretApiKey]),
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before removing an organization member.');
  const customerBeta = await customerBetaAccessEnabled();
  const targetUserId = typeof request.data?.targetUserId === 'string' ? request.data.targetUserId.trim() : '';
  if (!targetUserId) throw new HttpsError('invalid-argument', 'Choose an organization member to remove.');

  const callerRef = db.collection('users').doc(request.auth.uid);
  const callerSnapshot = await callerRef.get();
  const organizationId = callerSnapshot.data()?.organizationId;
  if (!callerSnapshot.exists || normalizedRole(callerSnapshot.data()?.role) !== 'manager' || !organizationId) {
    throw new HttpsError('permission-denied', 'Only an active organization Manager can remove members.');
  }
  const organizationRef = db.collection('organizations').doc(organizationId);
  const billingRef = db.collection('organizationBilling').doc(organizationId);
  const targetRef = db.collection('users').doc(targetUserId);
  const auditRef = db.collection('billingAuditEvents').doc();
  const notificationRef = db.collection('userNotifications').doc();
  const targetCustomerRef = db.collection('revenueCatCustomers').doc(hashedDocumentId(targetUserId));
  const teamsQuery = db.collection('teams').where('organizationId', '==', organizationId);
  const organizationMembersQuery = db.collection('users').where('organizationId', '==', organizationId);
  const organizationEventsQuery = db.collection('events').where('organizationId', '==', organizationId);
  const targetChatThreadsQuery = db.collection('chatThreads').where('participants', 'array-contains', targetUserId);
  const targetChatUnreadQuery = db.collection('chatUnread').where('userId', '==', targetUserId);
  const roleNotificationsQuery = db.collection('roleAssignmentNotifications').where('workerId', '==', targetUserId);
  const managedRoleNotificationsQuery = db.collection('roleAssignmentNotifications').where('managerId', '==', targetUserId);
  const verificationBillingSnapshot = await billingRef.get();
  const verificationBilling = verificationBillingSnapshot.exists
    ? { ...defaultOrganizationBilling(), ...verificationBillingSnapshot.data() }
    : defaultOrganizationBilling();
  const verificationPayerId = verificationBilling.purchaserUserId
    || verificationBilling.purchaseIntent?.purchaserUserId
    || null;
  let verifiedLivePaidPurchaserId = null;
  let verifiedPayerProjection = null;
  if (!customerBeta && verificationPayerId === targetUserId) {
    try {
      const subscriber = await fetchRevenueCatSubscriber({
        appUserId: verificationPayerId,
        secretApiKey: revenueCatSecretApiKey.value(),
      });
      verifiedPayerProjection = deriveOrganizationBillingFromSubscriber({
        subscriber,
        currentBilling: verificationBilling,
        expectedEnvironment: expectedRevenueCatEnvironment(),
      });
      if (isLivePaidRevenueCatProjection(verifiedPayerProjection)) {
        verifiedLivePaidPurchaserId = verificationPayerId;
      }
    } catch (error) {
      throw new HttpsError('unavailable', error instanceof Error ? error.message : 'RevenueCat could not verify the current payer.');
    }
  }

  const result = await db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    await assertAccountDeletionNotStarted(transaction, targetUserId);
    await customerBetaAccessEnabled(transaction);
    if (verificationPayerId && verificationPayerId !== request.auth.uid && verificationPayerId !== targetUserId) {
      await assertAccountDeletionNotStarted(transaction, verificationPayerId);
    }
    const [organizationSnapshot, billingSnapshot, freshCallerSnapshot, targetSnapshot, targetCustomerSnapshot] = await transaction.getAll(
      organizationRef,
      billingRef,
      callerRef,
      targetRef,
      targetCustomerRef
    );
    const [
      teamsSnapshot,
      organizationMembers,
      organizationEventsSnapshot,
      targetChatThreadsSnapshot,
      targetChatUnreadSnapshot,
      roleNotificationsSnapshot,
      managedRoleNotificationsSnapshot,
    ] = await Promise.all([
      transaction.get(teamsQuery),
      transaction.get(organizationMembersQuery),
      transaction.get(organizationEventsQuery),
      transaction.get(targetChatThreadsQuery),
      transaction.get(targetChatUnreadQuery),
      transaction.get(roleNotificationsQuery),
      transaction.get(managedRoleNotificationsQuery),
    ]);
    if (!revenueCatBillingSnapshotIsCurrent({
      preloadedExists: verificationBillingSnapshot.exists,
      preloadedBilling: verificationBillingSnapshot.exists ? verificationBillingSnapshot.data() : {},
      freshExists: billingSnapshot.exists,
      freshBilling: billingSnapshot.exists ? billingSnapshot.data() : {},
    })) {
      throw new HttpsError('aborted', 'Billing changed during RevenueCat verification. Refresh and try again.');
    }
    const organizationEventIds = new Set(organizationEventsSnapshot.docs.map((snapshot) => snapshot.id));
    const organizationEventUpdates = new Map();
    organizationEventsSnapshot.docs.forEach((snapshot) => {
      const event = snapshot.data();
      const cleanup = removeWorkerFromEventMembership(event.roles, targetUserId);
      const reassignsManager = event.managerId === targetUserId;
      if (cleanup.changed
        || reassignsManager
        || (Array.isArray(event.workerIds) && event.workerIds.includes(targetUserId))) {
        organizationEventUpdates.set(snapshot.ref.path, { snapshot, event, cleanup, reassignsManager });
      }
    });
    const roleNotificationDocuments = new Map();
    [...roleNotificationsSnapshot.docs, ...managedRoleNotificationsSnapshot.docs]
      .filter((snapshot) => organizationEventIds.has(snapshot.data().eventId))
      .forEach((snapshot) => roleNotificationDocuments.set(snapshot.ref.path, snapshot));
    const organizationTeamDocuments = teamsSnapshot.docs.filter((snapshot) => {
      const team = snapshot.data();
      return team.managerId === targetUserId
        || uniqueStrings(team.managerIds).includes(targetUserId)
        || uniqueStrings(team.workerIds).includes(targetUserId);
    });
    const targetChatThreadDocuments = targetChatThreadsSnapshot.docs;
    const targetChatUnreadDocuments = targetChatUnreadSnapshot.docs;
    const targetActiveViewerRefs = targetChatThreadsSnapshot.docs.map((snapshot) => (
      snapshot.ref.collection('activeViewers').doc(targetUserId)
    ));
    const targetActiveViewerSnapshots = targetActiveViewerRefs.length
      ? await transaction.getAll(...targetActiveViewerRefs)
      : [];
    const targetActiveViewerDocuments = targetActiveViewerSnapshots.filter((snapshot) => snapshot.exists);
    const projectedWriteCount = 6
      + organizationTeamDocuments.length
      + organizationEventUpdates.size
      + roleNotificationDocuments.size
      + targetChatThreadDocuments.length
      + targetChatUnreadDocuments.length
      + targetActiveViewerDocuments.length;
    if (projectedWriteCount > 450) {
      throw new HttpsError(
        'resource-exhausted',
        'This member has too much related event history for an atomic removal. Contact Dispatch support for assisted cleanup.'
      );
    }
    if (!organizationSnapshot.exists || !targetSnapshot.exists) {
      throw new HttpsError('not-found', 'The organization or selected member no longer exists.');
    }
    if (!freshCallerSnapshot.exists || freshCallerSnapshot.data().organizationId !== organizationId
      || normalizedRole(freshCallerSnapshot.data().role) !== 'manager') {
      throw new HttpsError('permission-denied', 'Your organization membership changed. Refresh and try again.');
    }
    const billing = billingSnapshot.exists
      ? { ...defaultOrganizationBilling(), ...billingSnapshot.data() }
      : defaultOrganizationBilling();
    const billingVerificationPayerId = billing.purchaserUserId
      || billing.purchaseIntent?.purchaserUserId
      || null;
    if (billingVerificationPayerId !== verificationPayerId) {
      throw new HttpsError('aborted', 'Billing ownership changed during verification. Refresh and try again.');
    }
    const organization = { id: organizationSnapshot.id, ...organizationSnapshot.data() };
    const plan = planOrganizationMemberRemoval({
      organization,
      callerId: request.auth.uid,
      targetUserId,
      targetUser: { uid: targetSnapshot.id, ...targetSnapshot.data() },
      verifiedLivePaidPurchaserId,
      customerBeta,
    });
    if (!plan.ok) throw new HttpsError(plan.code, plan.message, { reason: plan.reason });
    const retainedManagerId = plan.managerIds.includes(request.auth.uid)
      ? request.auth.uid : plan.managerIds[0];

    const now = FieldValue.serverTimestamp();
    transaction.update(organizationRef, { ...plan.organizationUpdate, updatedAt: now });
    transaction.update(targetRef, {
      organizationId: null,
      organizationName: null,
      updatedAt: now,
    });
    organizationTeamDocuments.forEach((teamSnapshot) => {
      const team = teamSnapshot.data();
      const nextManagerIds = uniqueStrings(team.managerIds).filter((userId) => userId !== targetUserId);
      const nextWorkerIds = uniqueStrings(team.workerIds).filter((userId) => userId !== targetUserId);
      const reassignsPrimaryManager = team.managerId === targetUserId;
      const retainedManagerIds = uniqueStrings([
        ...nextManagerIds,
        ...(reassignsPrimaryManager ? [retainedManagerId] : []),
      ]);
      transaction.update(teamSnapshot.ref, {
        managerId: reassignsPrimaryManager ? retainedManagerId : team.managerId,
        managerIds: retainedManagerIds.length ? retainedManagerIds : plan.managerIds,
        workerIds: nextWorkerIds,
        updatedAt: now,
      });
    });
    organizationEventUpdates.forEach(({ snapshot, event, cleanup, reassignsManager }) => {
      transaction.update(snapshot.ref, {
        roles: cleanup.roles,
        workerIds: cleanup.workerIds,
        ...(reassignsManager ? { managerId: retainedManagerId } : {}),
        revision: (event.revision ?? 0) + 1,
        updatedAt: now,
      });
    });
    roleNotificationDocuments.forEach((snapshot) => {
      const notification = snapshot.data();
      if (notification.workerId === targetUserId) {
        transaction.set(snapshot.ref, {
          status: 'declined',
          response: 'decline',
          statusReason: 'Organization membership was removed by the Billing Manager.',
          respondedAt: now,
          updatedAt: now,
        }, { merge: true });
      } else if (notification.managerId === targetUserId) {
        transaction.set(snapshot.ref, { managerId: retainedManagerId, updatedAt: now }, { merge: true });
      }
    });
    targetChatThreadDocuments.forEach((snapshot) => {
      const thread = snapshot.data();
      const chatAuthorization = removeOrganizationMemberFromChatThread(thread, targetUserId);
      transaction.update(snapshot.ref, {
        ...chatAuthorization,
        updatedAt: now,
      });
    });
    targetChatUnreadDocuments.forEach((snapshot) => transaction.delete(snapshot.ref));
    targetActiveViewerDocuments.forEach((snapshot) => transaction.delete(snapshot.ref));
    const remainingProfiles = organizationMembers.docs
      .filter((document) => document.id !== targetUserId)
      .map((document) => ({ uid: document.id, ...document.data() }));
    const verifiedBilling = verifiedPayerProjection
      ? {
          ...billing,
          ...applyRevenueCatLifecyclePolicy({
            billing,
            projection: verifiedPayerProjection,
            seatUsage: Math.max(0, organizationMembers.size - 1),
          }),
        }
      : billing;
    const releasesTargetPayer = !customerBeta && verificationPayerId === targetUserId
      && !verifiedLivePaidPurchaserId;
    const billingAfterPayerRelease = releasesTargetPayer
      ? { ...verifiedBilling, purchaserUserId: null, purchaseIntent: null }
      : verifiedBilling;
    const nextUsage = calculateSeatUsage({
      organization: mergeAcceptedOrganizationProfiles(plan.nextOrganization, remainingProfiles),
      billing: billingAfterPayerRelease,
    });
    if (!customerBeta) {
      transaction.set(billingRef, {
        ...billingAfterPayerRelease,
        accessMode: accessModeForBillingAndSeatUsage(billingAfterPayerRelease, nextUsage.seatUsage),
        ...(releasesTargetPayer ? { purchaseIntent: FieldValue.delete() } : {}),
        ...(billingSnapshot.exists ? {} : { createdAt: now }),
        updatedAt: now,
      }, { merge: true });
    }
    if (
      releasesTargetPayer
      && targetCustomerSnapshot.exists
      && targetCustomerSnapshot.data().organizationId === organizationId
    ) {
      transaction.set(targetCustomerRef, {
        active: false,
        state: 'released',
        releasedReason: 'organization_member_removed',
        releasedAt: now,
        updatedAt: now,
      }, { merge: true });
    }
    transaction.create(auditRef, {
      organizationId,
      kind: 'organization_member_removed',
      actorUserId: request.auth.uid,
      targetUserId,
      targetRole: plan.targetRole,
      createdAt: now,
    });
    transaction.create(notificationRef, {
      userId: targetUserId,
      pushAuthorized: true,
      kind: 'organization_member_removed',
      title: 'Organization access removed',
      body: `Your access to ${organization.name || 'the Dispatch organization'} was removed by the Billing Manager.`,
      read: false,
      createdAt: now,
    });
    return { removed: true, organizationId, targetUserId, targetRole: plan.targetRole };
  });

  await syncClaimedInvitationChats(organizationId, request.auth.uid).catch((error) => {
    logger.error('Organization member removed but communication-thread sync failed.', {
      organizationId,
      targetUserId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  return result;
});

exports.listOrganizationPendingInvites = onCall({ maxInstances: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before loading organization invitations.');
  const callerSnapshot = await db.collection('users').doc(request.auth.uid).get();
  const organizationId = callerSnapshot.data()?.organizationId;
  if (!callerSnapshot.exists || !organizationId) throw new HttpsError('permission-denied', 'Organization membership is required.');
  const organizationSnapshot = await db.collection('organizations').doc(organizationId).get();
  if (!organizationSnapshot.exists || resolveBillingManagerId(organizationSnapshot.data()) !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Only the Billing Manager can manage pending organization invitations.');
  }
  const invitesSnapshot = await db.collection('secureInvites').where('organizationId', '==', organizationId).get();
  const nowMs = Date.now();
  return {
    invites: invitesSnapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter((invite) => invite.status === 'active' && timestampMillis(invite.expiresAt) > nowMs)
      .map((invite) => ({
        inviteId: invite.sourceInviteId,
        inviteKind: invite.inviteKind,
        deliveryEmailHint: maskEmail(invite.deliveryEmail),
        teamName: invite.teamName || null,
        expiresAt: timestampMillis(invite.expiresAt),
      }))
      .filter((invite) => Boolean(invite.inviteId))
      .sort((left, right) => left.expiresAt - right.expiresAt),
  };
});

exports.mutateWorkerEvent = onCall({ maxInstances: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before changing an event.');
  const actionType = typeof request.data?.actionType === 'string' ? request.data.actionType.trim() : '';
  const notificationAction = actionType === 'respond_role_notification'
    || (actionType === 'join_event_waitlist' && Boolean(request.data?.notificationId));
  const notificationId = notificationAction
    ? requiredDocumentId(request.data?.notificationId, 'Notification ID')
    : null;
  const requestedEventId = request.data?.eventId
    ? requiredDocumentId(request.data.eventId, 'Event ID')
    : null;
  if (!requestedEventId && !notificationId) {
    throw new HttpsError('invalid-argument', 'Event ID or notification ID is required.');
  }
  const authUser = await adminAuth.getUser(request.auth.uid);

  return db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    const notificationRef = notificationId
      ? db.collection('roleAssignmentNotifications').doc(notificationId)
      : null;
    const notificationSnapshot = notificationRef ? await transaction.get(notificationRef) : null;
    if (notificationRef && !notificationSnapshot.exists) {
      throw new HttpsError('not-found', 'The role notification no longer exists.');
    }
    const notification = notificationSnapshot
      ? { id: notificationSnapshot.id, ...notificationSnapshot.data() }
      : null;
    const eventId = requestedEventId
      || requiredDocumentId(notification?.eventId, 'Notification event ID');
    if (requestedEventId && notification && notification.eventId !== requestedEventId) {
      throw new HttpsError('failed-precondition', 'The notification no longer matches this event.');
    }

    const eventRef = db.collection('events').doc(eventId);
    const callerRef = db.collection('users').doc(request.auth.uid);
    const [eventSnapshot, callerSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(callerRef),
    ]);
    if (!eventSnapshot.exists) throw new HttpsError('not-found', 'The event no longer exists.');
    if (!callerSnapshot.exists || normalizedRole(callerSnapshot.data().role) !== 'worker') {
      throw new HttpsError('permission-denied', 'Only an active organization Worker can use this action.');
    }
    const event = { id: eventSnapshot.id, ...eventSnapshot.data() };
    const caller = callerSnapshot.data();
    const organizationId = typeof event.organizationId === 'string' ? event.organizationId.trim() : '';
    if (!organizationId || caller.organizationId !== organizationId) {
      throw new HttpsError('permission-denied', 'This event belongs to a different organization.');
    }

    const organizationRef = db.collection('organizations').doc(organizationId);
    const billingRef = db.collection('organizationBilling').doc(organizationId);
    const [organizationSnapshot, billingSnapshot] = await Promise.all([
      transaction.get(organizationRef),
      transaction.get(billingRef),
    ]);
    if (!organizationSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'The event organization no longer exists.');
    }
    const customerBeta = await customerBetaAccessEnabled(transaction);
    if (customerBeta) assertCustomerBetaOrganizationWritable(organizationSnapshot.data());
    if (!customerBeta && !billingSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'Organization billing must be initialized before event work can continue.');
    }
    if (!customerBeta && billingSnapshot.data().accessMode !== 'full') {
      throw new HttpsError('failed-precondition', 'This organization is read-only. Ask the Billing Manager to resolve billing or capacity.');
    }

    const organization = organizationSnapshot.data();
    const authorizedManagerIds = uniqueStrings([
      event.managerId,
      ...(organization.managerIds || []),
    ]);
    const roleId = request.data?.roleId
      ? requiredDocumentId(request.data.roleId, 'Role ID')
      : notification
        ? requiredDocumentId(notification.roleId, 'Notification role ID')
        : null;
    const plan = planWorkerEventAction({
      actionType,
      callerUserId: request.auth.uid,
      callerDisplayName: String(caller.displayName || authUser.displayName || 'Worker').trim().slice(0, 80),
      event,
      eventId,
      roleId,
      taskId: request.data?.taskId,
      complete: request.data?.complete,
      response: request.data?.response,
      notification,
      notificationId,
      authorizedManagerIds,
    });
    if (!plan.ok) {
      throw new HttpsError(plan.code, plan.message, { reason: plan.reason });
    }

    const targetUserIds = uniqueStrings([
      ...plan.notificationSpecs.map((spec) => spec.userId),
      ...(notification?.managerId ? [notification.managerId] : []),
    ]);
    const targetSnapshots = targetUserIds.length
      ? await transaction.getAll(...targetUserIds.map((userId) => db.collection('users').doc(userId)))
      : [];
    const targetById = new Map(targetSnapshots.map((snapshot) => [snapshot.id, snapshot]));
    for (const targetUserId of targetUserIds) {
      const target = targetById.get(targetUserId);
      if (!target?.exists || target.data().organizationId !== organizationId) {
        throw new HttpsError('failed-precondition', 'The event contains a notification target outside this organization.');
      }
    }
    if (notification?.managerId
      && normalizedRole(targetById.get(notification.managerId)?.data()?.role) !== 'manager') {
      throw new HttpsError('failed-precondition', 'The role notification Manager is no longer active.');
    }
    for (const spec of plan.notificationSpecs) {
      const expectedRole = spec.kind === 'role_available' ? 'worker' : 'manager';
      if (normalizedRole(targetById.get(spec.userId)?.data()?.role) !== expectedRole) {
        throw new HttpsError('failed-precondition', 'The event contains an invalid notification target role.');
      }
    }

    const now = FieldValue.serverTimestamp();
    if (plan.eventChanged) {
      const currentRevision = Number(event.revision || 0);
      if (!Number.isSafeInteger(currentRevision) || currentRevision >= Number.MAX_SAFE_INTEGER) {
        throw new HttpsError('failed-precondition', 'The event revision is invalid.');
      }
      transaction.update(eventRef, {
        roles: plan.roles,
        workerIds: plan.workerIds,
        revision: currentRevision + 1,
        updatedAt: now,
      });
    }
    if (plan.roleNotificationUpdate) {
      if (!notificationRef || plan.roleNotificationUpdate.notificationId !== notificationRef.id) {
        throw new HttpsError('failed-precondition', 'The role notification changed during this action.');
      }
      transaction.update(notificationRef, {
        status: plan.roleNotificationUpdate.status,
        statusReason: plan.roleNotificationUpdate.statusReason,
        ...(plan.roleNotificationUpdate.response ? { response: plan.roleNotificationUpdate.response } : {}),
        ...(plan.roleNotificationUpdate.status === 'waitlisted'
          ? { waitlistedAt: now }
          : { respondedAt: now }),
      });
    }
    plan.notificationSpecs.forEach((spec) => {
      transaction.set(db.collection('userNotifications').doc(), {
        ...spec,
        title: String(spec.title || '').slice(0, 120),
        body: String(spec.body || '').slice(0, 500),
        organizationId,
        pushAuthorized: true,
        createdAt: now,
      });
    });
    if (plan.reminderEmailSpec) {
      const role = plan.roles.find((candidate) => candidate.id === plan.reminderEmailSpec.roleId);
      const reminderMail = role ? workerEventReminderMail({
        event,
        role,
        workerId: request.auth.uid,
        email: authUser.email,
      }) : null;
      if (reminderMail) {
        const reminderId = documentKey(
          `event-reminder:${eventId}:${plan.reminderEmailSpec.roleId}:${request.auth.uid}`
        );
        transaction.set(db.collection('mail').doc(reminderId), {
          ...reminderMail,
          createdAt: now,
          updatedAt: now,
        }, { merge: true });
      }
    }

    return {
      eventId,
      actionType,
      outcome: plan.outcome,
      eventChanged: plan.eventChanged,
    };
  });
});

const SUBSCRIPTION_PLAN_RANK = Object.freeze({ free: 0, crew: 1, production: 2, organization: 3, enterprise: 4 });
const SUBSCRIPTION_PLAN_CAP = Object.freeze({ free: 5, crew: 20, production: 50, organization: 100, enterprise: null });

function subscriptionChangeTiming(currentPlanId, nextPlanId, currentBillingPeriod, nextBillingPeriod, currentStatus) {
  const livePaidSubscription = currentPlanId !== 'free' && ['trialing', 'active', 'grace'].includes(currentStatus);
  if (!livePaidSubscription) return nextPlanId === 'enterprise' ? 'contact_sales' : 'immediate';
  if (currentPlanId === nextPlanId && currentBillingPeriod === nextBillingPeriod) return 'none';
  if (nextPlanId === 'enterprise') return 'contact_sales';
  if ((SUBSCRIPTION_PLAN_RANK[nextPlanId] ?? -1) > (SUBSCRIPTION_PLAN_RANK[currentPlanId] ?? 0)) return 'immediate';
  return 'next_renewal';
}

function billingResponse(billing) {
  const iso = (value) => {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return null;
  };
  return {
    planId: billing.planId || 'free',
    billingPeriod: billing.billingPeriod || null,
    status: billing.status || 'free',
    accessMode: billing.accessMode || 'full',
    seatLimit: billing.seatLimit ?? 5,
    purchaserUserId: billing.purchaserUserId || null,
    sourceStore: billing.sourceStore || null,
    productIdentifier: billing.productIdentifier || null,
    willRenew: Boolean(billing.willRenew),
    currentPeriodEndsAt: iso(billing.currentPeriodEndsAt),
    gracePeriodExpiresAt: iso(billing.gracePeriodExpiresAt),
    pendingPlanId: billing.pendingPlanId || null,
    pendingBillingPeriod: billing.pendingBillingPeriod || null,
    pendingPlanEffectiveAt: iso(billing.pendingPlanEffectiveAt),
    managementURL: billing.managementURL || null,
  };
}

exports.initializeOrganizationBillingOnCreate = onDocumentCreated('organizations/{organizationId}', async (event) => {
  if (isCustomerBetaProject(runtimeProjectId())) return;
  const organizationId = event.params.organizationId;
  const organizationRef = db.collection('organizations').doc(organizationId);
  const billingRef = db.collection('organizationBilling').doc(organizationId);
  const now = FieldValue.serverTimestamp();
  try {
    await db.runTransaction(async (transaction) => {
      await assertAccountDeletionMutationLeaseAvailable(transaction);
      const [organizationSnapshot, billingSnapshot] = await transaction.getAll(
        organizationRef,
        billingRef
      );
      if (!organizationSnapshot.exists || billingSnapshot.exists) return;
      transaction.create(billingRef, {
        ...defaultOrganizationBilling(),
        createdAt: now,
        updatedAt: now,
      });
    });
  } catch (error) {
    if (error?.code !== 6 && error?.code !== 'already-exists') throw error;
  }
});

exports.initializeOrganizationBilling = onCall({ maxInstances: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before loading organization billing.');
  await assertSubscriptionsAvailable();
  const callerSnapshot = await db.collection('users').doc(request.auth.uid).get();
  const organizationId = callerSnapshot.data()?.organizationId;
  if (!callerSnapshot.exists || !organizationId) {
    throw new HttpsError('failed-precondition', 'Join or create an organization before loading billing.');
  }

  const organizationRef = db.collection('organizations').doc(organizationId);
  const billingRef = db.collection('organizationBilling').doc(organizationId);
  const organizationMembersQuery = db.collection('users').where('organizationId', '==', organizationId);
  const initialized = await db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    const [organizationSnapshot, billingSnapshot] = await transaction.getAll(organizationRef, billingRef);
    const organizationMembers = await transaction.get(organizationMembersQuery);
    if (!organizationSnapshot.exists) throw new HttpsError('not-found', 'Organization not found.');
    if (!organizationMembers.docs.some((document) => document.id === request.auth.uid)) {
      throw new HttpsError('permission-denied', 'Your organization membership changed. Refresh and try again.');
    }

    const billing = billingSnapshot.exists
      ? { ...defaultOrganizationBilling(), ...billingSnapshot.data() }
      : defaultOrganizationBilling();
    const usage = calculateSeatUsage({
      organization: organizationWithAcceptedProfiles(organizationSnapshot.data(), organizationMembers),
      billing,
    });
    const accessMode = accessModeForBillingAndSeatUsage(billing, usage.seatUsage);
    const now = FieldValue.serverTimestamp();
    const nextBilling = {
      ...billing,
      accessMode,
      seatLimit: billing.planId === 'free' ? 5 : billing.seatLimit,
    };
    transaction.set(billingRef, {
      ...nextBilling,
      ...(billingSnapshot.exists ? {} : { createdAt: now }),
      updatedAt: now,
    }, { merge: true });
    return nextBilling;
  });

  if (normalizedRole(callerSnapshot.data()?.role) === 'manager') {
    const migration = await migrateLegacyManagerOrganizationRecords({
      managerId: request.auth.uid,
      organizationId,
    });
    if (migration.migratedTeams || migration.migratedEvents) {
      logger.info('Migrated legacy manager records into the active organization.', {
        managerId: request.auth.uid,
        organizationId,
        ...migration,
      });
    }
  }

  return billingResponse(initialized);
});

// Older local web builds used a separate customer map. Never claim an identity
// assigned there to another organization while migrating to the shared map.
async function assertLegacyWebBillingAssignment(transaction, purchaserUserId, organizationId) {
  const legacy = await transaction.get(db.collection('webBillingCustomers').doc(hashedDocumentId(purchaserUserId)));
  if (legacy.exists && (legacy.data().organizationId !== organizationId || legacy.data().uid !== purchaserUserId)) {
    throw new HttpsError('failed-precondition', 'This browser purchaser is already assigned to another organization.');
  }
}

async function assertNoPendingBrowserCheckout(transaction, organizationId) {
  const checkout = await transaction.get(db.collection('webBillingCheckout').doc(organizationId));
  if (checkout.exists && checkout.data().state === 'prepared') {
    throw new HttpsError('failed-precondition', 'A browser checkout is awaiting verification. Verify it in the web app before purchasing or restoring on mobile.');
  }
}

exports.prepareOrganizationSubscriptionChange = onCall({
  maxInstances: 10,
  secrets: subscriptionSecrets([revenueCatSecretApiKey]),
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before changing a subscription.');
  await assertSubscriptionsAvailable();
  const planId = typeof request.data?.planId === 'string' ? request.data.planId.trim() : '';
  const billingPeriod = request.data?.billingPeriod === 'annual' ? 'annual' : request.data?.billingPeriod === 'monthly' ? 'monthly' : '';
  const purchaseStore = revenueCatPurchaseStoreForCallable(request.data?.purchaseStore);
  if (!['crew', 'production', 'organization'].includes(planId) || !billingPeriod) {
    throw new HttpsError('invalid-argument', 'Choose a valid Dispatch subscription plan, billing period, and store.');
  }
  const packageIdentifier = packageIdentifierForPlan(planId, billingPeriod);
  if (!packageIdentifier) throw new HttpsError('failed-precondition', 'That RevenueCat package is not configured in Dispatch.');

  const callerRef = db.collection('users').doc(request.auth.uid);
  const callerSnapshot = await callerRef.get();
  const organizationId = callerSnapshot.data()?.organizationId;
  if (!callerSnapshot.exists || normalizedRole(callerSnapshot.data()?.role) !== 'manager' || !organizationId) {
    throw new HttpsError('permission-denied', 'Only an active organization Manager can access billing.');
  }
  const organizationRef = db.collection('organizations').doc(organizationId);
  const billingRef = db.collection('organizationBilling').doc(organizationId);
  const customerRef = db.collection('revenueCatCustomers').doc(hashedDocumentId(request.auth.uid));
  const organizationMembersQuery = db.collection('users').where('organizationId', '==', organizationId);
  const verificationBillingSnapshot = await billingRef.get();
  const verificationBilling = verificationBillingSnapshot.exists
    ? { ...defaultOrganizationBilling(), ...verificationBillingSnapshot.data() }
    : defaultOrganizationBilling();
  const verificationPayerId = verificationBilling.purchaserUserId
    || verificationBilling.purchaseIntent?.purchaserUserId
    || request.auth.uid;
  const verificationCustomerRef = db.collection('revenueCatCustomers').doc(hashedDocumentId(verificationPayerId));
  const verificationIdentities = uniqueStrings([verificationPayerId, request.auth.uid]);
  const preloadedCustomerMappings = await loadRevenueCatCustomerMappingSnapshots(verificationIdentities);
  let verifiedProjectionsByIdentity;
  try {
    verifiedProjectionsByIdentity = new Map(await Promise.all(verificationIdentities.map(async (identity) => {
      const subscriber = await fetchRevenueCatSubscriber({
        appUserId: identity,
        secretApiKey: revenueCatSecretApiKey.value(),
      });
      return [identity, deriveOrganizationBillingFromSubscriber({
        subscriber,
        currentBilling: identity === verificationPayerId
          ? verificationBilling
          : defaultOrganizationBilling(),
        expectedEnvironment: expectedRevenueCatEnvironment(),
      })];
    })));
  } catch (error) {
    throw new HttpsError('unavailable', error instanceof Error ? error.message : 'RevenueCat verification failed before checkout.');
  }
  const verifiedProjection = verifiedProjectionsByIdentity.get(verificationPayerId);
  const requesterProjection = verifiedProjectionsByIdentity.get(request.auth.uid);

  return db.runTransaction(async (transaction) => {
    for (const identity of verificationIdentities) {
      await assertAccountDeletionNotStarted(transaction, identity);
      await assertLegacyWebBillingAssignment(transaction, identity, organizationId);
    }
    await assertNoPendingBrowserCheckout(transaction, organizationId);
    const mappingRefs = new Map(preloadedCustomerMappings.map((mapping) => [mapping.ref.path, mapping.ref]));
    const snapshots = await transaction.getAll(
      organizationRef,
      billingRef,
      ...mappingRefs.values()
    );
    const snapshotByPath = new Map(snapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
    const organizationSnapshot = snapshotByPath.get(organizationRef.path);
    const billingSnapshot = snapshotByPath.get(billingRef.path);
    const customerSnapshot = snapshotByPath.get(customerRef.path);
    const verificationCustomerSnapshot = snapshotByPath.get(verificationCustomerRef.path);
    if (!revenueCatBillingSnapshotIsCurrent({
      preloadedExists: verificationBillingSnapshot.exists,
      preloadedBilling: verificationBillingSnapshot.exists ? verificationBillingSnapshot.data() : {},
      freshExists: billingSnapshot.exists,
      freshBilling: billingSnapshot.exists ? billingSnapshot.data() : {},
    })) {
      throw new HttpsError('aborted', 'Billing changed during RevenueCat verification. Refresh and try again.');
    }
    for (const preloadedMapping of preloadedCustomerMappings) {
      const freshSnapshot = snapshotByPath.get(preloadedMapping.ref.path);
      if (!freshSnapshot || !revenueCatMappingSnapshotIsCurrent({
        preloadedMapping,
        freshExists: freshSnapshot.exists,
        freshData: freshSnapshot.exists ? freshSnapshot.data() : {},
        documentId: freshSnapshot.ref.id,
      })) {
        throw new HttpsError('aborted', 'RevenueCat customer ownership changed during verification. Refresh and try again.');
      }
    }
    const organizationMembers = await transaction.get(organizationMembersQuery);
    if (!organizationSnapshot?.exists) throw new HttpsError('not-found', 'Organization not found.');
    const organization = organizationSnapshot.data();
    if (resolveBillingManagerId(organization) !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Only the current Billing Manager can purchase or change a plan.');
    }
    const storedBilling = billingSnapshot.exists
      ? { ...defaultOrganizationBilling(), ...billingSnapshot.data() }
      : defaultOrganizationBilling();
    const storedVerificationPayerId = storedBilling.purchaserUserId
      || storedBilling.purchaseIntent?.purchaserUserId
      || request.auth.uid;
    if (storedVerificationPayerId !== verificationPayerId) {
      throw new HttpsError('aborted', 'Billing ownership changed during verification. Refresh and try again.');
    }
    const verificationUsage = calculateSeatUsage({
      organization: organizationWithAcceptedProfiles(organization, organizationMembers),
      billing: storedBilling,
    });
    const verifiedLivePaid = isLivePaidRevenueCatProjection(verifiedProjection);
    const requesterLivePaid = isLivePaidRevenueCatProjection(requesterProjection);
    const requesterMapping = customerSnapshot?.exists ? customerSnapshot.data() : null;
    const requesterMappingState = requesterMapping?.state || null;
    const requesterMappingIsUnsafeAlias = ['alias', 'quarantined', 'transferred'].includes(requesterMappingState);
    const requesterMappingCanMoveOrganizations = Boolean(
      requesterMapping
      && requesterMapping.organizationId !== organizationId
      && requesterMapping.purchaserUserId === request.auth.uid
      && requesterMapping.active === false
      && requesterMappingState === 'released'
      && !requesterLivePaid
    );
    if (requesterMappingIsUnsafeAlias || (
      requesterMapping
      && requesterMapping.organizationId !== organizationId
      && !requesterMappingCanMoveOrganizations
    )) {
      throw new HttpsError(
        'failed-precondition',
        'This RevenueCat customer has an unresolved transfer or organization assignment. Release or resolve that billing relationship first.'
      );
    }
    if (requesterLivePaid && verificationPayerId !== request.auth.uid) {
      throw new HttpsError(
        'failed-precondition',
        'This store account already has a live Dispatch subscription. Restore and resolve that subscription before starting another checkout.'
      );
    }
    const billing = {
      ...storedBilling,
      ...applyRevenueCatLifecyclePolicy({
        billing: storedBilling,
        projection: verifiedProjection,
        seatUsage: verificationUsage.seatUsage,
      }),
      purchaserUserId: verifiedLivePaid ? verificationPayerId : null,
    };
    const activePaidStatus = ['trialing', 'active', 'grace'].includes(billing.status) && billing.planId !== 'free';
    if (activePaidStatus && billing.purchaserUserId && billing.purchaserUserId !== request.auth.uid) {
      throw new HttpsError(
        'failed-precondition',
        'The current store subscription belongs to another payer. They must cancel renewal; the new Billing Manager can subscribe after it expires.'
      );
    }
    if (activePaidStatus && billing.sourceStore && billing.sourceStore !== purchaseStore) {
      throw new HttpsError(
        'failed-precondition',
        billing.sourceStore === 'rc_billing'
          ? 'This subscription is managed in the Dispatch web app. Do not purchase a second mobile subscription.'
          : `This subscription is owned by ${billing.sourceStore === 'app_store' ? 'Apple' : billing.sourceStore === 'play_store' ? 'Google Play' : 'RevenueCat Test Store'}. Complete plan changes on that original store account and device.`
      );
    }
    const timing = subscriptionChangeTiming(
      billing.planId || 'free',
      planId,
      billing.billingPeriod || null,
      billingPeriod,
      billing.status || 'free'
    );
    if (timing === 'none' && activePaidStatus) {
      throw new HttpsError('already-exists', 'This organization already has that active subscription.');
    }
    const usage = calculateSeatUsage({
      organization: organizationWithAcceptedProfiles(organization, organizationMembers),
      billing,
    });
    const targetCap = SUBSCRIPTION_PLAN_CAP[planId];
    if (targetCap !== null && timing === 'next_renewal' && usage.seatUsage > targetCap) {
      throw new HttpsError(
        'failed-precondition',
        `Reduce accepted members and pending invitations to ${targetCap} before scheduling this downgrade.`,
        { reason: 'downgrade-over-capacity', seatUsage: usage.seatUsage, targetCap }
      );
    }

    const now = FieldValue.serverTimestamp();
    const purchaseIntent = {
      purchaserUserId: request.auth.uid,
      operation: 'purchase',
      purchaseStore,
      planId,
      billingPeriod,
      packageIdentifier,
      changeTiming: timing,
      createdAtMs: Date.now(),
    };
    transaction.set(customerRef, {
      purchaserUserId: request.auth.uid,
      organizationId,
      active: true,
      state: 'active',
      releasedReason: FieldValue.delete(),
      releasedAt: FieldValue.delete(),
      quarantineEventId: FieldValue.delete(),
      transferQuarantinedAt: FieldValue.delete(),
      createdAt: customerSnapshot?.exists ? customerSnapshot.data().createdAt || now : now,
      updatedAt: now,
    }, { merge: true });
    if (
      !verifiedLivePaid
      && verificationCustomerRef.path !== customerRef.path
      && verificationCustomerSnapshot?.exists
      && verificationCustomerSnapshot.data().organizationId === organizationId
    ) {
      transaction.set(verificationCustomerRef, {
        active: false,
        state: 'released',
        releasedReason: 'superseded_before_checkout',
        releasedAt: now,
        updatedAt: now,
      }, { merge: true });
    }
    transaction.set(billingRef, {
      ...billing,
      purchaseIntent,
      ...(billingSnapshot.exists ? {} : { createdAt: now }),
      updatedAt: now,
    }, { merge: true });

    return {
      organizationId,
      planId,
      billingPeriod,
      packageIdentifier,
      changeTiming: timing,
      currentProductIdentifier: billing.productIdentifier || null,
      currentSourceStore: billing.sourceStore || null,
    };
  });
});

exports.prepareOrganizationSubscriptionRestore = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before restoring purchases.');
  await assertSubscriptionsAvailable();
  const purchaseStore = revenueCatPurchaseStoreForCallable(request.data?.purchaseStore);
  const callerRef = db.collection('users').doc(request.auth.uid);
  const callerSnapshot = await callerRef.get();
  const organizationId = callerSnapshot.data()?.organizationId;
  if (!callerSnapshot.exists || normalizedRole(callerSnapshot.data()?.role) !== 'manager' || !organizationId) {
    throw new HttpsError('permission-denied', 'Only an active organization Manager can restore purchases.');
  }
  const organizationRef = db.collection('organizations').doc(organizationId);
  const billingRef = db.collection('organizationBilling').doc(organizationId);
  const customerRef = db.collection('revenueCatCustomers').doc(hashedDocumentId(request.auth.uid));

  return db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    await assertLegacyWebBillingAssignment(transaction, request.auth.uid, organizationId);
    await assertNoPendingBrowserCheckout(transaction, organizationId);
    const [freshCallerSnapshot, organizationSnapshot, billingSnapshot, customerSnapshot] = await transaction.getAll(
      callerRef,
      organizationRef,
      billingRef,
      customerRef
    );
    if (!freshCallerSnapshot.exists
      || freshCallerSnapshot.data().organizationId !== organizationId
      || normalizedRole(freshCallerSnapshot.data().role) !== 'manager'
      || !organizationSnapshot.exists
      || resolveBillingManagerId(organizationSnapshot.data()) !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Only the current Billing Manager can restore purchases.');
    }
    const billing = billingSnapshot.exists
      ? { ...defaultOrganizationBilling(), ...billingSnapshot.data() }
      : defaultOrganizationBilling();
    if (isLivePaidRevenueCatProjection(billing) && billing.sourceStore && billing.sourceStore !== purchaseStore) {
      throw new HttpsError(
        'failed-precondition',
        'Restore must be completed on the original Apple, Google Play, or RevenueCat Test Store account and device.'
      );
    }
    if (activeRevenueCatPayerMustResolveSubscription(billing, billing.purchaserUserId)
      && billing.purchaserUserId !== request.auth.uid) {
      throw new HttpsError(
        'failed-precondition',
        'The current store subscription belongs to another payer. They must resolve it before a different store account can restore.'
      );
    }
    const mapping = customerSnapshot.exists ? customerSnapshot.data() : null;
    const releasedMappingCanMove = Boolean(
      mapping
      && mapping.organizationId !== organizationId
      && mapping.purchaserUserId === request.auth.uid
      && mapping.active === false
      && mapping.state === 'released'
    );
    if (mapping && (
      ['alias', 'quarantined', 'transferred'].includes(mapping.state)
      || (mapping.organizationId !== organizationId && !releasedMappingCanMove)
    )) {
      throw new HttpsError(
        'failed-precondition',
        'This RevenueCat customer has an unresolved transfer or organization assignment. Resolve it before restoring purchases.'
      );
    }
    const now = FieldValue.serverTimestamp();
    transaction.set(customerRef, {
      purchaserUserId: request.auth.uid,
      organizationId,
      active: true,
      state: 'active',
      releasedReason: FieldValue.delete(),
      releasedAt: FieldValue.delete(),
      createdAt: customerSnapshot.exists ? customerSnapshot.data().createdAt || now : now,
      updatedAt: now,
    }, { merge: true });
    transaction.set(billingRef, {
      purchaseIntent: {
        purchaserUserId: request.auth.uid,
        operation: 'restore',
        purchaseStore,
        createdAtMs: Date.now(),
      },
      ...(billingSnapshot.exists ? {} : { createdAt: now }),
      updatedAt: now,
    }, { merge: true });
    return { organizationId, restorePrepared: true };
  });
});

exports.refreshOrganizationSubscription = onCall({
  maxInstances: 10,
  secrets: subscriptionSecrets([revenueCatSecretApiKey]),
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before refreshing subscription status.');
  await assertSubscriptionsAvailable();
  revenueCatPurchaseStoreForCallable(request.data?.purchaseStore);
  const callerRef = db.collection('users').doc(request.auth.uid);
  const callerSnapshot = await callerRef.get();
  const organizationId = callerSnapshot.data()?.organizationId;
  if (!callerSnapshot.exists || normalizedRole(callerSnapshot.data()?.role) !== 'manager' || !organizationId) {
    throw new HttpsError('permission-denied', 'Only an active organization Manager can refresh billing.');
  }

  const organizationRef = db.collection('organizations').doc(organizationId);
  const billingRef = db.collection('organizationBilling').doc(organizationId);
  const [organizationSnapshot, billingSnapshot] = await Promise.all([
    organizationRef.get(),
    billingRef.get(),
  ]);
  if (!organizationSnapshot.exists || resolveBillingManagerId(organizationSnapshot.data()) !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Only the current Billing Manager can refresh subscription status.');
  }
  const existingBilling = billingSnapshot.exists
    ? { ...defaultOrganizationBilling(), ...billingSnapshot.data() }
    : defaultOrganizationBilling();
  const activePaidStatus = existingBilling.planId !== 'free'
    && ['trialing', 'active', 'grace'].includes(existingBilling.status);
  // Verification is a server read of the organization payer, independent of
  // this device's store. Purchase and restore preflights remain store-bound.
  const purchaserUserId = activePaidStatus
    ? (existingBilling.purchaserUserId || request.auth.uid)
    : (existingBilling.purchaseIntent?.purchaserUserId || request.auth.uid);
  const apiKey = revenueCatSecretApiKey.value();
  if (!apiKey) throw new HttpsError('failed-precondition', 'RevenueCat server verification is not configured.');

  let subscriber;
  try {
    subscriber = await fetchRevenueCatSubscriber({ appUserId: purchaserUserId, secretApiKey: apiKey });
  } catch (error) {
    throw new HttpsError('unavailable', error instanceof Error ? error.message : 'RevenueCat verification failed.');
  }
  let projection;
  try {
    projection = deriveOrganizationBillingFromSubscriber({
      subscriber,
      currentBilling: existingBilling,
      expectedEnvironment: expectedRevenueCatEnvironment(),
    });
  } catch (error) {
    throw new HttpsError('failed-precondition', error instanceof Error ? error.message : 'RevenueCat returned an unsupported subscription.');
  }
  const projectionIsLivePaid = isLivePaidRevenueCatProjection(projection);
  const customerRef = db.collection('revenueCatCustomers').doc(hashedDocumentId(purchaserUserId));
  const organizationMembersQuery = db.collection('users').where('organizationId', '==', organizationId);

  const nextBilling = await db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    await assertLegacyWebBillingAssignment(transaction, purchaserUserId, organizationId);
    if (purchaserUserId !== request.auth.uid) {
      await assertAccountDeletionNotStarted(transaction, purchaserUserId);
    }
    const [freshOrganizationSnapshot, freshBillingSnapshot, customerSnapshot] = await transaction.getAll(
      organizationRef,
      billingRef,
      customerRef
    );
    const organizationMembers = await transaction.get(organizationMembersQuery);
    if (!revenueCatBillingSnapshotIsCurrent({
      preloadedExists: billingSnapshot.exists,
      preloadedBilling: billingSnapshot.exists ? billingSnapshot.data() : {},
      freshExists: freshBillingSnapshot.exists,
      freshBilling: freshBillingSnapshot.exists ? freshBillingSnapshot.data() : {},
    })) {
      throw new HttpsError('aborted', 'Billing changed during RevenueCat verification. Refresh and try again.');
    }
    if (!freshOrganizationSnapshot.exists || resolveBillingManagerId(freshOrganizationSnapshot.data()) !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Billing ownership changed. Refresh and try again.');
    }
    const existingCustomerMapping = customerSnapshot.exists ? customerSnapshot.data() : null;
    if (projectionIsLivePaid && !revenueCatMappingAllowsPaidRefresh({
      mapping: existingCustomerMapping,
      organizationId,
      purchaserUserId,
    })) {
      throw new HttpsError(
        'failed-precondition',
        'This RevenueCat customer has an unresolved transfer or organization assignment. Resolve it before refreshing paid access.'
      );
    }
    const billing = freshBillingSnapshot.exists
      ? { ...defaultOrganizationBilling(), ...freshBillingSnapshot.data() }
      : defaultOrganizationBilling();
    const freshActivePaidStatus = billing.planId !== 'free'
      && ['trialing', 'active', 'grace'].includes(billing.status);
    const freshPurchaserUserId = freshActivePaidStatus
      ? (billing.purchaserUserId || request.auth.uid)
      : (billing.purchaseIntent?.purchaserUserId || request.auth.uid);
    if (freshPurchaserUserId !== purchaserUserId) {
      throw new HttpsError('aborted', 'The billing payer changed during verification. Refresh and try again.');
    }
    const usage = calculateSeatUsage({
      organization: organizationWithAcceptedProfiles(freshOrganizationSnapshot.data(), organizationMembers),
      billing,
    });
    const lifecycleProjection = applyRevenueCatLifecyclePolicy({
      billing,
      projection,
      seatUsage: usage.seatUsage,
    });
    const now = FieldValue.serverTimestamp();
    const clearsPendingChange = lifecycleProjection.planId === billing.pendingPlanId
      && (!billing.pendingBillingPeriod || lifecycleProjection.billingPeriod === billing.pendingBillingPeriod);
    const update = {
      ...billing,
      ...lifecycleProjection,
      purchaserUserId: projectionIsLivePaid ? purchaserUserId : null,
      ...(clearsPendingChange ? {
        pendingPlanId: null,
        pendingBillingPeriod: null,
        pendingPlanEffectiveAt: null,
      } : {
        pendingPlanId: lifecycleProjection.pendingPlanId,
        pendingBillingPeriod: lifecycleProjection.pendingBillingPeriod,
        pendingPlanEffectiveAt: lifecycleProjection.pendingPlanEffectiveAt,
      }),
      // A client preflight proves only intent. A paid next-renewal target is
      // authoritative only after RevenueCat sends PRODUCT_CHANGE.
      purchaseIntent: FieldValue.delete(),
      lastRevenueCatRefreshAt: now,
      updatedAt: now,
    };
    if (projectionIsLivePaid) {
      transaction.set(customerRef, {
        purchaserUserId,
        organizationId,
        active: true,
        state: 'active',
        createdAt: customerSnapshot.exists ? customerSnapshot.data().createdAt || now : now,
        updatedAt: now,
      }, { merge: true });
    } else if (customerSnapshot.exists
      && customerSnapshot.data().organizationId === organizationId
      && customerSnapshot.data().purchaserUserId === purchaserUserId
      && (
        (customerSnapshot.data().active === true && customerSnapshot.data().state === 'active')
        || (customerSnapshot.data().active === false && customerSnapshot.data().state === 'released')
      )) {
      transaction.set(customerRef, {
        active: false,
        state: 'released',
        releasedReason: 'verified_non_live_refresh',
        releasedAt: now,
        updatedAt: now,
      }, { merge: true });
    }
    transaction.set(billingRef, update, { merge: true });
    return { ...billing, ...lifecycleProjection, purchaserUserId: projectionIsLivePaid ? purchaserUserId : null };
  });

  return billingResponse(nextBilling);
});

async function loadRevenueCatCustomerMappingSnapshots(identityCandidates) {
  const candidates = uniqueStrings(identityCandidates);
  if (!candidates.length) return [];
  const refs = candidates.map((userId) => db.collection('revenueCatCustomers').doc(hashedDocumentId(userId)));
  const snapshots = await db.getAll(...refs);
  return snapshots.map((snapshot, index) => ({
    ...(snapshot.exists ? snapshot.data() : {}),
    identity: candidates[index],
    ref: snapshot.ref,
    exists: snapshot.exists,
  }));
}

async function loadRevenueCatCustomerMappings(identityCandidates) {
  return (await loadRevenueCatCustomerMappingSnapshots(identityCandidates))
    .filter((mapping) => mapping.exists);
}

async function applyRevenueCatTransferEvent(event, eventRef) {
  const { fromCandidates, toCandidates } = partitionRevenueCatTransferIdentities(event);
  const [fromMappingSnapshots, toMappingSnapshots] = await Promise.all([
    loadRevenueCatCustomerMappingSnapshots(fromCandidates),
    loadRevenueCatCustomerMappingSnapshots(toCandidates),
  ]);
  const fromMappings = fromMappingSnapshots.filter((mapping) => mapping.exists);
  const toMappings = toMappingSnapshots.filter((mapping) => mapping.exists);
  const activeFromMappings = fromMappings.filter((mapping) => mapping.active !== false);
  const activeToMappings = toMappings.filter((mapping) => mapping.active !== false);
  const affectedOrganizationIds = uniqueStrings([
    ...activeFromMappings.map((mapping) => mapping.organizationId),
    ...activeToMappings.map((mapping) => mapping.organizationId),
  ]);
  if (!affectedOrganizationIds.length) {
    await eventRef.create({
      revenueCatEventId: event.id,
      eventType: 'TRANSFER',
      eventTimestampMs: event.event_timestamp_ms,
      status: 'ignored_unmapped',
      environment: event.environment || null,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ignored: true, reason: 'unmapped_transfer', eventId: event.id };
  }

  const destinationOrganizationIds = uniqueStrings(activeToMappings.map((mapping) => mapping.organizationId));
  const destinationResolved = destinationOrganizationIds.length === 1;
  const destinationOrganizationId = destinationResolved ? destinationOrganizationIds[0] : null;
  const canonicalDestinationMapping = destinationOrganizationId
    ? activeToMappings.find((mapping) => mapping.organizationId === destinationOrganizationId) || null
    : null;
  const destinationPayerId = canonicalDestinationMapping?.purchaserUserId
    || canonicalDestinationMapping?.identity
    || null;
  const sourcePayerIds = new Set(uniqueStrings([
    ...activeFromMappings.map((mapping) => mapping.identity),
    ...activeFromMappings.map((mapping) => mapping.purchaserUserId),
  ]));
  const destinationPayerIds = new Set(uniqueStrings([
    ...activeToMappings.map((mapping) => mapping.identity),
    ...activeToMappings.map((mapping) => mapping.purchaserUserId),
  ]));
  const identitiesToVerify = uniqueStrings([
    ...activeFromMappings.map((mapping) => mapping.identity),
    ...activeFromMappings.map((mapping) => mapping.purchaserUserId),
    ...activeToMappings.map((mapping) => mapping.identity),
    ...activeToMappings.map((mapping) => mapping.purchaserUserId),
  ]);
  const subscriberEntries = await Promise.all(identitiesToVerify.map(async (identity) => [
    identity,
    await fetchRevenueCatSubscriber({
      appUserId: identity,
      secretApiKey: revenueCatSecretApiKey.value(),
    }),
  ]));
  const subscribersByIdentity = new Map(subscriberEntries);
  const organizationRefs = new Map(affectedOrganizationIds.map((organizationId) => [
    organizationId,
    db.collection('organizations').doc(organizationId),
  ]));
  const billingRefs = new Map(affectedOrganizationIds.map((organizationId) => [
    organizationId,
    db.collection('organizationBilling').doc(organizationId),
  ]));
  const preloadedMappingSnapshots = new Map([...fromMappingSnapshots, ...toMappingSnapshots]
    .map((mapping) => [mapping.ref.path, mapping]));
  const mappingRefs = new Map([...preloadedMappingSnapshots.values()]
    .map((mapping) => [mapping.ref.path, mapping.ref]));
  const mappedPayerIds = uniqueStrings([
    ...fromMappings.map((mapping) => mapping.purchaserUserId),
    ...toMappings.map((mapping) => mapping.purchaserUserId),
  ]);
  const mappedPayerUserRefs = mappedPayerIds.map((userId) => db.collection('users').doc(userId));
  const mappedPayerTombstoneRefs = mappedPayerIds.map((userId) => (
    db.collection('accountDeletionTombstones').doc(userId)
  ));

  return db.runTransaction(async (transaction) => {
    await assertAccountDeletionMutationLeaseAvailable(transaction);
    const refs = [
      eventRef,
      ...organizationRefs.values(),
      ...billingRefs.values(),
      ...mappingRefs.values(),
      ...mappedPayerUserRefs,
      ...mappedPayerTombstoneRefs,
    ];
    const snapshots = await transaction.getAll(...refs);
    const snapshotByPath = new Map(snapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
    if (snapshotByPath.get(eventRef.path)?.exists) return { duplicate: true, eventId: event.id };
    for (const preloadedMapping of preloadedMappingSnapshots.values()) {
      const freshSnapshot = snapshotByPath.get(preloadedMapping.ref.path);
      if (!freshSnapshot || !revenueCatMappingSnapshotIsCurrent({
        preloadedMapping,
        freshExists: freshSnapshot.exists,
        freshData: freshSnapshot.exists ? freshSnapshot.data() : {},
        documentId: freshSnapshot.ref.id,
      })) {
        throw new Error('RevenueCat customer mapping changed during transfer processing; retry the webhook.');
      }
    }
    mappedPayerIds.forEach((userId, index) => {
      const userSnapshot = snapshotByPath.get(mappedPayerUserRefs[index].path);
      const tombstoneSnapshot = snapshotByPath.get(mappedPayerTombstoneRefs[index].path);
      if (!userSnapshot?.exists
        || (tombstoneSnapshot?.exists && accountDeletionTombstoneIsActive(tombstoneSnapshot.data()))) {
        throw new Error('RevenueCat transfer references a Dispatch account being deleted; retry after cleanup.');
      }
    });

    const membersByOrganization = new Map();
    for (const organizationId of affectedOrganizationIds) {
      membersByOrganization.set(
        organizationId,
        await transaction.get(db.collection('users').where('organizationId', '==', organizationId))
      );
    }

    const states = new Map();
    for (const organizationId of affectedOrganizationIds) {
      const organizationSnapshot = snapshotByPath.get(organizationRefs.get(organizationId).path);
      if (!organizationSnapshot?.exists) continue;
      const billingSnapshot = snapshotByPath.get(billingRefs.get(organizationId).path);
      const billing = billingSnapshot?.exists
        ? { ...defaultOrganizationBilling(), ...billingSnapshot.data() }
        : defaultOrganizationBilling();
      const usage = calculateSeatUsage({
        organization: organizationWithAcceptedProfiles(
          organizationSnapshot.data(),
          membersByOrganization.get(organizationId)
        ),
        billing,
      });
      const expectedPayerId = billing.purchaseIntent?.purchaserUserId || billing.purchaserUserId || null;
      let sourceProjection = null;
      if (expectedPayerId && sourcePayerIds.has(expectedPayerId)) {
        const sourceSubscriber = subscribersByIdentity.get(expectedPayerId);
        sourceProjection = deriveOrganizationBillingFromSubscriber({
          subscriber: sourceSubscriber,
          currentBilling: billing,
          expectedEnvironment: expectedRevenueCatEnvironment(),
        });
      }
      states.set(organizationId, { billing, usage, expectedPayerId, sourceProjection });
    }

    let quarantineReason = null;
    if (!destinationResolved || !canonicalDestinationMapping || !destinationPayerId) {
      quarantineReason = 'ambiguous_destination';
    }
    const liveSourceOrganizations = [...states.entries()]
      .filter(([organizationId, state]) => (
        organizationId !== destinationOrganizationId
        && state.sourceProjection
        && isLivePaidRevenueCatProjection(state.sourceProjection)
      ))
      .map(([organizationId]) => organizationId);
    if (liveSourceOrganizations.length) quarantineReason = 'source_still_live';

    let destinationProjection = null;
    const destinationState = destinationOrganizationId ? states.get(destinationOrganizationId) : null;
    if (!quarantineReason && destinationState) {
      const destinationSubscriber = subscribersByIdentity.get(destinationPayerId);
      destinationProjection = deriveOrganizationBillingFromSubscriber({
        subscriber: destinationSubscriber,
        currentBilling: destinationState.billing,
        expectedEnvironment: expectedRevenueCatEnvironment(),
      });
      if (!isLivePaidRevenueCatProjection(destinationProjection)) {
        quarantineReason = 'destination_not_live';
      }
      const destinationHasDifferentLivePayer = destinationState.billing.planId !== 'free'
        && ['trialing', 'active', 'grace'].includes(destinationState.billing.status)
        && destinationState.expectedPayerId
        && destinationState.expectedPayerId !== destinationPayerId
        && !sourcePayerIds.has(destinationState.expectedPayerId);
      if (destinationHasDifferentLivePayer) quarantineReason = 'conflicting_live_payer';
    } else if (!quarantineReason) {
      quarantineReason = 'destination_missing';
    }

    const now = FieldValue.serverTimestamp();
    const processed = !quarantineReason;
    states.forEach((state, organizationId) => {
      if (Number(state.billing.lastRevenueCatEventAtMs || 0) >= event.event_timestamp_ms) return;
      let nextBilling = null;
      if (processed && organizationId === destinationOrganizationId) {
        nextBilling = {
          ...state.billing,
          ...applyRevenueCatLifecyclePolicy({
            billing: state.billing,
            projection: destinationProjection,
            seatUsage: state.usage.seatUsage,
          }),
          purchaserUserId: destinationPayerId,
          purchaseIntent: FieldValue.delete(),
        };
      } else if (
        state.sourceProjection
        && !isLivePaidRevenueCatProjection(state.sourceProjection)
        && organizationId !== destinationOrganizationId
      ) {
        nextBilling = deriveTransferredAwayOrganizationBilling({
          billing: state.billing,
          seatUsage: state.usage.seatUsage,
        });
      } else if (
        !processed
        && destinationPayerIds.has(state.expectedPayerId)
        && organizationId !== destinationOrganizationId
      ) {
        nextBilling = {
          ...state.billing,
          status: 'revoked',
          accessMode: 'read_only',
          willRenew: false,
          purchaseIntent: FieldValue.delete(),
        };
      } else if (!processed && organizationId === destinationOrganizationId && destinationPayerIds.has(state.expectedPayerId)) {
        nextBilling = {
          ...state.billing,
          status: 'revoked',
          accessMode: 'read_only',
          willRenew: false,
          purchaseIntent: FieldValue.delete(),
        };
      }
      if (!nextBilling) return;
      transaction.set(billingRefs.get(organizationId), {
        ...nextBilling,
        lastRevenueCatEventAtMs: event.event_timestamp_ms,
        lastRevenueCatEventId: event.id,
        updatedAt: now,
      }, { merge: true });
    });

    const mappingUpdates = new Map();
    activeFromMappings.forEach((mapping) => {
      const state = states.get(mapping.organizationId);
      const sourceStillLive = state?.sourceProjection && isLivePaidRevenueCatProjection(state.sourceProjection);
      mappingUpdates.set(mapping.ref.path, {
        ref: mapping.ref,
        update: sourceStillLive ? {
          active: true,
          state: 'quarantined',
          quarantineEventId: event.id,
          transferQuarantinedAt: now,
          updatedAt: now,
        } : {
          active: false,
          state: 'transferred',
          transferredAwayAt: now,
          updatedAt: now,
        },
      });
    });
    activeToMappings.forEach((mapping) => {
      const canonical = processed && mapping.ref.path === canonicalDestinationMapping.ref.path;
      mappingUpdates.set(mapping.ref.path, {
        ref: mapping.ref,
        update: canonical ? {
          active: true,
          state: 'active',
          transferredToAt: now,
          updatedAt: now,
        } : {
          active: false,
          state: processed ? 'alias' : 'quarantined',
          quarantineEventId: processed ? null : event.id,
          transferQuarantinedAt: processed ? null : now,
          updatedAt: now,
        },
      });
    });
    mappingUpdates.forEach(({ ref, update }) => transaction.set(ref, update, { merge: true }));
    transaction.create(eventRef, {
      revenueCatEventId: event.id,
      eventType: 'TRANSFER',
      eventTimestampMs: event.event_timestamp_ms,
      organizationIds: affectedOrganizationIds,
      destinationOrganizationIds,
      sourcePurchaserUserIds: [...sourcePayerIds],
      destinationPurchaserUserIds: [...destinationPayerIds],
      status: processed ? 'processed' : `quarantined_${quarantineReason}`,
      liveSourceOrganizationIds: liveSourceOrganizations,
      environment: event.environment || null,
      createdAt: now,
    });
    return {
      processed,
      quarantined: !processed,
      reason: quarantineReason,
      eventId: event.id,
      organizationIds: affectedOrganizationIds,
    };
  });
}

async function processRevenueCatWebhookEvent(event) {
  if (!event || typeof event !== 'object') throw new Error('RevenueCat webhook event is missing.');
  if (typeof event.id !== 'string' || !event.id || !Number.isSafeInteger(event.event_timestamp_ms)) {
    throw new Error('RevenueCat webhook event identity is invalid.');
  }
  const eventRef = db.collection('revenueCatWebhookEvents').doc(hashedDocumentId(event.id));
  if ((await eventRef.get()).exists) return { duplicate: true, eventId: event.id };
  const identityCandidates = webhookIdentityCandidates(event);
  if (!identityCandidates.length) {
    await eventRef.create({
      revenueCatEventId: event.id,
      eventType: event.type || 'UNKNOWN',
      eventTimestampMs: event.event_timestamp_ms,
      status: 'ignored_anonymous',
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ignored: true, reason: 'anonymous_customer', eventId: event.id };
  }
  const deletionTombstoneRefs = identityCandidates.map((userId) => (
    db.collection('accountDeletionTombstones').doc(userId)
  ));
  const deletionTombstoneSnapshots = deletionTombstoneRefs.length
    ? await db.getAll(...deletionTombstoneRefs)
    : [];
  const deletedPayerTombstones = deletionTombstoneSnapshots.filter((snapshot) => (
    snapshot.exists && accountDeletionTombstoneIsActive(snapshot.data())
  ));
  if (deletedPayerTombstones.length) {
    await db.runTransaction(async (transaction) => {
      const freshTombstones = await transaction.getAll(...deletionTombstoneRefs);
      const now = FieldValue.serverTimestamp();
      freshTombstones.forEach((snapshot) => {
        if (!snapshot.exists || !accountDeletionTombstoneIsActive(snapshot.data())) return;
        const cleanupIsLocal = snapshot.data().status === 'deleting';
        const hasUnresolvedAliasPeer = identityCandidates.some((candidate) => (
          candidate !== snapshot.id
        ));
        // A webhook proves the customer now exists, but REST v1 cannot prove
        // its complete alias set. Never re-arm irreversible customer deletion.
        transaction.set(snapshot.ref, {
          ...(cleanupIsLocal ? {} : { status: 'manual_revenuecat_review' }),
          revenueCatDeletionPolicy: 'manual_alias_review',
          revenueCatDeletionBasis: hasUnresolvedAliasPeer
            ? 'webhook_alias_peer_unresolved'
            : 'webhook_customer_recreated',
          revenueCatCustomerDeleted: false,
          revenueCatDeletionPending: false,
          revenueCatManualReviewRequired: true,
          revenueCatDeletionGeneration: FieldValue.increment(1),
          revenueCatDeletionAttemptToken: FieldValue.delete(),
          revenueCatDeletionAttemptStartedAt: FieldValue.delete(),
          completedAt: FieldValue.delete(),
          purgeAt: FieldValue.delete(),
          remoteCleanupUpdatedAt: now,
        }, { merge: true });
      });
    });
  }
  if (event.type === 'TRANSFER') return applyRevenueCatTransferEvent(event, eventRef);
  if (deletedPayerTombstones.length) {
    await eventRef.create({
      revenueCatEventId: event.id,
      eventType: event.type || 'UNKNOWN',
      eventTimestampMs: event.event_timestamp_ms,
      status: 'ignored_deleted_payer',
      environment: event.environment || null,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ignored: true, reason: 'deleted_payer', eventId: event.id };
  }
  const mappings = (await loadRevenueCatCustomerMappings(identityCandidates))
    .filter((mapping) => mapping.active !== false);
  const organizationIds = uniqueStrings(mappings.map((mapping) => mapping.organizationId));
  if (!organizationIds.length) {
    await eventRef.create({
      revenueCatEventId: event.id,
      eventType: event.type || 'UNKNOWN',
      eventTimestampMs: event.event_timestamp_ms,
      status: 'ignored_unmapped',
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ignored: true, reason: 'unmapped_customer', eventId: event.id };
  }
  if (organizationIds.length !== 1) throw new Error('RevenueCat identities map to multiple Dispatch organizations.');
  const organizationId = organizationIds[0];
  const billingRef = db.collection('organizationBilling').doc(organizationId);
  const currentBillingSnapshot = await billingRef.get();
  const currentBilling = currentBillingSnapshot.exists
    ? { ...defaultOrganizationBilling(), ...currentBillingSnapshot.data() }
    : defaultOrganizationBilling();
  const mapping = mappings.find((candidate) => revenueCatMappingCanMutateBilling({
    mapping: candidate,
    billing: currentBilling,
    organizationId,
  }));
  if (!mapping) {
    await eventRef.create({
      revenueCatEventId: event.id,
      eventType: event.type || 'UNKNOWN',
      eventTimestampMs: event.event_timestamp_ms,
      organizationId,
      status: 'ignored_noncurrent_payer',
      environment: event.environment || null,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ignored: true, reason: 'noncurrent_payer', eventId: event.id, organizationId };
  }
  const purchaserUserId = mapping.purchaserUserId;
  const subscriber = await fetchRevenueCatSubscriber({
    appUserId: purchaserUserId,
    secretApiKey: revenueCatSecretApiKey.value(),
  });
  const projection = deriveOrganizationBillingFromSubscriber({
    subscriber,
    currentBilling,
    expectedEnvironment: expectedRevenueCatEnvironment(),
  });

  return db.runTransaction(async (transaction) => {
    await assertAccountDeletionMutationLeaseAvailable(transaction);
    const organizationRef = db.collection('organizations').doc(organizationId);
    const purchaserUserRef = db.collection('users').doc(purchaserUserId);
    const purchaserTombstoneRef = db.collection('accountDeletionTombstones').doc(purchaserUserId);
    const organizationMembersQuery = db.collection('users').where('organizationId', '==', organizationId);
    const [
      existingEventSnapshot,
      billingSnapshot,
      organizationSnapshot,
      mappingSnapshot,
      purchaserUserSnapshot,
      purchaserTombstoneSnapshot,
    ] = await transaction.getAll(
      eventRef,
      billingRef,
      organizationRef,
      mapping.ref,
      purchaserUserRef,
      purchaserTombstoneRef
    );
    if (existingEventSnapshot.exists) return { duplicate: true, eventId: event.id };
    const purchaserDeletionFenced = !purchaserUserSnapshot.exists
      || (purchaserTombstoneSnapshot.exists
        && accountDeletionTombstoneIsActive(purchaserTombstoneSnapshot.data()));
    if (purchaserDeletionFenced) {
      const now = FieldValue.serverTimestamp();
      transaction.create(eventRef, {
        revenueCatEventId: event.id,
        eventType: event.type || 'UNKNOWN',
        eventTimestampMs: event.event_timestamp_ms,
        organizationId,
        status: 'ignored_deleted_payer',
        environment: event.environment || null,
        createdAt: now,
      });
      if (mappingSnapshot.exists) transaction.delete(mapping.ref);
      return { ignored: true, reason: 'deleted_payer', eventId: event.id, organizationId };
    }
    if (!organizationSnapshot.exists) throw new Error('Mapped Dispatch organization no longer exists.');
    const organizationMembers = await transaction.get(organizationMembersQuery);
    const billing = billingSnapshot.exists
      ? { ...defaultOrganizationBilling(), ...billingSnapshot.data() }
      : defaultOrganizationBilling();
    const freshMapping = mappingSnapshot.exists ? mappingSnapshot.data() : null;
    if (!freshMapping || !revenueCatMappingCanMutateBilling({
      mapping: freshMapping,
      billing,
      organizationId,
    })) {
      const now = FieldValue.serverTimestamp();
      transaction.create(eventRef, {
        revenueCatEventId: event.id,
        eventType: event.type || 'UNKNOWN',
        eventTimestampMs: event.event_timestamp_ms,
        organizationId,
        purchaserUserId,
        status: 'ignored_noncurrent_payer',
        environment: event.environment || null,
        createdAt: now,
      });
      if (mappingSnapshot.exists && mappingSnapshot.data().organizationId === organizationId) {
        transaction.set(mapping.ref, {
          active: false,
          state: 'released',
          releasedReason: 'noncurrent_webhook_payer',
          releasedAt: now,
          updatedAt: now,
        }, { merge: true });
      }
      return { ignored: true, reason: 'noncurrent_payer', eventId: event.id, organizationId };
    }
    const usage = calculateSeatUsage({
      organization: organizationWithAcceptedProfiles(organizationSnapshot.data(), organizationMembers),
      billing,
    });
    const lifecycleProjection = applyRevenueCatLifecyclePolicy({
      billing,
      projection,
      seatUsage: usage.seatUsage,
    });
    const stale = Number(billing.lastRevenueCatEventAtMs || 0) >= event.event_timestamp_ms;
    const eventProduct = resolveRevenueCatProduct(event.new_product_id || event.product_id);
    const now = FieldValue.serverTimestamp();
    const ledger = {
      revenueCatEventId: event.id,
      eventType: event.type || 'UNKNOWN',
      eventTimestampMs: event.event_timestamp_ms,
      organizationId,
      purchaserUserId,
      productIdentifier: event.product_id || null,
      status: stale ? 'ignored_stale' : 'processed',
      environment: event.environment || null,
      createdAt: now,
    };
    transaction.create(eventRef, ledger);
    if (stale) return { stale: true, eventId: event.id, organizationId };

    const productChangeState = revenueCatProductChangeState({
      eventType: event.type,
      eventProduct,
      projection: lifecycleProjection,
    });
    const productChangePending = productChangeState === 'pending';
    const completesOrCancelsPendingChange = productChangeState === 'current'
      || lifecycleProjection.planId === billing.pendingPlanId
      && (!billing.pendingBillingPeriod || lifecycleProjection.billingPeriod === billing.pendingBillingPeriod);
    transaction.set(billingRef, {
      ...billing,
      ...lifecycleProjection,
      purchaserUserId,
      ...(productChangePending ? {
        pendingPlanId: eventProduct.planId,
        pendingBillingPeriod: eventProduct.billingPeriod,
        pendingPlanEffectiveAt: lifecycleProjection.currentPeriodEndsAt,
      } : completesOrCancelsPendingChange ? {
        pendingPlanId: null,
        pendingBillingPeriod: null,
        pendingPlanEffectiveAt: null,
      } : {
        pendingPlanId: lifecycleProjection.pendingPlanId,
        pendingBillingPeriod: lifecycleProjection.pendingBillingPeriod,
        pendingPlanEffectiveAt: lifecycleProjection.pendingPlanEffectiveAt,
      }),
      purchaseIntent: FieldValue.delete(),
      lastRevenueCatEventAtMs: event.event_timestamp_ms,
      lastRevenueCatEventId: event.id,
      updatedAt: now,
    }, { merge: true });
    return { processed: true, eventId: event.id, organizationId };
  });
}

exports.revenueCatWebhook = onRequest({
  maxInstances: 10,
  timeoutSeconds: 30,
  secrets: subscriptionSecrets([
    revenueCatWebhookAuthorization,
    revenueCatWebhookSigningSecret,
    revenueCatSecretApiKey,
    revenueCatAllowedAppIds,
  ]),
}, async (request, response) => {
  if (request.method !== 'POST') {
    response.status(405).send('Method Not Allowed');
    return;
  }
  if (isCustomerBetaProject(runtimeProjectId())) {
    response.status(403).send('Subscriptions are disabled for the customer beta');
    return;
  }
  const expectedAuthorization = revenueCatWebhookAuthorization.value();
  const signingSecret = revenueCatWebhookSigningSecret.value();
  const secretApiKey = revenueCatSecretApiKey.value();
  const allowedAppIds = revenueCatAllowedAppIds.value().split(',').map((value) => value.trim()).filter(Boolean);
  if (!expectedAuthorization || !signingSecret || !secretApiKey || !allowedAppIds.length) {
    logger.error('RevenueCat webhook server secrets are not configured.');
    response.status(503).send('Webhook not configured');
    return;
  }
  let configuredEnvironment;
  try {
    configuredEnvironment = expectedRevenueCatEnvironment();
  } catch (error) {
    logger.error('RevenueCat expected environment is not configured.', {
      message: error instanceof Error ? error.message : String(error),
    });
    response.status(503).send('Webhook environment not configured');
    return;
  }
  if (!constantTimeEqual(request.get('authorization') || '', expectedAuthorization)) {
    response.status(401).send('Unauthorized');
    return;
  }
  if (!verifyRevenueCatWebhookSignature({
    rawBody: request.rawBody,
    signatureHeader: request.get('x-revenuecat-webhook-signature') || '',
    signingSecret,
  })) {
    response.status(401).send('Invalid signature');
    return;
  }

  const event = request.body?.event;
  const transferMayOmitEnvironment = event?.type === 'TRANSFER' && event?.environment == null;
  if (!transferMayOmitEnvironment) {
    try {
      validateRevenueCatWebhookEnvironment(event, configuredEnvironment);
    } catch (error) {
      const actualEnvironment = typeof event?.environment === 'string' ? event.environment.trim().toLowerCase() : '';
      if (['sandbox', 'production'].includes(actualEnvironment)) {
        response.status(202).json({ ignored: true, reason: 'unexpected_environment' });
      } else {
        response.status(400).send('Missing RevenueCat environment');
      }
      return;
    }
  }
  if (event?.app_id && !allowedAppIds.includes(event.app_id)) {
    response.status(403).send('Unexpected RevenueCat app');
    return;
  }
  const entitlementIds = Array.isArray(event?.entitlement_ids) ? event.entitlement_ids : [];
  if (entitlementIds.length && !entitlementIds.includes(REVENUECAT_ENTITLEMENT_ID)) {
    response.status(202).json({ ignored: true, reason: 'unrelated_entitlement' });
    return;
  }
  if (event?.product_id && !resolveRevenueCatProduct(event.product_id) && event.type !== 'TRANSFER') {
    logger.error('RevenueCat webhook referenced an unsupported Dispatch product.', {
      eventId: event?.id || null,
      productIdentifier: event.product_id,
    });
    response.status(500).send('Unsupported RevenueCat product');
    return;
  }

  try {
    const result = await processRevenueCatWebhookEvent(event);
    response.status(200).json(result);
  } catch (error) {
    logger.error('RevenueCat webhook processing failed.', {
      eventId: event?.id || null,
      message: error instanceof Error ? error.message : String(error),
    });
    response.status(500).send('Webhook processing failed');
  }
});

exports.sendDispatchEmailVerification = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in before requesting a verification email.');
  }
  if (isCustomerBetaProject(runtimeProjectId())) {
    throw new HttpsError('failed-precondition', 'Use email verification in the customer beta app. Invitation email delivery is not configured for this environment.');
  }

  const authUser = await adminAuth.getUser(request.auth.uid);
  if (authUser.emailVerified) {
    return { queued: false, alreadyVerified: true };
  }

  const deliveryEmail = normalizeEmail(authUser.email);
  if (!isValidEmail(deliveryEmail)) {
    throw new HttpsError('failed-precondition', 'This account does not have a valid email address to verify.');
  }

  const requestRef = db.collection('_emailVerificationRequests').doc(request.auth.uid);
  const existingRequest = await requestRef.get();
  const initialWaitSeconds = verificationCooldownSeconds(
    timestampMillis(existingRequest.data()?.lastRequestedAt)
  );
  if (initialWaitSeconds > 0) {
    throw new HttpsError(
      'resource-exhausted',
      `Wait ${initialWaitSeconds} seconds before requesting another verification email.`
    );
  }

  let verificationLink;
  try {
    const firebaseVerificationLink = await adminAuth.generateEmailVerificationLink(deliveryEmail);
    verificationLink = buildDispatchVerificationLink(
      firebaseVerificationLink,
      undefined,
      normalizeVerificationInviteToken(request.data?.inviteToken)
    );
  } catch (error) {
    logger.error('Unable to generate a Dispatch email verification link.', {
      uid: request.auth.uid,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new HttpsError('internal', 'Unable to generate the verification link. Please try again.');
  }

  const mailRef = db.collection('mail').doc();
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    const latestRequest = await transaction.get(requestRef);
    const waitSeconds = verificationCooldownSeconds(
      timestampMillis(latestRequest.data()?.lastRequestedAt)
    );
    if (waitSeconds > 0) {
      throw new HttpsError(
        'resource-exhausted',
        `Wait ${waitSeconds} seconds before requesting another verification email.`
      );
    }

    transaction.set(requestRef, {
      uid: request.auth.uid,
      lastRequestedAt: now,
      lastMailId: mailRef.id,
      updatedAt: now,
    }, { merge: true });
    transaction.set(mailRef, {
      ...buildVerificationEmail({
        deliveryEmail,
        displayName: authUser.displayName,
        verificationLink,
      }),
      dispatchEmailVerification: {
        uid: request.auth.uid,
        mailId: mailRef.id,
      },
      createdAt: now,
    });
  });

  logger.info('Queued Dispatch email verification.', {
    uid: request.auth.uid,
    mailId: mailRef.id,
  });
  return { queued: true, alreadyVerified: false };
});

exports.resetDispatchDatabase = onCall({
  maxInstances: 1,
  timeoutSeconds: 540,
  memory: '1GiB',
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to reset Dispatch.');
  }

  await assertAccountDeletionNotStarted(null, request.auth.uid);

  const caller = await adminAuth.getUser(request.auth.uid);
  if (!isAuthorizedAdminEmail(caller.email) || !isAuthorizedAdminEmail(request.auth.token.email)) {
    logger.warn('Rejected unauthorized Dispatch database reset request.', {
      callerUid: request.auth.uid,
      callerEmail: caller.email || null,
    });
    throw new HttpsError('permission-denied', 'This account is not allowed to reset Dispatch.');
  }

  logger.warn('Starting full Dispatch Firestore and Firebase Auth reset.', {
    callerUid: request.auth.uid,
    callerEmail: caller.email,
  });

  const authUsersDeleted = await deleteAllAuthUsers(adminAuth);
  const firestoreCollectionsDeleted = await deleteAllFirestoreCollections(db);

  logger.warn('Completed full Dispatch Firestore and Firebase Auth reset.', {
    firestoreCollectionsDeleted,
    authUsersDeleted,
  });

  return { firestoreCollectionsDeleted, authUsersDeleted };
});

exports.deleteDispatchAccount = onCall({
  maxInstances: 5,
  timeoutSeconds: 540,
  memory: '1GiB',
  secrets: subscriptionSecrets([revenueCatV2SecretApiKey]),
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to delete your Dispatch account.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const authTime = Number(request.auth.token.auth_time);
  if (!Number.isFinite(authTime)
    || authTime > nowSeconds + 60
    || nowSeconds - authTime > RECENT_AUTH_MAX_AGE_SECONDS) {
    throw new HttpsError(
      'failed-precondition',
      'A recent sign-in is required. Sign out, sign back in, and then try deleting your account again.'
    );
  }

  const authUser = await adminAuth.getUser(request.auth.uid);
  const deletingProfileSnapshot = await db.collection('users').doc(request.auth.uid).get();
  // Account deletion must remain available if the beta access policy is paused
  // or missing. This project never creates RevenueCat customer identities.
  const customerBeta = isCustomerBetaProject(runtimeProjectId());
  const deletingOrganizationId = deletingProfileSnapshot.data()?.organizationId;
  let deletingBilling = defaultOrganizationBilling();
  let deletingBillingSnapshotExists = false;
  let deletingBillingSnapshotData = {};
  if (deletingOrganizationId) {
    const deletingBillingSnapshot = await db.collection('organizationBilling').doc(deletingOrganizationId).get();
    deletingBillingSnapshotExists = deletingBillingSnapshot.exists;
    deletingBillingSnapshotData = deletingBillingSnapshot.exists ? deletingBillingSnapshot.data() : {};
    deletingBilling = deletingBillingSnapshot.exists
      ? { ...defaultOrganizationBilling(), ...deletingBillingSnapshot.data() }
      : defaultOrganizationBilling();
  }

  const confirmedSubscriptionDeletion = request.data?.confirmActiveSubscriptionDeletion === true;
  let revenueCatStatusVerified = false;
  let activeSubscriberDeletedImmediately = false;
  if (!customerBeta && activeRevenueCatPayerMustResolveSubscription(deletingBilling, request.auth.uid)) {
    if (!confirmedSubscriptionDeletion) {
      throw new HttpsError(
        'failed-precondition',
        'This account may own an active store subscription. Confirm immediate deletion after acknowledging that account deletion does not cancel Apple or Google renewal.'
      );
    }
    activeSubscriberDeletedImmediately = true;
  }
  const accountDeletionLock = await acquireAccountDeletionLock(request.auth.uid);
  try {
  const lockedProfileSnapshot = await db.collection('users').doc(request.auth.uid).get();
  const lockedOrganizationId = lockedProfileSnapshot.data()?.organizationId;
  if (!lockedProfileSnapshot.exists || lockedOrganizationId !== deletingOrganizationId) {
    throw new HttpsError(
      'aborted',
      'Your organization membership changed while deletion was starting. Nothing was deleted; try again.'
    );
  }
  if (lockedOrganizationId) {
    const lockedBillingSnapshot = await db.collection('organizationBilling').doc(lockedOrganizationId).get();
    if (!revenueCatBillingSnapshotIsCurrent({
      preloadedExists: deletingBillingSnapshotExists,
      preloadedBilling: deletingBillingSnapshotData,
      freshExists: lockedBillingSnapshot.exists,
      freshBilling: lockedBillingSnapshot.exists ? lockedBillingSnapshot.data() : {},
    })) {
      throw new HttpsError(
        'aborted',
        'Billing changed while deletion was starting. No data was deleted; wait for the store action to finish and try again.'
      );
    }
    deletingBilling = lockedBillingSnapshot.exists
      ? { ...defaultOrganizationBilling(), ...lockedBillingSnapshot.data() }
      : defaultOrganizationBilling();
  }
  if (!customerBeta && activeRevenueCatStoreIntentForUser(deletingBilling, request.auth.uid)) {
    throw new HttpsError(
      'failed-precondition',
      'An Apple or Google purchase or restore is still in progress. Finish that store action, refresh billing, and then delete the account.'
    );
  }

  let lockedRevenueCatProjectId = null;
  let lockedRevenueCatAliasEvidence = { status: 'unavailable', aliases: [] };
  if (!customerBeta) {
    try {
      lockedRevenueCatProjectId = configuredRevenueCatProjectId();
      lockedRevenueCatAliasEvidence = await fetchRevenueCatCustomerAliases({
        customerId: request.auth.uid,
        projectId: lockedRevenueCatProjectId,
        secretApiKey: revenueCatV2SecretApiKey.value(),
      });
      revenueCatStatusVerified = true;
    } catch (error) {
      logger.warn('RevenueCat API v2 alias verification is unavailable; customer deletion requires manual review.', {
        uid: request.auth.uid,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const lockedRevenueCatCustomerRef = db.collection('revenueCatCustomers')
    .doc(hashedDocumentId(request.auth.uid));
  const lockedRevenueCatCustomerSnapshot = await lockedRevenueCatCustomerRef.get();
  const lockedRevenueCatMapping = lockedRevenueCatCustomerSnapshot.exists
    ? lockedRevenueCatCustomerSnapshot.data()
    : null;
  const remoteDeletionDecision = customerBeta ? {
    policy: 'not_applicable_customer_beta', basis: 'isolated_customer_project_has_no_billing',
  } : revenueCatCustomerDeletionDecision({
    aliasStatus: lockedRevenueCatAliasEvidence.status,
    aliases: lockedRevenueCatAliasEvidence.aliases,
    userId: request.auth.uid,
  });
  const deletionTombstoneRef = db.collection('accountDeletionTombstones').doc(request.auth.uid);
  const existingDeletionTombstone = await deletionTombstoneRef.get();
  const appleProvider = authUser.providerData.find((provider) => provider.providerId === 'apple.com');
  let appleAuthorizationRevoked = existingDeletionTombstone.data()?.appleAuthorizationRevoked === true;

  if (appleProvider && !appleAuthorizationRevoked) {
    const authorizationCode = typeof request.data?.appleAuthorizationCode === 'string'
      ? request.data.appleAuthorizationCode.trim()
      : '';
    const firebaseApiKey = typeof request.data?.firebaseApiKey === 'string'
      ? request.data.firebaseApiKey.trim()
      : '';
    if (!authorizationCode || !firebaseApiKey) {
      throw new HttpsError(
        'failed-precondition',
        'Confirm your identity with Apple before deleting this account.'
      );
    }

    try {
      await revokeAppleAuthorization({
        authorizationCode,
        firebaseIdToken: firebaseIdTokenFromAuthorizationHeader(
          request.rawRequest?.headers?.authorization
        ),
        apiKey: firebaseApiKey,
      });
      appleAuthorizationRevoked = true;
    } catch (error) {
      const revocationError = error instanceof Error ? error.message : String(error);
      logger.error(`Sign in with Apple revocation failed before account deletion: ${revocationError}`);
      throw new HttpsError(
        'failed-precondition',
        'Apple authorization could not be revoked, so no account data was deleted. Please try again.'
      );
    }
  }

  try {
    await db.runTransaction(async (transaction) => {
      const profileSnapshot = await transaction.get(lockedProfileSnapshot.ref);
      if (!profileSnapshot.exists || profileSnapshot.data().organizationId !== lockedOrganizationId) {
        throw new Error('The deleting profile changed before its storage fence was written.');
      }
      transaction.set(deletionTombstoneRef, {
        status: 'deleting',
        startedAt: FieldValue.serverTimestamp(),
        denyUntil: new Date(Date.now() + ACCOUNT_DELETION_TOMBSTONE_MS),
        appleAuthorizationRevoked,
        cleanupAuthUser: accountDeletionAuthSnapshot(authUser),
        localCleanupAttempts: 0,
        localCleanupRetryAfter: new Date(Date.now() + ACCOUNT_DELETION_LOCK_MS),
        revenueCatDeletionGeneration: Math.max(
          0,
          Math.floor(Number(existingDeletionTombstone.data()?.revenueCatDeletionGeneration) || 0)
        ),
        revenueCatDeletionPolicy: remoteDeletionDecision.policy,
        revenueCatDeletionBasis: remoteDeletionDecision.basis,
        revenueCatDeletionOwnershipVerified: remoteDeletionDecision.policy === 'automatic',
        revenueCatDeletionProjectId: lockedRevenueCatProjectId,
        revenueCatAliasCount: lockedRevenueCatAliasEvidence.aliases.length,
        revenueCatCustomAliasCount: webhookIdentityCandidates({
          aliases: lockedRevenueCatAliasEvidence.aliases,
        }).length,
        revenueCatDeletionMappingSnapshot: lockedRevenueCatMapping ? {
          organizationId: lockedRevenueCatMapping.organizationId || null,
          purchaserUserId: lockedRevenueCatMapping.purchaserUserId || null,
          active: lockedRevenueCatMapping.active === true,
          state: lockedRevenueCatMapping.state || null,
        } : null,
        revenueCatManualReviewRequired: !customerBeta && remoteDeletionDecision.policy !== 'automatic',
        revenueCatDeletionAttemptToken: FieldValue.delete(),
        revenueCatDeletionAttemptStartedAt: FieldValue.delete(),
        completedAt: FieldValue.delete(),
        purgeAt: FieldValue.delete(),
      }, { merge: true });
      transaction.update(profileSnapshot.ref, {
        accountDeletionStartedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    logger.error('Could not create the account-deletion write fence.', {
      uid: request.auth.uid,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new HttpsError(
      'internal',
      'Account deletion could not start safely. Nothing was deleted; please try again.'
    );
  }

  let cleanup;
  try {
    cleanup = await deleteDispatchUserData({
      db,
      bucket: storageBucket,
      FieldValue,
      authUser,
    });
  } catch (error) {
    const cleanupError = error instanceof Error ? error.message : String(error);
    logger.error(`Dispatch account data cleanup failed: ${cleanupError}`);
    await deletionTombstoneRef.set({
      status: 'deleting',
      localCleanupAttempts: FieldValue.increment(1),
      localCleanupLastFailedAt: FieldValue.serverTimestamp(),
      localCleanupRetryAfter: new Date(Date.now() + ACCOUNT_DELETION_LOCK_MS),
    }, { merge: true }).catch(() => undefined);
    throw new HttpsError(
      'internal',
      'Account deletion could not be completed. Your sign-in account remains active; please try again.'
    );
  }

  const localCleanupState = await completeLocalAccountDeletionCleanup(deletionTombstoneRef);

  // RevenueCat can recreate a deleted customer from another device whose SDK
  // is still identified. Keep the durable tombstone for operator review after
  // Firebase Auth is removed; never issue a remote customer DELETE here.
  const revenueCatAttempt = null;
  let revenueCatCustomerDeleted = false;

  let authUserDeleted = false;
  try {
    await adminAuth.deleteUser(authUser.uid);
    authUserDeleted = true;
  } catch (error) {
    const authDeletionError = error instanceof Error ? error.message : String(error);
    if (error?.code === 'auth/user-not-found') {
      authUserDeleted = true;
    } else {
      logger.error(`Firebase Auth deletion will be retried by the deletion-fence maintainer: ${authDeletionError}`);
    }
  }

  const finalizedRemoteCleanup = await finalizeRemoteAccountDeletion({
    tombstoneRef: deletionTombstoneRef,
    revenueCatAttempt,
    revenueCatCustomerDeleted,
    authUserDeleted,
  }).catch((error) => {
    logger.error('Could not advance the account-deletion cleanup outbox.', {
      uid: authUser.uid,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  revenueCatCustomerDeleted = finalizedRemoteCleanup?.revenueCatCustomerDeleted === true;
  authUserDeleted = finalizedRemoteCleanup?.authUserDeleted === true;
  const remoteCleanupStatus = finalizedRemoteCleanup?.status || localCleanupState.status;
  const remoteCleanupPending = remoteCleanupStatus !== 'completed';
  const revenueCatManualReviewRequired = remoteCleanupStatus === 'manual_revenuecat_review';

  logger.info('Dispatch account deletion completed.', {
    appleAuthorizationRevoked,
    revenueCatCustomerDeleted,
    revenueCatStatusVerified,
    activeSubscriberDeletedImmediately,
    revenueCatManualReviewRequired,
    authDeletionPending: !authUserDeleted,
    remoteCleanupPending,
    ...cleanup,
  });
  return {
    deleted: true,
    appleAuthorizationRevoked,
    revenueCatCustomerDeleted,
    revenueCatStatusVerified,
    revenueCatDeletionPending: remoteCleanupStatus === 'ready_for_revenuecat_deletion',
    revenueCatManualReviewRequired,
    activeSubscriberDeletedImmediately,
    authDeletionPending: !authUserDeleted,
    remoteCleanupPending,
    ...cleanup,
  };
  } finally {
    await releaseAccountDeletionLock(accountDeletionLock).catch((error) => {
      logger.error('Could not release the serialized account-deletion lock.', {
        uid: request.auth.uid,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }
});

async function recoverDispatchAccountAfterAuthDeletion(authUser) {
  const tombstoneRef = db.collection('accountDeletionTombstones').doc(authUser.uid);
  const cleanupAuthUser = accountDeletionAuthSnapshot(authUser);
  const customerBeta = isCustomerBetaProject(runtimeProjectId());
  const initialFence = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(tombstoneRef);
    const existing = snapshot.exists ? snapshot.data() : {};
    if (existing.dataCleanupCompletedAt) {
      transaction.set(tombstoneRef, {
        authUserDeleted: true,
        authDeletionPending: false,
        authDeletionObservedAt: FieldValue.serverTimestamp(),
        remoteCleanupUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { cleanupCompleted: true };
    }
    transaction.set(tombstoneRef, {
      status: 'deleting',
      startedAt: existing.startedAt || FieldValue.serverTimestamp(),
      denyUntil: new Date(Date.now() + ACCOUNT_DELETION_TOMBSTONE_MS),
      cleanupAuthUser,
      localCleanupAttempts: Number(existing.localCleanupAttempts || 0),
      localCleanupRetryAfter: new Date(Date.now() + ACCOUNT_DELETION_LOCK_MS),
      revenueCatDeletionGeneration: Math.max(
        0,
        Math.floor(Number(existing.revenueCatDeletionGeneration) || 0)
      ),
      revenueCatDeletionPolicy: customerBeta ? 'not_applicable_customer_beta' : 'manual_alias_review',
      revenueCatDeletionBasis: customerBeta ? 'isolated_customer_project_has_no_billing' : 'auth_deleted_outside_dispatch_workflow',
      revenueCatDeletionOwnershipVerified: false,
      revenueCatDeletionPending: false,
      revenueCatManualReviewRequired: !customerBeta,
      authUserDeleted: true,
      authDeletionPending: false,
      authDeletionObservedAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.delete(),
      purgeAt: FieldValue.delete(),
      remoteCleanupUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { cleanupCompleted: false };
  });
  if (initialFence.cleanupCompleted) {
    await finalizeRemoteAccountDeletion({
      tombstoneRef,
      authUserDeleted: true,
    });
    return;
  }

  let deletionLock = null;
  try {
    deletionLock = await acquireAccountDeletionLock(authUser.uid);
  } catch (error) {
    await tombstoneRef.set({
      status: 'deleting',
      denyUntil: new Date(Date.now() + ACCOUNT_DELETION_TOMBSTONE_MS),
      localCleanupRetryAfter: new Date(Date.now() + ACCOUNT_DELETION_LOCK_MS),
      remoteCleanupUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    logger.warn('Queued account cleanup after Firebase Auth was deleted outside the Dispatch callable.', {
      uid: authUser.uid,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  try {
    const freshSnapshot = await tombstoneRef.get();
    if (freshSnapshot.exists && freshSnapshot.data().dataCleanupCompletedAt) {
      await finalizeRemoteAccountDeletion({
        tombstoneRef,
        authUserDeleted: true,
      });
      return;
    }

    try {
      const cleanup = await deleteDispatchUserData({
        db,
        bucket: storageBucket,
        FieldValue,
        authUser,
      });
      await completeLocalAccountDeletionCleanup(tombstoneRef);
      await finalizeRemoteAccountDeletion({
        tombstoneRef,
        authUserDeleted: true,
      });
      logger.info('Recovered Dispatch data cleanup after a direct Firebase Auth deletion.', {
        uid: authUser.uid,
        ...cleanup,
      });
    } catch (error) {
      await tombstoneRef.set({
        status: 'deleting',
        localCleanupAttempts: FieldValue.increment(1),
        localCleanupLastFailedAt: FieldValue.serverTimestamp(),
        localCleanupRetryAfter: new Date(Date.now() + ACCOUNT_DELETION_LOCK_MS),
      }, { merge: true });
      logger.error('Account cleanup after direct Firebase Auth deletion will be retried.', {
        uid: authUser.uid,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    if (deletionLock) await releaseAccountDeletionLock(deletionLock).catch(() => undefined);
  }
}

exports.recoverDispatchAccountAfterAuthDeletion = functionsV1
  .runWith({ failurePolicy: true })
  .region(getFunctionsRegion(runtimeProjectId()))
  .auth.user()
  .onDelete(recoverDispatchAccountAfterAuthDeletion);

exports.purgeExpiredAccountDeletionTombstones = onSchedule({
  schedule: 'every 60 minutes',
  maxInstances: 1,
  timeoutSeconds: 540,
  memory: '1GiB',
}, async () => {
  const interruptedLocalCleanup = await db.collection('accountDeletionTombstones')
    .where('status', '==', 'deleting')
    .where('localCleanupRetryAfter', '<=', new Date())
    .orderBy('localCleanupRetryAfter', 'asc')
    .limit(1)
    .get();
  let localCleanupRetries = 0;
  for (const document of interruptedLocalCleanup.docs) {
    let cleanupLock = null;
    try {
      cleanupLock = await acquireAccountDeletionLock(document.id);
      const freshTombstoneSnapshot = await document.ref.get();
      if (!freshTombstoneSnapshot.exists
        || freshTombstoneSnapshot.data().status !== 'deleting'
        || timestampMillis(freshTombstoneSnapshot.data().localCleanupRetryAfter) > Date.now()) {
        continue;
      }
      const freshTombstone = freshTombstoneSnapshot.data();
      let cleanupAuthUser;
      try {
        cleanupAuthUser = await adminAuth.getUser(document.id);
      } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error;
        cleanupAuthUser = storedAccountDeletionAuthUser(document.id, freshTombstone);
      }
      const cleanup = await deleteDispatchUserData({
        db,
        bucket: storageBucket,
        FieldValue,
        authUser: cleanupAuthUser,
      });
      await completeLocalAccountDeletionCleanup(document.ref);
      localCleanupRetries += 1;
      logger.info('Resumed interrupted Dispatch account data cleanup.', {
        uid: document.id,
        ...cleanup,
      });
    } catch (error) {
      await document.ref.set({
        status: 'deleting',
        localCleanupAttempts: FieldValue.increment(1),
        localCleanupLastFailedAt: FieldValue.serverTimestamp(),
        localCleanupRetryAfter: new Date(Date.now() + ACCOUNT_DELETION_LOCK_MS),
      }, { merge: true }).catch(() => undefined);
      logger.error('Scheduled Dispatch account data cleanup retry failed.', {
        uid: document.id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (cleanupLock) {
        await releaseAccountDeletionLock(cleanupLock).catch(() => undefined);
      }
    }
  }

  const legacyAutomaticRevenueCatDeletion = await db.collection('accountDeletionTombstones')
    .where('status', '==', 'ready_for_revenuecat_deletion')
    .limit(100)
    .get();
  let quarantinedLegacyRevenueCatDeletions = 0;
  for (const document of legacyAutomaticRevenueCatDeletion.docs) {
    let legacyLock = null;
    try {
      legacyLock = await acquireAccountDeletionLock(document.id);
      const quarantined = await db.runTransaction(async (transaction) => {
        const freshSnapshot = await transaction.get(document.ref);
        if (!freshSnapshot.exists || freshSnapshot.data().status !== 'ready_for_revenuecat_deletion') {
          return false;
        }
        transaction.set(document.ref, {
          status: 'manual_revenuecat_review',
          revenueCatDeletionPolicy: 'manual_alias_review',
          revenueCatDeletionBasis: 'post_auth_device_drain_required',
          revenueCatDeletionOwnershipVerified: false,
          revenueCatDeletionPending: false,
          revenueCatManualReviewRequired: true,
          revenueCatDeletionGeneration: FieldValue.increment(1),
          revenueCatDeletionAttemptToken: FieldValue.delete(),
          revenueCatDeletionAttemptStartedAt: FieldValue.delete(),
          completedAt: FieldValue.delete(),
          purgeAt: FieldValue.delete(),
          remoteCleanupUpdatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return true;
      });
      if (quarantined) quarantinedLegacyRevenueCatDeletions += 1;
    } catch (error) {
      logger.error('Could not quarantine a legacy automatic RevenueCat deletion record.', {
        uid: document.id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (legacyLock) {
        await releaseAccountDeletionLock(legacyLock).catch(() => undefined);
      }
    }
  }

  const awaitingAuthDeletion = await db.collection('accountDeletionTombstones')
    .where('status', '==', 'ready_for_auth_deletion')
    .limit(100)
    .get();
  for (const document of awaitingAuthDeletion.docs) {
    try {
      await adminAuth.deleteUser(document.id);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') {
        logger.error('Scheduled Firebase Auth deletion retry failed.', {
          uid: document.id,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    await finalizeRemoteAccountDeletion({
      tombstoneRef: document.ref,
      authUserDeleted: true,
    });
  }

  const awaitingManualReviewAuthDeletion = await db.collection('accountDeletionTombstones')
    .where('status', '==', 'manual_revenuecat_review')
    .where('authUserDeleted', '==', false)
    .limit(100)
    .get();
  for (const document of awaitingManualReviewAuthDeletion.docs) {
    try {
      await adminAuth.deleteUser(document.id);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') {
        logger.error('Scheduled Firebase Auth deletion retry for a RevenueCat manual-review record failed.', {
          uid: document.id,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    await finalizeRemoteAccountDeletion({
      tombstoneRef: document.ref,
      authUserDeleted: true,
    });
  }

  const expired = await db.collection('accountDeletionTombstones')
    .where('status', '==', 'completed')
    .where('purgeAt', '<=', new Date())
    .limit(400)
    .get();
  let purged = 0;
  if (!expired.empty) {
    purged = await db.runTransaction(async (transaction) => {
      const freshSnapshots = await transaction.getAll(...expired.docs.map((document) => document.ref));
      let count = 0;
      freshSnapshots.forEach((snapshot) => {
        if (!snapshot.exists
          || snapshot.data().status !== 'completed'
          || timestampMillis(snapshot.data().purgeAt) > Date.now()) return;
        transaction.delete(snapshot.ref);
        count += 1;
      });
      return count;
    });
  }
  logger.info('Maintained account-deletion write fences.', {
    localCleanupRetries,
    quarantinedLegacyRevenueCatDeletions,
    authDeletionRetries: awaitingAuthDeletion.size,
    manualReviewAuthDeletionRetries: awaitingManualReviewAuthDeletion.size,
    purged,
  });
});

function dispatchStorageObjectContext(name) {
  if (typeof name !== 'string' || !name) return null;
  const parts = name.split('/');
  if (parts[0] === 'dispatchTemplateAttachments' && parts[1]) {
    return { kind: 'template', ownerId: parts[1], threadId: null };
  }
  if (parts[0] === 'chatAttachments' && parts[1] && parts[2]) {
    return { kind: 'chat', ownerId: parts[2], threadId: parts[1] };
  }
  return null;
}

exports.reapOrphanedDispatchStorageObject = onObjectFinalized({ retry: true }, async (event) => {
  const objectName = event.data?.name;
  const context = dispatchStorageObjectContext(objectName);
  if (!context) return;
  const ownerRef = db.collection('users').doc(context.ownerId);
  const tombstoneRef = db.collection('accountDeletionTombstones').doc(context.ownerId);
  const refs = [ownerRef, tombstoneRef];
  const threadRef = context.threadId ? db.collection('chatThreads').doc(context.threadId) : null;
  if (threadRef) refs.push(threadRef);
  const [ownerSnapshot, tombstoneSnapshot, threadSnapshot] = await db.getAll(...refs);
  const ownerDeletionFenced = !ownerSnapshot.exists
    || (tombstoneSnapshot.exists && accountDeletionTombstoneIsActive(tombstoneSnapshot.data()));
  const orphanedChatObject = context.kind === 'chat'
    && (!threadSnapshot?.exists
      || !uniqueStrings(threadSnapshot.data()?.participants).includes(context.ownerId));
  const mismatchedChatOrganization = context.kind === 'chat'
    && threadSnapshot?.exists
    && ownerSnapshot.exists
    && ownerSnapshot.data().organizationId !== threadSnapshot.data().organizationId;
  let orphanedCustomerOrganization = false;
  if (isCustomerBetaProject(runtimeProjectId())) {
    const organizationId = context.kind === 'chat'
      ? threadSnapshot?.data()?.organizationId
      : ownerSnapshot.data()?.organizationId;
    const organizationSnapshot = typeof organizationId === 'string' && organizationId
      ? await db.collection('organizations').doc(organizationId).get()
      : null;
    orphanedCustomerOrganization = !organizationSnapshot?.exists
      || !organizationHasManagerAuthority(organizationSnapshot.data());
  }
  if (!ownerDeletionFenced && !orphanedChatObject && !mismatchedChatOrganization && !orphanedCustomerOrganization) return;
  await storageBucket.file(objectName).delete({ ignoreNotFound: true });
  logger.info('Removed a finalized Dispatch upload whose owner or chat source no longer exists.', {
    kind: context.kind,
  });
});

function pushTokenOwnerQuery(token) {
  return db.collection('users')
    .where('pushTokens', 'array-contains', token)
    .limit(MAX_PUSH_TOKEN_OWNERS);
}

function assertCompletePushTokenOwnerSnapshot(snapshot) {
  if (snapshot.size >= MAX_PUSH_TOKEN_OWNERS) {
    throw new HttpsError('resource-exhausted', 'Too many accounts are associated with this device token.');
  }
}

async function removePushTokenFromAllUsers(token) {
  return db.runTransaction(async (transaction) => {
    await assertAccountDeletionMutationLeaseAvailable(transaction);
    const ownersSnapshot = await transaction.get(pushTokenOwnerQuery(token));
    assertCompletePushTokenOwnerSnapshot(ownersSnapshot);
    ownersSnapshot.docs.forEach((ownerSnapshot) => {
      transaction.update(ownerSnapshot.ref, {
        pushTokens: FieldValue.arrayRemove(token),
        pushTokenUpdatedAt: FieldValue.serverTimestamp(),
      });
    });
    return ownersSnapshot.size;
  });
}

exports.registerDevicePushToken = onCall({ maxInstances: 20 }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in before registering this device for notifications.');
  }

  let registration;
  try {
    registration = normalizePushTokenRegistration(request.data);
  } catch (error) {
    throw new HttpsError('invalid-argument', error instanceof Error ? error.message : String(error));
  }

  const callerRef = db.collection('users').doc(request.auth.uid);
  return db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    const callerSnapshot = await transaction.get(callerRef);
    if (!callerSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'Create your Dispatch profile before enabling notifications.');
    }

    const ownersSnapshot = await transaction.get(pushTokenOwnerQuery(registration.token));
    assertCompletePushTokenOwnerSnapshot(ownersSnapshot);
    const previousOwnerIds = stalePushTokenOwnerIds(
      ownersSnapshot.docs.map((ownerSnapshot) => ownerSnapshot.id),
      request.auth.uid
    );

    ownersSnapshot.docs
      .filter((ownerSnapshot) => previousOwnerIds.includes(ownerSnapshot.id))
      .forEach((ownerSnapshot) => {
        transaction.set(ownerSnapshot.ref, {
          pushTokens: FieldValue.arrayRemove(registration.token),
          pushTokenUpdatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

    transaction.set(callerRef, {
      pushTokens: FieldValue.arrayUnion(registration.token),
      pushPermissionStatus: registration.permissionStatus,
      pushTokenUpdatedAt: FieldValue.serverTimestamp(),
      pushPlatform: registration.platform,
    }, { merge: true });

    return { previousOwnersRemoved: previousOwnerIds.length };
  });
});

exports.unregisterDevicePushToken = onCall({ maxInstances: 20 }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in before unregistering this device from notifications.');
  }

  let token;
  try {
    token = normalizePushTokenRegistration(request.data).token;
  } catch (error) {
    throw new HttpsError('invalid-argument', error instanceof Error ? error.message : String(error));
  }

  return db.runTransaction(async (transaction) => {
    await assertAccountDeletionNotStarted(transaction, request.auth.uid);
    const ownersSnapshot = await transaction.get(pushTokenOwnerQuery(token));
    assertCompletePushTokenOwnerSnapshot(ownersSnapshot);
    if (!ownersSnapshot.docs.some((ownerSnapshot) => ownerSnapshot.id === request.auth.uid)) {
      return { ownersRemoved: 0 };
    }

    ownersSnapshot.docs.forEach((ownerSnapshot) => {
      transaction.set(ownerSnapshot.ref, {
        pushTokens: FieldValue.arrayRemove(token),
        pushTokenUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return { ownersRemoved: ownersSnapshot.size };
  });
});

async function expoRequest(url, body) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      const error = new Error(`Expo push request failed (${response.status}): ${JSON.stringify(payload)}`);
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
  }
  throw lastError || new Error('Expo push request failed');
}

function firestoreSnapshotVersion(snapshot) {
  const updateTime = snapshot?.updateTime;
  if (!updateTime) return null;
  if (Number.isInteger(updateTime.seconds) && Number.isInteger(updateTime.nanoseconds)) {
    return `${updateTime.seconds}:${updateTime.nanoseconds}`;
  }
  return typeof updateTime.valueOf === 'function' ? String(updateTime.valueOf()) : String(updateTime);
}

async function claimDelivery(deliveryId, metadata, sourceGuards = []) {
  const ref = db.collection('pushDeliveries').doc(documentKey(deliveryId));
  return db.runTransaction(async (transaction) => {
    const state = await readPushMutationState(transaction, metadata?.userId, [
      ref,
      ...sourceGuards.map((guard) => guard.ref),
    ]);
    const [snapshot, ...sourceSnapshots] = state.additionalSnapshots;
    if (!state.allowed) return { claimed: false, ref };
    const sourceIsCurrent = sourceGuards.every((guard, index) => (
      sourceSnapshots[index]?.exists
      && firestoreSnapshotVersion(sourceSnapshots[index]) === guard.version
    ));
    if (!sourceIsCurrent) return { claimed: false, ref };
    const current = snapshot.exists ? snapshot.data() : null;
    const updatedAtMs = current?.updatedAt?.toMillis?.() || 0;
    if (current?.status === 'sent') return { claimed: false, ref };
    if (current?.status === 'processing' && updatedAtMs > Date.now() - PROCESSING_LEASE_MS) {
      return { claimed: false, ref };
    }
    const nextDelivery = {
      ...metadata,
      deliveryId,
      status: 'processing',
      attempts: current ? FieldValue.increment(1) : 1,
      updatedAt: FieldValue.serverTimestamp(),
      ...(current ? {} : { createdAt: FieldValue.serverTimestamp() }),
    };
    if (current) transaction.update(ref, nextDelivery);
    else transaction.create(ref, nextDelivery);
    return { claimed: true, ref };
  });
}

async function removeInvalidToken(_userId, token) {
  await removePushTokenFromAllUsers(token);
}

async function savePushTicket(ticketId, userId, token, deliveryId, deliveryRef, sourceGuards = []) {
  const ticketRef = db.collection('pushTickets').doc(documentKey(ticketId));
  return db.runTransaction(async (transaction) => {
    const state = await readPushMutationState(transaction, userId, [
      ticketRef,
      deliveryRef,
      ...sourceGuards.map((guard) => guard.ref),
    ]);
    const [ticketSnapshot, deliverySnapshot, ...sourceSnapshots] = state.additionalSnapshots;
    if (!state.allowed) return false;
    if (!deliverySnapshot?.exists || deliverySnapshot.data().status !== 'processing') return false;
    const sourceIsCurrent = sourceGuards.every((guard, index) => (
      sourceSnapshots[index]?.exists
      && firestoreSnapshotVersion(sourceSnapshots[index]) === guard.version
    ));
    if (!sourceIsCurrent) return false;
    if (ticketSnapshot.exists && ticketSnapshot.data().userId !== userId) return false;
    const ticket = {
      ticketId,
      userId,
      token,
      deliveryId,
      status: 'pending',
      updatedAt: FieldValue.serverTimestamp(),
      ...(ticketSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    };
    if (ticketSnapshot.exists) transaction.update(ticketRef, ticket);
    else transaction.create(ticketRef, ticket);
    return true;
  });
}

async function loadPushTokens(userId, expectedOrganizationId = null) {
  return db.runTransaction(async (transaction) => {
    const state = await readPushMutationState(transaction, userId);
    if (!state.allowed) return [];
    const user = state.userSnapshot.data();
    if (expectedOrganizationId !== null
      && (typeof expectedOrganizationId !== 'string'
        || !expectedOrganizationId
        || user.organizationId !== expectedOrganizationId)) {
      return [];
    }
    if (user.pushPermissionStatus === 'denied') return [];
    return normalizeExpoPushTokens(user.pushTokens);
  });
}

async function readPushMutationState(transaction, userId, additionalRefs = []) {
  if (typeof userId !== 'string' || !userId) {
    return { allowed: false, additionalSnapshots: [] };
  }
  const lockRef = accountDeletionLockRef();
  const tombstoneRef = db.collection('accountDeletionTombstones').doc(userId);
  const userRef = db.collection('users').doc(userId);
  const snapshots = await transaction.getAll(lockRef, tombstoneRef, userRef, ...additionalRefs);
  const [lockSnapshot, tombstoneSnapshot, userSnapshot, ...additionalSnapshots] = snapshots;
  return {
    allowed: accountDeletionMutationIsAllowed({
      maintenanceLock: lockSnapshot.exists ? lockSnapshot.data() : null,
      tombstone: tombstoneSnapshot.exists ? tombstoneSnapshot.data() : null,
      userExists: userSnapshot.exists,
    }),
    lockSnapshot,
    tombstoneSnapshot,
    userRef,
    userSnapshot,
    additionalSnapshots,
  };
}

async function finalizePushDelivery({
  deliveryRef,
  userId,
  updates,
  sourceRef = null,
  sourceGuards = [],
}) {
  return db.runTransaction(async (transaction) => {
    const additionalRefs = [deliveryRef, ...sourceGuards.map((guard) => guard.ref)];
    const state = await readPushMutationState(transaction, userId, additionalRefs);
    const [deliverySnapshot, ...sourceSnapshots] = state.additionalSnapshots;
    if (!state.allowed || !deliverySnapshot?.exists) return false;
    transaction.update(deliveryRef, updates);
    const guardedSourceIsCurrent = sourceGuards.length > 0 && sourceGuards.every((guard, index) => (
      sourceSnapshots[index]?.exists
      && firestoreSnapshotVersion(sourceSnapshots[index]) === guard.version
    ));
    if (sourceRef && guardedSourceIsCurrent) {
      transaction.update(sourceRef, { pushSeenBy: FieldValue.arrayUnion(userId) });
    }
    return true;
  });
}

async function sendPushToUser({
  deliveryId,
  userId,
  title,
  body,
  data,
  sourceRef,
  sourceGuards = [],
  expectedOrganizationId = null,
}) {
  if (!userId) return false;
  const tokens = await loadPushTokens(userId, expectedOrganizationId);
  if (!tokens.length) {
    logger.info('Push skipped because the user has no registered Expo token.', { deliveryId, userId });
    return false;
  }

  const claim = await claimDelivery(
    deliveryId,
    { userId, sourcePath: sourceRef?.path || null },
    sourceGuards
  );
  if (!claim.claimed) return false;

  try {
    let successfulTickets = 0;
    for (const tokenChunk of chunks(tokens, 100)) {
      const messages = tokenChunk.map((token) => pushMessageForUser(userId, {
        to: token,
        title,
        body,
        data,
      }));
      const response = await expoRequest(EXPO_PUSH_URL, messages);
      const tickets = Array.isArray(response.data) ? response.data : [];
      for (let index = 0; index < tokenChunk.length; index += 1) {
        const token = tokenChunk[index];
        const ticket = tickets[index];
        if (ticket?.status === 'ok' && ticket.id) {
          successfulTickets += 1;
          await savePushTicket(ticket.id, userId, token, deliveryId, claim.ref, sourceGuards);
        } else if (ticket?.details?.error === 'DeviceNotRegistered') {
          await removeInvalidToken(userId, token);
        } else {
          logger.error('Expo rejected a push notification.', { deliveryId, userId, ticket });
        }
      }
    }

    await finalizePushDelivery({
      deliveryRef: claim.ref,
      userId,
      updates: {
      status: successfulTickets ? 'sent' : 'no_valid_tokens',
      successfulTickets,
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      },
      sourceRef: successfulTickets ? sourceRef : null,
      sourceGuards: successfulTickets ? sourceGuards : [],
    });
    return successfulTickets > 0;
  } catch (error) {
    await finalizePushDelivery({
      deliveryRef: claim.ref,
      userId,
      updates: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: FieldValue.serverTimestamp(),
      },
    }).catch(() => undefined);
    throw error;
  }
}

exports.pushChatMessage = onDocumentCreated('chatThreads/{threadId}/messages/{messageId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const threadRef = db.collection('chatThreads').doc(event.params.threadId);
  const [messageSnapshot, threadSnapshot] = await db.getAll(snapshot.ref, threadRef);
  if (!messageSnapshot.exists || !threadSnapshot.exists) return;
  const message = { ...messageSnapshot.data(), id: messageSnapshot.id, threadId: event.params.threadId };
  const thread = { ...threadSnapshot.data(), id: threadSnapshot.id };
  const organizationId = typeof thread.organizationId === 'string' && thread.organizationId
    ? thread.organizationId
    : null;
  if (!organizationId) return;
  const candidateRecipientIds = chatPushRecipientIds(message, thread);
  const viewerSnapshots = candidateRecipientIds.length
    ? await db.getAll(...candidateRecipientIds.map((userId) => threadRef.collection('activeViewers').doc(userId)))
    : [];
  const nowMs = Date.now();
  const activeViewerIds = viewerSnapshots
    .filter((viewerSnapshot) => viewerSnapshot.exists && Number(viewerSnapshot.data().expiresAtMs) > nowMs)
    .map((viewerSnapshot) => viewerSnapshot.id);
  const recipientIds = chatPushRecipientIds(message, thread, activeViewerIds);
  const content = chatPushContent(message, thread);
  const sourceGuards = [messageSnapshot, threadSnapshot].map((sourceSnapshot) => ({
    ref: sourceSnapshot.ref,
    version: firestoreSnapshotVersion(sourceSnapshot),
  }));

  await Promise.all(recipientIds.map((userId) => sendPushToUser({
    deliveryId: `chat:${event.params.threadId}:${event.params.messageId}:${userId}`,
    userId,
    ...content,
    sourceRef: threadRef,
    sourceGuards,
    expectedOrganizationId: organizationId,
  })));
});

exports.pushUserNotification = onDocumentCreated('userNotifications/{notificationId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const currentSnapshot = await snapshot.ref.get();
  if (!currentSnapshot.exists) return;
  const notification = currentSnapshot.data();
  if (notification.pushAuthorized !== true) return;
  await sendPushToUser({
    deliveryId: `user-notification:${event.params.notificationId}:${notification.userId}`,
    userId: notification.userId,
    title: notification.title || 'Dispatch notification',
    body: notification.body || 'You have an update.',
    data: {
      kind: 'user_notification',
      relatedEventId: notification.relatedEventId,
      userNotificationId: event.params.notificationId,
    },
    sourceRef: currentSnapshot.ref,
    sourceGuards: [{
      ref: currentSnapshot.ref,
      version: firestoreSnapshotVersion(currentSnapshot),
    }],
    expectedOrganizationId: typeof notification.organizationId === 'string'
      ? notification.organizationId
      : null,
  });
});

exports.pushRoleAssignmentNotification = onDocumentCreated('roleAssignmentNotifications/{notificationId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const currentSnapshot = await snapshot.ref.get();
  if (!currentSnapshot.exists) return;
  const notification = { ...currentSnapshot.data(), id: event.params.notificationId };
  if (notification.pushAuthorized !== true) return;
  const recipientId = rolePushRecipientId(notification);
  if (!recipientId) {
    logger.info('Skipped Manager or invalid role invite push recipient.', {
      notificationId: event.params.notificationId,
    });
    return;
  }
  if (typeof notification.eventId !== 'string' || typeof notification.managerId !== 'string') return;
  const eventRef = db.collection('events').doc(notification.eventId);
  const managerRef = db.collection('users').doc(notification.managerId);
  const [eventSnapshot, managerSnapshot] = await db.getAll(eventRef, managerRef);
  if (!eventSnapshot.exists || !managerSnapshot.exists) return;
  const dispatchEvent = eventSnapshot.data();
  const organizationId = typeof dispatchEvent.organizationId === 'string' && dispatchEvent.organizationId
    ? dispatchEvent.organizationId
    : null;
  if (!organizationId
    || managerSnapshot.data().organizationId !== organizationId
    || normalizedRole(managerSnapshot.data().role) !== 'manager') {
    return;
  }
  if (notification.action === 'assign') {
    await ensureRoleInviteEventAccess(notification, recipientId).catch((error) => {
      logger.error('Unable to grant the invited Worker Event access.', {
        notificationId: event.params.notificationId,
        eventId: notification.eventId,
        workerId: recipientId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  const content = rolePushContent(notification);
  await sendPushToUser({
    deliveryId: `role-notification:${event.params.notificationId}:${recipientId}`,
    userId: recipientId,
    ...content,
    sourceRef: currentSnapshot.ref,
    sourceGuards: [currentSnapshot, eventSnapshot, managerSnapshot].map((sourceSnapshot) => ({
      ref: sourceSnapshot.ref,
      version: firestoreSnapshotVersion(sourceSnapshot),
    })),
    expectedOrganizationId: organizationId,
  });
});

exports.syncEventRoleNotificationState = onDocumentUpdated('events/{eventId}', async (event) => {
  const beforeSnapshot = event.data?.before;
  const afterSnapshot = event.data?.after;
  if (!afterSnapshot?.exists) return;

  const before = beforeSnapshot?.exists ? beforeSnapshot.data() : {};
  const after = afterSnapshot.data();
  if (roleStateFingerprint(before) === roleStateFingerprint(after)) return;

  const notifications = await db.collection('roleAssignmentNotifications')
    .where('eventId', '==', event.params.eventId)
    .get();
  let updateCount = 0;
  for (const notificationChunk of chunks(notifications.docs.map((snapshot) => snapshot.ref), 400)) {
    const updated = await db.runTransaction(async (transaction) => {
      const lockRef = accountDeletionLockRef();
      const snapshots = await transaction.getAll(lockRef, afterSnapshot.ref, ...notificationChunk);
      const [lockSnapshot, eventSnapshot, ...notificationSnapshots] = snapshots;
      if (lockSnapshot.exists && accountDeletionLeaseIsActive(lockSnapshot.data())) return 0;
      if (!eventSnapshot.exists) return 0;
      const currentEvent = eventSnapshot.data();
      let count = 0;
      notificationSnapshots.forEach((snapshot) => {
        if (!snapshot.exists) return;
        const notification = snapshot.data();
        const nextState = buildRoleNotificationState(notification, currentEvent);
        if (!roleNotificationStateChanged(notification, nextState)) return;
        transaction.update(snapshot.ref, {
          ...nextState,
          roleStateSyncedAt: FieldValue.serverTimestamp(),
        });
        count += 1;
      });
      return count;
    });
    updateCount += updated;
  }

  logger.info('Synchronized event role state to invite notifications.', {
    eventId: event.params.eventId,
    notificationCount: notifications.size,
    updateCount,
  });
});

exports.pushTwoHourEventReminders = onSchedule({
  schedule: 'every 5 minutes',
  timeZone: 'America/Edmonton',
}, async () => {
  const now = Date.now();
  const startsAfter = new Date(now + 110 * 60 * 1000).toISOString();
  const startsBefore = new Date(now + 125 * 60 * 1000).toISOString();
  const events = await db.collection('events')
    .where('startsAt', '>=', startsAfter)
    .where('startsAt', '<=', startsBefore)
    .limit(200)
    .get();

  for (const eventSnapshot of events.docs) {
    const currentEventSnapshot = await eventSnapshot.ref.get();
    if (!currentEventSnapshot.exists) continue;
    const currentEvent = { ...currentEventSnapshot.data(), id: currentEventSnapshot.id };
    const organizationId = typeof currentEvent.organizationId === 'string' && currentEvent.organizationId
      ? currentEvent.organizationId
      : null;
    if (!organizationId) continue;
    const sourceGuards = [{
      ref: currentEventSnapshot.ref,
      version: firestoreSnapshotVersion(currentEventSnapshot),
    }];
    for (const target of eventReminderTargets(currentEvent)) {
      await sendPushToUser({
        deliveryId: `event-two-hour:${currentEvent.id}:${currentEvent.startsAt}:${target.userId}`,
        userId: target.userId,
        title: `${currentEvent.name || 'Event'} starts in 2 hours`,
        body: `${target.roleNames.join(', ')} at ${currentEvent.location || 'the event location'}.`,
        data: {
          kind: 'user_notification',
          relatedEventId: currentEvent.id,
          dispatchReminderKey: `event-two-hour:${currentEvent.id}:${currentEvent.startsAt}`,
        },
        sourceGuards,
        expectedOrganizationId: organizationId,
      });
    }
  }
});

exports.pushLateTaskNotifications = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'America/Edmonton',
  maxInstances: 1,
}, async () => {
  const nowMs = Date.now();
  const earliestStart = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
  const latestStart = new Date(nowMs).toISOString();
  const eventsSnapshot = await db.collection('events')
    .where('startsAt', '>=', earliestStart)
    .where('startsAt', '<=', latestStart)
    .limit(500)
    .get();
  let candidateCount = 0;
  let createdCount = 0;
  for (const sourceEventSnapshot of eventsSnapshot.docs) {
    const result = await db.runTransaction(async (transaction) => {
      const lockRef = accountDeletionLockRef();
      const [lockSnapshot, eventSnapshot] = await transaction.getAll(lockRef, sourceEventSnapshot.ref);
      if ((lockSnapshot.exists && accountDeletionLeaseIsActive(lockSnapshot.data())) || !eventSnapshot.exists) {
        return { candidates: 0, created: 0 };
      }
      const currentEvent = { ...eventSnapshot.data(), id: eventSnapshot.id };
      const organizationRef = typeof currentEvent.organizationId === 'string' && currentEvent.organizationId
        ? db.collection('organizations').doc(currentEvent.organizationId)
        : null;
      const organizationSnapshot = organizationRef ? await transaction.get(organizationRef) : null;
      const notifications = lateTaskNotificationDocuments({
        event: currentEvent,
        nowMs,
        organizationManagerIds: organizationSnapshot?.exists
          ? uniqueStrings(organizationSnapshot.data().managerIds)
          : [],
      });
      if (!notifications.length) return { candidates: 0, created: 0 };

      const notificationRefs = notifications.map((notification) => (
        db.collection('userNotifications').doc(notification.id)
      ));
      const userRefs = notifications.map((notification) => db.collection('users').doc(notification.userId));
      const tombstoneRefs = notifications.map((notification) => (
        db.collection('accountDeletionTombstones').doc(notification.userId)
      ));
      const snapshots = await transaction.getAll(...notificationRefs, ...userRefs, ...tombstoneRefs);
      const snapshotByPath = new Map(snapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
      let count = 0;
      notifications.forEach((notification, index) => {
        const notificationRef = notificationRefs[index];
        const notificationSnapshot = snapshotByPath.get(notificationRef.path);
        const userSnapshot = snapshotByPath.get(userRefs[index].path);
        const tombstoneSnapshot = snapshotByPath.get(tombstoneRefs[index].path);
        if (notificationSnapshot?.exists || !userSnapshot?.exists) return;
        if (tombstoneSnapshot?.exists && accountDeletionTombstoneIsActive(tombstoneSnapshot.data())) return;
        if (userSnapshot.data().organizationId !== currentEvent.organizationId
          || normalizedRole(userSnapshot.data().role) !== 'manager') return;
        const { id: _id, ...notificationData } = notification;
        transaction.create(notificationRef, {
          ...notificationData,
          pushAuthorized: true,
          createdAt: FieldValue.serverTimestamp(),
        });
        count += 1;
      });
      return { candidates: notifications.length, created: count };
    });
    candidateCount += result.candidates;
    createdCount += result.created;
  }

  logger.info('Created overdue task notifications.', {
    eventCount: eventsSnapshot.size,
    candidateCount,
    createdCount,
  });
});

async function recordExpoPushReceipt(ticket, receipt) {
  return db.runTransaction(async (transaction) => {
    const state = await readPushMutationState(transaction, ticket.userId, [ticket.ref]);
    const [ticketSnapshot] = state.additionalSnapshots;
    if (!ticketSnapshot?.exists) return { recorded: false, removeToken: false };
    if (state.lockSnapshot?.exists && accountDeletionLeaseIsActive(state.lockSnapshot.data())) {
      return { recorded: false, removeToken: false };
    }
    if (!state.allowed) {
      transaction.delete(ticket.ref);
      return { recorded: false, removeToken: false };
    }
    if (ticketSnapshot.data().userId !== ticket.userId) {
      return { recorded: false, removeToken: false };
    }
    transaction.update(ticket.ref, {
      status: receipt.status === 'ok' ? 'delivered' : 'error',
      receipt,
      checkedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      recorded: true,
      removeToken: receipt.details?.error === 'DeviceNotRegistered',
    };
  });
}

exports.checkExpoPushReceipts = onSchedule({ schedule: 'every 15 minutes' }, async () => {
  const snapshot = await db.collection('pushTickets').where('status', '==', 'pending').limit(1000).get();
  const tickets = snapshot.docs
    .map((document) => ({ ref: document.ref, ...document.data() }))
    .filter((ticket) => ticket.createdAt?.toMillis?.() <= Date.now() - 2 * 60 * 1000);

  for (const ticketChunk of chunks(tickets, 1000)) {
    const ticketIds = ticketChunk.map((ticket) => ticket.ticketId);
    const response = await expoRequest(EXPO_RECEIPTS_URL, { ids: ticketIds });
    const receipts = response.data || {};
    for (const ticket of ticketChunk) {
      const receipt = receipts[ticket.ticketId];
      if (!receipt) continue;
      const result = await recordExpoPushReceipt(ticket, receipt);
      if (result.recorded && result.removeToken) {
        await removeInvalidToken(ticket.userId, ticket.token);
      }
    }
  }
});
