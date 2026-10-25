const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  activeRevenueCatPayerMustResolveSubscription,
  activeRevenueCatStoreIntentForUser,
  applyRevenueCatLifecyclePolicy,
  deriveOrganizationBillingFromSubscriber,
  deriveTransferredAwayOrganizationBilling,
  fetchRevenueCatCustomerAliases,
  hashedDocumentId,
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
  validateRevenueCatSubscriberEnvironment,
  validateRevenueCatWebhookEnvironment,
  verifyRevenueCatWebhookSignature,
  webhookIdentityCandidates,
} = require('../lib/revenuecat');

test('keeps Test Store requests out of the production billing environment', () => {
  assert.equal(validateRevenueCatPurchaseStoreEnvironment({
    purchaseStore: 'test_store',
    expectedEnvironment: 'sandbox',
  }), 'test_store');
  assert.equal(validateRevenueCatPurchaseStoreEnvironment({
    purchaseStore: 'app_store',
    expectedEnvironment: 'production',
  }), 'app_store');
  assert.throws(() => validateRevenueCatPurchaseStoreEnvironment({
    purchaseStore: 'test_store',
    expectedEnvironment: 'production',
  }), /cannot update production organization billing/);
  assert.throws(() => validateRevenueCatPurchaseStoreEnvironment({
    purchaseStore: 'unknown_store',
    expectedEnvironment: 'sandbox',
  }), /valid RevenueCat purchase store/);
});

test('routes every RevenueCat customer through durable post-auth manual review', () => {
  assert.deepEqual(revenueCatCustomerDeletionDecision({
    aliasStatus: 'not_found',
    userId: 'payer-1',
  }), { policy: 'manual_alias_review', basis: 'post_auth_device_drain_required' });

  assert.deepEqual(revenueCatCustomerDeletionDecision({
    aliasStatus: 'not_found',
    subscriberStatus: 'verified',
    userId: 'payer-1',
  }), { policy: 'manual_alias_review', basis: 'revenuecat_api_state_mismatch' });

  assert.deepEqual(revenueCatCustomerDeletionDecision({
    aliasStatus: 'not_found',
    subscriberStatus: 'unavailable',
    userId: 'payer-1',
  }), { policy: 'manual_alias_review', basis: 'revenuecat_api_state_mismatch' });

  assert.deepEqual(revenueCatCustomerDeletionDecision({
    aliasStatus: 'verified',
    aliases: ['$RCAnonymousID:one', 'payer-1'],
    userId: 'payer-1',
  }), { policy: 'manual_alias_review', basis: 'post_auth_device_drain_required' });

  assert.deepEqual(revenueCatCustomerDeletionDecision({
    aliasStatus: 'verified',
    aliases: ['payer-1', 'surviving-peer'],
    userId: 'payer-1',
  }), { policy: 'manual_alias_review', basis: 'surviving_custom_aliases' });

  assert.deepEqual(revenueCatCustomerDeletionDecision({
    aliasStatus: 'verified',
    aliases: ['different-canonical'],
    userId: 'payer-1',
  }), { policy: 'manual_alias_review', basis: 'deleting_user_not_in_alias_set' });

  assert.deepEqual(revenueCatCustomerDeletionDecision({
    aliasStatus: 'unavailable',
    userId: 'payer-1',
  }), { policy: 'manual_alias_review', basis: 'authoritative_alias_set_unavailable' });
});

test('paginates authoritative RevenueCat API v2 aliases without issuing a delete', async () => {
  const requests = [];
  const evidence = await fetchRevenueCatCustomerAliases({
    customerId: 'payer-1',
    projectId: 'proj_1',
    secretApiKey: 'v2-secret',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            object: 'list',
            items: [{ object: 'customer.alias', id: '$RCAnonymousID:one' }],
            next_page: '/v2/projects/proj_1/customers/payer-1/aliases?starting_after=one',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          object: 'list',
          items: [{ object: 'customer.alias', id: 'payer-1' }],
          next_page: null,
        }),
      };
    },
  });
  assert.deepEqual(evidence, {
    status: 'verified',
    aliases: ['$RCAnonymousID:one', 'payer-1'],
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer v2-secret');
});

