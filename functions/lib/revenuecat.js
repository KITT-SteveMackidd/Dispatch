const crypto = require('node:crypto');
const { accessModeForBillingAndSeatUsage } = require('./subscriptions');

const REVENUECAT_ENTITLEMENT_ID = 'organization_access';
const REVENUECAT_OFFERING_ID = 'dispatch_organization_plans_v1';
const REVENUECAT_STORE_INTENT_TTL_MS = 60 * 60 * 1000;
const REVENUECAT_PURCHASE_STORES = new Set(['app_store', 'play_store', 'test_store']);

const PRODUCT_CATALOG = Object.freeze([
  {
    planId: 'crew',
    billingPeriod: 'monthly',
    packageIdentifier: 'crew_monthly',
    productIdentifiers: ['dispatch_crew_20_monthly', 'dispatch_crew_20:monthly'],
  },
  {
    planId: 'crew',
    billingPeriod: 'annual',
    packageIdentifier: 'crew_annual',
    productIdentifiers: ['dispatch_crew_20_annual', 'dispatch_crew_20:annual'],
  },
  {
    planId: 'production',
    billingPeriod: 'monthly',
    packageIdentifier: 'production_monthly',
    productIdentifiers: ['dispatch_production_50_monthly', 'dispatch_production_50:monthly'],
  },
  {
    planId: 'production',
    billingPeriod: 'annual',
    packageIdentifier: 'production_annual',
    productIdentifiers: ['dispatch_production_50_annual', 'dispatch_production_50:annual'],
  },
  {
    planId: 'organization',
    billingPeriod: 'monthly',
    packageIdentifier: 'organization_monthly',
    productIdentifiers: ['dispatch_organization_100_monthly', 'dispatch_organization_100:monthly'],
  },
  {
    planId: 'organization',
    billingPeriod: 'annual',
    packageIdentifier: 'organization_annual',
    productIdentifiers: ['dispatch_organization_100_annual', 'dispatch_organization_100:annual'],
  },
]);

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseSignatureHeader(value) {
  if (typeof value !== 'string') return null;
  const parts = Object.fromEntries(value.split(',').map((part) => {
    const separator = part.indexOf('=');
    return separator > 0
      ? [part.slice(0, separator).trim(), part.slice(separator + 1).trim()]
      : ['', ''];
  }));
  return parts.t && parts.v1 ? { timestamp: parts.t, signature: parts.v1 } : null;
}

function verifyRevenueCatWebhookSignature({
  rawBody,
  signatureHeader,
  signingSecret,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
}) {
  if (!signingSecret || !Buffer.isBuffer(rawBody)) return false;
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed || !/^\d+$/.test(parsed.timestamp) || !/^[a-f0-9]{64}$/i.test(parsed.signature)) return false;
  const signedAtSeconds = Number(parsed.timestamp);
  if (!Number.isSafeInteger(signedAtSeconds) || Math.abs(nowSeconds - signedAtSeconds) > toleranceSeconds) return false;
  const expected = crypto
    .createHmac('sha256', signingSecret)
    .update(Buffer.concat([Buffer.from(`${parsed.timestamp}.`), rawBody]))
    .digest('hex');
  return constantTimeEqual(expected, parsed.signature.toLowerCase());
}

function resolveRevenueCatProduct(productIdentifier) {
  const normalized = typeof productIdentifier === 'string' ? productIdentifier.trim() : '';
  if (!normalized) return null;
  return PRODUCT_CATALOG.find((entry) => entry.productIdentifiers.includes(normalized)) || null;
}

function packageIdentifierForPlan(planId, billingPeriod) {
  return PRODUCT_CATALOG.find((entry) => (
    entry.planId === planId && entry.billingPeriod === billingPeriod
  ))?.packageIdentifier || null;
}

