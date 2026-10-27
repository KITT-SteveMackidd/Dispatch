const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { rolloutEnabled, validateAttachmentUrl, CHAT_UPLOAD_TYPES, suspended, suspensionFor } = require('./chat-safety');
const { storagePathFromAttachment } = require('./account-deletion');

const ACTIONS = new Set(['dismiss', 'remove_message', 'suspend_user', 'restore_user']);
const CURSOR_TTL_MS = 30 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const millis = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : 0);
const iso = value => new Date(millis(value)).toISOString();
const revision = data => Number.isInteger(data?.revision) ? data.revision : 0;
const notFound = error => Number(error?.code) === 404 || Number(error?.statusCode) === 404;
const timestamp = (getFieldValue) => getFieldValue().serverTimestamp();

function normalizeAction(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).some(key => !['reportId', 'action', 'note', 'clientRequestId', 'expectedRevision'].includes(key))
    || !/^[a-f0-9]{64}$/.test(data.reportId || '') || !ACTIONS.has(data.action)
    || typeof data.note !== 'string' || !data.note.trim() || data.note.length > 2000
    || !/^[A-Za-z0-9_-]{8,80}$/.test(data.clientRequestId || '')
    || (data.expectedRevision !== undefined && (!Number.isInteger(data.expectedRevision) || data.expectedRevision < 0))) {
    throw new HttpsError('invalid-argument', 'Choose a valid moderation action, request identifier and note (up to 2,000 characters).');
  }
  return { ...data, note: data.note.trim() };
}

function reportConflict(report, uid) { return report.reporterUserId === uid || report.targetUserId === uid; }

function safeAttachmentMetadata(attachment) {
  const result = { name: typeof attachment?.name === 'string' ? attachment.name.slice(0, 240) : 'Attachment', kind: attachment?.kind || 'file' };
  if (typeof attachment?.mimeType === 'string') result.mimeType = attachment.mimeType;
  if (Number.isFinite(attachment?.size)) result.size = attachment.size;
  return result;
}

function actionOptions(report, target, moderationState, reportId) {
  if (report.moderationAction?.status === 'cleanup_pending') return ['remove_message'];
  const options = [];
  if (['submitted', 'under_review'].includes(report.status)) options.push('dismiss');
  if (report.kind === 'message' && !report.messageRemovedAt) options.push('remove_message');
  if (target?.eligible) {
    // Never replace a different active restriction: doing so could let a
    // reviewer bypass a conflict on that report and then restore their own.
    if (!moderationState?.active && !suspended(target)) options.push('suspend_user');
    if (moderationState?.active && moderationState.sourceReportId === reportId
      && (suspensionFor(target)?.organizationId === report.organizationId || target.verifiedLocalLegacyRestriction)) options.push('restore_user');
  }
  return options;
}

function moderationProjection(id, report, options) {
  const evidence = { thread: { title: report.evidence?.thread?.title || 'Chat', kind: report.evidence?.thread?.kind || 'chat' } };
  if (report.evidence?.message) evidence.message = {
    id: report.messageId, senderId: report.targetUserId, text: report.evidence.message.text || '',
    attachments: (report.evidence.message.attachments || []).map(safeAttachmentMetadata),
  };
  return {
    id, organizationId: report.organizationId, kind: report.kind, targetUserId: report.targetUserId,
    targetDisplayName: report.targetDisplayName || 'Dispatch member', reporterDisplayName: report.reporterDisplayName || 'Dispatch member',
    reason: report.reason, details: report.details || '', status: report.status,
    createdAt: iso(report.createdAt), updatedAt: iso(report.updatedAt || report.createdAt), revision: revision(report),
    evidence, availableActions: options,
    ...(report.moderationAction ? { actionState: {
      action: report.moderationAction.action, status: report.moderationAction.status,
      ...(report.moderationAction.status === 'cleanup_pending' ? { message: report.moderationAction.cleanupIssue
        ? 'Message hidden. An attachment has unverified ownership and needs operator review.'
        : 'Message hidden. Attachment cleanup must finish before this report is resolved.' } : {}),
    } } : {}),
  };
}