test('detects any billing document change across an external RevenueCat verification', () => {
  const preloadedBilling = {
    planId: 'crew',
    purchaserUserId: 'payer-1',
    lastRevenueCatEventAtMs: 100,
    currentPeriodEndsAt: new Date('2030-01-01T00:00:00.000Z'),
    purchaseIntent: { planId: 'production', changeTiming: 'immediate' },
  };
  assert.equal(revenueCatBillingSnapshotIsCurrent({
    preloadedExists: true,
    preloadedBilling,
    freshExists: true,
    freshBilling: { ...preloadedBilling },
  }), true);
  assert.equal(revenueCatBillingSnapshotIsCurrent({
    preloadedExists: true,
    preloadedBilling,
    freshExists: true,
    freshBilling: { ...preloadedBilling, lastRevenueCatEventAtMs: 101 },
  }), false);
  assert.equal(revenueCatBillingSnapshotIsCurrent({
    preloadedExists: false,
    freshExists: true,
    freshBilling: preloadedBilling,
  }), false);
});

test('never launders a quarantined or transferred mapping through paid refresh', () => {
  const params = { organizationId: 'org-1', purchaserUserId: 'payer-1' };
  assert.equal(revenueCatMappingAllowsPaidRefresh({ mapping: null, ...params }), true);
  assert.equal(revenueCatMappingAllowsPaidRefresh({
    mapping: { organizationId: 'org-1', purchaserUserId: 'payer-1', active: true, state: 'active' },
    ...params,
  }), true);
  for (const state of ['alias', 'quarantined', 'transferred', 'released']) {
    assert.equal(revenueCatMappingAllowsPaidRefresh({
      mapping: { organizationId: 'org-1', purchaserUserId: 'payer-1', active: state !== 'released', state },
      ...params,
    }), false);
  }
  assert.equal(revenueCatMappingAllowsPaidRefresh({
    mapping: { organizationId: 'org-2', purchaserUserId: 'payer-1', active: true, state: 'active' },
    ...params,
  }), false);
});

test('blocks deletion only while the user is the payer for a live paid subscription', () => {
  assert.equal(activeRevenueCatPayerMustResolveSubscription({
    purchaserUserId: 'payer-1',
    planId: 'crew',
    status: 'active',
  }, 'payer-1'), true);
  assert.equal(activeRevenueCatPayerMustResolveSubscription({
    purchaserUserId: 'payer-1',
    planId: 'crew',
    status: 'expired',
  }, 'payer-1'), false);
  assert.equal(activeRevenueCatPayerMustResolveSubscription({
    purchaserUserId: 'payer-1',
    planId: 'free',
    status: 'free',
  }, 'payer-1'), false);
  assert.equal(activeRevenueCatPayerMustResolveSubscription({
    purchaserUserId: 'payer-2',
    planId: 'organization',
    status: 'grace',
  }, 'payer-1'), false);
});

test('blocks deletion during a recent purchase or restore intent but releases stale intents', () => {
  const nowMs = Date.parse('2030-01-01T00:15:00.000Z');
  assert.equal(activeRevenueCatStoreIntentForUser({
    purchaseIntent: { purchaserUserId: 'payer-1', operation: 'restore', createdAtMs: nowMs - 1_000 },
  }, 'payer-1', nowMs), true);
  assert.equal(activeRevenueCatStoreIntentForUser({
    purchaseIntent: { purchaserUserId: 'payer-1', operation: 'purchase', createdAtMs: nowMs - 61 * 60 * 1000 },
  }, 'payer-1', nowMs), false);
  assert.equal(activeRevenueCatStoreIntentForUser({
    purchaseIntent: { purchaserUserId: 'payer-2', createdAtMs: nowMs - 1_000 },
  }, 'payer-1', nowMs), false);
});

