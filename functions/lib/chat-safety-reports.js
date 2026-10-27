const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');

const REPORT_REASONS = new Set(['harassment', 'hate', 'sexual', 'violence', 'privacy', 'spam', 'illegal', 'other']);
const REPORT_STATUSES = new Set(['submitted', 'under_review', 'resolved', 'dismissed']);
const REPORT_HOURLY_LIMIT = 5;
const REPORT_DAILY_LIMIT = 20;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const millis = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : 0);
const iso = value => new Date(millis(value)).toISOString();
const label = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : fallback;

function requireAuth(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to report a chat concern.');
  return request.auth.uid;
}

function validId(value, field) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 200 || value.includes('/')) {
    throw new HttpsError('invalid-argument', `Choose a valid ${field}.`);
  }
  return value;
}

function normalizeReportInput(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).some(key => !['threadId', 'kind', 'messageId', 'targetUserId', 'reason', 'details', 'clientRequestId'].includes(key))) {
    throw new HttpsError('invalid-argument', 'Reports accept only a selected chat concern and your explanation.');
  }
  const threadId = validId(data.threadId, 'chat');
  if (!['message', 'user'].includes(data.kind) || !REPORT_REASONS.has(data.reason)) throw new HttpsError('invalid-argument', 'Choose a valid report type and reason.');
  if (typeof data.clientRequestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(data.clientRequestId)) {
    throw new HttpsError('invalid-argument', 'This report needs a valid request identifier.');
  }
  if (data.details !== undefined && (typeof data.details !== 'string' || data.details.length > 2000)) {
    throw new HttpsError('invalid-argument', 'Report details must be 2,000 characters or fewer.');
  }
  if ((data.kind === 'message' && data.targetUserId !== undefined) || (data.kind === 'user' && data.messageId !== undefined)) {
    throw new HttpsError('invalid-argument', 'Select either one message or one member to report.');
  }
  return {
    threadId, kind: data.kind, reason: data.reason, details: (data.details || '').trim(), clientRequestId: data.clientRequestId,
    messageId: data.kind === 'message' ? validId(data.messageId, 'message') : null,
    targetUserId: data.kind === 'user' ? validId(data.targetUserId, 'member') : null,
  };
}

function reportIdentity(uid, input) {
  const { clientRequestId, ...content } = input;
  return { reportId: hash(JSON.stringify([uid, clientRequestId])), fingerprint: hash(JSON.stringify(content)) };
}

function encodeReportCursor(reportId) {
  return Buffer.from(JSON.stringify({ version: 1, reportId })).toString('base64url');
}

function decodeReportCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length > 300 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new HttpsError('invalid-argument', 'This report page cursor is invalid.');
  }
  let decoded;
  try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { /* handled below */ }
  if (!decoded || decoded.version !== 1 || !/^[a-f0-9]{64}$/.test(decoded.reportId || '') || encodeReportCursor(decoded.reportId) !== cursor) {
    throw new HttpsError('invalid-argument', 'This report page cursor is invalid.');
  }
  return decoded.reportId;
}

function reporterProjection(id, data) {
  return {
    id, kind: data.kind, targetDisplayName: label(data.targetDisplayName, 'Dispatch member'), reason: data.reason,
    status: REPORT_STATUSES.has(data.status) ? data.status : 'submitted', createdAt: iso(data.createdAt),
    ...(data.updatedAt ? { updatedAt: iso(data.updatedAt) } : {}),
    ...(typeof data.resolutionSummary === 'string' && data.resolutionSummary.trim()
      ? { resolutionSummary: data.resolutionSummary.trim().slice(0, 500) } : {}),
  };
}

function snapshotAttachment(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of ['id', 'name', 'kind', 'mimeType', 'url']) {
    if (typeof value[key] === 'string') result[key] = value[key].slice(0, key === 'url' ? 4096 : 1024);
  }
  if (Number.isFinite(value.size) && value.size >= 0) result.size = value.size;
  return result;
}

