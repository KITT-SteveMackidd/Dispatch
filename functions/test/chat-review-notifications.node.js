const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatReviewNotificationService, notificationIdFor } = require('../lib/chat-review-notifications');
const { createChatSafetyService } = require('../lib/chat-safety');
const { MemoryFirestore, FieldValue } = require('./helpers/chat-safety-memory');

function harness(options = {}) {
  const db = new MemoryFirestore({
    'organizations/a': { chatSafetyEnabled: true, managerIds: ['m1', 'm2'], workerIds: ['reporter', 'target'] },
    'organizationBilling/a': { chatSafetyEnabled: true },
    'organizations/b': { chatSafetyEnabled: true, managerIds: ['m3'], workerIds: [] },
    'organizationBilling/b': { chatSafetyEnabled: true },
    ...['m1', 'm2', 'reporter', 'target'].reduce((rows, uid) => ({ ...rows, [`users/${uid}`]: {
      uid, organizationId: 'a', role: uid.startsWith('m') ? 'Manager' : 'Worker',
    } }), {}),
    'users/m3': { uid: 'm3', organizationId: 'b', role: 'Manager' },
  });
  const dependencies = { getDb: () => db, getFieldValue: () => FieldValue, projectId: () => 'demo-dispatch-billing' };
  const service = createChatReviewNotificationService({ ...dependencies, ...options });
  const safety = createChatSafetyService({ ...dependencies, getPendingReviewCount: service.pendingReviewCount });
  const report = (id, changes = {}) => {
    const data = { organizationId: 'a', reporterUserId: 'reporter', targetUserId: 'target', status: 'submitted', ...changes };
    db.documents.set(`chatSafetyReports/${id}`, data);
    return data;
  };
  const count = uid => db.runTransaction(tx => service.pendingReviewCount(tx, {
    uid, profile: db.documents.get(`users/${uid}`), organizationId: db.documents.get(`users/${uid}`).organizationId, enabled: true,
  }));
  const state = (uid, token = {}) => safety.getState({ auth: { uid, token }, data: {} });
  return { db, service, report, count, state };
}

test('new report creates only generic authorized-manager notices once, even after user dismisses the notice', async () => {
  const h = harness();
  const after = h.report('r', { details: 'Private report text', targetDisplayName: 'Private target' });
  assert.deepEqual(await h.service.handleReportWrite({ reportId: 'r', after }), { created: 2 });
  for (const uid of ['m1', 'm2']) {
    const id = notificationIdFor('r', uid);
    const notice = h.db.documents.get(`userNotifications/${id}`);
    assert.deepEqual(Object.keys(notice).sort(), ['body', 'createdAt', 'kind', 'organizationId', 'pushAuthorized', 'read', 'title', 'userId']);
    assert.equal(notice.body, 'A chat safety report is ready for review.');
    assert.equal(notice.title, 'Chat report needs review');
    assert.equal(notice.kind, 'chat_safety_report');
    assert.equal(await h.service.canDeliver({ notificationId: id, recipientId: uid }), true);
  }
  const notices = [...h.db.documents.keys()].filter(path => path.startsWith('userNotifications/'));
  assert.equal(notices.length, 2);
  h.db.documents.delete(notices[0]);
  assert.deepEqual(await h.service.handleReportWrite({ reportId: 'r', after }), { created: 0 });
  assert.equal(h.db.documents.has(notices[0]), false);
});

test('reporter and reported-self Manager conflicts exclude notices and unresolved counts', async () => {
  const h = harness();
  const after = h.report('conflict', { reporterUserId: 'm1', targetUserId: 'm2' });
  assert.deepEqual(await h.service.handleReportWrite({ reportId: 'conflict', after }), { created: 0 });
  assert.equal(await h.count('m1'), 0);
  assert.equal(await h.count('m2'), 0);
  assert.equal((await h.state('m1', { dispatchModerator: true })).pendingReviewCount, 0);
});