function validateRevenueCatPurchaseStoreEnvironment({ purchaseStore, expectedEnvironment }) {
  const normalizedStore = typeof purchaseStore === 'string' ? purchaseStore.trim().toLowerCase() : '';
  const normalizedEnvironment = typeof expectedEnvironment === 'string'
    ? expectedEnvironment.trim().toLowerCase()
    : '';
  if (!REVENUECAT_PURCHASE_STORES.has(normalizedStore)) {
    throw new Error('Choose a valid RevenueCat purchase store.');
  }
  if (!['sandbox', 'production'].includes(normalizedEnvironment)) {
    throw new Error('RevenueCat expected environment must be sandbox or production.');
  }
  if (normalizedEnvironment === 'production' && normalizedStore === 'test_store') {
    throw new Error('RevenueCat Test Store cannot update production organization billing.');
  }
  return normalizedStore;
}

function millis(value) {
  if (!value) return null;
  if (Number.isFinite(value)) return Number(value);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceStore(value) {
  const store = typeof value === 'string' ? value.toUpperCase() : '';
  if (store === 'APP_STORE' || store === 'MAC_APP_STORE') return 'app_store';
  if (store === 'PLAY_STORE') return 'play_store';
  if (store === 'TEST_STORE') return 'test_store';
  return null;
}

function normalizeRevenueCatEnvironment(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!['sandbox', 'production'].includes(normalized)) {
    throw new Error('Expected RevenueCat environment must be sandbox or production.');
  }
  return normalized;
}

function validateRevenueCatSubscriberEnvironment({
  subscriber,
  productIdentifier,
  expectedEnvironment,
}) {
  const expected = normalizeRevenueCatEnvironment(expectedEnvironment);
  const subscription = productIdentifier ? subscriber?.subscriptions?.[productIdentifier] : null;
  if (!subscription || typeof subscription.is_sandbox !== 'boolean') {
    throw new Error('RevenueCat subscriber is missing a verified subscription environment.');
  }
  const actual = subscription.is_sandbox ? 'sandbox' : 'production';
  if (actual !== expected) {
    throw new Error(`RevenueCat subscriber environment ${actual} does not match expected ${expected}.`);
  }
  return actual;
}

function validateRevenueCatWebhookEnvironment(event, expectedEnvironment) {
  const expected = normalizeRevenueCatEnvironment(expectedEnvironment);
  const actual = typeof event?.environment === 'string'
    ? event.environment.trim().toLowerCase()
    : '';
  if (!['sandbox', 'production'].includes(actual)) {
    throw new Error('RevenueCat webhook is missing a valid environment.');
  }
  if (actual !== expected) {
    throw new Error(`RevenueCat webhook environment ${actual} does not match expected ${expected}.`);
  }
  return actual;
}

function deriveOrganizationBillingFromSubscriber({
  subscriber,
  currentBilling = {},
  nowMs = Date.now(),
  expectedEnvironment,
}) {
  const entitlement = subscriber?.entitlements?.[REVENUECAT_ENTITLEMENT_ID] || null;
  const entitlementProductIdentifier = entitlement?.product_identifier || null;
  const productIdentifier = entitlementProductIdentifier || currentBilling.productIdentifier || null;
  const product = resolveRevenueCatProduct(productIdentifier);

  if (entitlement && !product) {
    throw new Error(`RevenueCat returned an unsupported product identifier: ${productIdentifier || 'missing'}`);
  }
  if (entitlement && expectedEnvironment) {
    validateRevenueCatSubscriberEnvironment({
      subscriber,
      productIdentifier: entitlementProductIdentifier,
      expectedEnvironment,
    });
  }

  const expirationAtMs = millis(entitlement?.expires_date);
  const gracePeriodExpiresAtMs = millis(entitlement?.grace_period_expires_date);
  const subscription = productIdentifier ? subscriber?.subscriptions?.[productIdentifier] || {} : {};
  const inGrace = Boolean(gracePeriodExpiresAtMs && gracePeriodExpiresAtMs > nowMs);
  const entitlementActive = Boolean(entitlement && (expirationAtMs === null || expirationAtMs > nowMs || inGrace));
  const trialing = entitlementActive && String(subscription.period_type || '').toUpperCase() === 'TRIAL';
  const status = !entitlementActive
    ? (currentBilling.planId && currentBilling.planId !== 'free' ? 'expired' : 'free')
    : inGrace || subscription.billing_issues_detected_at
      ? 'grace'
      : trialing
        ? 'trialing'
        : 'active';
  const planId = product?.planId || currentBilling.planId || 'free';

  return {
    planId,
    billingPeriod: product?.billingPeriod || currentBilling.billingPeriod || null,
    status,
    accessMode: ['active', 'trialing', 'grace', 'free'].includes(status) ? 'full' : 'read_only',
    seatLimit: planId === 'crew' ? 20
      : planId === 'production' ? 50
        : planId === 'organization' ? 100
          : planId === 'enterprise' ? currentBilling.seatLimit ?? null
            : 5,
    sourceStore: sourceStore(subscription.store),
    productIdentifier,
    currentPeriodEndsAt: expirationAtMs ? new Date(expirationAtMs) : null,
    gracePeriodExpiresAt: gracePeriodExpiresAtMs ? new Date(gracePeriodExpiresAtMs) : null,
    willRenew: entitlementActive && !subscription.unsubscribe_detected_at,
    managementURL: subscriber?.management_url || null,
  };
}

