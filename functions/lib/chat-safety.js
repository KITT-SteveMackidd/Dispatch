const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');

const CHAT_TERMS_VERSION = '2026-10-27';
const CHAT_UPLOAD_TTL_MS = 5 * 60 * 1000;
const CHAT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const CHAT_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/ogg']);
const ids = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value))];
const millis = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : Number(value) || 0);
function suspensionFor(user) {
  const legacy = user?.chatSuspension;
  // An unscoped legacy restriction is deliberately fail-closed until a trusted
  // migration/review resolves it. A scoped restriction never follows a transfer.
  if (legacy?.active === true && !legacy.organizationId) return legacy;
  const scoped = user?.chatOrganizationSuspensions?.[user?.organizationId];
  return scoped || legacy;
}
const suspended = user => {
  const state = suspensionFor(user);
  return state?.active === true && (!state.organizationId || state.organizationId === user?.organizationId)
    && (!state.expiresAt || millis(state.expiresAt) > Date.now());
};

function documentId(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || value.includes('/')) {
    throw new HttpsError('invalid-argument', `Choose a valid ${label}.`);
  }
  return value.trim();
}

function rolloutEnabled(organization, billing, projectId) {
  const enabled = organization?.chatSafetyEnabled === true;
  if (enabled !== (billing?.chatSafetyEnabled === true)) {
    throw new HttpsError('failed-precondition', 'Chat safety is being configured. Try again shortly.');
  }
  if (enabled && projectId === 'dispatch-customer-beta') {
    throw new HttpsError('failed-precondition', 'Chat safety is not configured for this backend.');
  }
  return enabled;
}

function pairIsBlocked(blocks, first, second) {
  return blocks.has(`${first}/${second}`) || blocks.has(`${second}/${first}`);
}

function assertChatSendAllowed({ user, thread, userId, blocks }) {
  if (suspended(user)) throw new HttpsError('permission-denied', 'Your chat access is suspended.');
  if (user.chatRulesVersion !== CHAT_TERMS_VERSION) throw new HttpsError('failed-precondition', 'Accept the current chat rules before sending messages or attachments.');
  const participants = ids(thread.participants);
  if (participants.length === 2 && participants.some(id => id !== userId && pairIsBlocked(blocks, userId, id))) {
    throw new HttpsError('permission-denied', 'Messages are unavailable while blocking is active in this conversation.');
  }
}

function attachmentGrantId(attachment) {
  const match = /^chatSafetyAttachments\/([a-f0-9]{40})\/([A-Za-z0-9._-]{1,180})$/.exec(attachment?.id || '');
  if (!match) throw new HttpsError('invalid-argument', 'Use a new secure chat upload for this attachment.');
  return match[1];
}

function validateAttachmentUrl({ url, objectPath, bucket, emulatorOrigin }) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new HttpsError('invalid-argument', 'The attachment URL is invalid.'); }
  const emulatorOrigins = Array.isArray(emulatorOrigin) ? emulatorOrigin : [emulatorOrigin];
  const validOrigin = parsed.origin === 'https://firebasestorage.googleapis.com'
    || emulatorOrigins.includes(parsed.origin);
  if (!validOrigin || parsed.username || parsed.password || parsed.hash
    || parsed.pathname !== `/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}`
    || parsed.searchParams.get('alt') !== 'media') {
    throw new HttpsError('invalid-argument', 'The attachment must use its secure Dispatch upload URL.');
  }
  return parsed.searchParams.get('token');
}

