import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const { accountDeletionCleanupStatus } = createRequire(join(root, 'functions/package.json'))('./lib/account-deletion-lifecycle');

describe('organization billing workflow wiring', () => {
  it('exposes one organization Billing screen from Profile', () => {
    const profile = read('app/(tabs)/profile.tsx');
    const layout = read('app/_layout.tsx');
    expect(profile).toContain("router.push('/billing')");
    expect(profile).toContain('Organization Billing');
    expect(layout).toContain('<Stack.Screen name="billing"');
  });

  it('limits store actions to the Billing Manager and prevents duplicate payer checkout', () => {
    const billing = read('app/billing.tsx');
    expect(billing).toContain("&& !activeStoreBelongsToAnotherPlatform;");
    expect(billing).toContain('Duplicate checkout is locked');
    expect(billing).toContain('controls purchases and plan changes');
  });

  it('preflights, purchases, and verifies in that order', () => {
    const billing = read('app/billing.tsx');
    const preflight = billing.indexOf('await prepareOrganizationSubscriptionChange({');
    const purchase = billing.indexOf('await purchaseDispatchRevenueCatPackage({');
    const verification = billing.indexOf('await refreshOrganizationSubscription(purchaseStore);', purchase);
    expect(preflight).toBeGreaterThan(-1);
    expect(purchase).toBeGreaterThan(preflight);
    expect(verification).toBeGreaterThan(purchase);
  });

  it('restores only through an explicit action and then verifies trusted state', () => {
    const billing = read('app/billing.tsx');
    const restoreFunction = billing.indexOf('const restorePurchases = async () =>');
    const restore = billing.indexOf('await restoreDispatchPurchases({', restoreFunction);
    const verification = billing.indexOf('await refreshOrganizationSubscription(purchaseStore);', restore);
    expect(restoreFunction).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(restoreFunction);
    expect(verification).toBeGreaterThan(restore);
    expect(billing).toContain('onPress={() => void restorePurchases()}');
  });

  it('does not create RevenueCat customers for every signed-in organization member', () => {
    const session = read('context/session.tsx');
    expect(session).not.toContain('identifyRevenueCatUser');
  });

  it('provides next-renewal downgrade and verified cancellation guidance', () => {
    const billing = read('app/billing.tsx');
    expect(billing).toContain("canDowngradeToPlan('free', seatUsage.seatUsage)");
    expect(billing).toContain('Move to Free at paid expiry');
    expect(billing).toContain('new invitations are limited to the');
    expect(billing).toContain('await openDispatchSubscriptionManagement(billing.managementURL);');
    expect(billing).toContain('only after RevenueCat confirms the renewal schedule');
    const functions = read('functions/index.js');
    expect(functions).not.toContain('deferredIntentPending');
    expect(functions).toContain('authoritative only after RevenueCat sends PRODUCT_CHANGE');
  });

  it('enforces server-owned read-only mode beyond the Billing screen', () => {
    const rules = read('firestore.rules');
    const functions = read('functions/index.js');
    const tabs = read('app/(tabs)/_layout.tsx');
    expect(rules).toContain('function organizationWriteEnabled(organizationId)');
    expect(rules).toContain("data.accessMode != 'read_only'");
    expect(rules).toContain('allow update: if signedIn()');
    expect(rules).toContain('allow delete: if signedIn()');
    expect(rules).toContain('&& organizationWriteEnabled(organizationIdFromData(resource.data))');
    expect(functions).toContain('This organization is read-only. Resolve billing or Free-plan capacity');
    expect(functions).toContain('This organization is read-only. Ask the Billing Manager');
    expect(tabs).toContain('Organization is read-only · View billing');
  });

  it('releases a claimed invite reservation without coupling billing state to manager transfer', () => {
    const functions = read('functions/index.js');
    const claimStart = functions.indexOf('exports.claimDispatchInvite');
    const transferStart = functions.indexOf('exports.transferOrganizationBillingManager');
    const subscriptionStart = functions.indexOf('const SUBSCRIPTION_PLAN_RANK');
    const claimFlow = functions.slice(claimStart, transferStart);
    const transferFlow = functions.slice(transferStart, subscriptionStart);

    expect(claimStart).toBeGreaterThan(-1);
    expect(transferStart).toBeGreaterThan(claimStart);
    expect(subscriptionStart).toBeGreaterThan(transferStart);
    expect(claimFlow).toContain('const nextBilling = hasMatchingReservation');
    expect(claimFlow).toContain('transaction.set(billingRef, {');
    expect(claimFlow).toContain('...nextBilling');
    expect(transferFlow).not.toContain('...nextBilling,');
    expect(transferFlow).toContain('const billingRef');
    expect(transferFlow).toContain('The active Apple or Google payer must remain the Billing Manager');
    expect(transferFlow).toContain('transaction.update(organizationRef, {');
  });

  it('preserves the existing self-managed push notification profile fields', () => {
    const rules = read('firestore.rules');
    const usersRule = rules.slice(
      rules.indexOf('match /users/{userId}'),
      rules.indexOf('match /teams/{teamId}')
    );

    expect(usersRule).toContain("'pushTokens'");
    expect(usersRule).toContain("'pushPermissionStatus'");
    expect(usersRule).toContain("'pushTokenUpdatedAt'");
    expect(usersRule).toContain("'pushPlatform'");
    expect(usersRule).toContain("optionalFieldUnchanged('organizationId')");
    expect(usersRule).toContain("optionalFieldUnchanged('organizationName')");
  });

  it('binds subscription write enforcement to the caller organization and legacy Free capacity', () => {
    const rules = read('firestore.rules');
    const functions = read('functions/index.js');
    const tabs = read('app/(tabs)/_layout.tsx');
    expect(rules).toContain('return isOrganizationMember(organizationId)');
    expect(rules).toContain('exists(/databases/$(database)/documents/organizationBilling/$(organizationId))');
    expect(rules).toContain('isCustomerBetaProject() ? customerBetaOrganizationWritable(organizationId) : (');
    expect(rules).not.toContain('!exists(/databases/$(database)/documents/organizationBilling/$(organizationId))');
    expect(rules).toContain('request.resource.data.organizationId == resource.data.organizationId');
    expect(rules).toContain('organizationIdFromData(request.resource.data) == organizationIdFromData(resource.data)');
    expect(rules).not.toContain("? teamOrganizationId(data.teamId) : userOrganizationId()");
    expect(functions).toContain('exports.initializeOrganizationBilling');
    expect(functions).toContain('exports.initializeOrganizationBillingOnCreate');
    expect(tabs).toContain('initializeOrganizationBilling()');
    expect(tabs).toContain('setOrganizationReadOnly(true)');
  });

  it('adopts pre-secure invitations through a server callable instead of denied client writes', () => {
    const session = read('context/session.tsx');
    const functions = read('functions/index.js');
    expect(session).toContain('adoptLegacyDispatchInvites()');
    expect(session).not.toContain('acceptPendingWorkerInvitesForUser');
    expect(session).not.toContain('linkPendingManagerInvites');
    expect(functions).toContain('exports.adoptLegacyDispatchInvites');
    expect(functions).toContain('buildLegacyInviteAdoptionPlan');
  });

  it('provides an actionable accepted-member and invitation capacity workflow', () => {
    const billing = read('app/billing.tsx');
    const functions = read('functions/index.js');
    expect(billing).toContain('Manage seats for a downgrade');
    expect(billing).toContain('await removeOrganizationMember(member.uid);');
    expect(billing).toContain('await cancelSecureDispatchInvite(invite.inviteId);');
    expect(functions).toContain('exports.removeOrganizationMember');
    expect(functions).toContain('exports.listOrganizationPendingInvites');
    expect(functions).toContain('planOrganizationMemberRemoval');
    expect(functions).toContain("db.collection('events').where('organizationId', '==', organizationId)");
    expect(functions).toContain("db.collection('chatThreads').where('participants', 'array-contains', targetUserId)");
    expect(functions).toContain("snapshot.ref.collection('activeViewers').doc(targetUserId)");
    expect(functions).toContain('removeOrganizationMemberFromChatThread(thread, targetUserId)');
    expect(functions).toContain("statusReason: 'Organization membership was removed by the Billing Manager.'");
    expect(functions).not.toContain("const userNotificationsQuery = db.collection('userNotifications').where('userId', '==', targetUserId)");
  });

  it('fails closed across RevenueCat environments, transfers, and account deletion', () => {
    const functions = read('functions/index.js');
    const rules = read('firestore.rules');
    const storageRules = read('storage.rules');
    const accountDeletion = read('functions/lib/account-deletion.js');
    const firebaseConfig = JSON.parse(read('firebase.json')) as {
      firestore?: { indexes?: string };
      storage?: { rules?: string };
    };
    const session = read('context/session.tsx');
    const revenueCat = read('services/revenuecat.ts');
    const revenueCatServer = read('functions/lib/revenuecat.js');
    const profile = read('app/(tabs)/profile.tsx');
    expect(functions).toContain("defineString('REVENUECAT_EXPECTED_ENVIRONMENT')");
    expect(functions).toContain('validateRevenueCatWebhookEnvironment(event, configuredEnvironment)');
    expect(functions).toContain("if (event.type === 'TRANSFER') return applyRevenueCatTransferEvent(event, eventRef);");
    expect(functions).toContain('deriveTransferredAwayOrganizationBilling');
    expect(functions).toContain("status: processed ? 'processed' : `quarantined_${quarantineReason}`");
    expect(functions).toContain('revenueCatMappingCanMutateBilling({');
    expect(functions).toContain('verificationBilling.purchaseIntent?.purchaserUserId');
    expect(functions).not.toContain('deleteRevenueCatCustomer');
    expect(revenueCatServer).not.toContain("method: 'DELETE'");
    expect(revenueCatServer).toContain("basis: 'authoritative_alias_set_unavailable'");
    expect(revenueCatServer).toContain("basis: 'post_auth_device_drain_required'");
    expect(accountDeletionCleanupStatus({
      revenueCatDeletionPolicy: 'manual_alias_review', revenueCatCustomerDeleted: false, authUserDeleted: true,
    })).toBe('manual_revenuecat_review');
    expect(accountDeletionCleanupStatus({
      revenueCatDeletionPolicy: 'not_applicable_customer_beta', customerBeta: false, authUserDeleted: true,
    })).toBe('manual_revenuecat_review');
    expect(functions).toContain(".where('status', '==', 'ready_for_revenuecat_deletion')");
    expect(functions).toContain('quarantinedLegacyRevenueCatDeletions');
    expect(functions).toContain('secrets: subscriptionSecrets([revenueCatSecretApiKey])');
    expect(functions).toContain("db.collection('maintenanceLocks').doc('accountDeletion')");
    expect(functions).toContain('await acquireAccountDeletionLock(request.auth.uid);');
    expect(functions).toContain('confirmActiveSubscriptionDeletion');
    expect(functions).toContain('exports.prepareOrganizationSubscriptionRestore');
    expect(functions).toContain('The Manager who issued this invitation is no longer authorized.');
    expect(functions).toContain('!organizationData.managerIds.includes(invite.inviterId)');
    expect(functions).toContain('authUser.emailVerified !== true');
    expect(functions).toContain('The Manager who issued this legacy invitation is no longer authorized.');
    expect(functions).toContain('!currentManagerIds.has(invite.inviterId)');
    expect(functions).toContain('activeRevenueCatStoreIntentForUser(deletingBilling, request.auth.uid)');
    expect(functions).toContain('const lockedBillingSnapshot = await');
    expect(functions).toContain("db.collection('accountDeletionTombstones')");
    expect(functions).toContain("status: 'deleting'");
    expect(functions).toContain('exports.recoverDispatchAccountAfterAuthDeletion = functionsV1');
    expect(functions).toContain('.runWith({ failurePolicy: true })');
    expect(functions).toContain('authDeletionObservedAt: FieldValue.serverTimestamp()');
    expect(functions).toContain(".where('status', '==', 'deleting')");
    expect(functions).toContain(".where('localCleanupRetryAfter', '<=', new Date())");
    expect(functions).toContain(".orderBy('localCleanupRetryAfter', 'asc')");
    expect(functions).toContain('freshTombstoneSnapshot.data().status !== \'deleting\'');
    expect(functions).toContain(".where('purgeAt', '<=', new Date())");
    expect((functions.match(/assertAccountDeletionNotStarted\(/g) || []).length).toBeGreaterThanOrEqual(12);
    expect(functions).toContain('revenueCatBillingSnapshotIsCurrent({');
    expect(functions).toContain('revenueCatMappingAllowsPaidRefresh({');
    expect(rules).toContain('!activeAccountDeletionTombstone()');
    expect(rules).toContain("'ready_for_revenuecat_deletion'");
    expect(rules).toContain('match /accountDeletionTombstones/{userId}');
    expect(rules).toContain('function activeGlobalAccountDeletionLock()');
    expect(rules).toContain('allow create: if mutationAllowed()');
    expect(rules).toContain('allow create, update, delete: if mutationAllowed()');
    expect(firebaseConfig.storage?.rules).toBe('storage.rules');
    expect(firebaseConfig.firestore?.indexes).toBe('firestore.indexes.json');
    expect(storageRules).toContain("!('accountDeletionStartedAt' in userProfile().data)");
    expect(storageRules).toContain('request.auth.uid == ownerId');
    expect(storageRules).toContain('participatesInExplicitOrganizationChat(threadId)');
    expect(storageRules).toContain('return authenticated()');
    expect(storageRules).toContain('organizationStorageWriteEnabled(');
    expect(storageRules).toContain('allow update, delete: if false;');
    expect(storageRules).toContain('allow list: if false;');
    expect(storageRules).not.toContain('allow read: if canUseDispatchStorage();');
    expect(accountDeletion).toContain('const residualStorageFiles = await collectOwnedStorageFiles');
    expect(functions).toContain('exports.reapOrphanedDispatchStorageObject = onObjectFinalized({ retry: true }');
    expect(functions).toContain("!uniqueStrings(threadSnapshot.data()?.participants).includes(context.ownerId)");
    expect(functions).toContain('ownerSnapshot.data().organizationId !== threadSnapshot.data().organizationId');
    expect(functions).toContain('accountDeletionLeaseIsActive(lockSnapshot.data())');
    expect(rules).toContain('participantsAreActiveOrganizationMembers(request.resource.data)');
    expect(rules).toContain('request.resource.data.senderId == request.auth.uid');
    expect(rules).toContain('resource.data.managerId == request.auth.uid');
    expect(revenueCat).toContain('await Purchases.logOut();');
    expect(revenueCat).toContain('anonymousAppUserId === expectedFirebaseUid');
    expect(revenueCat).toContain('const blockedRevenueCatUserIds = new Set<string>();');
    expect(revenueCat).toContain('serializeRevenueCatOperation');
    expect(revenueCat).toContain('blockedRevenueCatUserIds.add(expectedFirebaseUid);');
    expect(session).toContain('await logOutDispatchRevenueCatUser(user.uid);');
    expect(session.indexOf('await logOutDispatchRevenueCatUser(user.uid);', session.indexOf('const deleteAccount = async')))
      .toBeLessThan(session.indexOf('await requestDispatchAccountDeletion({'));
    expect(profile).toContain('Deleting Dispatch does not cancel an Apple or Google subscription.');
    expect(profile).toContain('RevenueCat customer data is never deleted automatically');
    expect(profile).toContain('Firebase sign-in deletion is still retrying in the background.');
    expect(profile).toContain('confirmActiveSubscriptionDeletion: !customerBeta');
    expect(functions).toContain('preloadedCustomerMappings');
    expect(functions).toContain("requesterMappingState === 'released'");
    expect(functions).toContain('requesterLivePaid');
    expect(functions).toContain('accountDeletionMutationIsAllowed({');
    expect(functions).toContain('readPushMutationState(transaction, userId');
    expect(functions).toContain('recordExpoPushReceipt(ticket, receipt)');
    expect(functions).toContain('firestoreSnapshotVersion(sourceSnapshots[index]) === guard.version');
    expect(functions).toContain("status: 'ignored_deleted_payer'");
    expect(functions).not.toContain('claim.ref.set({');
    expect(functions).not.toContain('ticket.ref.set({');
    expect(functions).not.toContain("db.collection('users').doc(userId).set({");
  });

  it('routes Worker event mutations through a trusted callable and fences push recipients by organization', () => {
    const dispatch = read('services/dispatch.ts');
    const functions = read('functions/index.js');
    const rules = read('firestore.rules');
    expect(dispatch).toContain("'mutateWorkerEvent'");
    expect(dispatch).toContain("import { auth, db, functions, storage } from '@/lib/firebase';");
    expect(dispatch).not.toContain("getFunctions(undefined, 'us-central1')");
    expect(functions).toContain('exports.mutateWorkerEvent = onCall');
    expect(functions).toContain('planWorkerEventAction({');
    expect(functions).toContain("billingSnapshot.data().accessMode !== 'full'");
    expect(functions).toContain('expectedOrganizationId = null');
    expect(functions).toContain('user.organizationId !== expectedOrganizationId');
    expect(functions).toContain('if (notification.pushAuthorized !== true) return;');
    expect(functions).toContain("normalizedRole(userSnapshot.data().role) !== 'manager'");
    expect(rules).toContain('function isOrganizationWorker(userId, organizationId)');
    expect(rules).toContain("!('pushAuthorized' in request.resource.data)");
    expect(rules).toContain('request.resource.data.workerId,');
  });

  it('isolates RevenueCat Test Store writes behind a demo-project Firebase emulator guard', () => {
    const firebase = read('lib/firebase.ts');
    const emulatorConfig = read('lib/firebase-emulator-config.ts');
    const billingService = read('services/billing.ts');
    const revenueCatService = read('services/revenuecat.ts');
    const revenueCatServer = read('functions/lib/revenuecat.js');
    const functions = read('functions/index.js');
    const firebaseJson = JSON.parse(read('firebase.json')) as {
      emulators?: Record<string, { host?: string; port?: number } | boolean>;
    };
    expect(emulatorConfig).toContain("projectId?.startsWith('demo-')");
    expect(emulatorConfig).toContain('restricted to local development builds');
    expect(firebase).toContain('connectAuthEmulator');
    expect(firebase).toContain('connectFirestoreEmulator');
    expect(firebase).toContain('connectFunctionsEmulator');
    expect(firebase).toContain('connectStorageEmulator');
    expect(billingService).toContain("purchaseStore === 'test_store' && !firebaseEmulatorConfiguration.enabled");
    expect(billingService).toContain('assertRevenueCatStoreIsolation(purchaseStore);');
    expect(revenueCatService).toContain('testStoreAllowed: firebaseEmulatorConfiguration.enabled');
    expect(revenueCatServer).toContain('validateRevenueCatPurchaseStoreEnvironment');
    expect(functions).toContain('const purchaseStore = revenueCatPurchaseStoreForCallable(request.data?.purchaseStore);');
    expect((functions.match(/revenueCatPurchaseStoreForCallable\(request\.data\?\.purchaseStore\)/g) || []).length).toBe(3);
    expect(firebaseJson.emulators?.auth).toMatchObject({ host: '0.0.0.0', port: 9099 });
    expect(firebaseJson.emulators?.firestore).toMatchObject({ host: '0.0.0.0', port: 8080 });
    expect(firebaseJson.emulators?.functions).toMatchObject({ host: '0.0.0.0', port: 5001 });
    expect(firebaseJson.emulators?.storage).toMatchObject({ host: '0.0.0.0', port: 9199 });
  });
});
