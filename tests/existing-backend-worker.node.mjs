import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { before, beforeEach, after, test } from 'node:test';
import ts from 'typescript';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import * as firestore from 'firebase/firestore';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
let environment;
let ruleText;
const read = file => readFileSync(path.join(root, file), 'utf8');
const role = (overrides = {}) => ({
  id: 'role', name: 'Crew', assignedWorkerIds: [], waitlistWorkerIds: [], eligibleWaitlistWorkerIds: [],
  waitlistInviteWorkerIds: [], removedWorkerIds: [], openSlots: 1,
  tasks: [{ id: 'task', name: 'Check task', completedBy: [] }], ...overrides,
});
const event = (overrides = {}) => ({
  name: 'Existing backend event', managerId: 'manager', organizationId: 'org', revision: 0,
  workerIds: ['worker', 'other-worker'], roles: [role()], startsAt: '2025-01-01T00:00:00Z', ...overrides,
});
const notification = (overrides = {}) => ({
  workerId: 'worker', managerId: 'manager', eventId: 'event', roleId: 'role', action: 'assign', status: 'pending', ...overrides,
});
const clientDb = uid => environment.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
async function seed(values) {
  return environment.withSecurityRulesDisabled(async context => {
    const batch = firestore.writeBatch(context.firestore());
    for (const [key, value] of Object.entries(values)) batch.set(firestore.doc(context.firestore(), key), value);
    await batch.commit();
  });
}
function serviceFor(uid = 'worker', existingCustomer = true) {
  const db = clientDb(uid);
  const calls = [];
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const module = { exports: {} };
    cache.set(relative, module.exports);
    const code = ts.transpileModule(read(relative), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const localRequire = specifier => {
      if (specifier === 'firebase/firestore') return firestore;
      if (specifier === '@/lib/firebase') return { db, auth: { currentUser: uid ? { uid } : null }, functions: {} };
      if (specifier === '@/config/beta-mode') return { isExistingDispatchCustomerBeta: () => existingCustomer };
      if (specifier === 'firebase/functions') return { httpsCallable: (_functions, name) => async params => { calls.push({ name, params }); return { data: {} }; } };
      if (specifier === 'firebase/storage') return {};
      if (specifier.startsWith('@/')) return load(`${specifier.slice(2)}.ts`);
      if (specifier.startsWith('.')) return load(path.join(path.dirname(relative), `${specifier}.ts`));
      return require(specifier);
    };
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
    return module.exports;
  }
  return { service: load('services/dispatch.ts'), db, calls };
}
async function saved(db, key = 'events/event') { return (await firestore.getDoc(firestore.doc(db, key))).data(); }

before(async () => {
  // This is a read-only export of the existing deployed rules, audited against
  // origin/master. Never deploy the candidate subscription rules for this suite.
  const rulesPath = 'tests/fixtures/existing-dispatch-firestore.rules';
  ruleText = read(rulesPath);
  const audit = JSON.parse(read('tests/fixtures/existing-dispatch-firestore.audit.json'));
  assert.equal(createHash('sha256').update(ruleText.replace(/\r\n/g, '\n')).digest('hex'), audit.normalizedSha256);
  assert.equal(ruleText.includes('organizationWriteEnabled'), false, 'This suite requires the audited pre-billing rule snapshot.');
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:18180').split(':');
  environment = await initializeTestEnvironment({ projectId: 'demo-dispatch-existing-workers', firestore: { host, port: Number(port), rules: ruleText } });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await seed({
    'users/manager': { uid: 'manager', role: 'manager', organizationId: 'org' },
    'users/worker': { uid: 'worker', role: 'worker', organizationId: 'org', displayName: 'Worker' },
    'users/other-worker': { uid: 'other-worker', role: 'worker', organizationId: 'org' },
    'users/outsider': { uid: 'outsider', role: 'worker', organizationId: 'other-org' },
    'organizations/org': { name: 'Organization', managerIds: ['manager'], workerIds: ['worker', 'other-worker'] },
    'organizations/other-org': { managerIds: ['other-manager'], workerIds: ['outsider'] },
    'events/event': event(), 'roleAssignmentNotifications/invite': notification(),
  });
});
after(async () => environment?.cleanup());

