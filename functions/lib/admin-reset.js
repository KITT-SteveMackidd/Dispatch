const ADMIN_RESET_EMAIL = 'stevemackidd@gmail.com';

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isAuthorizedAdminEmail(value) {
  return normalizeEmail(value) === ADMIN_RESET_EMAIL;
}

async function deleteAllFirestoreCollections(db) {
  let collectionsDeleted = 0;

  while (true) {
    const collections = await db.listCollections();
    if (!collections.length) break;

    for (const collection of collections) {
      await db.recursiveDelete(collection);
      collectionsDeleted += 1;
    }
  }

  return collectionsDeleted;
}

async function deleteAllAuthUsers(adminAuth) {
  let usersDeleted = 0;

  while (true) {
    const page = await adminAuth.listUsers(1000);
    const userIds = page.users.map((user) => user.uid);
    if (!userIds.length) break;

    const result = await adminAuth.deleteUsers(userIds);
    if (result.failureCount) {
      const failedIndexes = result.errors.map((item) => item.index).join(', ');
      throw new Error(`Unable to delete ${result.failureCount} Firebase Auth user(s). Failed indexes: ${failedIndexes}`);
    }

    usersDeleted += result.successCount;
  }

  return usersDeleted;
}

module.exports = {
  ADMIN_RESET_EMAIL,
  deleteAllAuthUsers,
  deleteAllFirestoreCollections,
  isAuthorizedAdminEmail,
  normalizeEmail,
};
