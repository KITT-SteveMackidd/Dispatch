const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatSafetyService } = require('../lib/chat-safety');
const { createChatReportService, encodeReportCursor, decodeReportCursor } = require('../lib/chat-safety-reports');

function harness() {
  const docs = new Map([
    ['organizations/org', { chatSafetyEnabled: true, managerIds: ['manager'], workerIds: ['a', 'b'] }],
    ['organizationBilling/org', { chatSafetyEnabled: true, accessMode: 'full' }],
    ...['manager', 'a', 'b'].map(uid => [`users/${uid}`, { uid, organizationId: 'org', displayName: `Profile ${uid}` }]),
    ['users/outsider', { uid: 'outsider', organizationId: 'other', displayName: 'Private other organization name' }],
    ['chatThreads/group', { organizationId: 'org', kind: 'organization', title: 'Crew', participants: ['a', 'b', 'manager'] }],
    ['chatThreads/other', { organizationId: 'other', participants: ['outsider'] }],
    ['chatThreads/group/messages/message', { senderId: 'b', senderName: 'Old name', text: 'Original server message', createdAt: new Date('2026-10-27T10:00:00Z'), attachments: [{ id: 'file', name: 'proof.pdf', kind: 'file', url: 'https://example.test/proof.pdf' }] }],
  ]);
  let time = Date.parse('2026-10-27T12:05:00Z');
  const snap = ref => ({ ref, id: ref.id, exists: docs.has(ref.path), data: () => docs.get(ref.path) });
  const collection = (path, filters = [], count = Infinity, anchor = null) => ({
    path, filters, count, anchor,
    doc: id => ({ id, path: `${path}/${id}`, collection: child => collection(`${path}/${id}/${child}`) }),
    where: (field, op, value) => { assert.equal(op, '=='); return collection(path, [...filters, [field, value]], count, anchor); },
    orderBy: () => collection(path, filters, count, anchor),
    startAfter: value => collection(path, filters, count, value),
    limit: value => collection(path, filters, value, anchor),
  });
  const db = {
    collection,
    runTransaction: async fn => {
      const pending = [];
      const read = ref => {
        assert.equal(pending.length, 0, 'Transactions must finish reads before writes');
        if (ref.id) return snap(ref);
        let rows = [...docs.keys()].filter(key => key.startsWith(`${ref.path}/`) && !key.slice(ref.path.length + 1).includes('/'))
          .map(key => snap({ id: key.split('/').at(-1), path: key }))
          .filter(row => ref.filters.every(([field, value]) => row.data()[field] === value))
          .sort((a, b) => b.data().createdAt - a.data().createdAt || b.id.localeCompare(a.id));
        if (ref.anchor) rows = rows.slice(rows.findIndex(row => row.id === ref.anchor.id) + 1);
        return { docs: rows.slice(0, ref.count) };
      };
      const result = await fn({ get: async ref => read(ref), getAll: async (...refs) => refs.map(read),
        create: (ref, value) => { assert.equal(docs.has(ref.path), false); pending.push([ref, value]); },
        set: (ref, value) => pending.push([ref, { ...docs.get(ref.path), ...value }]),
      });
      pending.forEach(([ref, value]) => docs.set(ref.path, value));
      return result;
    },
  };
  const assertAccountAllowed = async (_tx, uid) => { if (docs.get(`users/${uid}`)?.accountDeletionStartedAt) throw Error('Account deletion is active'); };
  const common = { getDb: () => db, getFieldValue: () => ({ increment: value => value, serverTimestamp: () => new Date(time) }), assertAccountAllowed };
  const safety = createChatSafetyService({ ...common, projectId: () => 'demo-dispatch-billing' });
  const service = createChatReportService({ ...common, getActorContext: safety.getActorContext, now: () => time, documentIdField: () => '__name__' });
  const request = (uid, data = {}) => ({ auth: { uid, token: {} }, data });
  const input = (clientRequestId = 'report-request-1', extra = {}) => ({ threadId: 'group', kind: 'message', messageId: 'message', reason: 'harassment', details: 'Please review this', clientRequestId, ...extra });
  return { docs, service, request, input, time: () => time, advance: ms => { time += ms; } };
}

test('reports require authentication and reject client-provided identities or evidence', async () => {
  const h = harness();
  await assert.rejects(h.service.submit({ data: h.input() }), error => error.code === 'unauthenticated');
  for (const extra of [{ evidence: { text: 'fake' } }, { reporterUserId: 'manager' }, { organizationId: 'other' }, { targetDisplayName: 'Fake' }, { reason: 'unknown' }, { details: 'x'.repeat(2001) }, { clientRequestId: '../unsafe' }]) {
    await assert.rejects(h.service.submit(h.request('a', h.input('report-request-1', extra))), error => error.code === 'invalid-argument');
  }
  assert.equal([...h.docs.keys()].some(key => key.startsWith('chatSafetyReports/')), false);
});