test('existing customer can complete and undo only an assigned task through live-rule-compatible transactions', async () => {
  await seed({ 'events/event': event({ roles: [role({ assignedWorkerIds: ['worker'], openSlots: 0 })] }) });
  const { service, db, calls } = serviceFor();
  const params = { eventId: 'event', roleId: 'role', taskId: 'task', workerId: 'worker' };
  await service.toggleTaskCompletion({ ...params, complete: true });
  assert.deepEqual((await saved(db)).roles[0].tasks[0].completedBy, ['worker']);
  await service.toggleTaskCompletion({ ...params, complete: false });
  assert.deepEqual((await saved(db)).roles[0].tasks[0].completedBy, []);
  assert.deepEqual(calls, []);
});
test('existing customer can cancel an assigned role and notify the manager without changing event membership', async () => {
  await seed({ 'events/event': event({ roles: [role({ assignedWorkerIds: ['worker'], openSlots: 0 })] }) });
  const { service, db } = serviceFor();
  await service.cancelWorkerEventRole({ eventId: 'event', roleId: 'role', workerId: 'worker' });
  const result = await saved(db);
  assert.deepEqual(result.roles[0].assignedWorkerIds, []);
  assert.equal(result.roles[0].openSlots, 1);
  assert.deepEqual(result.workerIds, ['worker', 'other-worker']);
});
test('existing customer can join the event waitlist', async () => {
  const { service, db } = serviceFor();
  await service.joinEventRoleWaitlist({ eventId: 'event', roleId: 'role', workerId: 'worker' });
  assert.deepEqual((await saved(db)).roles[0].waitlistWorkerIds, ['worker']);
});
test('existing customer can waitlist their own pending notification', async () => {
  const { service, db } = serviceFor();
  await service.joinRoleWaitlist({ notificationId: 'invite', workerId: 'worker' });
  assert.deepEqual((await saved(db)).roles[0].waitlistWorkerIds, ['worker']);
  assert.equal((await saved(db, 'roleAssignmentNotifications/invite')).status, 'waitlisted');
});
test('existing customer can accept a waitlist opening while preserving the event roster', async () => {
  await seed({ 'events/event': event({ roles: [role({ waitlistWorkerIds: ['worker'], waitlistInviteWorkerIds: ['worker'] })] }) });
  const { service, db } = serviceFor();
  await service.acceptEventRoleWaitlistInvite({ eventId: 'event', roleId: 'role', workerId: 'worker' });
  const result = await saved(db);
  assert.deepEqual(result.roles[0].assignedWorkerIds, ['worker']);
  assert.equal(result.roles[0].openSlots, 0);
  assert.deepEqual(result.workerIds, ['worker', 'other-worker']);
});
for (const response of ['accept', 'decline']) {
  test(`existing customer can ${response} a role notification without dropping another invited worker`, async () => {
    const { service, db } = serviceFor();
    await service.respondToRoleAssignmentNotification({ notificationId: 'invite', workerId: 'worker', response });
    const result = await saved(db);
    assert.deepEqual(result.workerIds, ['worker', 'other-worker']);
    assert.equal((await saved(db, 'roleAssignmentNotifications/invite')).status, response === 'accept' ? 'accepted' : 'declined');
    assert.equal(result.roles[0].assignedWorkerIds.includes('worker'), response === 'accept');
  });
}
test('existing customer rejects spoofed identities, foreign events, wrong roles and unassigned tasks', async () => {
  const worker = serviceFor();
  const args = { eventId: 'event', roleId: 'role', taskId: 'task', workerId: 'worker', complete: true };
  await assert.rejects(worker.service.toggleTaskCompletion({ ...args, workerId: 'other-worker' }), /signed-in account/);
  await assert.rejects(serviceFor('outsider').service.joinEventRoleWaitlist({ eventId: 'event', roleId: 'role', workerId: 'outsider' }), error => error.code === 'permission-denied' || /organization/.test(error.message));
  await assert.rejects(serviceFor('manager').service.joinEventRoleWaitlist({ eventId: 'event', roleId: 'role', workerId: 'manager' }), /active Worker/);
  await assert.rejects(worker.service.toggleTaskCompletion(args), /assigned to this role/);
  await assertFails(firestore.updateDoc(firestore.doc(clientDb('outsider'), 'events/event'), { roles: [role()] }));
  assert.equal((await saved(worker.db)).revision, 0);
});
test('standard and local billing QA keep the server callable path for all six worker actions', async () => {
  const { service, calls } = serviceFor('worker', false);
  await service.cancelWorkerEventRole({ eventId: 'event', roleId: 'role', workerId: 'worker' });
  await service.joinRoleWaitlist({ notificationId: 'invite', workerId: 'worker' });
  await service.joinEventRoleWaitlist({ eventId: 'event', roleId: 'role', workerId: 'worker' });
  await service.acceptEventRoleWaitlistInvite({ eventId: 'event', roleId: 'role', workerId: 'worker' });
  await service.respondToRoleAssignmentNotification({ notificationId: 'invite', workerId: 'worker', response: 'accept' });
  await service.toggleTaskCompletion({ eventId: 'event', roleId: 'role', taskId: 'task', workerId: 'worker', complete: true });
  assert.equal(calls.length, 6);
  assert.ok(calls.every(call => call.name === 'mutateWorkerEvent' && !('workerId' in call.params)));
});