test('verifies RevenueCat raw-body HMAC with timestamp replay protection', () => {
  const rawBody = Buffer.from('{"event":{"id":"event-1"}}');
  const timestamp = '2000000000';
  const secret = 'local-signing-secret';
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  assert.equal(verifyRevenueCatWebhookSignature({
    rawBody,
    signatureHeader: `t=${timestamp},v1=${signature}`,
    signingSecret: secret,
    nowSeconds: 2000000000,
  }), true);
  assert.equal(verifyRevenueCatWebhookSignature({
    rawBody,
    signatureHeader: `t=${timestamp},v1=${signature}`,
    signingSecret: secret,
    nowSeconds: 2000000400,
  }), false);
});

test('maps only allowlisted products and stable packages', () => {
  assert.deepEqual(resolveRevenueCatProduct('dispatch_production_50:annual'), {
    planId: 'production',
    billingPeriod: 'annual',
    packageIdentifier: 'production_annual',
    productIdentifiers: ['dispatch_production_50_annual', 'dispatch_production_50:annual', 'dispatch_production_annual'],
  });
  assert.equal(packageIdentifierForPlan('crew', 'monthly'), 'crew_monthly');
  assert.equal(resolveRevenueCatProduct('unexpected_product'), null);
});

test('derives active, grace, cancellation, and expired access from authoritative Customer Info', () => {
  const nowMs = Date.parse('2030-01-01T00:00:00.000Z');
  const activeSubscriber = {
    entitlements: {
      organization_access: {
        product_identifier: 'dispatch_crew_20_monthly',
        expires_date: '2030-02-01T00:00:00.000Z',
      },
    },
    subscriptions: {
      dispatch_crew_20_monthly: { store: 'APP_STORE', period_type: 'NORMAL' },
    },
    management_url: 'https://apps.apple.com/account/subscriptions',
  };
  assert.deepEqual(deriveOrganizationBillingFromSubscriber({ subscriber: activeSubscriber, nowMs }), {
    planId: 'crew',
    billingPeriod: 'monthly',
    status: 'active',
    accessMode: 'full',
    seatLimit: 20,
    sourceStore: 'app_store',
    productIdentifier: 'dispatch_crew_20_monthly',
    currentPeriodEndsAt: new Date('2030-02-01T00:00:00.000Z'),
    gracePeriodExpiresAt: null,
    willRenew: true,
    managementURL: 'https://apps.apple.com/account/subscriptions',
  });

  const graceSubscriber = structuredClone(activeSubscriber);
  graceSubscriber.entitlements.organization_access.expires_date = '2029-12-31T00:00:00.000Z';
  graceSubscriber.entitlements.organization_access.grace_period_expires_date = '2030-01-03T00:00:00.000Z';
  graceSubscriber.subscriptions.dispatch_crew_20_monthly.billing_issues_detected_at = '2029-12-31T00:00:00.000Z';
  assert.equal(deriveOrganizationBillingFromSubscriber({ subscriber: graceSubscriber, nowMs }).status, 'grace');

  const cancelledSubscriber = structuredClone(activeSubscriber);
  cancelledSubscriber.subscriptions.dispatch_crew_20_monthly.unsubscribe_detected_at = '2029-12-30T00:00:00.000Z';
  const cancelled = deriveOrganizationBillingFromSubscriber({ subscriber: cancelledSubscriber, nowMs });
  assert.equal(cancelled.status, 'active');
  assert.equal(cancelled.willRenew, false);

  assert.deepEqual(deriveOrganizationBillingFromSubscriber({
    subscriber: { entitlements: {}, subscriptions: {} },
    currentBilling: { planId: 'crew', billingPeriod: 'monthly', productIdentifier: 'dispatch_crew_20_monthly' },
    nowMs,
  }), {
    planId: 'crew',
    billingPeriod: 'monthly',
    status: 'expired',
    accessMode: 'read_only',
    seatLimit: 20,
    sourceStore: null,
    productIdentifier: 'dispatch_crew_20_monthly',
    currentPeriodEndsAt: null,
    gracePeriodExpiresAt: null,
    willRenew: false,
    managementURL: null,
  });
});