function createChatModerationService({ getDb, getFieldValue, getBucket, assertAccountAllowed, projectId,
  emulatorOrigins = () => null, fetchImpl = (...args) => fetch(...args), now = Date.now,
  documentIdField = () => require('firebase-admin/firestore').FieldPath.documentId() }) {
  const reports = () => getDb().collection('chatSafetyReports');
  const operations = () => getDb().collection('chatModerationOperations');
  const privateState = uid => getDb().collection('chatUserModerationState').doc(uid);
  const userRef = uid => getDb().collection('users').doc(uid);
  const signal = (tx, uid) => {
    if (typeof uid !== 'string' || !uid) return;
    tx.set(userRef(uid).collection('chatSafetyState').doc('current'), {
      version: getFieldValue().increment(1), updatedAt: timestamp(getFieldValue),
    }, { merge: true });
  };
  function caller(request) {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to review chat reports.');
    return request.auth.uid;
  }

  async function organization(tx, orgId) {
    const [org, billing] = await tx.getAll(getDb().collection('organizations').doc(orgId), getDb().collection('organizationBilling').doc(orgId));
    if (!org.exists || !rolloutEnabled(org.data(), billing.data(), projectId())) throw new HttpsError('failed-precondition', 'Chat moderation is unavailable for this organization.');
    return org.data();
  }

  async function reviewer(tx, request) {
    const uid = caller(request);
    await assertAccountAllowed(tx, uid);
    const profile = await tx.get(userRef(uid));
    if (!profile.exists || profile.data().accountDeletionStartedAt) throw new HttpsError('permission-denied', 'An active Dispatch profile is required.');
    if (request.auth.token?.dispatchModerator === true) return { uid, scope: 'operator', operator: true };
    const data = profile.data();
    if (String(data.role).trim().toLowerCase() !== 'manager' || !data.organizationId) throw new HttpsError('permission-denied', 'Only authorized Managers or Dispatch moderators can review reports.');
    const org = await organization(tx, data.organizationId);
    if (!(org.managerIds || []).includes(uid)) throw new HttpsError('permission-denied', 'Your Manager access is no longer active.');
    return { uid, scope: `organization:${data.organizationId}`, operator: false, organizationId: data.organizationId };
  }

  async function authorizeReport(tx, actor, report) {
    if (reportConflict(report, actor.uid)) throw new HttpsError('permission-denied', 'Another reviewer must handle a report involving you.');
    if (!actor.operator && report.organizationId !== actor.organizationId) throw new HttpsError('permission-denied', 'This report belongs to another organization.');
    const org = await organization(tx, report.organizationId);
    const [target, state] = await tx.getAll(userRef(report.targetUserId), privateState(report.targetUserId));
    const eligible = target.exists && target.data().organizationId === report.organizationId
      && [...(org.managerIds || []), ...(org.workerIds || [])].includes(report.targetUserId)
      && !target.data().accountDeletionStartedAt;
    const rawState = state.data();
    const scopedState = rawState?.organizations?.[report.organizationId]
      || (rawState?.organizationId === report.organizationId ? rawState : undefined);
    let verifiedLocalLegacyRestriction = false;
    const targetData = target.data() || {};
    // During this local stage an earlier callable wrote generic unscoped state.
    // Restore only if its exact private operation/time proves the correlation;
    // arbitrary legacy/global restrictions still fail closed.
    if (projectId().startsWith('demo-') && targetData.chatSuspension?.active === true && !targetData.chatSuspension.organizationId
      && scopedState?.active && scopedState.sourceOperationId
      && millis(scopedState.updatedAt) > 0 && millis(scopedState.updatedAt) === millis(targetData.chatSuspension.updatedAt)) {
      const source = await tx.get(operations().doc(scopedState.sourceOperationId));
      verifiedLocalLegacyRestriction = source.exists && source.data().action === 'suspend_user' && source.data().status === 'completed'
        && source.data().targetUserId === report.targetUserId && source.data().organizationId === report.organizationId
        && source.data().reportId === scopedState.sourceReportId;
    }
    return { org, target: { ...targetData, eligible, verifiedLocalLegacyRestriction }, state: scopedState, rawState };
  }

  async function list(request) {
    caller(request);
    const data = request.data || {};
    const limit = data.limit === undefined ? 20 : data.limit;
    if (typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['cursor', 'limit'].includes(key))
      || !Number.isInteger(limit) || limit < 1 || limit > 50 || (data.cursor !== undefined && !/^[a-f0-9]{64}$/.test(data.cursor))) {
      throw new HttpsError('invalid-argument', 'Choose a valid moderation page.');
    }
    return getDb().runTransaction(async tx => {
      const actor = await reviewer(tx, request);
      let anchor;
      if (data.cursor) {
        const cursor = await tx.get(getDb().collection('chatModerationCursors').doc(data.cursor));
        if (!cursor.exists || cursor.data().ownerId !== actor.uid || cursor.data().scope !== actor.scope || millis(cursor.data().expiresAt) <= now()) {
          throw new HttpsError('invalid-argument', 'This moderation page expired or is unavailable. Refresh the queue.');
        }
        anchor = cursor.data();
      }
      const page = [];
      let hasMore = false;
      let scanned = 0;
      while (scanned < 200 && page.length < limit) {
        let query = reports();
        if (!actor.operator) query = query.where('organizationId', '==', actor.organizationId);
        query = query.orderBy('createdAt', 'desc').orderBy(documentIdField(), 'desc');
        if (anchor) query = query.startAfter(anchor.createdAt, anchor.reportId);
        const batch = await tx.get(query.limit(50));
        if (!batch.docs.length) { hasMore = false; break; }
        for (let index = 0; index < batch.docs.length; index++) {
          const doc = batch.docs[index];
          const report = doc.data();
          scanned++;
          anchor = { reportId: doc.id, createdAt: report.createdAt };
          if (!reportConflict(report, actor.uid)) {
            try {
              const access = await authorizeReport(tx, actor, report);
              page.push(moderationProjection(doc.id, report, actionOptions(report, access.target, access.state, doc.id)));
            } catch (error) {
              if (!['permission-denied', 'failed-precondition'].includes(error.code)) throw error;
            }
          }
          if (page.length === limit || scanned === 200) {
            hasMore = index < batch.docs.length - 1 || batch.docs.length === 50;
            break;
          }
        }
        if (page.length === limit || scanned === 200) break;
        hasMore = batch.docs.length === 50;
        if (!hasMore) break;
      }
      let nextCursor;
      if (hasMore && anchor) {
        nextCursor = crypto.randomBytes(32).toString('hex');
        tx.create(getDb().collection('chatModerationCursors').doc(nextCursor), {
          ownerId: actor.uid, scope: actor.scope, ...anchor, expiresAt: new Date(now() + CURSOR_TTL_MS),
        });
      }
      return { reports: page, ...(nextCursor ? { nextCursor } : {}) };
    });
  }

  async function removalManifest(tx, report, message, allowReferenceRemoval = false) {
    const attachments = [...(report.evidence?.message?.attachments || []), ...(message?.attachments || [])];
    const entries = new Map();
    for (const attachment of attachments) {
      try {
      const objectPath = storagePathFromAttachment(attachment);
      let grantId;
      if (objectPath?.startsWith('chatSafetyAttachments/')) {
        grantId = objectPath.split('/')[1];
        const grant = /^[a-f0-9]{40}$/.test(grantId) ? await tx.get(getDb().collection('chatUploadGrants').doc(grantId)) : null;
        if (!grant?.exists || grant.data().ownerId !== report.targetUserId || grant.data().threadId !== report.threadId
          || grant.data().messageId !== report.messageId || grant.data().objectPath !== objectPath) {
          throw new HttpsError('failed-precondition', 'An attachment cannot be safely attributed to this reported message.');
        }
      } else if (!objectPath?.startsWith(`chatAttachments/${report.threadId}/${report.targetUserId}/`)) {
        throw new HttpsError('failed-precondition', 'An attachment is outside Dispatch storage and requires operator review.');
      }
      const token = validateAttachmentUrl({ url: attachment.url, objectPath, bucket: getBucket().name, emulatorOrigin: emulatorOrigins() });
      if (!token) throw new HttpsError('failed-precondition', 'An attachment download cannot be safely verified.');
      const origins = emulatorOrigins();
      const origin = Array.isArray(origins) ? origins[0] : origins || 'https://firebasestorage.googleapis.com';
      const url = `${origin}/v0/b/${getBucket().name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${encodeURIComponent(token)}`;
      const entry = entries.get(objectPath) || { objectPath, ...(grantId ? { grantId } : {}), urls: [] };
      if (!entry.urls.includes(url)) entry.urls.push(url);
      entries.set(objectPath, entry);
      } catch (error) {
        if (!allowReferenceRemoval || !['invalid-argument', 'failed-precondition'].includes(error.code)) throw error;
        let url;
        try { url = new URL(attachment?.url); } catch { /* unresolved below */ }
        const path = storagePathFromAttachment(attachment);
        const possibleOwnedPath = path?.startsWith('chatSafetyAttachments/') || path?.startsWith('chatAttachments/');
        const possibleOwnedUrl = url?.pathname.startsWith(`/v0/b/${getBucket().name}/o/`);
        const clearlyExternal = url && ['https:', 'http:'].includes(url.protocol) && !possibleOwnedPath && !possibleOwnedUrl;
        const key = hash(JSON.stringify([attachment?.id || '', attachment?.url || '']));
        entries.set(key, clearlyExternal ? { externalReference: true } : { blocked: true, reason: 'unverified_attachment_ownership' });
      }
    }
    return [...entries.values()];
  }

  function resultFor(reportId, action, data, actionState = 'completed') {
    return { reportId, status: data.status, revision: revision(data), action, actionState,
      ...(actionState === 'cleanup_pending' ? { message: 'The message is hidden. Attachment cleanup is still pending; retry this action.' } : {}) };
  }

  async function prepare(request, input) {
    const uid = caller(request);
    const operationId = hash(JSON.stringify([uid, input.clientRequestId]));
    const fingerprint = hash(JSON.stringify([input.reportId, input.action, input.note]));
    return getDb().runTransaction(async tx => {
      const actor = await reviewer(tx, request);
      const reportRef = reports().doc(input.reportId);
      const operationRef = operations().doc(operationId);
      const [reportDoc, previous] = await tx.getAll(reportRef, operationRef);
      if (!reportDoc.exists) throw new HttpsError('not-found', 'This report is no longer available.');
      const report = reportDoc.data();
      const access = await authorizeReport(tx, actor, report);
      if (previous.exists) {
        if (previous.data().requestFingerprint !== fingerprint || previous.data().actorUserId !== uid) throw new HttpsError('failed-precondition', 'This request identifier was already used for another action.');
        const canonical = previous.data().canonicalOperationId
          ? await tx.get(operations().doc(previous.data().canonicalOperationId)) : previous;
        if (!canonical.exists) throw new HttpsError('failed-precondition', 'This action record is no longer available.');
        return { operationId: canonical.id, operation: canonical.data(), result: canonical.data().result };
      }
      if (input.expectedRevision !== undefined && input.expectedRevision !== revision(report)) throw new HttpsError('failed-precondition', 'This report changed. Refresh it before choosing an action.');
      if (report.moderationAction?.status === 'cleanup_pending') {
        if (input.action !== 'remove_message') throw new HttpsError('failed-precondition', 'Finish the pending attachment cleanup before another action.');
        const canonical = await tx.get(operations().doc(report.moderationAction.operationId));
        if (!canonical.exists) throw new HttpsError('failed-precondition', 'The pending cleanup needs operator review.');
        tx.create(operationRef, { actorUserId: uid, reporterUserId: report.reporterUserId, targetUserId: report.targetUserId,
          organizationId: report.organizationId, reportId: input.reportId, action: input.action, requestFingerprint: fingerprint,
          canonicalOperationId: canonical.id, status: 'alias', createdAt: new Date(now()) });
        tx.create(reportRef.collection('moderationAudit').doc(operationId), { actorUserId: uid, action: 'retry_remove_message', note: input.note, createdAt: new Date(now()), operationId: canonical.id });
        return { operationId: canonical.id, operation: canonical.data() };
      }
      if (!actionOptions(report, access.target, access.state, input.reportId).includes(input.action)) throw new HttpsError('failed-precondition', 'This action is no longer available. Refresh the report.');
      if (['suspend_user', 'restore_user'].includes(input.action) && !access.target.eligible) throw new HttpsError('failed-precondition', 'The member is no longer active in this organization.');
      const time = new Date(now());
      const operation = { actorUserId: uid, reporterUserId: report.reporterUserId, targetUserId: report.targetUserId,
        organizationId: report.organizationId, reportId: input.reportId, action: input.action,
        requestFingerprint: fingerprint, createdAt: time, updatedAt: time };
      let manifest = [];
      let threadRef;
      let messageRef;
      let message;
      let thread;
      if (input.action === 'remove_message') {
        threadRef = getDb().collection('chatThreads').doc(report.threadId);
        messageRef = threadRef.collection('messages').doc(report.messageId);
        const snapshots = await tx.getAll(threadRef, messageRef);
        thread = snapshots[0]; message = snapshots[1];
        if (thread.exists && thread.data().organizationId !== report.organizationId) throw new HttpsError('permission-denied', 'The reported chat organization changed.');
        if (message.exists && message.data().senderId !== report.targetUserId) throw new HttpsError('failed-precondition', 'The reported message identity changed.');
        manifest = await removalManifest(tx, report, message.data(), true);
      }
      const next = { ...report, revision: revision(report) + 1, updatedAt: time,
        status: input.action === 'dismiss' ? 'dismissed' : input.action === 'remove_message' ? 'under_review' : 'resolved',
        resolutionSummary: input.action === 'dismiss' ? 'The report was reviewed. No further action was taken.'
          : input.action === 'remove_message' ? 'The reported message is hidden while attachment cleanup finishes.' : 'The report was reviewed and chat safety action was taken.',
        moderationAction: { action: input.action, status: input.action === 'remove_message' ? 'cleanup_pending' : 'completed', operationId,
          ...(manifest.some(entry => entry.blocked) ? { cleanupIssue: 'unverified_attachment_ownership' } : {}) },
      };
      if (input.action === 'remove_message') {
        if (message.exists) tx.update(messageRef, { text: '', attachments: [], moderationStatus: 'removed', moderatedAt: time });
        // Clear shared preview data conservatively; never copy another message
        // into a preview without the per-viewer block filter.
        if (thread.exists) tx.update(threadRef, { lastMessageText: 'A message was removed.', lastMessage: 'A message was removed.', lastMessageSenderId: null, updatedAt: time });
        operation.cleanup = manifest; operation.status = 'cleanup_pending'; operation.cleanupAttempts = 0;
      } else {
        operation.status = 'completed';
        if (input.action === 'suspend_user') {
          const state = { active: true, organizationId: report.organizationId, sourceReportId: input.reportId, sourceOperationId: operationId, updatedAt: time };
          const prior = access.rawState?.organizationId ? { [access.rawState.organizationId]: { ...access.rawState, organizations: undefined } } : {};
          // Avoid nested undefined while migrating an earlier single-org record.
          Object.values(prior).forEach(value => delete value.organizations);
          tx.set(privateState(report.targetUserId), { ...state, organizations: { ...prior, ...access.rawState?.organizations, [report.organizationId]: state } });
          const generic = { active: true, organizationId: report.organizationId, reason: 'Chat access suspended.', updatedAt: time };
          const oldGeneric = access.target.chatSuspension?.organizationId ? { [access.target.chatSuspension.organizationId]: access.target.chatSuspension } : {};
          tx.update(userRef(report.targetUserId), { chatSuspension: generic,
            chatOrganizationSuspensions: { ...oldGeneric, ...access.target.chatOrganizationSuspensions, [report.organizationId]: generic } });
          signal(tx, report.targetUserId);
        } else if (input.action === 'restore_user') {
          // actionOptions only allows restoration of this report's CURRENT
          // private suspension; a later independent report cannot be cleared.
          const state = { ...access.state, active: false, restoredByOperationId: operationId, updatedAt: time };
          const generic = { active: false, organizationId: report.organizationId, reason: 'Chat access restored.', updatedAt: time };
          tx.set(privateState(report.targetUserId), { ...state, organizations: { ...access.rawState?.organizations, [report.organizationId]: state } });
          tx.update(userRef(report.targetUserId), { chatSuspension: generic,
            chatOrganizationSuspensions: { ...access.target.chatOrganizationSuspensions, [report.organizationId]: generic } });
          signal(tx, report.targetUserId);
        }
      }
      const result = resultFor(input.reportId, input.action, next, operation.status);
      operation.result = result;
      tx.update(reportRef, { status: next.status, revision: next.revision, updatedAt: next.updatedAt, resolutionSummary: next.resolutionSummary, moderationAction: next.moderationAction });
      tx.create(operationRef, operation);
      tx.create(reportRef.collection('moderationAudit').doc(operationId), { actorUserId: uid, actorScope: actor.scope, action: input.action, note: input.note, createdAt: time });
      signal(tx, report.reporterUserId);
      return { operationId, operation, result };
    });
  }

  async function cleanup(operationId, operation) {
    const results = await Promise.allSettled((operation.cleanup || []).map(async entry => {
      if (entry.externalReference) return;
      if (entry.blocked) throw new Error('unverified-attachment-needs-operator-review');
      const file = getBucket().file(entry.objectPath);
      try { await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } }); } catch (error) { if (!notFound(error)) throw error; }
      await file.delete({ ignoreNotFound: true });
      try { await file.getMetadata(); throw new Error('object-still-exists'); } catch (error) { if (!notFound(error)) throw error; }
      for (const url of entry.urls) {
        const response = await fetchImpl(url, { method: 'GET', headers: { 'Cache-Control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        await response.body?.cancel?.();
        // Storage can deny an old download token with 403 after object deletion.
        // Accept that only after the authoritative object lookup returned 404.
        if (![403, 404].includes(response.status)) throw new Error('download-url-not-revoked');
      }
    }));
    const failed = results.some(result => result.status === 'rejected');
    return getDb().runTransaction(async tx => {
      const opRef = operations().doc(operationId);
      const reportRef = reports().doc(operation.reportId);
      const [op, reportDoc] = await tx.getAll(opRef, reportRef);
      if (!op.exists || !reportDoc.exists) throw new HttpsError('not-found', 'The report was removed while cleanup completed.');
      if (op.data().status === 'completed') return op.data().result;
      const report = reportDoc.data();
      const time = new Date(now());
      if (failed) {
        const result = resultFor(operation.reportId, 'remove_message', report, 'cleanup_pending');
        if ((operation.cleanup || []).some(entry => entry.blocked)) result.message = 'The message is hidden. An attachment has unverified ownership and needs operator review before cleanup can be confirmed.';
        tx.update(opRef, { cleanupAttempts: Number(op.data().cleanupAttempts || 0) + 1, updatedAt: time, result });
        tx.create(reportRef.collection('moderationAudit').doc(`${operationId}_retry_${crypto.randomBytes(8).toString('hex')}`), {
          action: 'attachment_cleanup_pending', createdAt: time, operationId,
        });
        return result;
      }
      const next = { ...report, status: 'resolved', revision: revision(report) + 1 };
      const result = resultFor(operation.reportId, 'remove_message', next);
      const evidence = { ...report.evidence };
      if (evidence.message) evidence.message = { ...evidence.message, attachments: (evidence.message.attachments || []).map(safeAttachmentMetadata) };
      tx.update(reportRef, { status: 'resolved', revision: next.revision, updatedAt: time, messageRemovedAt: time,
        resolutionSummary: 'The reported message was removed.', evidence,
        externalReferencesRemoved: (operation.cleanup || []).filter(entry => entry.externalReference).length,
        moderationAction: { action: 'remove_message', status: 'completed', operationId } });
      tx.update(opRef, { status: 'completed', completedAt: time, updatedAt: time, result,
        cleanup: (operation.cleanup || []).map(({ urls, ...metadata }) => metadata) });
      tx.create(reportRef.collection('moderationAudit').doc(`${operationId}_completed`), { action: 'attachment_cleanup_completed', createdAt: time, operationId });
      signal(tx, report.reporterUserId);
      return result;
    });
  }

  async function moderate(request) {
    caller(request);
    const input = normalizeAction(request.data);
    const prepared = await prepare(request, input);
    if (prepared.operation.status === 'cleanup_pending') return cleanup(prepared.operationId, prepared.operation);
    return prepared.result;
  }

  async function preview(request) {
    caller(request);
    const data = request.data;
    if (!data || typeof data !== 'object' || Object.keys(data).some(key => !['reportId', 'attachmentIndex'].includes(key))
      || !/^[a-f0-9]{64}$/.test(data.reportId || '') || !Number.isInteger(data.attachmentIndex) || data.attachmentIndex < 0 || data.attachmentIndex > 9) {
      throw new HttpsError('invalid-argument', 'Choose a valid reported attachment.');
    }
    return getDb().runTransaction(async tx => {
      const actor = await reviewer(tx, request);
      const reportDoc = await tx.get(reports().doc(data.reportId));
      if (!reportDoc.exists) throw new HttpsError('not-found', 'This report is no longer available.');
      const report = reportDoc.data();
      await authorizeReport(tx, actor, report);
      if (report.kind !== 'message' || report.messageRemovedAt || report.moderationAction?.status === 'cleanup_pending') throw new HttpsError('not-found', 'This reported attachment is no longer available.');
      const source = await tx.get(getDb().collection('chatThreads').doc(report.threadId).collection('messages').doc(report.messageId));
      if (!source.exists || source.data().moderationStatus === 'removed' || source.data().senderId !== report.targetUserId) throw new HttpsError('not-found', 'This reported message is no longer available.');
      const attachment = report.evidence?.message?.attachments?.[data.attachmentIndex];
      if (!attachment) throw new HttpsError('not-found', 'This attachment is no longer available.');
      const manifest = await removalManifest(tx, { ...report, evidence: { message: { attachments: [attachment] } } });
      const entry = manifest[0];
      let metadata;
      try { [metadata] = await getBucket().file(entry.objectPath).getMetadata(); }
      catch (error) { if (notFound(error)) throw new HttpsError('not-found', 'This attachment was removed.'); throw error; }
      const token = validateAttachmentUrl({ url: attachment.url, objectPath: entry.objectPath, bucket: getBucket().name, emulatorOrigin: emulatorOrigins() });
      if (!CHAT_UPLOAD_TYPES.has(metadata.contentType) || metadata.contentType !== attachment.mimeType
        || Number(metadata.size) !== attachment.size || !String(metadata.metadata?.firebaseStorageDownloadTokens || '').split(',').includes(token)) {
        throw new HttpsError('failed-precondition', 'This attachment no longer matches the reported evidence.');
      }
      return { url: attachment.url, name: attachment.name || 'Attachment', mimeType: metadata.contentType };
    });
  }

  return { list, moderate, preview };
}

module.exports = { createChatModerationService, normalizeAction, reportConflict, actionOptions, moderationProjection };
