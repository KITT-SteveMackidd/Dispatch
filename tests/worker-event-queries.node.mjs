import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';

const address = process.env.FIRESTORE_EMULATOR_HOST;
if (!address || !/^(127\.0\.0\.1|localhost):18180$/.test(address)) throw new Error('Use the dedicated test emulator on port 18180; shared QA is not allowed.');
const [host, port] = address.split(':');
let environment;
before(async () => {
  environment = await initializeTestEnvironment({ projectId: 'demo-dispatch-event-query-tests', firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users/worker-a'), { uid: 'worker-a', role: 'worker', organizationId: 'org-a' }),
      setDoc(doc(db, 'users/manager-a'), { uid: 'manager-a', role: 'manager', organizationId: 'org-a' }),
      setDoc(doc(db, 'events/current'), { organizationId: 'org-a', managerId: 'manager-a', workerIds: ['worker-a'] }),
      setDoc(doc(db, 'events/unassigned'), { organizationId: 'org-a', managerId: 'manager-a', workerIds: [] }),
      setDoc(doc(db, 'events/stale-other-org'), { organizationId: 'org-b', managerId: 'manager-a', workerIds: ['worker-a'] }),
      setDoc(doc(db, 'events/explicit-legacy'), { organizationId: null, teamId: null, managerId: 'manager-a', workerIds: ['worker-a'] }),
      setDoc(doc(db, 'teams/other-org-team'), { organizationId: 'org-b' }),
      setDoc(doc(db, 'events/legacy-other-team'), { organizationId: null, teamId: 'other-org-team', managerId: 'manager-a', workerIds: ['worker-a'] }),
    ]);
  });
});
after(async () => { await environment?.clearFirestore(); await environment?.cleanup(); });
const events = uid => collection(environment.authenticatedContext(uid).firestore(), 'events');

test('worker query returns current organization assignments and excludes stale cross-organization IDs', async () => {
  const snapshot = await assertSucceeds(getDocs(query(events('worker-a'), where('organizationId', '==', 'org-a'), where('workerIds', 'array-contains', 'worker-a'))));
  assert.deepEqual(snapshot.docs.map(item => item.id), ['current']);
  await assertFails(getDocs(query(events('worker-a'), where('workerIds', 'array-contains', 'worker-a'))));
  await assertFails(getDocs(query(events('worker-a'), where('organizationId', '==', 'org-b'), where('workerIds', 'array-contains', 'worker-a'))));
});
test('manager organization query only returns current organization events', async () => {
  const snapshot = await assertSucceeds(getDocs(query(events('manager-a'), where('organizationId', '==', 'org-a'))));
  assert.deepEqual(snapshot.docs.map(item => item.id).sort(), ['current', 'unassigned']);
});
test('stale manager and worker IDs do not authorize direct reads from another organization', async () => {
  for (const uid of ['worker-a', 'manager-a']) {
    await assertFails(getDoc(doc(environment.authenticatedContext(uid).firestore(), 'events/stale-other-org')));
  }
});
test('event list Rules reject unscoped managerId queries with stale ownership', async () => {
  await assertFails(getDocs(query(events('manager-a'), where('managerId', '==', 'manager-a'))));
});