test('keeps Free access when a purchased product has no organization_access entitlement', () => {
  const projection = deriveOrganizationBillingFromSubscriber({
    subscriber: {
      entitlements: {},
      subscriptions: {
        dispatch_crew_20_monthly: {
          store: 'test_store',
          is_sandbox: true,
          expires_date: '2030-02-01T00:00:00.000Z',
        },
      },
    },
    currentBilling: { planId: 'free', status: 'free' },
    nowMs: Date.parse('2030-01-01T00:00:00.000Z'),
    expectedEnvironment: 'sandbox',
  });
  assert.equal(projection.planId, 'free');
  assert.equal(projection.status, 'free');
  assert.equal(projection.seatLimit, 5);
});

test('never maps anonymous RevenueCat identities to a Dispatch organization', () => {
  assert.deepEqual(webhookIdentityCandidates({
    app_user_id: '$RCAnonymousID:one',
    original_app_user_id: 'firebase-uid',
    aliases: ['$RCAnonymousID:two', 'firebase-uid'],
    transferred_from: ['$RCAnonymousID:three', 'former-payer'],
    transferred_to: ['next-payer', 'firebase-uid'],
  }), ['firebase-uid', 'former-payer', 'next-payer']);
  assert.deepEqual(partitionRevenueCatTransferIdentities({
    transferred_from: ['$RCAnonymousID:one', 'former-payer', 'former-payer'],
    transferred_to: ['next-payer', '$RCAnonymousID:two'],
  }), {
    fromCandidates: ['former-payer'],
    toCandidates: ['next-payer'],
  });
  assert.deepEqual(webhookIdentityCandidates({ transferred_from: 'former-payer' }), ['former-payer']);
  assert.equal(hashedDocumentId('firebase-uid').length, 64);
});

test('allows only the active current or purchase-intent payer mapping to mutate billing', () => {
  const activeMapping = {
    active: true,
    organizationId: 'org-1',
    purchaserUserId: 'payer-1',
  };
  assert.equal(revenueCatMappingCanMutateBilling({
    mapping: activeMapping,
    billing: { purchaserUserId: 'payer-1' },
    organizationId: 'org-1',
  }), true);
  assert.equal(revenueCatMappingCanMutateBilling({
    mapping: activeMapping,
    billing: { purchaserUserId: 'former', purchaseIntent: { purchaserUserId: 'payer-1' } },
    organizationId: 'org-1',
  }), true);
  assert.equal(revenueCatMappingCanMutateBilling({
    mapping: activeMapping,
    billing: { purchaserUserId: 'payer-2' },
    organizationId: 'org-1',
  }), false);
  assert.equal(revenueCatMappingCanMutateBilling({
    mapping: { ...activeMapping, active: false },
    billing: { purchaserUserId: 'payer-1' },
    organizationId: 'org-1',
  }), false);
  assert.equal(revenueCatMappingCanMutateBilling({
    mapping: activeMapping,
    billing: { purchaserUserId: 'payer-1' },
    organizationId: 'org-2',
  }), false);
});

