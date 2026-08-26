const assert = require('node:assert/strict');
const test = require('node:test');
const {
  LegacyInviteOrganizationConflictError,
  buildLegacyInviteAdoptionPlan,
  canonicalizeEmail,
  normalizeEmail,
  selectEligibleLegacyInvites,
  timestampMillis,
} = require('../lib/legacy-invites');

const NOW_MS = Date.parse('2026-08-25T12:00:00.000Z');
const FUTURE_MS = NOW_MS + 60_000;

function workerInvite(overrides = {}) {
  return {
    id: 'worker-1',
    managerId: 'manager-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    email: 'person@example.com',
    status: 'pending_acceptance',
    expiresAt: new Date(FUTURE_MS),
    ...overrides,
  };
}

function managerInvite(overrides = {}) {
  return {
    id: 'manager-1',
    inviterId: 'manager-1',
    organizationId: 'org-1',
    normalizedEmail: 'person@example.com',
    status: 'pending',
    ...overrides,
  };
}

test('normalizes auth email without collapsing a plus-addressed Firebase identity', () => {
  assert.equal(normalizeEmail('  Person+Crew@Example.COM '), 'person+crew@example.com');
  assert.equal(canonicalizeEmail('  Person+Crew@Example.COM '), 'person+crew@example.com');
  assert.notEqual(canonicalizeEmail('person+crew@example.com'), canonicalizeEmail('person@example.com'));
});

test('selects unclaimed active worker and pending manager invites for the auth identity', () => {
  const result = selectEligibleLegacyInvites({
    authEmail: ' PERSON@example.com ',
    userId: 'user-1',
    nowMs: NOW_MS,
    workerInvites: [
      workerInvite({ id: 'worker-delivered', status: 'delivered' }),
      workerInvite({ id: 'worker-active', status: 'active', workerId: 'user-1' }),
    ],
    managerInvites: [managerInvite()],
  });

  assert.deepEqual(result, [
    {
      collection: 'managerInvites',
      inviteId: 'manager-1',
      inviteKind: 'manager',
      organizationId: 'org-1',
      inviterId: 'manager-1',
      teamId: null,
    },
    {
      collection: 'workerInvites',
      inviteId: 'worker-active',
      inviteKind: 'worker',
      organizationId: 'org-1',
      inviterId: 'manager-1',
      teamId: 'team-1',
    },
    {
      collection: 'workerInvites',
      inviteId: 'worker-delivered',
      inviteKind: 'worker',
      organizationId: 'org-1',
      inviterId: 'manager-1',
      teamId: 'team-1',
    },
  ]);
});

test('rejects secure, terminal, expired, malformed, mismatched, and cross-user invites', () => {
  const result = selectEligibleLegacyInvites({
    authEmail: 'person@example.com',
    userId: 'user-1',
    nowMs: NOW_MS,
    workerInvites: [
      workerInvite({ id: 'secure', claimRequired: true }),
      workerInvite({ id: 'accepted', status: 'accepted' }),
      workerInvite({ id: 'expired', expiresAt: new Date(NOW_MS) }),
      workerInvite({ id: 'invalid-expiry', expiresAt: 'tomorrow' }),
      workerInvite({ id: 'different-email', email: 'else@example.com' }),
      workerInvite({ id: 'different-user', workerId: 'user-2' }),
      workerInvite({ id: 'missing-org', organizationId: null }),
      workerInvite({ id: 'missing-inviter', managerId: null }),
      workerInvite({ id: '', organizationId: 'org-1' }),
    ],
    managerInvites: [
      managerInvite({ id: 'declined', status: 'declined' }),
      managerInvite({ id: 'different-manager', managerUserId: 'user-2' }),
      managerInvite({ id: 'missing-inviter', inviterId: null }),
    ],
  });

  assert.deepEqual(result, []);
});

