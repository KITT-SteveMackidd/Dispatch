import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const CUSTOMER_PROJECT = 'dispatch-customer-beta';
const QA_PROJECT = 'dispatch-billing-qa';
let customer;
let qa;
let storageDocuments;

const context = (environment, uid = 'manager-a') => environment.authenticatedContext(uid, {
  email: `${uid}@example.test`, email_verified: true,
});
const dbFor = (environment, uid) => context(environment, uid).firestore();

async function privileged(environment, callback) {
  return environment.withSecurityRulesDisabled((ctx) => callback(ctx.firestore()));
}

async function seed(environment, projectId) {
  await privileged(environment, async (db) => {
    await Promise.all([
      setDoc(doc(db, 'dispatchConfig/billing'), { mode: 'customer_beta', projectId }),
      setDoc(doc(db, 'users/manager-a'), { uid: 'manager-a', role: 'manager', organizationId: 'org-a' }),
      setDoc(doc(db, 'users/worker-a'), { uid: 'worker-a', role: 'worker', organizationId: 'org-a' }),
      setDoc(doc(db, 'users/manager-b'), { uid: 'manager-b', role: 'manager', organizationId: 'org-b' }),
      setDoc(doc(db, 'users/new-manager'), { uid: 'new-manager', role: 'manager', organizationId: null }),
      setDoc(doc(db, 'organizations/org-a'), {
        name: 'Customer beta', createdBy: 'manager-a', billingManagerId: 'manager-a',
        managerIds: ['manager-a'], workerIds: ['worker-a', 'worker-2', 'worker-3', 'worker-4', 'worker-5', 'worker-6'],
      }),
      setDoc(doc(db, 'organizations/org-b'), { managerIds: ['manager-b'], workerIds: [], createdBy: 'manager-b' }),
      setDoc(doc(db, 'teams/team-a'), {
        name: 'Team', managerId: 'manager-a', managerIds: ['manager-a'], workerIds: ['worker-a'], organizationId: 'org-a',
      }),
      setDoc(doc(db, 'events/event-a'), {
        name: 'Event', managerId: 'manager-a', organizationId: 'org-a', workerIds: ['worker-a'], teamIds: ['team-a'], roles: [], revision: 0,
      }),
      setDoc(doc(db, 'chatThreads/thread-a'), {
        id: 'thread-a', kind: 'custom', title: 'Team', organizationId: 'org-a',
        participants: ['manager-a', 'worker-a'], createdBy: 'manager-a',
      }),
    ]);
  });
}

before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8180').split(':');
  const [storageHost, storagePort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9299').split(':');
  const firestore = { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') };
  const storage = { host: storageHost, port: Number(storagePort), rules: await readFile('storage.rules', 'utf8') };
  customer = await initializeTestEnvironment({ projectId: CUSTOMER_PROJECT, firestore, storage });
  qa = await initializeTestEnvironment({ projectId: QA_PROJECT, firestore, storage });
  // firebase-tools Storage emulator resolves firestore.get against its CLI
  // project, not the bucket's project. Seed only the supporting documents there;
  // authenticated contexts still carry the actual customer/QA project audience.
  storageDocuments = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || 'demo-dispatch-android-rules', firestore,
  });
});

beforeEach(async () => {
  await Promise.all([customer.clearFirestore(), qa.clearFirestore(), storageDocuments.clearFirestore()]);
  await seed(customer, CUSTOMER_PROJECT);
  await seed(qa, QA_PROJECT);
});

after(async () => {
  await Promise.all([customer?.cleanup(), qa?.cleanup(), storageDocuments?.cleanup()]);
});

test('customer beta writes work above five members without a billing record, preserving roles and tenant ownership', async () => {
  const manager = dbFor(customer, 'manager-a');
  await assertSucceeds(updateDoc(doc(manager, 'teams/team-a'), { name: 'Updated team' }));
  await assertSucceeds(updateDoc(doc(manager, 'events/event-a'), { name: 'Updated event' }));
  await assertSucceeds(setDoc(doc(manager, 'chatThreads/new-managed-thread'), {
    organizationId: 'org-a', participants: ['manager-a', 'worker-a'], kind: 'custom', createdBy: 'manager-a', title: 'Managed chat',
  }));
  await assertSucceeds(setDoc(doc(dbFor(customer, 'worker-a'), 'chatThreads/new-managed-thread/messages/first'), {
    senderId: 'worker-a', recipientIds: ['manager-a'], text: 'Allowed above five seats',
  }));
  await assertSucceeds(updateDoc(doc(manager, 'chatThreads/new-managed-thread'), { title: 'Updated managed chat' }));
  await assertFails(updateDoc(doc(dbFor(customer, 'worker-a'), 'teams/team-a'), { name: 'Worker takeover' }));
  await assertFails(updateDoc(doc(dbFor(customer, 'manager-b'), 'events/event-a'), { name: 'Other organization' }));
  await assertFails(updateDoc(doc(customer.unauthenticatedContext().firestore(), 'events/event-a'), { name: 'Anonymous' }));
});