test('validates subscriber and webhook environments before projecting access', () => {
  const subscriber = {
    entitlements: {
      organization_access: {
        product_identifier: 'dispatch_crew_20_monthly',
        expires_date: '2030-02-01T00:00:00.000Z',
      },
    },
    subscriptions: {
      dispatch_crew_20_monthly: {
        store: 'TEST_STORE',
        period_type: 'NORMAL',
        is_sandbox: true,
      },
    },
  };

  assert.equal(validateRevenueCatSubscriberEnvironment({
    subscriber,
    productIdentifier: 'dispatch_crew_20_monthly',
    expectedEnvironment: 'sandbox',
  }), 'sandbox');
  assert.throws(() => validateRevenueCatSubscriberEnvironment({
    subscriber,
    productIdentifier: 'dispatch_crew_20_monthly',
    expectedEnvironment: 'production',
  }), /sandbox does not match expected production/);
  const missingEnvironmentSubscriber = structuredClone(subscriber);
  delete missingEnvironmentSubscriber.subscriptions.dispatch_crew_20_monthly.is_sandbox;
  assert.throws(() => validateRevenueCatSubscriberEnvironment({
    subscriber: missingEnvironmentSubscriber,
    productIdentifier: 'dispatch_crew_20_monthly',
    expectedEnvironment: 'production',
  }), /missing a verified subscription environment/);
  assert.throws(() => deriveOrganizationBillingFromSubscriber({
    subscriber,
    nowMs: Date.parse('2030-01-01T00:00:00.000Z'),
    expectedEnvironment: 'production',
  }), /sandbox does not match expected production/);

  const productionSubscriber = structuredClone(subscriber);
  productionSubscriber.subscriptions.dispatch_crew_20_monthly.is_sandbox = false;
  assert.equal(deriveOrganizationBillingFromSubscriber({
    subscriber: productionSubscriber,
    nowMs: Date.parse('2030-01-01T00:00:00.000Z'),
    expectedEnvironment: 'production',
  }).status, 'active');
  assert.equal(validateRevenueCatWebhookEnvironment({ environment: 'SANDBOX' }, 'sandbox'), 'sandbox');
  assert.equal(validateRevenueCatWebhookEnvironment({ environment: 'PRODUCTION' }, 'production'), 'production');
  assert.throws(
    () => validateRevenueCatWebhookEnvironment({ environment: 'SANDBOX' }, 'production'),
    /sandbox does not match expected production/
  );
  assert.throws(
    () => validateRevenueCatWebhookEnvironment({}, 'production'),
    /missing a valid environment/
  );
});

test('transferred-away billing falls back to Free or read-only revoked access', () => {
  const billing = {
    planId: 'production',
    billingPeriod: 'annual',
    status: 'active',
    accessMode: 'full',
    seatLimit: 50,
    purchaserUserId: 'former-payer',
    sourceStore: 'app_store',
    productIdentifier: 'dispatch_production_50_annual',
    willRenew: true,
    seatReservations: { pending: { expiresAtMs: 2_000 } },
    pendingPlanId: 'crew',
  };
  const free = deriveTransferredAwayOrganizationBilling({ billing, seatUsage: 5 });
  assert.equal(free.planId, 'free');
  assert.equal(free.status, 'free');
  assert.equal(free.accessMode, 'full');
  assert.equal(free.seatLimit, 5);
  assert.equal(free.purchaserUserId, null);
  assert.equal(free.productIdentifier, null);
  assert.equal(free.pendingPlanId, null);
  assert.deepEqual(free.seatReservations, billing.seatReservations);

  const revoked = deriveTransferredAwayOrganizationBilling({ billing, seatUsage: 6 });
  assert.equal(revoked.planId, 'free');
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.accessMode, 'read_only');
  assert.equal(revoked.seatLimit, 5);
});

test('schedules Free only from verified cancellation and finalizes it at entitlement expiry', () => {
  const activeCancelled = {
    planId: 'crew',
    billingPeriod: 'monthly',
    status: 'active',
    accessMode: 'full',
    seatLimit: 20,
    willRenew: false,
    currentPeriodEndsAt: new Date('2030-02-01T00:00:00.000Z'),
  };
  const scheduled = applyRevenueCatLifecyclePolicy({
    billing: { planId: 'crew' },
    projection: activeCancelled,
    seatUsage: 4,
  });
  assert.equal(scheduled.planId, 'crew');
  assert.equal(scheduled.pendingPlanId, 'free');
  assert.deepEqual(scheduled.pendingPlanEffectiveAt, new Date('2030-02-01T00:00:00.000Z'));

  const expired = applyRevenueCatLifecyclePolicy({
    billing: scheduled,
    projection: { ...activeCancelled, status: 'expired', accessMode: 'read_only' },
    seatUsage: 4,
  });
  assert.equal(expired.planId, 'free');
  assert.equal(expired.status, 'free');
  assert.equal(expired.accessMode, 'full');
  assert.equal(expired.pendingPlanId, null);

  const overCapacity = applyRevenueCatLifecyclePolicy({
    billing: scheduled,
    projection: { ...activeCancelled, status: 'expired', accessMode: 'read_only' },
    seatUsage: 7,
  });
  assert.equal(overCapacity.planId, 'free');
  assert.equal(overCapacity.accessMode, 'read_only');
});

