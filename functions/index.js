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
const {
  chatPushContent,
  eventReminderTargets,
  normalizeExpoPushTokens,
  rolePushContent,
  uniqueStrings,
} = require('./lib/push-content');
const {
  buildRoleNotificationState,
  roleNotificationStateChanged,
  roleStateFingerprint,
} = require('./lib/role-state');

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

let db;
let FieldValue;
let adminAuth;

onInit(() => {
  const { initializeApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const firestore = require('firebase-admin/firestore');
  initializeApp();
  adminAuth = getAuth();
  db = firestore.getFirestore();
  FieldValue = firestore.FieldValue;
});
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const PROCESSING_LEASE_MS = 5 * 60 * 1000;

function documentKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

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
  const recipientIds = uniqueStrings(message.recipientIds?.length ? message.recipientIds : thread.participants)
    .filter((userId) => userId !== message.senderId);
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
  const content = rolePushContent(notification);
  await sendPushToUser({
    deliveryId: `role-notification:${event.params.notificationId}:${notification.workerId}`,
    userId: notification.workerId,
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