test('customer beta requires its exact trusted policy and never falls back to a billing grant', async () => {
  const manager = dbFor(customer, 'manager-a');
  await privileged(customer, async (db) => {
    await setDoc(doc(db, 'organizationBilling/org-a'), { accessMode: 'full' });
    await deleteDoc(doc(db, 'dispatchConfig/billing'));
  });
  await assertFails(updateDoc(doc(manager, 'events/event-a'), { name: 'Missing policy' }));
  for (const policy of [
    { mode: 'customer_beta', projectId: 'dispatch-eb63a' },
    { mode: 'billing_qa', projectId: CUSTOMER_PROJECT },
  ]) {
    await privileged(customer, (db) => setDoc(doc(db, 'dispatchConfig/billing'), policy));
    await assertFails(updateDoc(doc(manager, 'events/event-a'), { name: 'Wrong policy' }));
  }
});

test('the trusted beta policy cannot be read, created, altered or deleted by any client', async () => {
  for (const uid of ['manager-a', 'worker-a', 'manager-b']) {
    const db = dbFor(customer, uid);
    await assertFails(getDoc(doc(db, 'dispatchConfig/billing')));
    await assertFails(setDoc(doc(db, 'dispatchConfig/billing'), { mode: 'customer_beta', projectId: CUSTOMER_PROJECT }));
    await assertFails(deleteDoc(doc(db, 'dispatchConfig/billing')));
  }
  await assertFails(setDoc(doc(customer.unauthenticatedContext().firestore(), 'dispatchConfig/billing'), { mode: 'customer_beta' }));
});

test('a copied beta policy does not disable subscription enforcement in the QA project', async () => {
  const manager = dbFor(qa, 'manager-a');
  await assertFails(updateDoc(doc(manager, 'events/event-a'), { name: 'Missing billing' }));
  await privileged(qa, (db) => setDoc(doc(db, 'organizationBilling/org-a'), { accessMode: 'read_only' }));
  await assertFails(updateDoc(doc(manager, 'events/event-a'), { name: 'Read only' }));
  await privileged(qa, (db) => setDoc(doc(db, 'organizationBilling/org-a'), { accessMode: 'full' }));
  await assertSucceeds(updateDoc(doc(manager, 'events/event-a'), { name: 'Paid QA access' }));
});

test('customer beta onboarding creates an organization without manufacturing a paid subscription', async () => {
  const db = dbFor(customer, 'new-manager');
  const batch = writeBatch(db);
  batch.set(doc(db, 'organizations/new-org'), {
    name: 'New beta organization', createdBy: 'new-manager', billingManagerId: 'new-manager',
    managerIds: ['new-manager'], workerIds: [], pendingManagerInviteEmails: [], pendingManagerInviteCanonicalEmails: [],
  });
  batch.update(doc(db, 'users/new-manager'), { organizationId: 'new-org', organizationName: 'New beta organization' });
  await assertSucceeds(batch.commit());
  await assertSucceeds(setDoc(doc(db, 'teams/new-team'), {
    name: 'First team', managerId: 'new-manager', managerIds: ['new-manager'], workerIds: [], organizationId: 'new-org',
  }));
  await privileged(customer, async (adminDb) => {
    if ((await getDoc(doc(adminDb, 'organizationBilling/new-org'))).exists()) throw new Error('Beta must not create a paid billing record');
  });
});

test('customer beta still honors account deletion fences', async () => {
  await privileged(customer, (db) => setDoc(doc(db, 'accountDeletionTombstones/manager-a'), { status: 'deleting' }));
  await assertFails(updateDoc(doc(dbFor(customer, 'manager-a'), 'events/event-a'), { name: 'Deleting user' }));
});

test('customer beta chat and template uploads use policy access within the two-document Storage limit', async () => {
  await seed(storageDocuments, CUSTOMER_PROJECT);
  const manager = context(customer, 'manager-a').storage();
  const worker = context(customer, 'worker-a').storage();
  await assertSucceeds(uploadBytes(ref(manager, 'dispatchTemplateAttachments/manager-a/test.txt'), new Uint8Array([1, 2])));
  await assertSucceeds(uploadBytes(ref(worker, 'chatAttachments/thread-a/worker-a/test.txt'), new Uint8Array([1, 2])));
  await assertFails(uploadBytes(ref(context(customer, 'manager-b').storage(), 'chatAttachments/thread-a/manager-b/test.txt'), new Uint8Array([1])));
  await assertFails(uploadBytes(ref(worker, 'chatAttachments/thread-a/manager-a/test.txt'), new Uint8Array([1])));
  await assertFails(uploadBytes(ref(customer.unauthenticatedContext().storage(), 'chatAttachments/thread-a/worker-a/test.txt'), new Uint8Array([1])));
});

