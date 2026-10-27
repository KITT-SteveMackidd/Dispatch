const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PROJECT_ID, EMULATOR_HOSTS, assertLocalChatSafetyEnvironment, chatSafetyFixture, assertChatSafetyProfileMatches } = require('../scripts/chat-safety-test-common');

const local = { GCLOUD_PROJECT: PROJECT_ID, ...EMULATOR_HOSTS, CHAT_SAFETY_TEST_RUN_ID: 'safety-test' };
test('chat safety harness only accepts the fixed local demo project and emulator endpoints', () => {
  assert.equal(assertLocalChatSafetyEnvironment(local), 'safety-test');
  for (const GCLOUD_PROJECT of ['dispatch-eb63a', 'dispatch-customer-beta', 'demo-another-project', undefined]) {
    assert.throws(() => assertLocalChatSafetyEnvironment({ ...local, GCLOUD_PROJECT }));
  }
  for (const field of Object.keys(EMULATOR_HOSTS)) {
    for (const value of ['', undefined, 'firestore.googleapis.com:443', '192.168.1.45:8080', '127.0.0.1:1234']) {
      assert.throws(() => assertLocalChatSafetyEnvironment({ ...local, [field]: value }));
    }
  }
});
test('Auth recovery only accepts the exact synthetic Firestore identity', () => {
  const user = chatSafetyFixture('recovery-test').users[0];
  assert.doesNotThrow(() => assertChatSafetyProfileMatches(user, { ...user }));
  for (const profile of [undefined, { ...user, uid: 'another-user' }, { ...user, email: 'other@example.test' }, { ...user, organizationId: 'another-org' }]) {
    assert.throws(() => assertChatSafetyProfileMatches(user, profile));
  }
});
test('chat safety harness rejects conflicting Firebase project metadata and unsafe run IDs', () => {
  for (const extra of [
    { GOOGLE_CLOUD_PROJECT: 'dispatch-eb63a' }, { GCP_PROJECT: 'dispatch-eb63a' },
    { FIREBASE_CONFIG: '{"projectId":"dispatch-eb63a"}' }, { FIREBASE_CONFIG: '/tmp/config.json' },
    ...['', '../other', 'unsafe/child', 'UPPERCASE', 'x'.repeat(33)].map((CHAT_SAFETY_TEST_RUN_ID) => ({ CHAT_SAFETY_TEST_RUN_ID })),
  ]) assert.throws(() => assertLocalChatSafetyEnvironment({ ...local, ...extra }));
});
test('each synthetic chat safety run has independent accounts and organization IDs', () => {
  const first = chatSafetyFixture('first-run');
  const second = chatSafetyFixture('second-run');
  assert.notEqual(first.organizationId, second.organizationId);
  assert.equal(first.users.length, 6);
  const firstIds = first.users.map((user) => user.uid);
  const firstEmails = first.users.map((user) => user.email);
  assert.equal(new Set(firstIds).size, 6);
  assert.equal(new Set(firstEmails).size, 6);
  assert.ok(second.users.every((user) => !firstIds.includes(user.uid) && !firstEmails.includes(user.email)));
  assert.ok(firstEmails.every((email) => email.endsWith('@example.test')));
  assert.ok(first.threadIds.direct.startsWith('dm:'));
  assert.ok(first.users.find((user) => user.key === 'outsider').organizationId !== first.organizationId);
  assert.ok(first.users.find((user) => user.key === 'operator').organizationId !== first.organizationId);
  const organizationUsers = first.users.filter((user) => user.organizationId === first.organizationId);
  assert.equal(organizationUsers.length, 4);
  assert.equal(organizationUsers.filter((user) => user.role === 'manager').length, 2);
});
