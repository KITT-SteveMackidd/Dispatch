const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planOrganizationMemberRemoval,
  removeOrganizationMemberFromChatThread,
} = require('../lib/organization-membership');

function baseOrganization(overrides = {}) {
  return {
    id: 'org-1',
    name: 'Show Crew',
    managerIds: ['billing-manager', 'manager-2'],
    workerIds: ['worker-1', 'worker-2'],
    billingManagerId: 'billing-manager',
    createdBy: 'billing-manager',
    customPolicy: { retain: true },
    ...overrides,
  };
}

function removal(overrides = {}) {
  return planOrganizationMemberRemoval({
    organization: baseOrganization(),
    callerId: 'billing-manager',
    targetUserId: 'worker-1',
    targetUser: { uid: 'worker-1', role: 'worker', organizationId: 'org-1' },
    verifiedLivePaidPurchaserId: null,
    ...overrides,
  });
}

test('plans worker removal without mutating the organization and preserves unrelated fields', () => {
  const organization = baseOrganization({
    managerIds: ['manager-2', 'billing-manager', 'manager-2'],
    workerIds: ['worker-2', ' worker-1 ', 'worker-1'],
  });
  const original = structuredClone(organization);

  const result = removal({ organization });

  assert.equal(result.ok, true);
  assert.equal(result.currentBillingManagerId, 'billing-manager');
  assert.equal(result.callerId, 'billing-manager');
  assert.equal(result.targetUserId, 'worker-1');
  assert.equal(result.targetRole, 'worker');
  assert.deepEqual(result.target, {
    userId: 'worker-1',
    role: 'worker',
    organizationId: 'org-1',
  });
  assert.deepEqual(result.managerIds, ['billing-manager', 'manager-2']);
  assert.deepEqual(result.workerIds, ['worker-2']);
  assert.deepEqual(result.organizationUpdate, {
    managerIds: ['billing-manager', 'manager-2'],
    workerIds: ['worker-2'],
  });
  assert.deepEqual(result.nextOrganization, {
    ...organization,
    managerIds: ['billing-manager', 'manager-2'],
    workerIds: ['worker-2'],
  });
  assert.deepEqual(result.nextOrganization.customPolicy, { retain: true });
  assert.deepEqual(organization, original);
});

