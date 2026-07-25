const assert = require('node:assert/strict');
const test = require('node:test');
const {
  deleteAllAuthUsers,
  deleteAllFirestoreCollections,
  isAuthorizedAdminEmail,
} = require('../lib/admin-reset');

test('admin reset authorization only accepts the configured email', () => {
  assert.equal(isAuthorizedAdminEmail('stevemackidd@gmail.com'), true);
  assert.equal(isAuthorizedAdminEmail(' STEVEMACKIDD@GMAIL.COM '), true);
  assert.equal(isAuthorizedAdminEmail('stevemackidd+dispatch@gmail.com'), false);
  assert.equal(isAuthorizedAdminEmail('someone@example.com'), false);
  assert.equal(isAuthorizedAdminEmail(undefined), false);
});

test('deletes every Firestore root collection until none remain', async () => {
  const deleted = [];
  const collectionA = { id: 'events' };
  const collectionB = { id: 'users' };
  let listCount = 0;
  const db = {
    async listCollections() {
      listCount += 1;
      return listCount === 1 ? [collectionA, collectionB] : [];
    },
    async recursiveDelete(collection) {
      deleted.push(collection.id);
    },
  };

  const count = await deleteAllFirestoreCollections(db);

  assert.equal(count, 2);
  assert.deepEqual(deleted, ['events', 'users']);
  assert.equal(listCount, 2);
});

test('deletes Firebase Auth users in repeated batches until empty', async () => {
  const batches = [
    [{ uid: 'one' }, { uid: 'two' }],
    [{ uid: 'three' }],
    [],
  ];
  const deleted = [];
  const adminAuth = {
    async listUsers() {
      return { users: batches.shift() };
    },
    async deleteUsers(userIds) {
      deleted.push(userIds);
      return { successCount: userIds.length, failureCount: 0, errors: [] };
    },
  };

  const count = await deleteAllAuthUsers(adminAuth);

  assert.equal(count, 3);
  assert.deepEqual(deleted, [['one', 'two'], ['three']]);
});