test('reported message, sender and snapshot are server-derived and exact retries are idempotent', async () => {
  const h = harness();
  const result = await h.service.submit(h.request('a', h.input()));
  assert.equal(result.createdAt, new Date(h.time()).toISOString());
  const report = h.docs.get(`chatSafetyReports/${result.reportId}`);
  assert.equal(report.reporterUserId, 'a');
  assert.equal(report.targetUserId, 'b');
  assert.equal(report.targetDisplayName, 'Profile b');
  assert.equal(report.evidence.message.text, 'Original server message');
  h.docs.get('chatThreads/group/messages/message').text = 'Edited later';
  assert.deepEqual(await h.service.submit(h.request('a', h.input())), result);
  assert.equal(report.evidence.message.text, 'Original server message');
  assert.equal(h.docs.get('users/a/chatReportLimits/current').hourCount, 1);
  await assert.rejects(h.service.submit(h.request('a', h.input('report-request-1', { reason: 'spam' }))), error => error.code === 'failed-precondition');
});

test('reporting stays available without consent, while blocked, suspended and billing-read-only', async () => {
  const h = harness();
  h.docs.set('users/a/chatBlocks/b', { targetUserId: 'b' });
  h.docs.get('users/a').chatSuspension = { active: true, reason: 'Chat suspended' };
  h.docs.get('organizationBilling/org').accessMode = 'read_only';
  const result = await h.service.submit(h.request('a', h.input()));
  assert.equal(result.status, 'submitted');
  assert.ok(h.docs.has('users/a/chatSafetyState/current'));
});

test('new reports require own current organization and referenced thread authority', async () => {
  const h = harness();
  await assert.rejects(h.service.submit(h.request('outsider', h.input())), error => error.code === 'permission-denied');
  await assert.rejects(h.service.submit(h.request('a', h.input('report-request-1', { threadId: 'other' }))), error => error.code === 'permission-denied');
  await assert.rejects(h.service.submit(h.request('b', h.input())), /another member/);
  h.docs.get('organizationBilling/org').chatSafetyEnabled = false;
  await assert.rejects(h.service.submit(h.request('a', h.input())), error => error.code === 'failed-precondition');
});

test('user reporting rejects self and stale/foreign/nonparticipant targets', async () => {
  const h = harness();
  const userInput = targetUserId => ({ threadId: 'group', kind: 'user', targetUserId, reason: 'privacy', clientRequestId: 'user-report-1' });
  for (const target of ['a', 'outsider', 'missing']) await assert.rejects(h.service.submit(h.request('a', userInput(target))));
  const result = await h.service.submit(h.request('a', userInput('manager')));
  assert.equal(h.docs.get(`chatSafetyReports/${result.reportId}`).targetUserId, 'manager');
});

test('hourly and daily report quotas are atomic and retries remain available after quota', async () => {
  const h = harness();
  let first;
  for (let hour = 0; hour < 4; hour++) {
    for (let index = 0; index < 5; index++) {
      const result = await h.service.submit(h.request('a', h.input(`request-${hour}-${index}`)));
      if (!first) first = result;
    }
    await assert.rejects(h.service.submit(h.request('a', h.input(`extra-request-${hour}`))), error => error.code === 'resource-exhausted');
    h.advance(60 * 60 * 1000);
  }
  await assert.rejects(h.service.submit(h.request('a', h.input('next-hour-over-daily'))), error => error.code === 'resource-exhausted');
  assert.deepEqual(await h.service.submit(h.request('a', h.input('request-0-0'))), first);
  assert.equal(h.docs.get('users/a/chatReportLimits/current').dayCount, 20);
  assert.equal([...h.docs.keys()].filter(key => key.startsWith('chatSafetyReports/')).length, 20);
});

test('own report history is paginated and exposes no evidence, private identities or details', async () => {
  const h = harness();
  const created = [];
  for (let index = 0; index < 3; index++) { created.push(await h.service.submit(h.request('a', h.input(`request-${index}`)))); h.advance(1); }
  const other = await h.service.submit(h.request('manager', h.input('manager-report')));
  const page = await h.service.listMine(h.request('a', { limit: 2 }));
  assert.equal(page.reports.length, 2);
  assert.deepEqual(page.reports.map(report => report.id), [created[2].reportId, created[1].reportId]);
  assert.deepEqual(Object.keys(page.reports[0]).sort(), ['id', 'kind', 'targetDisplayName', 'reason', 'status', 'createdAt', 'updatedAt'].sort());
  const rest = await h.service.listMine(h.request('a', { limit: 2, cursor: page.nextCursor }));
  assert.deepEqual(rest.reports.map(report => report.id), [created[0].reportId]);
  assert.equal(rest.nextCursor, undefined);
  await assert.rejects(h.service.listMine(h.request('a', { cursor: encodeReportCursor(other.reportId) })), error => error.code === 'invalid-argument');
  assert.throws(() => decodeReportCursor(`${page.nextCursor}=`), error => error.code === 'invalid-argument');
});

test('historical own reports remain readable after leaving the organization, but new reports do not', async () => {
  const h = harness();
  const report = await h.service.submit(h.request('a', h.input()));
  h.docs.get('users/a').organizationId = null;
  assert.equal((await h.service.listMine(h.request('a'))).reports[0].id, report.reportId);
  await assert.rejects(h.service.submit(h.request('a', h.input('new-request-after-leave'))), error => error.code === 'permission-denied');
});
