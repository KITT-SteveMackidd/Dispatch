const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ID, assertLocalChatSafetyEnvironment, chatSafetyFixture } = require('./chat-safety-test-common');

async function run() {
  const runId = assertLocalChatSafetyEnvironment();
  const fixture = chatSafetyFixture(runId);
  const users = Object.fromEntries(fixture.users.map((user) => [user.key, user]));
  const origin = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const results = [];
  const tokens = {};
  for (const key of ['manager', 'reporter', 'outsider']) {
    const login = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: users[key].email, password: fixture.password, returnSecureToken: true }),
    });
    assert.equal(login.status, 200, `Unable to log in to the local Auth emulator as ${key}.`);
    tokens[key] = (await login.json()).idToken;
  }
  const orgFilter = organizationId => ({ fieldFilter: { field: { fieldPath: 'organizationId' }, op: 'EQUAL', value: { stringValue: organizationId } } });
  const participantFilter = uid => ({ fieldFilter: { field: { fieldPath: 'participants' }, op: 'ARRAY_CONTAINS', value: { stringValue: uid } } });
  async function query(key, filters) {
    const response = await fetch(`${origin}:runQuery`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[key]}` },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'chatThreads' }],
        where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } },
        orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'DESCENDING' }],
      } }),
    });
    return { status: response.status, body: await response.json() };
  }
  async function check(name, fn) {
    await fn();
    results.push({ name, status: 'passed' });
    console.log(`PASS ${name}`);
  }
  try {
    for (const key of ['manager', 'reporter']) {
      await check(`${key} organization + participant + updatedAt thread list`, async () => {
        const response = await query(key, [orgFilter(fixture.organizationId), participantFilter(users[key].uid)]);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        const documents = response.body.filter(row => row.document).map(row => row.document);
        assert.ok(documents.some(doc => doc.name.endsWith(`/${fixture.threadIds.organization}`)));
        assert.ok(documents.every(doc => doc.fields.organizationId.stringValue === fixture.organizationId));
        assert.ok(documents.every(doc => doc.fields.participants.arrayValue.values.some(value => value.stringValue === users[key].uid)));
      });
    }
    await check('thread list without organization scope is denied', async () => {
      assert.equal((await query('reporter', [participantFilter(users.reporter.uid)])).status, 403);
    });
    await check('thread list without caller membership filter is denied', async () => {
      assert.equal((await query('reporter', [orgFilter(fixture.organizationId)])).status, 403);
    });
    await check('other organization thread list is denied', async () => {
      assert.equal((await query('outsider', [orgFilter(fixture.organizationId), participantFilter(users.outsider.uid)])).status, 403);
    });
    await check('forged participant scope is denied', async () => {
      assert.equal((await query('reporter', [orgFilter(fixture.organizationId), participantFilter(users.manager.uid)])).status, 403);
    });
  } catch (error) {
    results.push({ name: 'failure', status: 'failed', message: error.message });
    throw error;
  } finally {
    const outputDir = path.resolve(__dirname, '../../.local-data/chat-safety');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${runId}-query-results.json`), JSON.stringify({ runId, projectId: PROJECT_ID, results }, null, 2));
  }
}

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
