const { PROJECT_ID, assertLocalChatSafetyEnvironment, chatSafetyFixture, assertChatSafetyProfileMatches } = require('./chat-safety-test-common');

async function restore() {
  const runId = assertLocalChatSafetyEnvironment();
  process.env.METADATA_SERVER_DETECTION = 'none';
  const fixture = chatSafetyFixture(runId);
  const { initializeApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth(app);
  const db = getFirestore(app);
  const marker = (await db.collection('localChatSafetyRuns').doc(runId).get()).data();
  if (marker?.state !== 'ready' || marker.runId !== runId || marker.organizationId !== fixture.organizationId) {
    throw new Error('A verified ready synthetic fixture must exist before restoring missing Auth identities.');
  }
  const missing = [];
  for (const user of fixture.users) {
    assertChatSafetyProfileMatches(user, (await db.collection('users').doc(user.uid).get()).data());
    try {
      const existing = await auth.getUser(user.uid);
      if (existing.email !== user.email) throw new Error(`Auth identity mismatch for ${user.uid}.`);
      if (user.key === 'operator' && existing.customClaims?.dispatchModerator !== true) {
        throw new Error('The existing operator account has unexpected claims; no account will be changed.');
      }
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
      try {
        await auth.getUserByEmail(user.email);
        throw new Error(`Email ${user.email} already belongs to another Auth identity.`);
      } catch (lookupError) {
        if (lookupError.code !== 'auth/user-not-found') throw lookupError;
      }
      missing.push(user);
    }
  }
  for (const user of missing) {
    await auth.createUser({ uid: user.uid, email: user.email, displayName: user.displayName, password: fixture.password, emailVerified: true });
    if (user.key === 'operator') await auth.setCustomUserClaims(user.uid, { dispatchModerator: true });
  }
  console.log(`Restored ${missing.length} missing local Auth identities for ${runId}. Existing Auth identities and all Firestore documents were unchanged.`);
}

if (require.main === module) restore().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { restore };