test('accepts legacy invitations without an expiry and supported Firestore timestamp shapes', () => {
  const result = selectEligibleLegacyInvites({
    authEmail: 'person@example.com',
    userId: 'user-1',
    nowMs: NOW_MS,
    workerInvites: [
      workerInvite({ id: 'no-expiry', expiresAt: null }),
      workerInvite({ id: 'to-millis', expiresAt: { toMillis: () => FUTURE_MS } }),
      workerInvite({ id: 'to-date', expiresAt: { toDate: () => new Date(FUTURE_MS) } }),
      workerInvite({ id: 'seconds', expiresAt: { seconds: Math.floor(FUTURE_MS / 1000), nanoseconds: 0 } }),
    ],
  });

  assert.deepEqual(result.map((invite) => invite.inviteId), [
    'no-expiry',
    'seconds',
    'to-date',
    'to-millis',
  ]);
  assert.equal(timestampMillis({ seconds: 2, nanoseconds: 500_000_000 }), 2500);
});

test('builds a deterministic worker adoption plan with sorted unique teams and sources', () => {
  const plan = buildLegacyInviteAdoptionPlan({
    authEmail: ' PERSON@example.com ',
    userId: 'user-1',
    nowMs: NOW_MS,
    workerInvites: [
      workerInvite({ id: 'z-invite', teamId: 'team-z' }),
      workerInvite({ id: 'a-invite', teamId: 'team-a', status: 'created' }),
      workerInvite({ id: 'b-invite', teamId: 'team-a', status: 'delivery_queued' }),
    ],
  });

  assert.deepEqual(plan, {
    normalizedEmail: 'person@example.com',
    canonicalEmail: 'person@example.com',
    organizationId: 'org-1',
    targetRole: 'worker',
    teamIds: ['team-a', 'team-z'],
    sourceInvites: [
      {
        collection: 'workerInvites',
        inviteId: 'a-invite',
        inviteKind: 'worker',
        organizationId: 'org-1',
        inviterId: 'manager-1',
        teamId: 'team-a',
      },
      {
        collection: 'workerInvites',
        inviteId: 'b-invite',
        inviteKind: 'worker',
        organizationId: 'org-1',
        inviterId: 'manager-1',
        teamId: 'team-a',
      },
      {
        collection: 'workerInvites',
        inviteId: 'z-invite',
        inviteKind: 'worker',
        organizationId: 'org-1',
        inviterId: 'manager-1',
        teamId: 'team-z',
      },
    ],
  });
});

test('manager adoption takes role precedence and does not add manager accounts as team workers', () => {
  const plan = buildLegacyInviteAdoptionPlan({
    authEmail: 'person@example.com',
    userId: 'user-1',
    nowMs: NOW_MS,
    workerInvites: [workerInvite()],
    managerInvites: [managerInvite()],
  });

  assert.equal(plan.targetRole, 'manager');
  assert.deepEqual(plan.teamIds, []);
  assert.deepEqual(plan.sourceInvites.map((invite) => invite.inviteKind), ['manager', 'worker']);
});

test('returns null when no eligible legacy invitation exists', () => {
  assert.equal(buildLegacyInviteAdoptionPlan({
    authEmail: 'person@example.com',
    userId: 'user-1',
    nowMs: NOW_MS,
    workerInvites: [workerInvite({ claimRequired: true })],
  }), null);

  assert.equal(buildLegacyInviteAdoptionPlan({
    authEmail: '',
    userId: 'user-1',
    nowMs: NOW_MS,
    workerInvites: [workerInvite()],
  }), null);
});

test('reports deterministic conflict evidence when eligible invites span organizations', () => {
  assert.throws(
    () => buildLegacyInviteAdoptionPlan({
      authEmail: 'person@example.com',
      userId: 'user-1',
      nowMs: NOW_MS,
      workerInvites: [workerInvite({ id: 'worker-2', organizationId: 'org-z' })],
      managerInvites: [managerInvite({ id: 'manager-2', organizationId: 'org-a' })],
    }),
    (error) => {
      assert.ok(error instanceof LegacyInviteOrganizationConflictError);
      assert.equal(error.code, 'legacy-invite-organization-conflict');
      assert.deepEqual(error.organizationIds, ['org-a', 'org-z']);
      assert.deepEqual(
        error.sourceInvites.map((invite) => `${invite.collection}/${invite.inviteId}`),
        ['managerInvites/manager-2', 'workerInvites/worker-2']
      );
      return true;
    }
  );
});