test('authoritative expiry reaches Free even when an earlier cancellation event was missed', () => {
  const expiredWithoutPendingState = applyRevenueCatLifecyclePolicy({
    billing: {
      planId: 'production',
      billingPeriod: 'annual',
      status: 'active',
      pendingPlanId: null,
    },
    projection: {
      planId: 'production',
      billingPeriod: 'annual',
      status: 'expired',
      accessMode: 'read_only',
      seatLimit: 50,
      sourceStore: 'app_store',
      productIdentifier: 'dispatch_production_50_annual',
      willRenew: false,
    },
    seatUsage: 5,
  });
  assert.equal(expiredWithoutPendingState.planId, 'free');
  assert.equal(expiredWithoutPendingState.status, 'free');
  assert.equal(expiredWithoutPendingState.accessMode, 'full');
  assert.equal(expiredWithoutPendingState.pendingPlanId, null);

  const overCapacity = applyRevenueCatLifecyclePolicy({
    billing: { planId: 'production', status: 'active' },
    projection: {
      planId: 'production',
      status: 'expired',
      accessMode: 'read_only',
      seatLimit: 50,
      willRenew: false,
    },
    seatUsage: 6,
  });
  assert.equal(overCapacity.planId, 'free');
  assert.equal(overCapacity.status, 'free');
  assert.equal(overCapacity.accessMode, 'read_only');
});

test('repeated verification of historical expired entitlements stays Free across stores and capacity limits', () => {
  const nowMs = Date.parse('2030-02-01T00:00:00.000Z');
  for (const [store, productIdentifier] of [
    ['RC_BILLING', 'dispatch_production_annual'],
    ['APP_STORE', 'dispatch_production_50_annual'],
    ['PLAY_STORE', 'dispatch_production_50:annual'],
    ['TEST_STORE', 'dispatch_production_50_annual'],
  ]) {
    const subscriber = {
      entitlements: { organization_access: {
        product_identifier: productIdentifier,
        expires_date: '2030-01-31T00:00:00.000Z',
      } },
      subscriptions: { [productIdentifier]: { store, is_sandbox: true } },
    };
    for (const seatUsage of [3, 5, 6]) {
      let billing = { planId: 'production', status: 'active', seatLimit: 50 };
      for (let verification = 0; verification < 4; verification += 1) {
        billing = applyRevenueCatLifecyclePolicy({
          billing,
          projection: deriveOrganizationBillingFromSubscriber({ subscriber, currentBilling: billing, nowMs, expectedEnvironment: 'sandbox' }),
          seatUsage,
        });
        assert.equal(billing.planId, 'free', `${store}, verification ${verification + 1}`);
        assert.equal(billing.status, 'free');
        assert.equal(billing.seatLimit, 5);
        assert.equal(billing.accessMode, seatUsage <= 5 ? 'full' : 'read_only');
        assert.equal(billing.productIdentifier, null);
        assert.equal(billing.sourceStore, null);
        assert.equal(billing.currentPeriodEndsAt, null);
      }
    }
  }
});

test('verification repairs stale paid fields on Free records even when the entitlement was removed', () => {
  const billing = { planId: 'free', status: 'free', productIdentifier: 'dispatch_production_annual', billingPeriod: 'annual' };
  const projection = deriveOrganizationBillingFromSubscriber({ subscriber: { entitlements: {}, subscriptions: {} }, currentBilling: billing });
  const result = applyRevenueCatLifecyclePolicy({ billing, projection, seatUsage: 3 });
  assert.equal(result.planId, 'free');
  assert.equal(result.seatLimit, 5);
  assert.equal(result.accessMode, 'full');
  assert.equal(result.billingPeriod, null);
  assert.equal(result.productIdentifier, null);
});

test('verified renewal clears a pending cancellation before expiry', () => {
  const renewed = applyRevenueCatLifecyclePolicy({
    billing: {
      planId: 'production',
      pendingPlanId: 'free',
      pendingPlanEffectiveAt: new Date('2030-02-01T00:00:00.000Z'),
    },
    projection: {
      planId: 'production',
      billingPeriod: 'annual',
      status: 'active',
      accessMode: 'full',
      seatLimit: 50,
      willRenew: true,
      currentPeriodEndsAt: new Date('2031-02-01T00:00:00.000Z'),
    },
    seatUsage: 18,
  });
  assert.equal(renewed.pendingPlanId, null);
  assert.equal(renewed.pendingPlanEffectiveAt, null);
});