test('QA storage retains billing enforcement and customer storage fails closed without policy', async () => {
  await seed(storageDocuments, QA_PROJECT);
  const qaStorage = context(qa, 'worker-a').storage();
  const path = 'chatAttachments/thread-a/worker-a/test.txt';
  await assertFails(uploadBytes(ref(qaStorage, path), new Uint8Array([1])));
  await privileged(storageDocuments, (db) => setDoc(doc(db, 'organizationBilling/org-a'), { accessMode: 'full' }));
  await assertSucceeds(uploadBytes(ref(qaStorage, path), new Uint8Array([1])));
  await privileged(storageDocuments, (db) => updateDoc(doc(db, 'organizationBilling/org-a'), { accessMode: 'read_only' }));
  await assertFails(uploadBytes(ref(qaStorage, path), new Uint8Array([1])));
  await privileged(storageDocuments, (db) => deleteDoc(doc(db, 'dispatchConfig/billing')));
  await assertFails(uploadBytes(ref(context(customer, 'worker-a').storage(), path), new Uint8Array([1])));
});

test('customer orphan recovery keeps history readable but blocks writes and clearing server-owned recovery markers', async () => {
  await privileged(customer, async (db) => {
    await updateDoc(doc(db, 'organizations/org-a'), { managerIds: [], recoveryState: 'orphaned_no_manager' });
    await updateDoc(doc(db, 'users/worker-a'), { organizationRecoveryState: 'orphaned_no_manager' });
    await updateDoc(doc(db, 'chatThreads/thread-a'), { organizationRecoveryState: 'orphaned_no_manager', participants: ['worker-a'] });
    await setDoc(doc(db, 'chatThreads/thread-a/messages/retained'), { senderId: 'worker-a', recipientIds: [], text: 'Retained' });
  });
  const worker = dbFor(customer, 'worker-a');
  await assertSucceeds(getDoc(doc(worker, 'events/event-a')));
  await assertSucceeds(getDoc(doc(worker, 'chatThreads/thread-a/messages/retained')));
  await assertFails(setDoc(doc(worker, 'chatThreads/thread-a/messages/blocked'), { senderId: 'worker-a', recipientIds: [], text: 'Blocked' }));
  await assertFails(setDoc(doc(worker, 'chatThreads/new-thread'), { organizationId: 'org-a', participants: ['worker-a'], kind: 'custom' }));
  await assertFails(updateDoc(doc(worker, 'users/worker-a'), { organizationRecoveryState: 'active' }));
  await assertFails(updateDoc(doc(worker, 'chatThreads/thread-a'), { organizationRecoveryState: 'active' }));
  await assertFails(updateDoc(doc(dbFor(customer, 'manager-a'), 'events/event-a'), { name: 'Stale Manager' }));
  await privileged(customer, (db) => updateDoc(doc(db, 'organizations/org-a'), { managerIds: ['manager-a'] }));
  await assertFails(updateDoc(doc(dbFor(customer, 'manager-a'), 'events/event-a'), { name: 'Recovery still pending' }));
  await privileged(customer, (db) => setDoc(doc(db, 'organizations/org-a'), { managerIds: [], workerIds: ['worker-a'] }));
  await assertFails(updateDoc(doc(dbFor(customer, 'manager-a'), 'events/event-a'), { name: 'Missing managers without marker' }));
});

test('customer Storage recovery projections deny uploads within two document reads and preserve existing attachment reads', async () => {
  await seed(storageDocuments, CUSTOMER_PROJECT);
  const worker = context(customer, 'worker-a').storage();
  const chatPath = 'chatAttachments/thread-a/worker-a/retained.txt';
  const templatePath = 'dispatchTemplateAttachments/worker-a/retained.txt';
  await assertSucceeds(uploadBytes(ref(worker, chatPath), new Uint8Array([1, 2])));
  await assertSucceeds(uploadBytes(ref(worker, templatePath), new Uint8Array([1, 2])));
  await privileged(storageDocuments, async (db) => {
    await updateDoc(doc(db, 'users/worker-a'), { organizationRecoveryState: 'orphaned_no_manager' });
    await updateDoc(doc(db, 'chatThreads/thread-a'), { organizationRecoveryState: 'orphaned_no_manager' });
  });
  await assertSucceeds(getBytes(ref(worker, chatPath)));
  await assertSucceeds(getBytes(ref(worker, templatePath)));
  await assertFails(uploadBytes(ref(worker, 'chatAttachments/thread-a/worker-a/blocked.txt'), new Uint8Array([3])));
  await assertFails(uploadBytes(ref(worker, 'dispatchTemplateAttachments/worker-a/blocked.txt'), new Uint8Array([3])));
});
