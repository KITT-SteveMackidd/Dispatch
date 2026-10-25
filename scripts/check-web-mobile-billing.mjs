// Authenticated mobile API smoke against the shared local web test organization.
// No Admin writes or client-granted entitlements: the callable verifies RevenueCat.
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, terminate } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

const runId = process.argv[2];
const expectedPlan = process.argv[3];
if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(runId || '') || !['free', 'crew', 'production', 'organization'].includes(expectedPlan)) {
  throw new Error('Usage: node scripts/check-web-mobile-billing.mjs <web-run-id> <expected-plan>');
}
const app = initializeApp({ projectId: 'demo-dispatch-billing', apiKey: 'demo-api-key', appId: 'demo-mobile-billing-check' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
const functions = getFunctions(app, 'us-central1');
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const orgId = `web-checkout-organization-${runId}`;
try {
  await signInWithEmailAndPassword(auth, `billing.${runId}@example.test`, 'DispatchLocal123!');
  const result = (await httpsCallable(functions, 'refreshOrganizationSubscription')({ purchaseStore: 'test_store' })).data;
  assert.equal(result.planId, expectedPlan);
  assert.equal(result.seatLimit, { free: 5, crew: 20, production: 50, organization: 100 }[expectedPlan]);
  const stored = (await getDoc(doc(db, 'organizationBilling', orgId))).data();
  assert.equal(stored.planId, expectedPlan);
  assert.equal(stored.seatLimit, result.seatLimit);
  if (expectedPlan !== 'free') {
    assert.equal(stored.sourceStore, 'rc_billing');
    for (const [name, data] of [
      ['prepareOrganizationSubscriptionChange', { planId: 'organization', billingPeriod: 'annual', purchaseStore: 'test_store' }],
      ['prepareOrganizationSubscriptionRestore', { purchaseStore: 'test_store' }],
    ]) {
      await assert.rejects(httpsCallable(functions, name)(data), error => error.code === 'functions/failed-precondition');
    }
  }
  await signInWithEmailAndPassword(auth, `manager.${runId}@example.test`, 'DispatchLocal123!');
  assert.equal((await getDoc(doc(db, 'organizationBilling', orgId))).data().planId, expectedPlan);
  await assert.rejects(httpsCallable(functions, 'refreshOrganizationSubscription')({ purchaseStore: 'test_store' }), error => error.code === 'functions/permission-denied');
  console.log(JSON.stringify({ project: 'demo-dispatch-billing', plan: result.planId, seats: result.seatLimit, sourceStore: result.sourceStore, billingManagerVerification: 'passed', sharedManagerRead: 'passed', unauthorizedRefresh: 'rejected', mobileDuplicatePurchase: expectedPlan === 'free' ? 'not applicable' : 'rejected' }));
} finally {
  await terminate(db);
  await deleteApp(app);
}
