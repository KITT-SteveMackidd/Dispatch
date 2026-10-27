const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ID, assertLocalChatSafetyEnvironment, chatSafetyFixture } = require('./chat-safety-test-common');

async function seed() {
  // Validate before importing or initializing Firebase; hosted projects are never a fallback.
  const runId = assertLocalChatSafetyEnvironment();
  process.env.METADATA_SERVER_DETECTION = 'none';
  const fixture = chatSafetyFixture(runId);
  const { initializeApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, Timestamp } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.firebasestorage.app` });
  const auth = getAuth(app);
  const db = getFirestore(app);
  const marker = db.collection('localChatSafetyRuns').doc(runId);
  if ((await marker.get()).exists) throw new Error('This run already exists. Choose a fresh run ID; existing data will not be reset.');

  // Reject collisions before any user changes. This seed never updates or deletes an account.
  for (const user of fixture.users) {
    for (const lookup of [() => auth.getUser(user.uid), () => auth.getUserByEmail(user.email)]) {
      try {
        await lookup();
        throw new Error(`Synthetic account already exists: ${user.email}. Choose a fresh run ID.`);
      } catch (error) {
        if (error.code !== 'auth/user-not-found') throw error;
      }
    }
  }

  const now = Timestamp.now();
  await marker.create({ runId, organizationId: fixture.organizationId, state: 'seeding', createdAt: now });
  try {
    for (const user of fixture.users) {
      await auth.createUser({ uid: user.uid, email: user.email, displayName: user.displayName, password: fixture.password, emailVerified: true });
      if (user.key === 'operator') await auth.setCustomUserClaims(user.uid, { dispatchModerator: true });
    }
    const byKey = Object.fromEntries(fixture.users.map((user) => [user.key, user]));
    const organizationUsers = fixture.users.filter((user) => user.organizationId === fixture.organizationId);
    const participants = organizationUsers.map((user) => user.uid);
    const managerIds = organizationUsers.filter((user) => user.role === 'manager').map((user) => user.uid);
    const workers = organizationUsers.filter((user) => user.role === 'worker').map((user) => user.uid);
    const batch = db.batch();
    for (const user of fixture.users) {
      batch.create(db.collection('users').doc(user.uid), {
        uid: user.uid, email: user.email, canonicalEmail: user.email, displayName: user.displayName,
        role: user.role, organizationId: user.organizationId,
        organizationName: user.key === 'outsider' ? 'Other Local Test Organization' : user.key === 'operator' ? 'Local Operator Test Organization' : fixture.organizationName,
        onboardingCompleted: true, pushTokens: [], createdAt: now, updatedAt: now,
      });
    }
    for (const [organizationId, organizationManagerIds, workerIds, name] of [
      [fixture.organizationId, managerIds, workers, fixture.organizationName],
      [fixture.otherOrganizationId, [byKey.outsider.uid], [], 'Other Local Test Organization'],
      [fixture.operatorOrganizationId, [byKey.operator.uid], [], 'Local Operator Test Organization'],
    ]) {
      const managerId = organizationManagerIds[0];
      batch.create(db.collection('organizations').doc(organizationId), {
        name, managerIds: organizationManagerIds, workerIds, createdBy: managerId, billingManagerId: managerId,
        chatSafetyEnabled: true, createdAt: now, updatedAt: now,
      });
      batch.create(db.collection('organizationBilling').doc(organizationId), {
        schemaVersion: 1, planId: 'free', status: 'free', accessMode: 'full', seatLimit: 5, seatReservations: {}, chatSafetyEnabled: true,
        purchaserUserId: null, sourceStore: null, productIdentifier: null, billingPeriod: null, willRenew: false,
        pendingPlanId: null, pendingBillingPeriod: null, pendingPlanEffectiveAt: null,
        initializedAtMs: Date.now(), createdAt: now, updatedAt: now,
      });
    }
    batch.create(db.collection('teams').doc(fixture.teamId), {
      name: 'Local Safety Team', managerId: byKey.manager.uid, managerIds, workerIds: workers,
      organizationId: fixture.organizationId, organizationName: fixture.organizationName, createdAt: now, updatedAt: now,
    });
    for (const [key, threadId] of Object.entries(fixture.threadIds)) {
      const threadParticipants = key === 'direct' || key === 'custom' ? [byKey.reporter.uid, byKey.reported.uid]
        : key === 'manager' ? [...managerIds, byKey.reporter.uid] : participants;
      const sender = key === 'manager' ? byKey.manager : byKey.reported;
      const text = 'Synthetic message for testing the report and block workflow. No real customer content.';
      batch.create(db.collection('chatThreads').doc(threadId), {
        id: threadId, organizationId: fixture.organizationId, teamId: key === 'team' ? fixture.teamId : null,
        title: key === 'direct' ? null : key === 'manager' ? byKey.reporter.displayName : key === 'team' ? 'Local Safety Team' : fixture.organizationName,
        kind: key, participants: threadParticipants, createdBy: byKey.manager.uid,
        lastMessageText: text, lastMessageSenderId: sender.uid, createdAt: now, updatedAt: now,
      });
      batch.create(db.collection('chatThreads').doc(threadId).collection('messages').doc(fixture.messageIds.reportable), {
        senderId: sender.uid, senderName: sender.displayName, text, attachments: [], createdAt: now,
      });
    }
    batch.update(marker, { state: 'ready', readyAt: now });
    await batch.commit();

    const outputDir = path.resolve(__dirname, '../../.local-data/chat-safety');
    fs.mkdirSync(outputDir, { recursive: true });
    const fixturePath = path.join(outputDir, `${runId}.json`);
    fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
    console.log(`Created isolated chat-safety fixture in ${PROJECT_ID}; no existing data was changed.`);
    console.log(`Fixture: ${fixturePath}`);
    for (const user of fixture.users) console.log(`${user.key}: ${user.email} / ${fixture.password}`);
  } catch (error) {
    await marker.update({ state: 'failed', failedAt: Timestamp.now() }).catch(() => {});
    throw error;
  }
}

if (require.main === module) seed().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { seed };
