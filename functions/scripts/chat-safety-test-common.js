const PROJECT_ID = 'demo-dispatch-billing';
const EMULATOR_HOSTS = Object.freeze({
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
});

function assertLocalChatSafetyEnvironment(env = process.env) {
  if (env.GCLOUD_PROJECT !== PROJECT_ID) {
    throw new Error(`Chat safety tests require GCLOUD_PROJECT=${PROJECT_ID}.`);
  }
  for (const [name, expected] of Object.entries(EMULATOR_HOSTS)) {
    if (env[name] !== expected) throw new Error(`Chat safety tests require ${name}=${expected}.`);
  }
  for (const name of ['GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT']) {
    if (env[name] && env[name] !== PROJECT_ID) throw new Error(`Conflicting ${name}; refusing local test.`);
  }
  if (env.FIREBASE_CONFIG) {
    let config;
    try { config = JSON.parse(env.FIREBASE_CONFIG); } catch { throw new Error('FIREBASE_CONFIG must be inline local JSON.'); }
    if (config.projectId !== PROJECT_ID) throw new Error('FIREBASE_CONFIG points outside the local demo project.');
  }
  const runId = String(env.CHAT_SAFETY_TEST_RUN_ID || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(runId)) {
    throw new Error('CHAT_SAFETY_TEST_RUN_ID must be a fresh 3-32 character lowercase identifier.');
  }
  return runId;
}

function chatSafetyFixture(runId) {
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(runId)) throw new Error('Invalid chat safety run ID.');
  const organizationId = `chat-safety-organization-${runId}`;
  const otherOrganizationId = `chat-safety-other-organization-${runId}`;
  const operatorOrganizationId = `chat-safety-operator-organization-${runId}`;
  const teamId = `chat-safety-team-${runId}`;
  const users = [
    { key: 'manager', displayName: 'Safety Test Manager', role: 'manager' },
    { key: 'reporter', displayName: 'Safety Test Reporter', role: 'worker' },
    { key: 'reported', displayName: 'Safety Test Colleague', role: 'worker' },
    { key: 'secondManager', displayName: 'Safety Test Second Manager', role: 'manager' },
    { key: 'outsider', displayName: 'Other Organization Manager', role: 'manager' },
    { key: 'operator', displayName: 'Local Safety Operator', role: 'manager' },
  ].map((user) => ({
    ...user,
    uid: `chat-safety-${user.key.toLowerCase()}-${runId}`,
    email: `chat.safety.${user.key.toLowerCase()}.${runId}@example.test`,
    organizationId: user.key === 'outsider' ? otherOrganizationId : user.key === 'operator' ? operatorOrganizationId : organizationId,
  }));
  const byKey = Object.fromEntries(users.map((user) => [user.key, user]));
  return {
    projectId: PROJECT_ID,
    runId,
    organizationId,
    otherOrganizationId,
    operatorOrganizationId,
    organizationName: `Local Chat Safety ${runId}`,
    teamId,
    password: 'DispatchSafety123!',
    users,
    threadIds: {
      organization: `organization:${organizationId}:all`,
      team: `team:${teamId}:all`,
      direct: `dm:${[byKey.reporter.uid, byKey.reported.uid].sort().join('__')}`,
      custom: `custom:chat-safety-pair-${runId}`,
      manager: `organization:${organizationId}:managers:${byKey.reporter.uid}`,
    },
    messageIds: { reportable: 'sample-colleague-message', ordinary: 'sample-manager-message' },
  };
}

function assertChatSafetyProfileMatches(user, profile) {
  if (!profile || profile.uid !== user.uid || profile.email !== user.email || profile.organizationId !== user.organizationId) {
    throw new Error(`Stored profile does not exactly match synthetic identity ${user.uid}; refusing Auth recovery.`);
  }
}

module.exports = { PROJECT_ID, EMULATOR_HOSTS, assertLocalChatSafetyEnvironment, chatSafetyFixture, assertChatSafetyProfileMatches };