test('badge counts unresolved reports independently of read notices, including pending cleanup', async () => {
  const h = harness();
  const after = h.report('r');
  h.report('cleanup', { status: 'under_review', moderationAction: { status: 'cleanup_pending' } });
  h.report('done', { status: 'resolved' });
  h.report('dismissed', { status: 'dismissed' });
  h.report('foreign', { organizationId: 'b' });
  await h.service.handleReportWrite({ reportId: 'r', after });
  h.db.documents.get(`userNotifications/${notificationIdFor('r', 'm1')}`).read = true;
  assert.equal((await h.state('m1')).pendingReviewCount, 2);
  const resolved = { ...after, status: 'resolved' };
  h.db.documents.set('chatSafetyReports/r', resolved);
  const version = h.db.documents.get('users/m1/chatSafetyState/current').version;
  await h.service.handleReportWrite({ reportId: 'r', before: after, after: resolved });
  assert.equal(await h.count('m1'), 1);
  assert.ok(h.db.documents.get('users/m1/chatSafetyState/current').version > version);
  assert.equal(await h.service.canDeliver({ notificationId: notificationIdFor('r', 'm1'), recipientId: 'm1' }), false);
  h.db.documents.get('chatSafetyReports/cleanup').status = 'resolved';
  assert.equal(await h.count('m1'), 0);
});

test('delayed creation after resolution or deletion never creates a stale review alert', async () => {
  const h = harness();
  const after = h.report('r');
  h.db.documents.set('chatSafetyReports/r', { ...after, status: 'dismissed' });
  assert.deepEqual(await h.service.handleReportWrite({ reportId: 'r', after }), { created: 0 });
  h.db.documents.delete('chatSafetyReports/r');
  assert.deepEqual(await h.service.handleReportWrite({ reportId: 'r', after }), { created: 0 });
});

test('current role, organization, roster, deletion fence and paired rollout protect delivery and counts', async () => {
  for (const change of ['role', 'organization', 'roster', 'deletion', 'off', 'mismatch']) {
    const h = harness();
    const after = h.report('r');
    await h.service.handleReportWrite({ reportId: 'r', after });
    const user = h.db.documents.get('users/m1');
    if (change === 'role') user.role = 'Worker';
    if (change === 'organization') user.organizationId = 'b';
    if (change === 'roster') h.db.documents.get('organizations/a').managerIds = ['m2'];
    if (change === 'deletion') user.accountDeletionStartedAt = new Date();
    if (change === 'off' || change === 'mismatch') h.db.documents.get('organizations/a').chatSafetyEnabled = false;
    if (change === 'off') h.db.documents.get('organizationBilling/a').chatSafetyEnabled = false;
    assert.equal(await h.count('m1'), 0, change);
    assert.equal(await h.service.canDeliver({ notificationId: notificationIdFor('r', 'm1'), recipientId: 'm1' }), false, change);
    const next = h.report('next');
    await h.service.handleReportWrite({ reportId: 'next', after: next });
    assert.equal(h.db.documents.has(`userNotifications/${notificationIdFor('next', 'm1')}`), false, change);
  }
});

test('deletion-fenced state removes reviewer access/count, including operator claims', async () => {
  const h = harness();
  h.report('r');
  h.db.documents.get('users/m1').accountDeletionStartedAt = new Date();
  for (const token of [{}, { dispatchModerator: true }]) {
    const state = await h.state('m1', token);
    assert.equal(state.canModerate, false);
    assert.equal(state.pendingReviewCount, 0);
  }
});

test('authority changes signal affected reviewers without creating new notices', async () => {
  const h = harness();
  const before = { ...h.db.documents.get('users/m1') };
  const after = { ...before, role: 'Worker' };
  h.db.documents.set('users/m1', after);
  await h.service.handleUserAuthorityChange({ uid: 'm1', before, after });
  assert.equal(h.db.documents.get('users/m1/chatSafetyState/current').version, 1);
  await h.service.handleOrganizationAuthorityChange({ before: { managerIds: ['m1'], chatSafetyEnabled: true }, after: { managerIds: ['m2'], chatSafetyEnabled: true } });
  assert.equal(h.db.documents.get('users/m1/chatSafetyState/current').version, 2);
  assert.equal(h.db.documents.get('users/m2/chatSafetyState/current').version, 1);
  assert.equal([...h.db.documents.keys()].some(path => path.startsWith('userNotifications/')), false);
});

test('account-maintenance fence stops report-trigger writes until a safe retry', async () => {
  let maintenance = true;
  const h = harness({ assertMutationAllowed: async () => { if (maintenance) throw Error('account maintenance'); } });
  const after = h.report('r');
  await assert.rejects(h.service.handleReportWrite({ reportId: 'r', after }), /account maintenance/);
  assert.equal([...h.db.documents.keys()].some(path => path.startsWith('chatReviewNotificationSources/')), false);
  maintenance = false;
  assert.equal((await h.service.handleReportWrite({ reportId: 'r', after })).created, 2);
});
