const crypto = require('node:crypto');

const PLAN_MEMBER_CAPS = Object.freeze({
  free: 5,
  crew: 20,
  production: 50,
  organization: 100,
  enterprise: null,
});

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function acceptedMemberIds(organization = {}) {
  return uniqueStrings([
    ...uniqueStrings(organization.managerIds),
    ...uniqueStrings(organization.workerIds),
  ]);
}

function mergeAcceptedOrganizationProfiles(organization = {}, profiles = []) {
  const managerIds = uniqueStrings(organization.managerIds);
  const workerIds = uniqueStrings(organization.workerIds);
  (Array.isArray(profiles) ? profiles : []).forEach((profile) => {
    const userId = typeof profile?.uid === 'string' ? profile.uid.trim()
      : typeof profile?.id === 'string' ? profile.id.trim()
        : '';
    const role = typeof profile?.role === 'string' ? profile.role.trim().toLowerCase() : '';
    if (!userId) return;
    if (role === 'manager') managerIds.push(userId);
    if (role === 'worker') workerIds.push(userId);
  });
  return {
    ...organization,
    managerIds: uniqueStrings(managerIds),
    workerIds: uniqueStrings(workerIds),
  };
}

function reservationExpiryMillis(reservation) {
  const value = reservation?.expiresAtMs ?? reservation?.expiresAt;
  if (Number.isFinite(value)) return Number(value);
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  return 0;
}

function activeSeatReservations(reservations, nowMs = Date.now()) {
  return Object.fromEntries(Object.entries(
    reservations && typeof reservations === 'object' ? reservations : {}
  ).filter(([, reservation]) => reservationExpiryMillis(reservation) > nowMs));
}

function seatReservationKey(deliveryEmail) {
  const email = typeof deliveryEmail === 'string' ? deliveryEmail.trim().toLowerCase() : '';
  return crypto.createHash('sha256').update(email).digest('hex');
}

function currentMemberCapForBilling(billing = {}) {
  if (billing.planId === 'enterprise') {
    return Number.isFinite(billing.seatLimit) ? Math.max(0, Math.floor(billing.seatLimit)) : null;
  }
  return PLAN_MEMBER_CAPS[billing.planId] ?? PLAN_MEMBER_CAPS.free;
}

function memberCapForBilling(billing = {}) {
  const currentCap = currentMemberCapForBilling(billing);
  const pendingCap = billing.pendingPlanId === 'enterprise'
    ? null
    : PLAN_MEMBER_CAPS[billing.pendingPlanId];
  if (!Number.isFinite(pendingCap)) return currentCap;
  if (!Number.isFinite(currentCap)) return pendingCap;
  return Math.min(currentCap, pendingCap);
}

function accessModeForBillingAndSeatUsage(billing = {}, seatUsage = 0) {
  const normalizedSeatUsage = Math.max(0, Math.floor(Number(seatUsage) || 0));
  const currentCap = currentMemberCapForBilling(billing);
  const capacityFits = currentCap === null || normalizedSeatUsage <= currentCap;
  const writableLifecycle = billing.planId === 'free'
    ? billing.status === 'free'
    : ['trialing', 'active', 'grace'].includes(billing.status);
  return writableLifecycle && capacityFits ? 'full' : 'read_only';
}

function defaultOrganizationBilling(nowMs = Date.now()) {
  return {
    schemaVersion: 1,
    planId: 'free',
    status: 'free',
    accessMode: 'full',
    seatLimit: PLAN_MEMBER_CAPS.free,
    seatReservations: {},
    purchaserUserId: null,
    sourceStore: null,
    willRenew: false,
    pendingPlanId: null,
    pendingPlanEffectiveAt: null,
    initializedAtMs: nowMs,
  };
}

function calculateSeatUsage({ organization, billing, nowMs = Date.now(), customerBeta = false }) {
  const acceptedIds = acceptedMemberIds(organization);
  const reservations = activeSeatReservations(billing?.seatReservations, nowMs);
  const reservedSeats = Object.keys(reservations).length;
  const memberCap = customerBeta ? null : memberCapForBilling(billing);
  const seatUsage = acceptedIds.length + reservedSeats;
  return {
    acceptedMemberIds: acceptedIds,
    acceptedSeats: acceptedIds.length,
    reservations,
    reservedSeats,
    seatUsage,
    memberCap,
    remainingSeats: memberCap === null ? null : Math.max(0, memberCap - seatUsage),
    isAtLimit: memberCap !== null && seatUsage === memberCap,
    isOverLimit: memberCap !== null && seatUsage > memberCap,
  };
}

function reserveInvitationSeat({
  organization,
  billing,
  deliveryEmail,
  inviteHash,
  inviteKind,
  sourceInviteId,
  expiresAtMs,
  nowMs = Date.now(),
  customerBeta = false,
}) {
  const baseBilling = billing && typeof billing === 'object'
    ? { ...defaultOrganizationBilling(nowMs), ...billing }
    : defaultOrganizationBilling(nowMs);
  const usage = calculateSeatUsage({ organization, billing: baseBilling, nowMs, customerBeta });
  const reservationId = seatReservationKey(deliveryEmail);
  const replacesExistingReservation = Boolean(usage.reservations[reservationId]);

  if (!replacesExistingReservation && usage.memberCap !== null && usage.seatUsage >= usage.memberCap) {
    return {
      ok: false,
      code: 'capacity-exceeded',
      message: `This organization has used all ${usage.memberCap} member seats. Upgrade the plan before inviting another person.`,
      ...usage,
    };
  }

  const seatReservations = {
    ...usage.reservations,
    [reservationId]: {
      inviteHash,
      sourceInviteId,
      inviteKind,
      expiresAtMs,
    },
  };
  const nextBilling = {
    ...baseBilling,
    seatLimit: currentMemberCapForBilling(baseBilling),
    seatReservations,
  };
  return {
    ok: true,
    reservationId,
    replacesExistingReservation,
    billing: nextBilling,
    ...calculateSeatUsage({ organization, billing: nextBilling, nowMs, customerBeta }),
  };
}

function releaseInvitationSeat({ billing, deliveryEmail, nowMs = Date.now() }) {
  const baseBilling = billing && typeof billing === 'object'
    ? { ...defaultOrganizationBilling(nowMs), ...billing }
    : defaultOrganizationBilling(nowMs);
  const seatReservations = activeSeatReservations(baseBilling.seatReservations, nowMs);
  delete seatReservations[seatReservationKey(deliveryEmail)];
  return { ...baseBilling, seatReservations };
}

module.exports = {
  PLAN_MEMBER_CAPS,
  acceptedMemberIds,
  activeSeatReservations,
  accessModeForBillingAndSeatUsage,
  calculateSeatUsage,
  currentMemberCapForBilling,
  defaultOrganizationBilling,
  memberCapForBilling,
  mergeAcceptedOrganizationProfiles,
  releaseInvitationSeat,
  reserveInvitationSeat,
  seatReservationKey,
};
