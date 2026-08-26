const WORKER_ACTIVE_STATUSES = new Set([
  'active',
  'pending',
  'created',
  'delivery_queued',
  'delivered',
  'delivery_failed',
  'pending_acceptance',
]);

const MANAGER_ACTIVE_STATUSES = new Set(['active', 'pending']);

class LegacyInviteOrganizationConflictError extends Error {
  constructor(organizationIds, sourceInvites) {
    super('Eligible legacy invitations belong to more than one organization.');
    this.name = 'LegacyInviteOrganizationConflictError';
    this.code = 'legacy-invite-organization-conflict';
    this.organizationIds = [...organizationIds];
    this.sourceInvites = [...sourceInvites];
  }
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Keep Firebase Auth account identities exact after case/whitespace normalization.
// Plus-addressed accounts are intentionally not collapsed into another address.
function canonicalizeEmail(value) {
  return normalizeEmail(value);
}

function normalizeIdentifier(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampMillis(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  if (typeof value?.toMillis === 'function') {
    const milliseconds = value.toMillis();
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }

  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : null;
  }

  if (Number.isFinite(value?.seconds)) {
    const nanoseconds = Number.isFinite(value.nanoseconds) ? value.nanoseconds : 0;
    return (value.seconds * 1000) + Math.floor(nanoseconds / 1_000_000);
  }

  return null;
}

function invitationEmail(invite) {
  return canonicalizeEmail(
    invite?.canonicalEmail
      || invite?.normalizedEmail
      || invite?.email
      || invite?.deliveryEmail
  );
}

function isUnexpired(invite, nowMs) {
  if (invite?.expiresAt === null || invite?.expiresAt === undefined) return true;
  const expiresAtMs = timestampMillis(invite.expiresAt);
  return expiresAtMs !== null && expiresAtMs > nowMs;
}

function isAvailableToUser(invite, inviteKind, userId) {
  const bindingFields = inviteKind === 'manager'
    ? ['managerUserId', 'boundUserId', 'claimedByUserId']
    : ['workerId', 'boundUserId', 'claimedByUserId'];

  return bindingFields.every((field) => {
    const boundUserId = normalizeIdentifier(invite?.[field]);
    return !boundUserId || boundUserId === userId;
  });
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareSourceInvites(left, right) {
  return compareText(left.collection, right.collection)
    || compareText(left.inviteId, right.inviteId)
    || compareText(left.organizationId, right.organizationId)
    || compareText(left.teamId || '', right.teamId || '');
}

function normalizeEligibleInvite(invite, inviteKind, authIdentity, userId, nowMs) {
  if (!invite || typeof invite !== 'object') return null;
  if (invite.claimRequired === true) return null;

  const status = typeof invite.status === 'string' ? invite.status.trim().toLowerCase() : '';
  const allowedStatuses = inviteKind === 'manager' ? MANAGER_ACTIVE_STATUSES : WORKER_ACTIVE_STATUSES;
  if (!allowedStatuses.has(status)) return null;
  if (invitationEmail(invite) !== authIdentity) return null;
  if (!isUnexpired(invite, nowMs)) return null;
  if (!isAvailableToUser(invite, inviteKind, userId)) return null;

  const inviteId = normalizeIdentifier(invite.id);
  const organizationId = normalizeIdentifier(invite.organizationId);
  const inviterId = normalizeIdentifier(
    inviteKind === 'manager' ? invite.inviterId : invite.managerId
  );
  if (!inviteId || !organizationId || !inviterId) return null;

  return {
    collection: inviteKind === 'manager' ? 'managerInvites' : 'workerInvites',
    inviteId,
    inviteKind,
    organizationId,
    inviterId,
    teamId: inviteKind === 'worker' ? (normalizeIdentifier(invite.teamId) || null) : null,
  };
}

function selectEligibleLegacyInvites({
  authEmail,
  userId,
  workerInvites = [],
  managerInvites = [],
  nowMs = Date.now(),
} = {}) {
  const authIdentity = canonicalizeEmail(authEmail);
  const normalizedUserId = normalizeIdentifier(userId);
  if (!authIdentity || !normalizedUserId || !Number.isFinite(nowMs)) return [];

  const eligibleInvites = [];
  for (const invite of Array.isArray(workerInvites) ? workerInvites : []) {
    const normalized = normalizeEligibleInvite(invite, 'worker', authIdentity, normalizedUserId, nowMs);
    if (normalized) eligibleInvites.push(normalized);
  }
  for (const invite of Array.isArray(managerInvites) ? managerInvites : []) {
    const normalized = normalizeEligibleInvite(invite, 'manager', authIdentity, normalizedUserId, nowMs);
    if (normalized) eligibleInvites.push(normalized);
  }

  return eligibleInvites.sort(compareSourceInvites);
}

function buildLegacyInviteAdoptionPlan(params = {}) {
  const normalizedEmail = normalizeEmail(params.authEmail);
  const canonicalEmail = canonicalizeEmail(params.authEmail);
  const sourceInvites = selectEligibleLegacyInvites(params);
  if (sourceInvites.length === 0) return null;

  const organizationIds = [...new Set(sourceInvites.map((invite) => invite.organizationId))]
    .sort(compareText);
  if (organizationIds.length > 1) {
    throw new LegacyInviteOrganizationConflictError(organizationIds, sourceInvites);
  }

  const targetRole = sourceInvites.some((invite) => invite.inviteKind === 'manager')
    ? 'manager'
    : 'worker';
  const teamIds = targetRole === 'worker'
    ? [...new Set(
      sourceInvites
        .map((invite) => invite.teamId)
        .filter(Boolean)
    )].sort(compareText)
    : [];

  return {
    normalizedEmail,
    canonicalEmail,
    organizationId: organizationIds[0],
    targetRole,
    teamIds,
    sourceInvites,
  };
}

module.exports = {
  LegacyInviteOrganizationConflictError,
  buildLegacyInviteAdoptionPlan,
  canonicalizeEmail,
  normalizeEmail,
  selectEligibleLegacyInvites,
  timestampMillis,
};