function applyRevenueCatLifecyclePolicy({ billing = {}, projection, seatUsage = 0 }) {
  const normalizedSeatUsage = Math.max(0, Math.floor(Number(seatUsage) || 0));
  const livePaidEntitlement = isLivePaidRevenueCatProjection(projection);
  let pendingPlanId = billing.pendingPlanId || null;
  let pendingBillingPeriod = billing.pendingBillingPeriod || null;
  let pendingPlanEffectiveAt = billing.pendingPlanEffectiveAt || null;

  if (livePaidEntitlement && !projection.willRenew) {
    pendingPlanId = 'free';
    pendingBillingPeriod = null;
    pendingPlanEffectiveAt = projection.currentPeriodEndsAt || null;
  } else if (livePaidEntitlement && projection.willRenew && pendingPlanId === 'free') {
    pendingPlanId = null;
    pendingBillingPeriod = null;
    pendingPlanEffectiveAt = null;
  } else if (
    livePaidEntitlement
    && pendingPlanId
    && pendingPlanId !== 'free'
    && (
      projection.planId !== billing.planId
      || (
        billing.billingPeriod
        && projection.billingPeriod
        && projection.billingPeriod !== billing.billingPeriod
      )
    )
  ) {
    // A newly verified current product supersedes any older paid change that was
    // waiting for renewal. This covers both the target taking effect and an
    // immediate upgrade selected while a lower tier was still pending.
    pendingPlanId = null;
    pendingBillingPeriod = null;
    pendingPlanEffectiveAt = null;
  }

  if (projection.status === 'expired') {
    return {
      ...projection,
      planId: 'free',
      billingPeriod: null,
      status: 'free',
      accessMode: normalizedSeatUsage <= 5 ? 'full' : 'read_only',
      seatLimit: 5,
      sourceStore: null,
      productIdentifier: null,
      currentPeriodEndsAt: null,
      gracePeriodExpiresAt: null,
      willRenew: false,
      managementURL: null,
      pendingPlanId: null,
      pendingBillingPeriod: null,
      pendingPlanEffectiveAt: null,
    };
  }

  const nextBilling = {
    ...projection,
    pendingPlanId,
    pendingBillingPeriod,
    pendingPlanEffectiveAt,
  };
  return {
    ...nextBilling,
    accessMode: accessModeForBillingAndSeatUsage(nextBilling, normalizedSeatUsage),
  };
}

function isLivePaidRevenueCatProjection(projection = {}) {
  return projection.planId !== 'free'
    && ['trialing', 'active', 'grace'].includes(projection.status);
}

