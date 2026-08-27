const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ACCOUNT_DELETION_COLLECTIONS,
  buildDeletionIdentity,
  identityMatchesEmail,
  redactIdentityText,
  sanitizeEventRoles,
  sanitizeTemplateRoles,
  storagePathFromAttachment,
  threadIdReferencesUser,
} = require('../lib/account-deletion');

test('account deletion audits every Dispatch collection that can retain user data', () => {
  assert.deepEqual(ACCOUNT_DELETION_COLLECTIONS, [
    'users',
    'organizations',
    'teams',
    'events',
    'eventTemplates',
    'workerInvites',
    'managerInvites',
    'inviteTokens',
    'secureInvites',
    'secureInviteCodes',
    'roleAssignmentNotifications',
    'userNotifications',
    'chatThreads',
    'chatUnread',
    'dispatchBetaChecklistRuns',
    '_emailVerificationRequests',
    'mail',
    'pushDeliveries',
    'pushTickets',
  ]);
});

test('buildDeletionIdentity preserves a plus-addressed account as a distinct identity', () => {
  const identity = buildDeletionIdentity({
    uid: 'user-123',
    email: 'Steve+Dispatch@Gmail.com',
    displayName: 'Steve Mackidd',
    providerData: [],
  }, { pushTokens: ['ExponentPushToken[token]'] });

  assert.equal(identityMatchesEmail('steve+dispatch@gmail.com', identity), true);
  assert.equal(identityMatchesEmail('steve@gmail.com', identity), false);
  assert.equal(identityMatchesEmail('steve+worker@gmail.com', identity), false);
  assert.deepEqual(identity.names, ['Steve Mackidd']);
  assert.deepEqual(identity.pushTokens, ['ExponentPushToken[token]']);
});

test('buildDeletionIdentity ignores a conflicting legacy canonical email', () => {
  const identity = buildDeletionIdentity({
    uid: 'user-123',
    email: 'steve+dispatch@gmail.com',
    providerData: [],
  }, {
    email: 'steve+dispatch@gmail.com',
    canonicalEmail: 'steve@gmail.com',
  });

  assert.deepEqual(identity.emails, ['steve+dispatch@gmail.com']);
  assert.equal(identityMatchesEmail('steve@gmail.com', identity), false);
});

test('sanitizeEventRoles removes all worker references, completions, and user-owned attachments', () => {
  const storagePaths = new Set();
  const result = sanitizeEventRoles([{
    id: 'role-1',
    assignedWorkerIds: ['deleted-user', 'worker-2'],
    waitlistWorkerIds: ['deleted-user'],
    eligibleWaitlistWorkerIds: ['deleted-user', 'worker-3'],
    waitlistInviteWorkerIds: ['deleted-user'],
    openSlots: 0,
    tasks: [{
      id: 'task-1',
      completedBy: ['deleted-user', 'worker-2'],
      attachments: [
        { id: 'dispatchTemplateAttachments/deleted-user/task-1/file.jpg', url: 'https://example.invalid/file' },
        { id: 'dispatchTemplateAttachments/manager-2/task-1/keep.jpg', url: 'https://example.invalid/keep' },
      ],
    }],
  }], 'deleted-user', storagePaths);

  assert.equal(result.changed, true);
  assert.deepEqual(result.workerIds, ['worker-2', 'worker-3']);
  assert.deepEqual(result.roles[0].assignedWorkerIds, ['worker-2']);
  assert.deepEqual(result.roles[0].waitlistWorkerIds, []);
  assert.equal(result.roles[0].openSlots, 1);
  assert.deepEqual(result.roles[0].tasks[0].completedBy, ['worker-2']);
  assert.deepEqual(result.roles[0].tasks[0].attachments.map((item) => item.id), [
    'dispatchTemplateAttachments/manager-2/task-1/keep.jpg',
  ]);
  assert.deepEqual([...storagePaths], ['dispatchTemplateAttachments/deleted-user/task-1/file.jpg']);
});

test('sanitizeTemplateRoles removes only uploads owned by the deleting manager', () => {
  const storagePaths = new Set();
  const result = sanitizeTemplateRoles([{
    id: 'role-1',
    tasks: [{
      id: 'task-1',
      attachments: [
        { id: 'dispatchTemplateAttachments/deleted-manager/task-1/delete.pdf' },
        { id: 'dispatchTemplateAttachments/other-manager/task-1/keep.pdf' },
      ],
    }],
  }], 'deleted-manager', storagePaths);

  assert.equal(result.changed, true);
  assert.deepEqual(result.roles[0].tasks[0].attachments.map((item) => item.id), [
    'dispatchTemplateAttachments/other-manager/task-1/keep.pdf',
  ]);
});

test('chat IDs and Firebase download URLs are recognized for cleanup', () => {
  assert.equal(threadIdReferencesUser('organization:org-1:group:user-1__user-2', 'user-1'), true);
  assert.equal(threadIdReferencesUser('team:team-1:all', 'user-1'), false);
  assert.equal(storagePathFromAttachment({
    url: 'https://firebasestorage.googleapis.com/v0/b/example.appspot.com/o/chatAttachments%2Fthread%2Fuser-1%2Ffile.jpg?alt=media',
  }), 'chatAttachments/thread/user-1/file.jpg');
});

test('redactIdentityText removes names, email aliases, and user IDs from retained text', () => {
  const identity = buildDeletionIdentity({
    uid: 'uid-secret',
    email: 'person+dispatch@example.com',
    displayName: 'Person Name',
    providerData: [],
  }, {});
  const redacted = redactIdentityText(
    'Person Name (person+dispatch@example.com) has uid-secret.',
    identity
  );

  assert.equal(redacted, 'Deleted user (Deleted user) has Deleted user.');
});
