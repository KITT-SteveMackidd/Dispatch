const test = require('node:test');
const assert = require('node:assert/strict');
const {
  accessModeForBillingAndSeatUsage,
  acceptedMemberIds,
  calculateSeatUsage,
  mergeAcceptedOrganizationProfiles,
  defaultOrganizationBilling,
  releaseInvitationSeat,
  reserveInvitationSeat,
} = require('../lib/subscriptions');

test('counts accepted profile members that are missing from legacy organization arrays', () => {
  const organization = mergeAcceptedOrganizationProfiles(
    { managerIds: ['manager-1'], workerIds: [] },
    [
      { uid: 'manager-1', role: 'manager' },
      { uid: 'worker-legacy', role: 'worker' },
      { uid: 'manager-legacy', role: 'Manager' },
    ]
  );
  assert.deepEqual(organization.managerIds.sort(), ['manager-1', 'manager-legacy']);
  assert.deepEqual(organization.workerIds, ['worker-legacy']);
  assert.equal(calculateSeatUsage({
    organization,
    billing: { planId: 'free', seatReservations: {} },
  }).acceptedSeats, 3);
});

const future = Date.parse('2030-01-01T00:00:00.000Z');
const now = Date.parse('2029-01-01T00:00:00.000Z');

test('counts each accepted organization member once across Manager and Worker lists', () => {
  assert.deepEqual(acceptedMemberIds({
    managerIds: ['manager', 'shared'],
    workerIds: ['worker', 'shared', 'worker'],
  }), ['manager', 'shared', 'worker']);
});

test('rejects a sixth occupied seat on Free without auto-upgrading', () => {
  const result = reserveInvitationSeat({
    organization: { managerIds: ['m1', 'm2'], workerIds: ['w1', 'w2', 'w3'] },
    billing: defaultOrganizationBilling(now),
    deliveryEmail: 'sixth@example.com',
    inviteHash: 'invite-6',
    sourceInviteId: 'source-6',
    inviteKind: 'worker',
    expiresAtMs: future,
    nowMs: now,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'capacity-exceeded');
  assert.equal(result.memberCap, 5);
});

test('replacing an invitation to the same address never reserves twice', () => {
  const first = reserveInvitationSeat({
    organization: { managerIds: ['m1'], workerIds: [] },
    billing: defaultOrganizationBilling(now),
    deliveryEmail: 'person@example.com',
    inviteHash: 'invite-1',
    sourceInviteId: 'source-1',
    inviteKind: 'worker',
    expiresAtMs: future,
    nowMs: now,
  });
  const replacement = reserveInvitationSeat({
    organization: { managerIds: ['m1'], workerIds: [] },
    billing: first.billing,
    deliveryEmail: 'PERSON@example.com',
    inviteHash: 'invite-2',
    sourceInviteId: 'source-2',
    inviteKind: 'manager',
    expiresAtMs: future,
    nowMs: now,
  });

  assert.equal(replacement.ok, true);
  assert.equal(replacement.replacesExistingReservation, true);
  assert.equal(replacement.reservedSeats, 1);
  assert.equal(replacement.seatUsage, 2);
});

test('expired and cancelled invitations release capacity', () => {
  const billing = {
    ...defaultOrganizationBilling(now),
    seatReservations: {
      expired: { expiresAtMs: now - 1 },
      active: { expiresAtMs: future },
    },
  };
  assert.equal(calculateSeatUsage({
    organization: { managerIds: ['m1'], workerIds: [] },
    billing,
    nowMs: now,
  }).reservedSeats, 1);

  const released = releaseInvitationSeat({
    billing: reserveInvitationSeat({
      organization: { managerIds: ['m1'], workerIds: [] },
      billing: defaultOrganizationBilling(now),
      deliveryEmail: 'cancel@example.com',
      inviteHash: 'invite',
      sourceInviteId: 'source',
      inviteKind: 'worker',
      expiresAtMs: future,
      nowMs: now,
    }).billing,
    deliveryEmail: 'cancel@example.com',
    nowMs: now,
  });
  assert.equal(Object.keys(released.seatReservations).length, 0);
  assert.equal(accessModeForBillingAndSeatUsage(released, 5), 'full');
});

test('a scheduled lower tier immediately locks new seat growth without ending current paid access', () => {
  const billing = {
    ...defaultOrganizationBilling(now),
    planId: 'production',
    status: 'active',
    seatLimit: 50,
    pendingPlanId: 'crew',
  };
  const atTargetCap = calculateSeatUsage({
    organization: { managerIds: ['manager'], workerIds: Array.from({ length: 19 }, (_, index) => `worker-${index}`) },
    billing,
    nowMs: now,
  });
  assert.equal(atTargetCap.memberCap, 20);
  assert.equal(atTargetCap.isAtLimit, true);
  assert.equal(accessModeForBillingAndSeatUsage(billing, 20), 'full');
  assert.equal(reserveInvitationSeat({
    organization: { managerIds: ['manager'], workerIds: Array.from({ length: 19 }, (_, index) => `worker-${index}`) },
    billing,
    deliveryEmail: 'growth@example.com',
    inviteHash: 'growth',
    sourceInviteId: 'source-growth',
    inviteKind: 'worker',
    expiresAtMs: future,
    nowMs: now,
  }).ok, false);
});

test('paid organizations fail closed when verified plan capacity is exceeded', () => {
  assert.equal(accessModeForBillingAndSeatUsage({ planId: 'crew', status: 'active' }, 20), 'full');
  assert.equal(accessModeForBillingAndSeatUsage({ planId: 'crew', status: 'active' }, 21), 'read_only');
  assert.equal(accessModeForBillingAndSeatUsage({ planId: 'production', status: 'grace' }, 51), 'read_only');
});