function createChatSafetyService({ getDb, getFieldValue, getBucket, projectId, emulatorOrigin = () => null, assertAccountAllowed, assertOrganizationWritable,
  getPendingReviewCount = async () => 0 }) {
  const userRef = uid => getDb().collection('users').doc(uid);
  const signalRef = uid => userRef(uid).collection('chatSafetyState').doc('current');
  const blockRef = (uid, target) => userRef(uid).collection('chatBlocks').doc(target);
  const signal = (tx, uid) => tx.set(signalRef(uid), { version: getFieldValue().increment(1), updatedAt: getFieldValue().serverTimestamp() }, { merge: true });
  const requireAuth = request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to manage chat safety.');
    return request.auth.uid;
  };

  async function context(tx, uid, thread) {
    const profile = await tx.get(userRef(uid));
    if (!profile.exists || !profile.data().organizationId) throw new HttpsError('permission-denied', 'Join an organization before using chat.');
    const user = profile.data();
    const organizationId = user.organizationId;
    const [org, billing] = await tx.getAll(getDb().collection('organizations').doc(organizationId), getDb().collection('organizationBilling').doc(organizationId));
    const organization = org.exists ? org.data() : null;
    if (!organization || !ids([...(organization.managerIds || []), ...(organization.workerIds || [])]).includes(uid)
      || (thread && (thread.organizationId !== organizationId || !ids(thread.participants).includes(uid)))) {
      throw new HttpsError('permission-denied', 'You are no longer an active member of this chat organization.');
    }
    return { user, organizationId, organization, billing: billing.data(), enabled: rolloutEnabled(organization, billing.data(), projectId()) };
  }

  async function pairBlocks(tx, uid, participants) {
    const others = ids(participants).filter(id => id !== uid);
    const refs = others.flatMap(id => [blockRef(uid, id), blockRef(id, uid)]);
    const snapshots = refs.length ? await tx.getAll(...refs) : [];
    const blocks = new Set();
    others.forEach((id, index) => {
      if (snapshots[index * 2].exists) blocks.add(`${uid}/${id}`);
      if (snapshots[index * 2 + 1].exists) blocks.add(`${id}/${uid}`);
    });
    return blocks;
  }

  async function threadRollout(tx, thread) {
    if (!thread.organizationId) return false;
    const [org, billing] = await tx.getAll(getDb().collection('organizations').doc(thread.organizationId), getDb().collection('organizationBilling').doc(thread.organizationId));
    return rolloutEnabled(org.data(), billing.data(), projectId());
  }

  async function getState(request) {
    const uid = requireAuth(request);
    return getDb().runTransaction(async tx => {
      const thread = request.data?.threadId
        ? await tx.get(getDb().collection('chatThreads').doc(documentId(request.data.threadId, 'chat'))) : null;
      if (thread && !thread.exists) throw new HttpsError('not-found', 'This chat no longer exists.');
      const state = await context(tx, uid, thread?.data());
      const ownBlocks = state.enabled ? await tx.get(userRef(uid).collection('chatBlocks')) : { docs: [] };
      const participants = thread ? ids(thread.data().participants) : [];
      const profiles = participants.length ? await tx.getAll(...participants.map(userRef)) : [];
      const blocks = state.enabled ? await pairBlocks(tx, uid, participants) : new Set();
      let sendDisabledReason;
      if (state.enabled) {
        try {
          assertChatSendAllowed({ user: state.user, userId: uid, thread: thread?.data() || { participants: [] }, blocks });
          if (state.billing?.accessMode !== 'full') sendDisabledReason = 'Organization changes are currently unavailable.';
        } catch (error) { sendDisabledReason = error.message; }
      }
      const canModerate = !state.user.accountDeletionStartedAt && (request.auth.token?.dispatchModerator === true
        || (String(state.user.role).trim().toLowerCase() === 'manager' && (state.organization.managerIds || []).includes(uid)));
      const pendingReviewCount = canModerate ? await getPendingReviewCount(tx, {
        uid, profile: state.user, organizationId: state.organizationId, enabled: state.enabled,
        isOperator: request.auth.token?.dispatchModerator === true,
      }) : 0;
      return {
        enabled: state.enabled, termsVersion: CHAT_TERMS_VERSION,
        acceptedTerms: state.user.chatRulesVersion === CHAT_TERMS_VERSION,
        blockedUsers: ownBlocks.docs.map(doc => ({ uid: doc.id, displayName: doc.data().displayName || 'Dispatch member' })),
        hiddenSenderIds: ownBlocks.docs.map(doc => doc.id),
        participants: profiles.filter(doc => doc.exists && doc.data().organizationId === state.organizationId)
          .map(doc => ({ uid: doc.id, displayName: doc.data().displayName || 'Dispatch member' })),
        canSend: !sendDisabledReason, ...(sendDisabledReason ? { sendDisabledReason } : {}),
        canModerate, pendingReviewCount,
        ...(state.enabled && suspended(state.user) ? { suspension: { reason: suspensionFor(state.user).reason || 'Chat access suspended.' } } : {}),
      };
    });
  }

  async function acceptRules(request) {
    const uid = requireAuth(request);
    if (request.data?.version !== CHAT_TERMS_VERSION) throw new HttpsError('failed-precondition', 'Read and accept the current chat rules.');
    return getDb().runTransaction(async tx => {
      await assertAccountAllowed(tx, uid);
      const state = await context(tx, uid);
      if (!state.enabled) throw new HttpsError('failed-precondition', 'Chat safety is not enabled for this organization.');
      tx.update(userRef(uid), { chatRulesVersion: CHAT_TERMS_VERSION, chatRulesAcceptedAt: getFieldValue().serverTimestamp() });
      signal(tx, uid);
      return { accepted: true, version: CHAT_TERMS_VERSION };
    });
  }

  async function setBlock(request) {
    const uid = requireAuth(request);
    const targetUid = documentId(request.data?.targetUserId, 'member');
    if (uid === targetUid || typeof request.data?.blocked !== 'boolean') throw new HttpsError('invalid-argument', 'Choose another member and a valid block action.');
    return getDb().runTransaction(async tx => {
      await assertAccountAllowed(tx, uid);
      const target = await tx.get(userRef(targetUid));
      if (request.data.blocked) {
        const state = await context(tx, uid);
        if (!state.enabled) throw new HttpsError('failed-precondition', 'Chat safety is not enabled for this organization.');
        if (!target.exists || target.data().organizationId !== state.organizationId
          || !ids([...(state.organization.managerIds || []), ...(state.organization.workerIds || [])]).includes(targetUid)) {
          throw new HttpsError('permission-denied', 'Only members of your organization can be blocked here.');
        }
        tx.set(blockRef(uid, targetUid), { targetUserId: targetUid, organizationId: state.organizationId, displayName: target.data().displayName || 'Dispatch member', createdAt: getFieldValue().serverTimestamp() });
      } else tx.delete(blockRef(uid, targetUid));
      signal(tx, uid);
      if (target.exists) signal(tx, targetUid);
      return { blocked: request.data.blocked, targetUserId: targetUid };
    });
  }

  async function createUpload(request) {
    const uid = requireAuth(request);
    const threadId = documentId(request.data?.threadId, 'chat');
    const name = typeof request.data?.name === 'string' ? request.data.name : '';
    const mimeType = request.data?.mimeType;
    const size = request.data?.size;
    if (!name || name.length > 120 || name !== name.trim() || !CHAT_UPLOAD_TYPES.has(mimeType) || !Number.isInteger(size) || size < 1 || size > CHAT_UPLOAD_MAX_BYTES) {
      throw new HttpsError('invalid-argument', 'Choose a supported attachment no larger than 20 MB.');
    }
    const grantId = crypto.randomBytes(20).toString('hex');
    const filename = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
    const objectPath = `chatSafetyAttachments/${grantId}/${filename}`;
    return getDb().runTransaction(async tx => {
      const thread = await tx.get(getDb().collection('chatThreads').doc(threadId));
      if (!thread.exists) throw new HttpsError('not-found', 'This chat no longer exists.');
      const state = await context(tx, uid, thread.data());
      if (!state.enabled) throw new HttpsError('failed-precondition', 'Secure chat uploads are not enabled for this organization.');
      await assertOrganizationWritable(tx, uid, state.organizationId);
      const blocks = await pairBlocks(tx, uid, thread.data().participants);
      assertChatSendAllowed({ user: state.user, userId: uid, thread: thread.data(), blocks });
      tx.create(getDb().collection('chatUploadGrants').doc(grantId), {
        ownerId: uid, threadId, organizationId: state.organizationId, objectPath, name, mimeType, size,
        createdAt: getFieldValue().serverTimestamp(), expiresAt: new Date(Date.now() + CHAT_UPLOAD_TTL_MS),
      });
      return { objectPath, grantId };
    });
  }

  async function prepareSend(tx, thread, uid, attachments) {
    if (!await threadRollout(tx, thread)) return { enabled: false, grantRefs: [] };
    const state = await context(tx, uid, thread);
    if (!state.enabled) return { enabled: false, grantRefs: [] };
    const blocks = await pairBlocks(tx, uid, thread.participants);
    assertChatSendAllowed({ user: state.user, userId: uid, thread, blocks });
    if (!Array.isArray(attachments) || attachments.length > 10) throw new HttpsError('invalid-argument', 'Choose up to 10 attachments.');
    const grantRefs = attachments.map(attachment => getDb().collection('chatUploadGrants').doc(attachmentGrantId(attachment)));
    if (new Set(grantRefs.map(ref => ref.id)).size !== grantRefs.length) throw new HttpsError('invalid-argument', 'An attachment cannot be repeated.');
    const grants = grantRefs.length ? await tx.getAll(...grantRefs) : [];
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index];
      const grant = grants[index].data();
      if (!grant || grant.ownerId !== uid || grant.threadId !== thread.id || grant.organizationId !== state.organizationId
        || grant.objectPath !== attachment.id || grant.usedAt || millis(grant.expiresAt) <= Date.now()
        || grant.name !== attachment.name || grant.mimeType !== attachment.mimeType || grant.size !== attachment.size
        || attachment.kind !== (grant.mimeType.startsWith('image/') ? 'image' : grant.mimeType.startsWith('audio/') ? 'audio' : 'file')) {
        throw new HttpsError('permission-denied', 'This attachment upload is expired or belongs to a different message sender or chat.');
      }
      const token = validateAttachmentUrl({ url: attachment.url, objectPath: grant.objectPath, bucket: getBucket().name, emulatorOrigin: emulatorOrigin() });
      let metadata;
      try { [metadata] = await getBucket().file(grant.objectPath).getMetadata(); } catch { throw new HttpsError('failed-precondition', 'Finish uploading the attachment before sending it.'); }
      if (Number(metadata.size) !== grant.size || metadata.contentType !== grant.mimeType
        || !token || !String(metadata.metadata?.firebaseStorageDownloadTokens || '').split(',').includes(token)) {
        throw new HttpsError('invalid-argument', 'The uploaded attachment does not match its grant.');
      }
    }
    return { enabled: true, grantRefs, recipientIds: ids(thread.participants).filter(id => id !== uid && !pairIsBlocked(blocks, uid, id)), allowHttpAttachments: Boolean(emulatorOrigin()) };
  }

  async function canDeliver({ threadId, senderId, recipientId, messageId }) {
    return getDb().runTransaction(async tx => {
      const thread = await tx.get(getDb().collection('chatThreads').doc(threadId));
      if (!thread.exists) return false;
      try {
        if (messageId) {
          const message = await tx.get(getDb().collection('chatThreads').doc(threadId).collection('messages').doc(messageId));
          if (!message.exists || message.data().moderationStatus === 'removed') return false;
        }
        if (!await threadRollout(tx, thread.data())) return true;
        const state = await context(tx, senderId, thread.data());
        if (!state.enabled) return true;
        const recipient = await tx.get(userRef(recipientId));
        if (!recipient.exists || recipient.data().organizationId !== state.organizationId || !ids(thread.data().participants).includes(recipientId)
          || !ids([...(state.organization.managerIds || []), ...(state.organization.workerIds || [])]).includes(recipientId)
          || state.user.accountDeletionStartedAt || recipient.data().accountDeletionStartedAt
          || suspended(state.user) || suspended(recipient.data())) return false;
        const blocks = await pairBlocks(tx, senderId, [recipientId]);
        return !pairIsBlocked(blocks, senderId, recipientId);
      } catch { return false; }
    });
  }

  return { getState, acceptRules, setBlock, createUpload, prepareSend, canDeliver, getActorContext: context };
}

module.exports = { CHAT_TERMS_VERSION, CHAT_UPLOAD_MAX_BYTES, CHAT_UPLOAD_TTL_MS, CHAT_UPLOAD_TYPES, createChatSafetyService, rolloutEnabled, pairIsBlocked, suspended, suspensionFor, assertChatSendAllowed, validateAttachmentUrl, attachmentGrantId };