test('plans removal of a non-billing Manager while retaining another Manager', () => {
  const result = removal({
    targetUserId: 'manager-2',
    targetUser: { id: 'manager-2', role: ' Manager ', organizationId: 'org-1' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.targetRole, 'manager');
  assert.deepEqual(result.managerIds, ['billing-manager']);
  assert.deepEqual(result.workerIds, ['worker-1', 'worker-2']);
});

test('cleans the target from both membership arrays when a legacy record contains both roles', () => {
  const result = removal({
    organization: baseOrganization({
      managerIds: ['billing-manager', 'manager-2'],
      workerIds: ['manager-2', 'worker-1'],
    }),
    targetUserId: 'manager-2',
    targetUser: { uid: 'manager-2', role: 'manager', organizationId: 'org-1' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.managerIds, ['billing-manager']);
  assert.deepEqual(result.workerIds, ['worker-1']);
});

test('rejects callers who are not the resolved Billing Manager before target validation', () => {
  assert.deepEqual(removal({ callerId: 'manager-2', targetUser: null }), {
    ok: false,
    code: 'permission-denied',
    reason: 'caller-not-billing-manager',
    message: 'Only the current Billing Manager can remove an organization member.',
  });
});

test('supports the deterministic legacy Billing Manager fallback', () => {
  const organization = baseOrganization({
    billingManagerId: undefined,
    createdBy: 'former-manager',
    managerIds: ['manager-z', 'manager-a'],
    workerIds: ['worker-1'],
  });
  const result = removal({ organization, callerId: 'manager-a' });

  assert.equal(result.ok, true);
  assert.equal(result.currentBillingManagerId, 'manager-a');
});

test('rejects a missing, mismatched, cross-organization, or invalid-role target', () => {
  const expected = {
    ok: false,
    code: 'failed-precondition',
    reason: 'target-not-active-member',
    message: 'The selected account is not an active member of this organization.',
  };

  assert.deepEqual(removal({ targetUser: null }), expected);
  assert.deepEqual(removal({
    targetUser: { uid: 'worker-2', role: 'worker', organizationId: 'org-1' },
  }), expected);
  assert.deepEqual(removal({
    targetUser: { uid: 'worker-1', role: 'worker', organizationId: 'org-2' },
  }), expected);
  assert.deepEqual(removal({
    targetUser: { uid: 'worker-1', role: 'owner', organizationId: 'org-1' },
  }), expected);
});

test('can remove a legacy active profile missing from organization arrays', () => {
  const result = removal({
    targetUserId: 'worker-3',
    targetUser: { uid: 'worker-3', role: 'worker', organizationId: 'org-1' },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.workerIds, ['worker-1', 'worker-2']);
});

test('uses the authoritative profile role while cleaning inconsistent legacy arrays', () => {
  const result = removal({
    targetUserId: 'manager-2',
    targetUser: { uid: 'manager-2', role: 'worker', organizationId: 'org-1' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.targetRole, 'worker');
  assert.deepEqual(result.managerIds, ['billing-manager']);
});

test('blocks removing the sole Manager', () => {
  assert.deepEqual(removal({
    organization: baseOrganization({
      managerIds: ['billing-manager'],
      workerIds: ['worker-1'],
    }),
    targetUserId: 'billing-manager',
    targetUser: { uid: 'billing-manager', role: 'manager', organizationId: 'org-1' },
  }), {
    ok: false,
    code: 'failed-precondition',
    reason: 'target-is-sole-manager',
    message: 'The organization must retain at least one active Manager.',
  });
});

test('blocks removing the current Billing Manager when another Manager remains', () => {
  assert.deepEqual(removal({
    targetUserId: 'billing-manager',
    targetUser: { uid: 'billing-manager', role: 'manager', organizationId: 'org-1' },
  }), {
    ok: false,
    code: 'failed-precondition',
    reason: 'target-is-billing-manager',
    message: 'Transfer the Billing Manager role before removing this Manager.',
  });
});

test('blocks only the explicitly verified live paid purchaser', () => {
  assert.deepEqual(removal({ verifiedLivePaidPurchaserId: 'worker-1' }), {
    ok: false,
    code: 'failed-precondition',
    reason: 'target-is-live-paid-purchaser',
    message: 'The verified live store purchaser cannot be removed until paid access ends.',
  });

  assert.equal(removal({ verifiedLivePaidPurchaserId: 'worker-2' }).ok, true);
  assert.equal(removal({ verifiedLivePaidPurchaserId: null }).ok, true);
});

test('normalizes caller and target identifiers for deterministic transaction output', () => {
  const result = removal({
    callerId: ' billing-manager ',
    targetUserId: ' worker-1 ',
    targetUser: { uid: ' worker-1 ', role: ' WORKER ', organizationId: ' org-1 ' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.callerId, 'billing-manager');
  assert.equal(result.targetUserId, 'worker-1');
  assert.deepEqual(result.workerIds, ['worker-2']);
});

test('removes a former member from chat authorization state while preserving other participants', () => {
  assert.deepEqual(removeOrganizationMemberFromChatThread({
    participants: ['manager-1', ' worker-1 ', 'manager-1', 'worker-2'],
    pushSeenBy: ['worker-1', 'worker-2', ' worker-1 '],
  }, ' worker-1 '), {
    participants: ['manager-1', 'worker-2'],
    pushSeenBy: ['worker-2'],
  });

  assert.deepEqual(removeOrganizationMemberFromChatThread({}, 'worker-1'), {
    participants: [],
    pushSeenBy: [],
  });
});
