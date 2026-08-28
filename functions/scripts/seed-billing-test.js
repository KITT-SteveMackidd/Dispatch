const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const projectId = process.env.GCLOUD_PROJECT;
const requiredProjectId = 'demo-dispatch-billing';
if (projectId !== requiredProjectId) {
  throw new Error(`Refusing to seed project ${projectId || 'unknown'}; expected ${requiredProjectId}.`);
}
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Refusing to seed without Auth and Firestore emulator hosts.');
}
const runId = String(process.env.BILLING_TEST_RUN_ID || '').trim().toLowerCase();
if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(runId)) {
  throw new Error('Refusing to seed without a valid BILLING_TEST_RUN_ID.');
}

const app = initializeApp({
  projectId,
  storageBucket: `${projectId}.firebasestorage.app`,
});

const auth = getAuth(app);
const db = getFirestore(app);
const now = Timestamp.now();
const organizationId = `billing-test-organization-${runId}`;
const password = 'DispatchLocal123!';
const users = [
  {
    uid: `billing-manager-${runId}`,
    email: 'billing.manager@example.test',
    displayName: 'Local Billing Manager',
    role: 'manager',
  },
  {
    uid: `second-manager-${runId}`,
    email: 'second.manager@example.test',
    displayName: 'Local Second Manager',
    role: 'manager',
  },
  {
    uid: `worker-${runId}`,
    email: 'worker@example.test',
    displayName: 'Local Worker',
    role: 'worker',
  },
];

async function upsertAuthUser(user) {
  try {
    await auth.updateUser(user.uid, {
      email: user.email,
      password,
      displayName: user.displayName,
      emailVerified: true,
      disabled: false,
    });
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    await auth.createUser({
      uid: user.uid,
      email: user.email,
      password,
      displayName: user.displayName,
      emailVerified: true,
    });
  }
}

async function seed() {
  await Promise.all(users.map(upsertAuthUser));

  const batch = db.batch();
  for (const user of users) {
    batch.set(db.collection('users').doc(user.uid), {
      uid: user.uid,
      email: user.email,
      canonicalEmail: user.email,
      displayName: user.displayName,
      role: user.role,
      organizationId,
      organizationName: 'Local Billing Test Organization',
      onboardingCompleted: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  batch.set(db.collection('organizations').doc(organizationId), {
    name: 'Local Billing Test Organization',
    managerIds: [users[0].uid, users[1].uid],
    workerIds: [users[2].uid],
    createdBy: users[0].uid,
    billingManagerId: users[0].uid,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(db.collection('organizationBilling').doc(organizationId), {
    schemaVersion: 1,
    planId: 'free',
    status: 'free',
    accessMode: 'full',
    seatLimit: 5,
    seatReservations: {},
    purchaserUserId: null,
    sourceStore: null,
    productIdentifier: null,
    billingPeriod: null,
    willRenew: false,
    pendingPlanId: null,
    pendingBillingPeriod: null,
    pendingPlanEffectiveAt: null,
    initializedAtMs: Date.now(),
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();

  console.log('Seeded isolated billing test organization.');
  console.log(`Billing Manager: ${users[0].email} / ${password}`);
  console.log(`Second Manager: ${users[1].email} / ${password}`);
  console.log(`Worker: ${users[2].email} / ${password}`);
  console.log(`Billing test run ID: ${runId}`);
  console.log(`RevenueCat App User ID for the first payer: ${users[0].uid}`);
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
