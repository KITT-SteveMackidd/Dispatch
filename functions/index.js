const crypto = require('node:crypto');
const { logger, setGlobalOptions } = require('firebase-functions/v2');
const { onInit } = require('firebase-functions/v2/core');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const {
  deleteAllAuthUsers,
  deleteAllFirestoreCollections,
  isAuthorizedAdminEmail,
} = require('./lib/admin-reset');
const { deleteDispatchUserData } = require('./lib/account-deletion');
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
  rolePushContent,
  rolePushRecipientId,
  uniqueStrings,
} = require('./lib/push-content');
const {
  buildRoleNotificationState,
  roleNotificationStateChanged,
  roleStateFingerprint,
} = require('./lib/role-state');
const { lateTaskNotificationDocuments } = require('./lib/late-task-notifications');
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

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

let db;
let FieldValue;
let adminAuth;
let storageBucket;

const RECENT_AUTH_MAX_AGE_SECONDS = 5 * 60;

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

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function normalizedRole(value) {
  const role = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return role === 'manager' || role === 'worker' ? role : null;
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
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

function communicationThreadIds(organizationId, workerId) {
  return {
    organization: `organization:${organizationId}:all`,
    managers: `organization:${organizationId}:managers:${workerId}`,
  };
}

async function syncClaimedInvitationChats(organizationId) {
  const organizationRef = db.collection('organizations').doc(organizationId);
  const [organizationSnapshot, usersSnapshot, teamsSnapshot] = await Promise.all([
    organizationRef.get(),
    db.collection('users').where('organizationId', '==', organizationId).get(),
    db.collection('teams').where('organizationId', '==', organizationId).get(),
  ]);
  if (!organizationSnapshot.exists) return;

  const organization = organizationSnapshot.data();
  const users = usersSnapshot.docs.map((userDocument) => ({ id: userDocument.id, ...userDocument.data() }));
  const managerIds = [...new Set([
    ...(Array.isArray(organization.managerIds) ? organization.managerIds : []),
    ...users.filter((user) => normalizedRole(user.role) === 'manager').map((user) => user.id),
  ])];
  const workerIds = [...new Set([
    ...(Array.isArray(organization.workerIds) ? organization.workerIds : []),
    ...users.filter((user) => normalizedRole(user.role) === 'worker').map((user) => user.id),
  ])];
  const participantIds = [...new Set([...managerIds, ...workerIds])];
  const writes = [];

  if (participantIds.length) {
    const organizationThreadId = communicationThreadIds(organizationId, '').organization;
    writes.push(db.collection('chatThreads').doc(organizationThreadId).set({
      id: organizationThreadId,
      organizationId,
      title: organization.name || 'Organization',
      kind: 'organization',
      participants: participantIds,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
  }

  for (const workerId of workerIds) {
    const threadId = communicationThreadIds(organizationId, workerId).managers;
    const worker = users.find((user) => user.id === workerId);
    writes.push(db.collection('chatThreads').doc(threadId).set({
      id: threadId,
      organizationId,
      title: worker?.displayName || 'Worker',
      kind: 'manager',
      participants: [...new Set([workerId, ...managerIds])],
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
  }

  for (const teamDocument of teamsSnapshot.docs) {
    const team = teamDocument.data();
    const teamWorkerIds = Array.isArray(team.workerIds) ? team.workerIds : [];
    const teamParticipants = [...new Set([...managerIds, ...teamWorkerIds])];
    const threadId = `team:${teamDocument.id}:all`;
    writes.push(teamDocument.ref.set({
      managerIds,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    writes.push(db.collection('chatThreads').doc(threadId).set({
      id: threadId,
      teamId: teamDocument.id,
      organizationId,
      teamName: team.name || null,
      title: team.name || 'Team',
      kind: 'team',
      participants: teamParticipants,
      createdByTeamSync: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
  }

  await Promise.all(writes);
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
  if (teamId) {
    const teamSnapshot = await db.collection('teams').doc(teamId).get();
    if (!teamSnapshot.exists || teamSnapshot.data().organizationId !== organizationId) {
      throw new HttpsError('permission-denied', 'That Team is not part of your organization.');
    }
    team = { id: teamSnapshot.id, ...teamSnapshot.data() };
  }

  const { token, code } = generateInviteSecrets();
  const inviteHash = hashInviteToken(token);
  const codeHash = hashInviteCode(code);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const { webUrl, appUrl } = buildInviteUrls(token, process.env.DISPATCH_INVITE_BASE_URL);
  const inviteRef = db.collection('secureInvites').doc(inviteHash);
  const codeRef = db.collection('secureInviteCodes').doc(codeHash);
  const sourceRef = db.collection(inviteKind === 'worker' ? 'workerInvites' : 'managerInvites').doc();
  const mailRef = db.collection('mail').doc();
  const now = FieldValue.serverTimestamp();
  const organizationName = organization.name || caller.organizationName || 'Dispatch organization';
  const teamName = team?.name || null;

  const previousInvites = await db.collection('secureInvites').where('inviterId', '==', request.auth.uid).get();
  const batch = db.batch();
  previousInvites.docs
    .filter((document) => {
      const data = document.data();
      return data.status === 'active'
        && data.inviteKind === inviteKind
        && data.deliveryEmail === deliveryEmail
        && (data.teamId || null) === teamId;
    })
    .forEach((document) => {
      const previous = document.data();
      const revokedState = {
        status: 'revoked',
        statusReason: 'Replaced by a newer invitation.',
        revokedAt: now,
        updatedAt: now,
      };
      batch.set(document.ref, revokedState, { merge: true });
      if (previous.sourceCollection && previous.sourceInviteId) {
        batch.set(
          db.collection(previous.sourceCollection).doc(previous.sourceInviteId),
          revokedState,
          { merge: true }
        );
      }
      if (previous.codeHash) {
        batch.set(db.collection('secureInviteCodes').doc(previous.codeHash), revokedState, { merge: true });
      }
    });

  batch.set(inviteRef, {
    inviteKind,
    inviterId: request.auth.uid,
    inviterName: caller.displayName || 'A Dispatch manager',
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
  batch.set(codeRef, {
    inviteHash,
    status: 'active',
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  if (inviteKind === 'worker') {
    batch.set(sourceRef, {
      managerId: request.auth.uid,
      teamId,
      teamName: teamName || (teamId ? 'Dispatch Team' : 'Solo worker'),
      organizationId,
      organizationName,
      appLink: webUrl,
      deliveryEmail,
      workerId: null,
      claimRequired: true,
      secureInviteId: inviteHash,
      deliveryChannel: 'email',
      emailDelivery: 'firebase-mail-collection',
      status: 'delivery_queued',
      statusReason: 'Secure invitation link queued for email delivery.',
      sendCount: 1,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      lastSentAt: now,
    });
  } else {
    batch.set(sourceRef, {
      inviterId: request.auth.uid,
      organizationId,
      organizationName,
      deliveryEmail,
      managerUserId: null,
      claimRequired: true,
      secureInviteId: inviteHash,
      appLink: webUrl,
      status: 'pending',
      statusReason: 'Waiting for the recipient to claim this secure invitation.',
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
  }

  batch.set(mailRef, {
    ...buildSecureInviteEmail({
      deliveryEmail,
      inviteKind,
      organizationName,
      teamName,
      inviterName: caller.displayName,
      inviteId: sourceRef.id,
      webUrl,
      appUrl,
      code,
    }),
    createdAt: now,
  });
  await batch.commit();

  logger.info('Created secure Dispatch invitation.', {
    inviteKind,
    organizationId,
    teamId,
    inviterId: request.auth.uid,
    sourceInviteId: sourceRef.id,
  });
  return {
    inviteId: sourceRef.id,
    inviteCode: code,
    appLink: webUrl,
    expiresAt: expiresAt.toISOString(),
    deliveryQueued: true,
    reused: false,
  };
});

exports.getDispatchInvite = onCall({ maxInstances: 20 }, async (request) => {
  const resolved = await resolveSecureInvite(request.data?.tokenOrCode);
  if (!resolved) throw new HttpsError('not-found', 'This Dispatch invitation could not be found.');

  const invite = resolved.snapshot.data();
  if (invite.status === 'active' && timestampMillis(invite.expiresAt) <= Date.now()) {
    await resolved.ref.set({
      status: 'expired',
      statusReason: 'Invitation expired before it was claimed.',
      expiredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    invite.status = 'expired';
  }
  return invitationPreview(invite, request.auth?.uid || null);
});

exports.claimDispatchInvite = onCall({ maxInstances: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before joining this Dispatch invitation.');
  const resolved = await resolveSecureInvite(request.data?.tokenOrCode);
  if (!resolved) throw new HttpsError('not-found', 'This Dispatch invitation could not be found.');
  const authUser = await adminAuth.getUser(request.auth.uid);

  const claimResult = await db.runTransaction(async (transaction) => {
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
    const sourceRef = db.collection(invite.sourceCollection).doc(invite.sourceInviteId);
    const codeRef = db.collection('secureInviteCodes').doc(invite.codeHash);
    const refs = [organizationRef, userRef, sourceRef];
    const teamRef = invite.teamId ? db.collection('teams').doc(invite.teamId) : null;
    if (teamRef) refs.push(teamRef);
    const snapshots = await transaction.getAll(...refs);
    const organizationSnapshot = snapshots[0];
    const userSnapshot = snapshots[1];
    const sourceSnapshot = snapshots[2];
    const teamSnapshot = teamRef ? snapshots[3] : null;
    if (!organizationSnapshot.exists) throw new HttpsError('not-found', 'The invited organization no longer exists.');
    if (!sourceSnapshot.exists) throw new HttpsError('not-found', 'The underlying invitation no longer exists.');
    if (teamRef && (!teamSnapshot?.exists || teamSnapshot.data().organizationId !== invite.organizationId)) {
      throw new HttpsError('failed-precondition', 'The invited Team is no longer available.');
    }

    const source = sourceSnapshot.data();
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

    const organization = organizationSnapshot.data();
    const authEmail = normalizeEmail(authUser.email);
    const displayName = authUser.displayName?.trim()
      || existingUser?.displayName?.trim()
      || (authEmail.endsWith('@privaterelay.appleid.com') ? 'Dispatch User' : authEmail.split('@')[0])
      || 'Dispatch User';
    const now = FieldValue.serverTimestamp();
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
    transaction.set(codeRef, { status: 'claimed', claimedAt: now, updatedAt: now }, { merge: true });
    const notificationRef = db.collection('userNotifications').doc();
    transaction.set(notificationRef, {
      userId: invite.inviterId,
      kind: invite.inviteKind === 'manager' ? 'manager_organisation_invite' : 'worker_team_invite',
      title: `${targetRole === 'manager' ? 'Manager' : 'Worker'} invitation accepted`,
      body: `${displayName} joined ${invite.teamName || invite.organizationName || 'your organization'}.`,
      relatedRoleId: invite.sourceInviteId,
      read: false,
      createdAt: now,
    });

    return { ...invitationPreview({ ...invite, status: 'claimed', claimedBy: request.auth.uid }, request.auth.uid), organizationId: invite.organizationId, teamId: invite.teamId || null };
  });

  await syncClaimedInvitationChats(claimResult.organizationId).catch((error) => {
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

exports.resetDispatchDatabase = onCall({
  maxInstances: 1,
  timeoutSeconds: 540,
  memory: '1GiB',
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to reset Dispatch.');
  }

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
  const appleProvider = authUser.providerData.find((provider) => provider.providerId === 'apple.com');
  let appleAuthorizationRevoked = false;

  if (appleProvider) {
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

  let cleanup;
  try {
    cleanup = await deleteDispatchUserData({
      db,
      bucket: storageBucket,
      FieldValue,
      authUser,
    });
  } catch (error) {
    logger.error('Dispatch account data cleanup failed.', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw new HttpsError(
      'internal',
      'Account deletion could not be completed. Your sign-in account remains active; please try again.'
    );
  }

  try {
    await adminAuth.deleteUser(authUser.uid);
  } catch (error) {
    logger.error('Firebase Auth deletion failed after Dispatch data cleanup.', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw new HttpsError(
      'internal',
      'Your Dispatch data was removed, but sign-in cleanup needs another attempt. Please try deleting the account again.'
    );
  }

  logger.info('Dispatch account deletion completed.', {
    appleAuthorizationRevoked,
    ...cleanup,
  });
  return { deleted: true, appleAuthorizationRevoked, ...cleanup };
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

async function claimDelivery(deliveryId, metadata) {
  const ref = db.collection('pushDeliveries').doc(documentKey(deliveryId));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() : null;
    const updatedAtMs = current?.updatedAt?.toMillis?.() || 0;
    if (current?.status === 'sent') return { claimed: false, ref };
    if (current?.status === 'processing' && updatedAtMs > Date.now() - PROCESSING_LEASE_MS) {
      return { claimed: false, ref };
    }
    transaction.set(ref, {
      ...metadata,
      deliveryId,
      status: 'processing',
      attempts: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: current?.createdAt || FieldValue.serverTimestamp(),
    }, { merge: true });
    return { claimed: true, ref };
  });
}

async function removeInvalidToken(userId, token) {
  await db.collection('users').doc(userId).set({
    pushTokens: FieldValue.arrayRemove(token),
    pushTokenUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function savePushTicket(ticketId, userId, token, deliveryId) {
  await db.collection('pushTickets').doc(documentKey(ticketId)).set({
    ticketId,
    userId,
    token,
    deliveryId,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function loadPushTokens(userId) {
  const snapshot = await db.collection('users').doc(userId).get();
  if (!snapshot.exists) return [];
  const user = snapshot.data();
  if (user.pushPermissionStatus === 'denied') return [];
  return normalizeExpoPushTokens(user.pushTokens);
}

async function sendPushToUser({ deliveryId, userId, title, body, data, sourceRef }) {
  if (!userId) return false;
  const tokens = await loadPushTokens(userId);
  if (!tokens.length) {
    logger.info('Push skipped because the user has no registered Expo token.', { deliveryId, userId });
    return false;
  }

  const claim = await claimDelivery(deliveryId, { userId, sourcePath: sourceRef?.path || null });
  if (!claim.claimed) return false;

  try {
    let successfulTickets = 0;
    for (const tokenChunk of chunks(tokens, 100)) {
      const messages = tokenChunk.map((token) => ({
        to: token,
        title,
        body,
        sound: 'default',
        priority: 'high',
        channelId: 'dispatch-default',
        data,
      }));
      const response = await expoRequest(EXPO_PUSH_URL, messages);
      const tickets = Array.isArray(response.data) ? response.data : [];
      for (let index = 0; index < tokenChunk.length; index += 1) {
        const token = tokenChunk[index];
        const ticket = tickets[index];
        if (ticket?.status === 'ok' && ticket.id) {
          successfulTickets += 1;
          await savePushTicket(ticket.id, userId, token, deliveryId);
        } else if (ticket?.details?.error === 'DeviceNotRegistered') {
          await removeInvalidToken(userId, token);
        } else {
          logger.error('Expo rejected a push notification.', { deliveryId, userId, ticket });
        }
      }
    }

    await claim.ref.set({
      status: successfulTickets ? 'sent' : 'no_valid_tokens',
      successfulTickets,
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (successfulTickets && sourceRef) {
      await sourceRef.set({ pushSeenBy: FieldValue.arrayUnion(userId) }, { merge: true }).catch(() => undefined);
    }
    return successfulTickets > 0;
  } catch (error) {
    await claim.ref.set({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  }
}

exports.pushChatMessage = onDocumentCreated('chatThreads/{threadId}/messages/{messageId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const message = { id: snapshot.id, ...snapshot.data(), threadId: event.params.threadId };
  const threadRef = db.collection('chatThreads').doc(event.params.threadId);
  const threadSnapshot = await threadRef.get();
  const thread = threadSnapshot.exists ? { id: threadSnapshot.id, ...threadSnapshot.data() } : { id: event.params.threadId };
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

  await Promise.all(recipientIds.map((userId) => sendPushToUser({
    deliveryId: `chat:${event.params.threadId}:${event.params.messageId}:${userId}`,
    userId,
    ...content,
    sourceRef: threadRef,
  })));
});

exports.pushUserNotification = onDocumentCreated('userNotifications/{notificationId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const notification = snapshot.data();
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
    sourceRef: snapshot.ref,
  });
});

exports.pushRoleAssignmentNotification = onDocumentCreated('roleAssignmentNotifications/{notificationId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const notification = { id: event.params.notificationId, ...snapshot.data() };
  const recipientId = rolePushRecipientId(notification);
  if (!recipientId) {
    logger.info('Skipped Manager or invalid role invite push recipient.', {
      notificationId: event.params.notificationId,
    });
    return;
  }
  const content = rolePushContent(notification);
  await sendPushToUser({
    deliveryId: `role-notification:${event.params.notificationId}:${recipientId}`,
    userId: recipientId,
    ...content,
    sourceRef: snapshot.ref,
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
  const updates = notifications.docs
    .map((snapshot) => {
      const notification = snapshot.data();
      const nextState = buildRoleNotificationState(notification, after);
      return roleNotificationStateChanged(notification, nextState)
        ? { ref: snapshot.ref, nextState }
        : null;
    })
    .filter(Boolean);

  for (const updateChunk of chunks(updates, 400)) {
    const batch = db.batch();
    updateChunk.forEach(({ ref, nextState }) => {
      batch.set(ref, {
        ...nextState,
        roleStateSyncedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  }

  logger.info('Synchronized event role state to invite notifications.', {
    eventId: event.params.eventId,
    notificationCount: notifications.size,
    updateCount: updates.length,
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
    const event = { id: eventSnapshot.id, ...eventSnapshot.data() };
    for (const target of eventReminderTargets(event)) {
      await sendPushToUser({
        deliveryId: `event-two-hour:${event.id}:${event.startsAt}:${target.userId}`,
        userId: target.userId,
        title: `${event.name || 'Event'} starts in 2 hours`,
        body: `${target.roleNames.join(', ')} at ${event.location || 'the event location'}.`,
        data: {
          kind: 'user_notification',
          relatedEventId: event.id,
          dispatchReminderKey: `event-two-hour:${event.id}:${event.startsAt}`,
        },
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

  const events = eventsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
  const organizationIds = uniqueStrings(events.map((event) => event.organizationId));
  const organizationSnapshots = await Promise.all(
    organizationIds.map((organizationId) => db.collection('organizations').doc(organizationId).get())
  );
  const managerIdsByOrganization = new Map(organizationSnapshots.map((snapshot) => [
    snapshot.id,
    snapshot.exists ? uniqueStrings(snapshot.data().managerIds) : [],
  ]));

  const notificationsById = new Map(events.flatMap((event) =>
    lateTaskNotificationDocuments({
      event,
      nowMs,
      organizationManagerIds: managerIdsByOrganization.get(event.organizationId) || [],
    })
  ).map((notification) => [notification.id, notification]));

  let createdCount = 0;
  for (const notificationChunk of chunks([...notificationsById.values()], 400)) {
    const refs = notificationChunk.map((notification) => db.collection('userNotifications').doc(notification.id));
    const existing = await db.getAll(...refs);
    const batch = db.batch();
    existing.forEach((snapshot, index) => {
      if (snapshot.exists) return;
      const { id: _id, ...notification } = notificationChunk[index];
      batch.create(snapshot.ref, { ...notification, createdAt: FieldValue.serverTimestamp() });
      createdCount += 1;
    });
    if (existing.some((snapshot) => !snapshot.exists)) await batch.commit();
  }

  logger.info('Created overdue task notifications.', {
    eventCount: events.length,
    candidateCount: notificationsById.size,
    createdCount,
  });
});

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
      await ticket.ref.set({
        status: receipt.status === 'ok' ? 'delivered' : 'error',
        receipt,
        checkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (receipt.details?.error === 'DeviceNotRegistered') {
        await removeInvalidToken(ticket.userId, ticket.token);
      }
    }
  }
});