function revenueCatCustomerDeletionDecision({
  aliasStatus,
  aliases = [],
  userId,
  subscriberStatus,
} = {}) {
  if (aliasStatus === 'not_found') {
    if (subscriberStatus && subscriberStatus !== 'not_found') {
      return { policy: 'manual_alias_review', basis: 'revenuecat_api_state_mismatch' };
    }
    return { policy: 'manual_alias_review', basis: 'post_auth_device_drain_required' };
  }
  if (aliasStatus !== 'verified') {
    return { policy: 'manual_alias_review', basis: 'authoritative_alias_set_unavailable' };
  }
  const customAliases = identityCandidates(aliases);
  if (!userId || !customAliases.includes(userId)) {
    return { policy: 'manual_alias_review', basis: 'deleting_user_not_in_alias_set' };
  }
  const survivingCustomAliases = customAliases.filter((alias) => alias !== userId);
  return survivingCustomAliases.length
    ? { policy: 'manual_alias_review', basis: 'surviving_custom_aliases' }
    : { policy: 'manual_alias_review', basis: 'post_auth_device_drain_required' };
}

function revenueCatProductChangeState({ eventType, eventProduct, projection = {} }) {
  if (eventType !== 'PRODUCT_CHANGE' || !eventProduct) return 'none';
  return eventProduct.planId === projection.planId
    && eventProduct.billingPeriod === projection.billingPeriod
    ? 'current'
    : 'pending';
}

function revenueCatMappingSnapshotIsCurrent({
  preloadedMapping = {},
  freshExists = false,
  freshData = {},
  documentId,
}) {
  if (!preloadedMapping.identity || documentId !== hashedDocumentId(preloadedMapping.identity)) return false;
  if (Boolean(preloadedMapping.exists) !== Boolean(freshExists)) return false;
  if (!freshExists) return true;
  const sameOptionalValue = (left, right) => (left ?? null) === (right ?? null);
  return sameOptionalValue(preloadedMapping.organizationId, freshData.organizationId)
    && sameOptionalValue(preloadedMapping.purchaserUserId, freshData.purchaserUserId)
    && sameOptionalValue(preloadedMapping.active, freshData.active)
    && sameOptionalValue(preloadedMapping.state, freshData.state);
}

function normalizeRevenueCatSnapshotValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (Array.isArray(value)) return value.map(normalizeRevenueCatSnapshotValue);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    normalizeRevenueCatSnapshotValue(value[key]),
  ]));
}

function revenueCatBillingSnapshotIsCurrent({
  preloadedExists = false,
  preloadedBilling = {},
  freshExists = false,
  freshBilling = {},
}) {
  if (Boolean(preloadedExists) !== Boolean(freshExists)) return false;
  if (!freshExists) return true;
  return JSON.stringify(normalizeRevenueCatSnapshotValue(preloadedBilling))
    === JSON.stringify(normalizeRevenueCatSnapshotValue(freshBilling));
}

function revenueCatMappingAllowsPaidRefresh({ mapping, organizationId, purchaserUserId }) {
  if (!mapping) return true;
  return mapping.organizationId === organizationId
    && mapping.purchaserUserId === purchaserUserId
    && mapping.active === true
    && mapping.state === 'active';
}

function identityCandidates(values) {
  const candidates = Array.isArray(values) ? values : [values];
  return [...new Set(candidates.filter((value) => (
    typeof value === 'string' && value && !value.startsWith('$RCAnonymousID:')
  )))];
}

function partitionRevenueCatTransferIdentities(event = {}) {
  return {
    fromCandidates: identityCandidates(event.transferred_from),
    toCandidates: identityCandidates(event.transferred_to),
  };
}

function webhookIdentityCandidates(event = {}) {
  return identityCandidates([
    event.app_user_id,
    event.original_app_user_id,
    ...identityCandidates(event.aliases),
    ...identityCandidates(event.transferred_from),
    ...identityCandidates(event.transferred_to),
  ]);
}

function deriveTransferredAwayOrganizationBilling({ billing = {}, seatUsage = 0 }) {
  const normalizedSeatUsage = Math.max(0, Math.floor(Number(seatUsage) || 0));
  const fitsFreePlan = normalizedSeatUsage <= 5;
  return {
    ...billing,
    planId: 'free',
    billingPeriod: null,
    status: fitsFreePlan ? 'free' : 'revoked',
    accessMode: fitsFreePlan ? 'full' : 'read_only',
    seatLimit: 5,
    purchaserUserId: null,
    sourceStore: null,
    productIdentifier: null,
    currentPeriodEndsAt: null,
    gracePeriodExpiresAt: null,
    willRenew: false,
    managementURL: null,
    pendingPlanId: null,
    pendingBillingPeriod: null,
    pendingPlanEffectiveAt: null,
    purchaseIntent: null,
  };
}