function createChatReportService({ getDb, getFieldValue, getActorContext, assertAccountAllowed, now = Date.now,
  documentIdField = () => require('firebase-admin/firestore').FieldPath.documentId() }) {
  const reports = () => getDb().collection('chatSafetyReports');
  const userRef = uid => getDb().collection('users').doc(uid);

  async function submit(request) {
    const uid = requireAuth(request);
    const input = normalizeReportInput(request.data);
    const { reportId, fingerprint } = reportIdentity(uid, input);
    const ref = reports().doc(reportId);
    return getDb().runTransaction(async tx => {
      await assertAccountAllowed(tx, uid);
      const existing = await tx.get(ref);
      if (existing.exists) {
        const previous = existing.data();
        if (previous.reporterUserId !== uid || previous.requestFingerprint !== fingerprint) {
          throw new HttpsError('failed-precondition', 'This report request was already used for a different submission.');
        }
        return { reportId, status: 'submitted', createdAt: iso(previous.createdAt) };
      }
      const threadRef = getDb().collection('chatThreads').doc(input.threadId);
      const thread = await tx.get(threadRef);
      if (!thread.exists) throw new HttpsError('not-found', 'This chat is no longer available to report.');
      const actor = await getActorContext(tx, uid, thread.data());
      if (!actor.enabled) throw new HttpsError('failed-precondition', 'Chat reporting is not enabled for this organization.');

      let message;
      let targetUserId = input.targetUserId;
      if (input.kind === 'message') {
        const source = await tx.get(threadRef.collection('messages').doc(input.messageId));
        if (!source.exists) throw new HttpsError('not-found', 'This message is no longer available to report.');
        message = source.data();
        targetUserId = validId(message.senderId, 'message sender');
      }
      if (targetUserId === uid) throw new HttpsError('invalid-argument', 'Choose another member or their message to report.');
      const target = await tx.get(userRef(targetUserId));
      const targetProfile = target.exists ? target.data() : null;
      if (input.kind === 'user' && (!targetProfile || targetProfile.organizationId !== actor.organizationId
        || !thread.data().participants.includes(targetUserId)
        || ![...(actor.organization.managerIds || []), ...(actor.organization.workerIds || [])].includes(targetUserId))) {
        throw new HttpsError('permission-denied', 'Only a current member of this chat organization can be reported here.');
      }

      const limiterRef = userRef(uid).collection('chatReportLimits').doc('current');
      const limiter = await tx.get(limiterRef);
      const previous = limiter.data() || {};
      const time = now();
      const hourStartMs = Math.floor(time / HOUR_MS) * HOUR_MS;
      const dayStartMs = Math.floor(time / DAY_MS) * DAY_MS;
      const hourCount = previous.hourStartMs === hourStartMs ? Number(previous.hourCount || 0) : 0;
      const dayCount = previous.dayStartMs === dayStartMs ? Number(previous.dayCount || 0) : 0;
      if (hourCount >= REPORT_HOURLY_LIMIT || dayCount >= REPORT_DAILY_LIMIT) {
        throw new HttpsError('resource-exhausted', 'You have reached the report limit. Please try again later.');
      }
      const createdAt = new Date(time);
      const targetDisplayName = targetProfile?.organizationId === actor.organizationId
        ? label(targetProfile.displayName, 'Dispatch member')
        : label(message?.senderName, 'Former Dispatch member');
      const evidence = {
        thread: { id: input.threadId, organizationId: actor.organizationId, kind: label(thread.data().kind, 'chat'), title: label(thread.data().title, 'Chat') },
        target: { uid: targetUserId, displayName: targetDisplayName },
        ...(message ? { message: {
          id: input.messageId, senderId: targetUserId,
          text: typeof message.text === 'string' ? message.text.slice(0, 4000) : '',
          attachments: (Array.isArray(message.attachments) ? message.attachments : []).slice(0, 10).map(snapshotAttachment).filter(Boolean),
          ...(message.createdAt ? { createdAt: new Date(millis(message.createdAt)) } : {}),
        } } : {}),
      };
      tx.create(ref, {
        schemaVersion: 1, organizationId: actor.organizationId, reporterUserId: uid,
        reporterDisplayName: label(actor.user.displayName, 'Dispatch member'), targetUserId, targetDisplayName,
        threadId: input.threadId, messageId: input.messageId, kind: input.kind, reason: input.reason, details: input.details,
        requestFingerprint: fingerprint, status: 'submitted', createdAt, updatedAt: createdAt, evidence,
      });
      tx.set(limiterRef, { hourStartMs, dayStartMs, hourCount: hourCount + 1, dayCount: dayCount + 1, updatedAt: createdAt });
      tx.set(userRef(uid).collection('chatSafetyState').doc('current'), {
        version: getFieldValue().increment(1), updatedAt: getFieldValue().serverTimestamp(),
      }, { merge: true });
      return { reportId, status: 'submitted', createdAt: createdAt.toISOString() };
    });
  }

  async function listMine(request) {
    const uid = requireAuth(request);
    const data = request.data || {};
    if (typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['cursor', 'limit'].includes(key))) {
      throw new HttpsError('invalid-argument', 'Choose a valid report page.');
    }
    const limit = data.limit === undefined ? 20 : data.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpsError('invalid-argument', 'Report page size must be between 1 and 50.');
    const anchorId = data.cursor === undefined ? null : decodeReportCursor(data.cursor);
    return getDb().runTransaction(async tx => {
      await assertAccountAllowed(tx, uid);
      const profile = await tx.get(userRef(uid));
      if (!profile.exists) throw new HttpsError('permission-denied', 'Your Dispatch profile is no longer available.');
      let query = reports().where('reporterUserId', '==', uid).orderBy('createdAt', 'desc').orderBy(documentIdField(), 'desc');
      if (anchorId) {
        const anchor = await tx.get(reports().doc(anchorId));
        if (!anchor.exists || anchor.data().reporterUserId !== uid) throw new HttpsError('invalid-argument', 'This report page is no longer available. Refresh your reports.');
        query = query.startAfter(anchor);
      }
      const result = await tx.get(query.limit(limit + 1));
      const page = result.docs.slice(0, limit);
      return { reports: page.map(doc => reporterProjection(doc.id, doc.data())),
        ...(result.docs.length > limit ? { nextCursor: encodeReportCursor(page.at(-1).id) } : {}) };
    });
  }

  return { submit, listMine };
}

module.exports = { REPORT_HOURLY_LIMIT, REPORT_DAILY_LIMIT, normalizeReportInput, reportIdentity, encodeReportCursor, decodeReportCursor, reporterProjection, createChatReportService };