test('a newly verified paid product supersedes an older scheduled downgrade', () => {
  const upgraded = applyRevenueCatLifecyclePolicy({
    billing: {
      planId: 'production',
      billingPeriod: 'annual',
      pendingPlanId: 'crew',
      pendingBillingPeriod: 'annual',
      pendingPlanEffectiveAt: new Date('2030-02-01T00:00:00.000Z'),
    },
    projection: {
      planId: 'organization',
      billingPeriod: 'annual',
      status: 'active',
      accessMode: 'full',
      seatLimit: 100,
      willRenew: true,
      currentPeriodEndsAt: new Date('2031-02-01T00:00:00.000Z'),
    },
    seatUsage: 30,
  });

  assert.equal(upgraded.planId, 'organization');
  assert.equal(upgraded.pendingPlanId, null);
  assert.equal(upgraded.pendingBillingPeriod, null);
  assert.equal(upgraded.pendingPlanEffectiveAt, null);
});

test('a product-change event distinguishes a pending target from a verified reversal', () => {
  const projection = { planId: 'production', billingPeriod: 'annual' };
  assert.equal(revenueCatProductChangeState({
    eventType: 'PRODUCT_CHANGE',
    eventProduct: { planId: 'crew', billingPeriod: 'annual' },
    projection,
  }), 'pending');
  assert.equal(revenueCatProductChangeState({
    eventType: 'PRODUCT_CHANGE',
    eventProduct: { planId: 'production', billingPeriod: 'annual' },
    projection,
  }), 'current');
  assert.equal(revenueCatProductChangeState({
    eventType: 'RENEWAL',
    eventProduct: { planId: 'production', billingPeriod: 'annual' },
    projection,
  }), 'none');
});

test('transfer processing rejects mapping creation, deletion, or reassignment after preload', () => {
  const identity = 'firebase-uid';
  const documentId = hashedDocumentId(identity);
  const active = {
    identity,
    exists: true,
    organizationId: 'org-1',
    purchaserUserId: identity,
    active: true,
    state: 'active',
  };
  assert.equal(revenueCatMappingSnapshotIsCurrent({
    preloadedMapping: active,
    freshExists: true,
    freshData: {
      organizationId: 'org-1',
      purchaserUserId: identity,
      active: true,
      state: 'active',
    },
    documentId,
  }), true);
  assert.equal(revenueCatMappingSnapshotIsCurrent({
    preloadedMapping: active,
    freshExists: true,
    freshData: { ...active, organizationId: 'org-2' },
    documentId,
  }), false);
  assert.equal(revenueCatMappingSnapshotIsCurrent({
    preloadedMapping: active,
    freshExists: false,
    freshData: {},
    documentId,
  }), false);
  assert.equal(revenueCatMappingSnapshotIsCurrent({
    preloadedMapping: { identity: 'new-alias', exists: false },
    freshExists: true,
    freshData: {
      organizationId: 'org-2',
      purchaserUserId: 'new-alias',
      active: true,
      state: 'active',
    },
    documentId: hashedDocumentId('new-alias'),
  }), false);
});

test('verified paid lifecycle becomes read-only when the renewed tier is over capacity', () => {
  const overCapacity = applyRevenueCatLifecyclePolicy({
    billing: { planId: 'production', status: 'active' },
    projection: {
      planId: 'crew',
      billingPeriod: 'monthly',
      status: 'active',
      accessMode: 'full',
      seatLimit: 20,
      willRenew: true,
      currentPeriodEndsAt: new Date('2030-02-01T00:00:00.000Z'),
    },
    seatUsage: 21,
  });
  assert.equal(overCapacity.planId, 'crew');
  assert.equal(overCapacity.status, 'active');
  assert.equal(overCapacity.accessMode, 'read_only');
});