function activeRevenueCatPayerMustResolveSubscription(billing = {}, userId) {
  if (!userId || billing.purchaserUserId !== userId) return false;
  if (!billing.planId || billing.planId === 'free') return false;
  return ['trialing', 'active', 'grace'].includes(billing.status);
}

function activeRevenueCatStoreIntentForUser(billing = {}, userId, nowMs = Date.now()) {
  const intent = billing.purchaseIntent;
  const createdAtMs = Number(intent?.createdAtMs);
  return Boolean(
    userId
    && intent?.purchaserUserId === userId
    && Number.isFinite(createdAtMs)
    && createdAtMs <= nowMs + 60_000
    && createdAtMs > nowMs - REVENUECAT_STORE_INTENT_TTL_MS
  );
}

function revenueCatMappingCanMutateBilling({ mapping = {}, billing = {}, organizationId } = {}) {
  const expectedPayerId = billing.purchaseIntent?.purchaserUserId || billing.purchaserUserId || null;
  return mapping.active !== false
    && typeof organizationId === 'string'
    && organizationId.length > 0
    && mapping.organizationId === organizationId
    && typeof mapping.purchaserUserId === 'string'
    && mapping.purchaserUserId.length > 0
    && mapping.purchaserUserId === expectedPayerId;
}

function hashedDocumentId(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function fetchRevenueCatSubscriber({ appUserId, secretApiKey, fetchImpl = fetch }) {
  if (!appUserId || !secretApiKey) throw new Error('RevenueCat server verification is not configured.');
  const response = await fetchImpl(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${secretApiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!response.ok) throw new Error(`RevenueCat subscriber verification failed with HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload?.subscriber) throw new Error('RevenueCat subscriber verification returned an invalid response.');
  return payload.subscriber;
}

function revenueCatV2CustomerUrl({ projectId, customerId, suffix = '' }) {
  if (!projectId || !customerId) throw new Error('RevenueCat API v2 customer identity is not configured.');
  return `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(customerId)}${suffix}`;
}

async function fetchRevenueCatCustomerAliases({
  customerId,
  projectId,
  secretApiKey,
  fetchImpl = fetch,
}) {
  if (!secretApiKey) throw new Error('RevenueCat API v2 alias verification is not configured.');
  const baseUrl = revenueCatV2CustomerUrl({ projectId, customerId, suffix: '/aliases' });
  let nextUrl = `${baseUrl}?limit=100`;
  const aliases = [];
  for (let page = 0; page < 100 && nextUrl; page += 1) {
    const response = await fetchImpl(nextUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${secretApiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return { status: 'not_found', aliases: [] };
    if (!response.ok) throw new Error(`RevenueCat API v2 alias verification failed with HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload?.object !== 'list' || !Array.isArray(payload.items)) {
      throw new Error('RevenueCat API v2 alias verification returned an invalid response.');
    }
    aliases.push(...payload.items.map((item) => item?.id).filter((id) => typeof id === 'string' && id));
    if (!payload.next_page) return { status: 'verified', aliases: [...new Set(aliases)] };
    const resolvedNextUrl = new URL(payload.next_page, 'https://api.revenuecat.com').toString();
    if (!resolvedNextUrl.startsWith(`${baseUrl}?`)) {
      throw new Error('RevenueCat API v2 alias pagination returned an unexpected URL.');
    }
    nextUrl = resolvedNextUrl;
  }
  throw new Error('RevenueCat API v2 alias verification exceeded the pagination limit.');
}

module.exports = {
  PRODUCT_CATALOG,
  REVENUECAT_ENTITLEMENT_ID,
  REVENUECAT_OFFERING_ID,
  REVENUECAT_STORE_INTENT_TTL_MS,
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
  validateRevenueCatSubscriberEnvironment,
  validateRevenueCatPurchaseStoreEnvironment,
  validateRevenueCatWebhookEnvironment,
  verifyRevenueCatWebhookSignature,
  webhookIdentityCandidates,
};
