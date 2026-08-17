const BATCH_SIZE = 400;
const PAGE_SIZE = 400;
const GENERIC_NAMES = new Set(['dispatch user', 'manager', 'worker', 'deleted user']);
const ACCOUNT_DELETION_COLLECTIONS = [
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
  'mail',
  'pushDeliveries',
  'pushTickets',
];

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function canonicalizeEmail(value) {
  return normalizeEmail(value);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function sameArray(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function buildDeletionIdentity(authUser, userData = {}) {
  const accountEmails = uniqueStrings([
    authUser?.email,
    userData.email,
    ...(authUser?.providerData || []).map((provider) => provider.email),
  ].map(normalizeEmail));
  const emails = accountEmails.length
    ? accountEmails
    : uniqueStrings([normalizeEmail(userData.canonicalEmail)]);
  const names = uniqueStrings([
    authUser?.displayName,
    userData.displayName,
    ...(authUser?.providerData || []).map((provider) => provider.displayName),
  ]).filter((name) => name.length >= 3 && !GENERIC_NAMES.has(name.toLowerCase()));

  return {
    uid: authUser.uid,
    emails,
    names: names.sort((left, right) => right.length - left.length),
    pushTokens: uniqueStrings(userData.pushTokens),
  };
}

function identityMatchesEmail(value, identity) {
  const normalized = normalizeEmail(value);
  return Boolean(normalized && identity.emails.includes(normalized));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactIdentityText(value, identity) {
  if (typeof value !== 'string' || !value) return value;
  let next = value;
  const needles = uniqueStrings([identity.uid, ...identity.emails, ...identity.names])
    .sort((left, right) => right.length - left.length);
  needles.forEach((needle) => {
    next = next.replace(new RegExp(escapeRegExp(needle), 'gi'), 'Deleted user');
  });
  return next;
}

function redactStringFields(data, fields, identity) {
  const updates = {};
  fields.forEach((field) => {
    const redacted = redactIdentityText(data[field], identity);
    if (redacted !== data[field]) updates[field] = redacted;
  });
  return updates;
}

function textContainsIdentity(value, identity, includeNames = false) {
  if (typeof value !== 'string') return false;
  const normalized = value.toLowerCase();
  const needles = [identity.uid, ...identity.emails, ...identity.pushTokens];
  if (includeNames) needles.push(...identity.names);
  return needles.some((needle) => needle && normalized.includes(needle.toLowerCase()));
}

function valueReferencesIdentity(value, identity, includeNames = false, seen = new Set()) {
  if (typeof value === 'string') return textContainsIdentity(value, identity, includeNames);
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => valueReferencesIdentity(item, identity, includeNames, seen));
  }
  return Object.values(value).some((item) => valueReferencesIdentity(item, identity, includeNames, seen));
}

function valueContainsAny(value, needles, seen = new Set()) {
  if (!needles.size) return false;
  if (typeof value === 'string') {
    return [...needles].some((needle) => needle && value.includes(needle));
  }
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => valueContainsAny(item, needles, seen));
  return Object.values(value).some((item) => valueContainsAny(item, needles, seen));
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function storagePathFromAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  const id = typeof attachment.id === 'string' ? attachment.id.trim().replace(/^\/+/, '') : '';
  if (id && !/^https?:\/\//i.test(id) && !/^gs:\/\//i.test(id)) return safeDecodeURIComponent(id);

  const url = typeof attachment.url === 'string' ? attachment.url.trim() : '';
  if (!url) return null;
  if (url.startsWith('gs://')) {
    const withoutScheme = url.slice(5);
    const slashIndex = withoutScheme.indexOf('/');
    return slashIndex >= 0 ? safeDecodeURIComponent(withoutScheme.slice(slashIndex + 1)) : null;
  }

  try {
    const parsed = new URL(url);
    const objectMatch = parsed.pathname.match(/\/o\/([^/]+)$/);
    if (objectMatch) return safeDecodeURIComponent(objectMatch[1]);
  } catch {
    return null;
  }
  return null;
}

function storagePathBelongsToUser(path, uid) {
  if (typeof path !== 'string' || !path) return false;
  if (path.startsWith(`dispatchTemplateAttachments/${uid}/`)) return true;
  const parts = path.split('/');
  return parts[0] === 'chatAttachments' && parts[2] === uid;
}

function collectAttachmentPaths(roles, target) {
  (Array.isArray(roles) ? roles : []).forEach((role) => {
    (Array.isArray(role?.tasks) ? role.tasks : []).forEach((task) => {
      (Array.isArray(task?.attachments) ? task.attachments : []).forEach((attachment) => {
        const path = storagePathFromAttachment(attachment);
        if (path) target.add(path);
      });
    });
  });
}

function sanitizeEventRoles(roles, uid, storagePaths, identity) {
  let changed = false;
  const nextRoles = (Array.isArray(roles) ? roles : []).map((role) => {
    const assignedBefore = uniqueStrings(role?.assignedWorkerIds);
    const assignedWorkerIds = assignedBefore.filter((id) => id !== uid);
    const waitlistWorkerIds = uniqueStrings(role?.waitlistWorkerIds).filter((id) => id !== uid);
    const eligibleWaitlistWorkerIds = uniqueStrings(role?.eligibleWaitlistWorkerIds).filter((id) => id !== uid);
    const waitlistInviteWorkerIds = uniqueStrings(role?.waitlistInviteWorkerIds).filter((id) => id !== uid);
    const removedAssignedCount = assignedBefore.length - assignedWorkerIds.length;
    if (removedAssignedCount
      || !sameArray(waitlistWorkerIds, role?.waitlistWorkerIds)
      || !sameArray(eligibleWaitlistWorkerIds, role?.eligibleWaitlistWorkerIds)
      || !sameArray(waitlistInviteWorkerIds, role?.waitlistInviteWorkerIds)) changed = true;

    const roleName = identity ? redactIdentityText(role?.name, identity) : role?.name;
    if (roleName !== role?.name) changed = true;
    const tasks = (Array.isArray(role?.tasks) ? role.tasks : []).map((task) => {
      const completedBy = uniqueStrings(task?.completedBy).filter((id) => id !== uid);
      const attachments = (Array.isArray(task?.attachments) ? task.attachments : []).flatMap((attachment) => {
        const path = storagePathFromAttachment(attachment);
        if (path && storagePathBelongsToUser(path, uid)) {
          storagePaths.add(path);
          changed = true;
          return [];
        }
        const name = identity ? redactIdentityText(attachment?.name, identity) : attachment?.name;
        if (name !== attachment?.name) changed = true;
        const nextAttachment = { ...attachment };
        if (name !== attachment?.name) nextAttachment.name = name;
        return [nextAttachment];
      });
      if (!sameArray(completedBy, task?.completedBy)) changed = true;
      if (attachments.length !== (task?.attachments || []).length) changed = true;
      const name = identity ? redactIdentityText(task?.name, identity) : task?.name;
      const description = identity ? redactIdentityText(task?.description, identity) : task?.description;
      if (name !== task?.name || description !== task?.description) changed = true;
      const nextTask = { ...task, completedBy, attachments };
      if (name !== task?.name) nextTask.name = name;
      if (description !== task?.description) nextTask.description = description;
      return nextTask;
    });

    const nextRole = {
      ...role,
      assignedWorkerIds,
      waitlistWorkerIds,
      eligibleWaitlistWorkerIds,
      waitlistInviteWorkerIds,
      openSlots: Math.max(0, Number(role?.openSlots || 0) + removedAssignedCount),
      tasks,
    };
    if (roleName !== role?.name) nextRole.name = roleName;
    return nextRole;
  });
  const workerIds = uniqueStrings(nextRoles.flatMap((role) => [
    ...role.assignedWorkerIds,
    ...role.waitlistWorkerIds,
    ...role.eligibleWaitlistWorkerIds,
    ...role.waitlistInviteWorkerIds,
  ]));
  return { roles: nextRoles, workerIds, changed };
}

function sanitizeTemplateRoles(roles, uid, storagePaths, identity) {
  let changed = false;
  const nextRoles = (Array.isArray(roles) ? roles : []).map((role) => {
    const name = identity ? redactIdentityText(role?.name, identity) : role?.name;
    if (name !== role?.name) changed = true;
    const tasks = (Array.isArray(role?.tasks) ? role.tasks : []).map((task) => {
      const attachments = (Array.isArray(task?.attachments) ? task.attachments : []).flatMap((attachment) => {
        const path = storagePathFromAttachment(attachment);
        if (path && storagePathBelongsToUser(path, uid)) {
          storagePaths.add(path);
          changed = true;
          return [];
        }
        const attachmentName = identity ? redactIdentityText(attachment?.name, identity) : attachment?.name;
        if (attachmentName !== attachment?.name) changed = true;
        const nextAttachment = { ...attachment };
        if (attachmentName !== attachment?.name) nextAttachment.name = attachmentName;
        return [nextAttachment];
      });
      const taskName = identity ? redactIdentityText(task?.name, identity) : task?.name;
      const description = identity ? redactIdentityText(task?.description, identity) : task?.description;
      if (taskName !== task?.name || description !== task?.description) changed = true;
      const nextTask = { ...task, attachments };
      if (taskName !== task?.name) nextTask.name = taskName;
      if (description !== task?.description) nextTask.description = description;
      return nextTask;
    });
    const nextRole = { ...role, tasks };
    if (name !== role?.name) nextRole.name = name;
    return nextRole;
  });
  return { roles: nextRoles, changed };
}

function threadIdReferencesUser(threadId, uid) {
  return typeof threadId === 'string' && threadId.includes(uid);
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

function summarizeMessage(message) {
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  if (text) return text;
  const attachmentCount = Array.isArray(message?.attachments) ? message.attachments.length : 0;
  return attachmentCount ? `Sent ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}` : '';
}

async function listCollectionDocuments(collectionRef) {
  const documents = [];
  let cursor = null;
  while (true) {
    let query = collectionRef.limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    documents.push(...snapshot.docs.map((document) => ({
      id: document.id,
      ref: document.ref,
      data: document.data(),
    })));
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) break;
  }
  return documents;
}

function createOperationQueue() {
  const operations = new Map();
  const recursiveDeletes = new Map();

  return {
    delete(ref) {
      if ([...recursiveDeletes.keys()].some((path) => ref.path === path || ref.path.startsWith(`${path}/`))) return;
      operations.set(ref.path, { type: 'delete', ref });
    },
    update(ref, data) {
      if (!data || !Object.keys(data).length) return;
      if ([...recursiveDeletes.keys()].some((path) => ref.path === path || ref.path.startsWith(`${path}/`))) return;
      const existing = operations.get(ref.path);
      if (existing?.type === 'delete') return;
      operations.set(ref.path, {
        type: 'update',
        ref,
        data: { ...(existing?.data || {}), ...data },
      });
    },
    recursiveDelete(ref) {
      recursiveDeletes.set(ref.path, ref);
      [...operations.keys()].forEach((path) => {
        if (path === ref.path || path.startsWith(`${ref.path}/`)) operations.delete(path);
      });
    },
    values() {
      return [...operations.values()];
    },
    recursiveValues() {
      return [...recursiveDeletes.values()];
    },
  };
}

async function commitOperations(db, operations) {
  for (let index = 0; index < operations.length; index += BATCH_SIZE) {
    const batch = db.batch();
    operations.slice(index, index + BATCH_SIZE).forEach((operation) => {
      if (operation.type === 'delete') batch.delete(operation.ref);
      else batch.update(operation.ref, operation.data);
    });
    await batch.commit();
  }
}

async function collectOwnedStorageFiles(bucket, uid, deletedThreadIds, explicitPaths) {
  const filesByName = new Map();
  for (const path of explicitPaths) filesByName.set(path, bucket.file(path));

  const [templateFiles] = await bucket.getFiles({ prefix: `dispatchTemplateAttachments/${uid}/` });
  templateFiles.forEach((file) => filesByName.set(file.name, file));

  const [chatFiles] = await bucket.getFiles({ prefix: 'chatAttachments/' });
  chatFiles.forEach((file) => {
    const parts = file.name.split('/');
    const threadId = parts[1];
    const senderId = parts[2];
    if (senderId === uid || deletedThreadIds.has(threadId)) filesByName.set(file.name, file);
  });

  return [...filesByName.values()];
}

async function deleteStorageFiles(files) {
  let deleted = 0;
  for (let index = 0; index < files.length; index += 25) {
    await Promise.all(files.slice(index, index + 25).map(async (file) => {
      await file.delete({ ignoreNotFound: true });
      deleted += 1;
    }));
  }
  return deleted;
}

async function deleteResidualIdentityRecords(params) {
  const {
    db,
    identity,
    collectionNames,
    deletedSourcePaths,
    sensitiveIds,
  } = params;
  const queue = createOperationQueue();

  for (const collectionName of collectionNames) {
    const records = await listCollectionDocuments(db.collection(collectionName));
    records.forEach((record) => {
      const referencesIdentity = valueReferencesIdentity(record.data, identity, true)
        || textContainsIdentity(record.id, identity)
        || deletedSourcePaths.has(record.data.sourcePath)
        || valueContainsAny(record.data, sensitiveIds);
      if (!referencesIdentity) return;
      if (collectionName === 'mail') queue.recursiveDelete(record.ref);
      else queue.delete(record.ref);
    });
  }

  const recursiveDeletes = queue.recursiveValues();
  for (const ref of recursiveDeletes) await db.recursiveDelete(ref);
  const operations = queue.values();
  await commitOperations(db, operations);
  return operations.filter((operation) => operation.type === 'delete').length + recursiveDeletes.length;
}

function changedArrayUpdate(updates, field, current, next) {
  if (!sameArray(current, next)) updates[field] = next;
}

function removeDeletedReference(updates, field, value, deletedIds, FieldValue) {
  if (typeof value === 'string' && deletedIds.has(value)) updates[field] = FieldValue.delete();
}

function getRecordMap(records) {
  return new Map(records.map((record) => [record.id, record]));
}

async function deleteDispatchUserData(params) {
  const { db, bucket, FieldValue, authUser } = params;
  const uid = authUser.uid;
  const collectionNames = ACCOUNT_DELETION_COLLECTIONS;
  const loaded = await Promise.all(collectionNames.map((name) => listCollectionDocuments(db.collection(name))));
  const records = Object.fromEntries(collectionNames.map((name, index) => [name, loaded[index]]));
  const userRecord = records.users.find((record) => record.id === uid);
  const userData = userRecord?.data || {};
  const identity = buildDeletionIdentity(authUser, userData);
  const queue = createOperationQueue();
  const storagePaths = new Set();
  const deletedOrgIds = new Set();
  const deletedTeamIds = new Set();
  const deletedEventIds = new Set();
  const deletedInviteIds = new Set();
  const deletedRoleNotificationIds = new Set();
  const deletedUserNotificationIds = new Set();
  const deletedThreadIds = new Set();
  const affectedThreadIds = new Set();
  const deletedMessageIds = new Set();
  const deletedSourcePaths = new Set();
  const sensitiveIds = new Set();
  const successorByOrganization = new Map();
  const survivingManagersByOrganization = new Map();
  const managerOrganizationsForUser = new Set();
  const organizationNamesAfterDeletion = new Map();
  const eventOwnerAfter = new Map();

  const usersByOrganization = new Map();
  records.users.forEach((record) => {
    const organizationId = record.data.organizationId;
    if (typeof organizationId !== 'string' || !organizationId) return;
    const current = usersByOrganization.get(organizationId) || [];
    current.push(record);
    usersByOrganization.set(organizationId, current);
  });

  records.organizations.forEach((record) => {
    const organizationUsers = usersByOrganization.get(record.id) || [];
    const profileManagers = organizationUsers
      .filter((member) => member.id !== uid && String(member.data.role || '').toLowerCase() === 'manager')
      .map((member) => member.id);
    const storedManagers = uniqueStrings(record.data.managerIds);
    const survivingManagers = uniqueStrings([...storedManagers.filter((id) => id !== uid), ...profileManagers]);
    const userIsManager = storedManagers.includes(uid)
      || (userData.organizationId === record.id && String(userData.role || '').toLowerCase() === 'manager');
    if (userIsManager) managerOrganizationsForUser.add(record.id);
    if (userIsManager && !survivingManagers.length) {
      deletedOrgIds.add(record.id);
      return;
    }
    if (survivingManagers.length) {
      successorByOrganization.set(record.id, survivingManagers[0]);
      survivingManagersByOrganization.set(record.id, survivingManagers);
    }
  });

  const teamsById = getRecordMap(records.teams);
  const replacementForOrganization = (organizationId) => (
    typeof organizationId === 'string' ? successorByOrganization.get(organizationId) : undefined
  );
  const defaultManagerReplacement = replacementForOrganization(userData.organizationId)
    || [...managerOrganizationsForUser]
      .map((organizationId) => successorByOrganization.get(organizationId))
      .find(Boolean);
  const inviteManagerReplacement = new Map();

  records.workerInvites.forEach((record) => {
    const data = record.data;
    const incoming = data.workerId === uid
      || identityMatchesEmail(data.email, identity)
      || identityMatchesEmail(data.normalizedEmail, identity)
      || identityMatchesEmail(data.canonicalEmail, identity);
    const team = typeof data.teamId === 'string' ? teamsById.get(data.teamId)?.data : null;
    const organizationId = data.organizationId || team?.organizationId || userData.organizationId;
    const replacement = replacementForOrganization(organizationId);
    if (incoming || deletedOrgIds.has(organizationId) || (data.managerId === uid && !replacement)) {
      queue.delete(record.ref);
      deletedInviteIds.add(record.id);
      deletedSourcePaths.add(record.ref.path);
      sensitiveIds.add(record.id);
      return;
    }
    const updates = {};
    if (data.managerId === uid && replacement) {
      updates.managerId = replacement;
      inviteManagerReplacement.set(record.id, replacement);
    }
    if (data.revokedBy === uid) updates.revokedBy = FieldValue.delete();
    Object.assign(updates, redactStringFields(
      data,
      ['teamName', 'organizationName', 'statusReason'],
      identity
    ));
    queue.update(record.ref, updates);
  });

  records.managerInvites.forEach((record) => {
    const data = record.data;
    const incoming = data.managerUserId === uid
      || identityMatchesEmail(data.email, identity)
      || identityMatchesEmail(data.normalizedEmail, identity)
      || identityMatchesEmail(data.canonicalEmail, identity);
    const replacement = replacementForOrganization(data.organizationId);
    if (incoming || deletedOrgIds.has(data.organizationId) || (data.inviterId === uid && !replacement)) {
      queue.delete(record.ref);
      deletedInviteIds.add(record.id);
      deletedSourcePaths.add(record.ref.path);
      sensitiveIds.add(record.id);
      return;
    }
    const updates = redactStringFields(data, ['organizationName', 'statusReason'], identity);
    if (data.inviterId === uid && replacement) updates.inviterId = replacement;
    queue.update(record.ref, updates);
  });

  records.inviteTokens.forEach((record) => {
    const data = record.data;
    const team = typeof data.teamId === 'string' ? teamsById.get(data.teamId)?.data : null;
    const replacement = inviteManagerReplacement.get(data.inviteId)
      || replacementForOrganization(team?.organizationId)
      || defaultManagerReplacement;
    if (deletedInviteIds.has(record.id)
      || deletedInviteIds.has(data.inviteId)
      || identityMatchesEmail(data.email, identity)
      || (data.managerId === uid && !replacement)) {
      queue.delete(record.ref);
      deletedSourcePaths.add(record.ref.path);
      sensitiveIds.add(record.id);
      return;
    }
    if (data.managerId === uid && replacement) queue.update(record.ref, { managerId: replacement });
  });

  const deletedSecureInviteHashes = new Set();
  records.secureInvites.forEach((record) => {
    const data = record.data;
    const replacement = replacementForOrganization(data.organizationId) || defaultManagerReplacement;
    const incoming = data.claimedBy === uid || identityMatchesEmail(data.deliveryEmail, identity);
    if (incoming
      || deletedInviteIds.has(data.sourceInviteId)
      || deletedOrgIds.has(data.organizationId)
      || (data.inviterId === uid && !replacement)) {
      queue.delete(record.ref);
      deletedSecureInviteHashes.add(record.id);
      deletedSourcePaths.add(record.ref.path);
      sensitiveIds.add(record.id);
      return;
    }

    const updates = redactStringFields(
      data,
      ['inviterName', 'organizationName', 'teamName', 'statusReason'],
      identity
    );
    if (data.inviterId === uid && replacement) updates.inviterId = replacement;
    queue.update(record.ref, updates);
  });

  records.secureInviteCodes.forEach((record) => {
    if (deletedSecureInviteHashes.has(record.data.inviteHash)) {
      queue.delete(record.ref);
      deletedSourcePaths.add(record.ref.path);
      sensitiveIds.add(record.id);
    }
  });

  records.organizations.forEach((record) => {
    const data = record.data;
    if (deletedOrgIds.has(record.id)) {
      queue.delete(record.ref);
      sensitiveIds.add(record.id);
      deletedSourcePaths.add(record.ref.path);
      return;
    }
    const organizationUsers = usersByOrganization.get(record.id) || [];
    const profileManagers = organizationUsers
      .filter((member) => member.id !== uid && String(member.data.role || '').toLowerCase() === 'manager')
      .map((member) => member.id);
    const managerIds = uniqueStrings([...uniqueStrings(data.managerIds).filter((id) => id !== uid), ...profileManagers]);
    const workerIds = uniqueStrings(data.workerIds).filter((id) => id !== uid);
    const pendingEmails = uniqueStrings(data.pendingManagerInviteEmails).filter((email) => !identityMatchesEmail(email, identity));
    const pendingCanonicalEmails = uniqueStrings(data.pendingManagerInviteCanonicalEmails).filter((email) => !identityMatchesEmail(email, identity));
    const updates = redactStringFields(data, ['name'], identity);
    organizationNamesAfterDeletion.set(record.id, updates.name || data.name);
    changedArrayUpdate(updates, 'managerIds', data.managerIds, managerIds);
    changedArrayUpdate(updates, 'workerIds', data.workerIds, workerIds);
    changedArrayUpdate(updates, 'pendingManagerInviteEmails', data.pendingManagerInviteEmails, pendingEmails);
    changedArrayUpdate(updates, 'pendingManagerInviteCanonicalEmails', data.pendingManagerInviteCanonicalEmails, pendingCanonicalEmails);
    if (data.createdBy === uid) updates.createdBy = managerIds[0] || FieldValue.delete();
    removeDeletedReference(updates, 'lastAcceptedInviteId', data.lastAcceptedInviteId, deletedInviteIds, FieldValue);
    if (Object.keys(updates).length) updates.updatedAt = FieldValue.serverTimestamp();
    queue.update(record.ref, updates);
  });

  records.users.forEach((record) => {
    if (record.id === uid) return;
    if (deletedOrgIds.has(record.data.organizationId)) {
      queue.update(record.ref, {
        organizationId: null,
        organizationName: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }
    const organizationName = organizationNamesAfterDeletion.get(record.data.organizationId);
    if (organizationName && organizationName !== record.data.organizationName) {
      queue.update(record.ref, {
        organizationName,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  records.teams.forEach((record) => {
    const data = record.data;
    const storedManagerIds = uniqueStrings([data.managerId, ...uniqueStrings(data.managerIds)]);
    const organizationManagers = data.organizationId && !deletedOrgIds.has(data.organizationId)
      ? (survivingManagersByOrganization.get(data.organizationId) || [])
      : [];
    const managerIds = uniqueStrings([
      ...storedManagerIds.filter((id) => id !== uid),
      ...uniqueStrings(organizationManagers).filter((id) => id !== uid),
    ]);
    const replacement = replacementForOrganization(data.organizationId) || managerIds[0];
    if (deletedOrgIds.has(data.organizationId) || (data.managerId === uid && !replacement)) {
      queue.delete(record.ref);
      deletedTeamIds.add(record.id);
      sensitiveIds.add(record.id);
      deletedSourcePaths.add(record.ref.path);
      return;
    }
    const updates = redactStringFields(data, ['name', 'organizationName'], identity);
    if (data.managerId === uid && replacement) updates.managerId = replacement;
    changedArrayUpdate(updates, 'managerIds', data.managerIds, managerIds);
    changedArrayUpdate(updates, 'workerIds', data.workerIds, uniqueStrings(data.workerIds).filter((id) => id !== uid));
    removeDeletedReference(updates, 'lastAcceptedInviteId', data.lastAcceptedInviteId, deletedInviteIds, FieldValue);
    if (Object.keys(updates).length) updates.updatedAt = FieldValue.serverTimestamp();
    queue.update(record.ref, updates);
  });

  records.events.forEach((record) => {
    const data = record.data;
    const replacement = data.organizationId
      ? replacementForOrganization(data.organizationId)
      : defaultManagerReplacement;
    const deleteEvent = deletedOrgIds.has(data.organizationId) || (data.managerId === uid && !replacement);
    if (deleteEvent) {
      collectAttachmentPaths(data.roles, storagePaths);
      queue.delete(record.ref);
      deletedEventIds.add(record.id);
      sensitiveIds.add(record.id);
      deletedSourcePaths.add(record.ref.path);
      return;
    }
    const sanitized = sanitizeEventRoles(data.roles, uid, storagePaths, identity);
    const updates = {};
    if (data.managerId === uid && replacement) updates.managerId = replacement;
    if (sanitized.changed || !sameArray(data.workerIds, sanitized.workerIds)) {
      updates.roles = sanitized.roles;
      updates.workerIds = sanitized.workerIds;
      updates.revision = Number(data.revision || 0) + 1;
    }
    Object.assign(updates, redactStringFields(data, ['name', 'location', 'description'], identity));
    if (Object.keys(updates).length) updates.updatedAt = FieldValue.serverTimestamp();
    queue.update(record.ref, updates);
    eventOwnerAfter.set(record.id, updates.managerId || data.managerId);
  });

  records.eventTemplates.forEach((record) => {
    const data = record.data;
    const replacement = data.organizationId
      ? replacementForOrganization(data.organizationId)
      : defaultManagerReplacement;
    const deleteTemplate = data.managerId === uid && !replacement;
    if (deleteTemplate) {
      collectAttachmentPaths(data.roles, storagePaths);
      queue.delete(record.ref);
      sensitiveIds.add(record.id);
      deletedSourcePaths.add(record.ref.path);
      return;
    }
    const sanitized = sanitizeTemplateRoles(data.roles, uid, storagePaths, identity);
    const updates = {};
    if (data.managerId === uid && replacement) updates.managerId = replacement;
    if (sanitized.changed) updates.roles = sanitized.roles;
    Object.assign(updates, redactStringFields(
      data,
      ['name', 'defaultLocation', 'defaultDescription'],
      identity
    ));
    if (Object.keys(updates).length) updates.updatedAt = FieldValue.serverTimestamp();
    queue.update(record.ref, updates);
  });

  records.roleAssignmentNotifications.forEach((record) => {
    const data = record.data;
    const replacement = eventOwnerAfter.get(data.eventId)
      || (!data.eventId ? defaultManagerReplacement : undefined);
    if (data.workerId === uid
      || deletedEventIds.has(data.eventId)
      || (data.managerId === uid && !replacement)) {
      queue.delete(record.ref);
      deletedRoleNotificationIds.add(record.id);
      sensitiveIds.add(record.id);
      deletedSourcePaths.add(record.ref.path);
      return;
    }
    const updates = {};
    if (data.managerId === uid && replacement) updates.managerId = replacement;
    [
      'roleAssignedWorkerIds',
      'roleWaitlistWorkerIds',
      'roleEligibleWaitlistWorkerIds',
      'roleWaitlistInviteWorkerIds',
      'pushSeenBy',
    ].forEach((field) => {
      const next = uniqueStrings(data[field]).filter((id) => id !== uid);
      changedArrayUpdate(updates, field, data[field], next);
    });
    Object.assign(updates, redactStringFields(
      data,
      ['eventName', 'eventLocation', 'roleName', 'statusReason'],
      identity
    ));
    if (Array.isArray(data.roleTaskNames)) {
      const roleTaskNames = data.roleTaskNames.map((name) => redactIdentityText(name, identity));
      changedArrayUpdate(updates, 'roleTaskNames', data.roleTaskNames, roleTaskNames);
    }
    queue.update(record.ref, updates);
  });

  records.events.forEach((record) => {
    if (deletedEventIds.has(record.id)) return;
    const data = record.data;
    const updates = {};
    removeDeletedReference(updates, 'pendingInviteNotificationId', data.pendingInviteNotificationId, deletedRoleNotificationIds, FieldValue);
    if (updates.pendingInviteNotificationId) updates.pendingInviteRoleId = FieldValue.delete();
    if (data.pendingInviteNotificationIds && typeof data.pendingInviteNotificationIds === 'object') {
      const nextEntries = Object.entries(data.pendingInviteNotificationIds)
        .filter(([, notificationId]) => !deletedRoleNotificationIds.has(notificationId));
      if (nextEntries.length !== Object.keys(data.pendingInviteNotificationIds).length) {
        updates.pendingInviteNotificationIds = nextEntries.length
          ? Object.fromEntries(nextEntries)
          : FieldValue.delete();
      }
    }
    if (Object.keys(updates).length) updates.updatedAt = FieldValue.serverTimestamp();
    queue.update(record.ref, updates);
  });

  records.users.forEach((record) => {
    if (record.id === uid || !Array.isArray(record.data.scheduledEventReminderKeys)) return;
    const scheduledEventReminderKeys = uniqueStrings(record.data.scheduledEventReminderKeys)
      .filter((key) => ![...deletedEventIds].some((eventId) => key.includes(eventId)))
      .filter((key) => !textContainsIdentity(key, identity));
    if (!sameArray(record.data.scheduledEventReminderKeys, scheduledEventReminderKeys)) {
      queue.update(record.ref, {
        scheduledEventReminderKeys,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  records.userNotifications.forEach((record) => {
    const data = record.data;
    const directReference = valueReferencesIdentity({
      userId: data.userId,
      workerId: data.workerId,
      managerId: data.managerId,
      sourceUserId: data.sourceUserId,
      createdBy: data.createdBy,
    }, identity);
    if (data.userId === uid
      || directReference
      || deletedEventIds.has(data.relatedEventId)
      || deletedInviteIds.has(data.relatedRoleId)
      || deletedRoleNotificationIds.has(data.sourceNotificationId)) {
      queue.delete(record.ref);
      deletedUserNotificationIds.add(record.id);
      sensitiveIds.add(record.id);
      deletedSourcePaths.add(record.ref.path);
      return;
    }
    const updates = {};
    Object.assign(updates, redactStringFields(data, ['title', 'body', 'statusReason'], identity));
    const pushSeenBy = uniqueStrings(data.pushSeenBy).filter((id) => id !== uid);
    changedArrayUpdate(updates, 'pushSeenBy', data.pushSeenBy, pushSeenBy);
    queue.update(record.ref, updates);
  });

  records.mail.forEach((record) => {
    if (valueReferencesIdentity(record.data, identity, true)
      || valueContainsAny(record.data, new Set([
        ...deletedInviteIds,
        ...deletedEventIds,
        ...deletedRoleNotificationIds,
        ...deletedUserNotificationIds,
      ]))) {
      queue.recursiveDelete(record.ref);
      sensitiveIds.add(record.id);
      deletedSourcePaths.add(record.ref.path);
    }
  });

  for (const thread of records.chatThreads) {
    const data = thread.data;
    const messages = await listCollectionDocuments(thread.ref.collection('messages'));
    const activeViewers = await listCollectionDocuments(thread.ref.collection('activeViewers'));
    let deleteWholeThread = threadIdReferencesUser(thread.id, uid)
      || deletedOrgIds.has(data.organizationId)
      || deletedTeamIds.has(data.teamId);
    const participants = uniqueStrings(data.participants).filter((id) => id !== uid);
    if (!participants.length && uniqueStrings(data.participants).includes(uid)) deleteWholeThread = true;

    if (deleteWholeThread) {
      messages.forEach((message) => {
        (Array.isArray(message.data.attachments) ? message.data.attachments : []).forEach((attachment) => {
          const path = storagePathFromAttachment(attachment);
          if (path) storagePaths.add(path);
        });
        deletedMessageIds.add(message.id);
        sensitiveIds.add(message.id);
      });
      queue.recursiveDelete(thread.ref);
      deletedThreadIds.add(thread.id);
      sensitiveIds.add(thread.id);
      deletedSourcePaths.add(thread.ref.path);
      continue;
    }

    const redactedTitle = redactIdentityText(data.title, identity);
    const redactedTeamName = redactIdentityText(data.teamName, identity);
    const redactedLastMessage = redactIdentityText(data.lastMessage, identity);
    const redactedLastMessageText = redactIdentityText(data.lastMessageText, identity);
    let threadAffected = !sameArray(participants, data.participants)
      || data.createdBy === uid
      || data.lastMessageSenderId === uid
      || redactedTitle !== data.title
      || redactedTeamName !== data.teamName
      || redactedLastMessage !== data.lastMessage
      || redactedLastMessageText !== data.lastMessageText;
    const remainingMessages = [];
    for (const message of messages) {
      const messageData = message.data;
      const senderNameMatches = identity.names.some((name) => (
        typeof messageData.senderName === 'string'
        && messageData.senderName.trim().toLowerCase() === name.toLowerCase()
      ));
      if (messageData.senderId === uid || (!messageData.senderId && senderNameMatches)) {
        (Array.isArray(messageData.attachments) ? messageData.attachments : []).forEach((attachment) => {
          const path = storagePathFromAttachment(attachment);
          if (path) storagePaths.add(path);
        });
        queue.delete(message.ref);
        deletedMessageIds.add(message.id);
        sensitiveIds.add(message.id);
        deletedSourcePaths.add(message.ref.path);
        threadAffected = true;
        continue;
      }

      const updates = {};
      const recipientIds = uniqueStrings(messageData.recipientIds).filter((id) => id !== uid);
      changedArrayUpdate(updates, 'recipientIds', messageData.recipientIds, recipientIds);
      const text = redactIdentityText(messageData.text, identity);
      const senderName = redactIdentityText(messageData.senderName, identity);
      if (text !== messageData.text) updates.text = text;
      if (senderName !== messageData.senderName) updates.senderName = senderName;
      const attachments = (Array.isArray(messageData.attachments) ? messageData.attachments : []).filter((attachment) => {
        const path = storagePathFromAttachment(attachment);
        if (!path || !storagePathBelongsToUser(path, uid)) return true;
        storagePaths.add(path);
        return false;
      });
      if (attachments.length !== (messageData.attachments || []).length) updates.attachments = attachments;
      if (Object.keys(updates).length) {
        queue.update(message.ref, updates);
        threadAffected = true;
      }
      remainingMessages.push({ ...messageData, ...updates, id: message.id });
    }

    activeViewers.forEach((viewer) => {
      if (viewer.id === uid || viewer.data.userId === uid || valueReferencesIdentity(viewer.data, identity)) {
        queue.delete(viewer.ref);
        threadAffected = true;
      }
    });

    if (threadAffected) {
      affectedThreadIds.add(thread.id);
      const updates = {};
      changedArrayUpdate(updates, 'participants', data.participants, participants);
      changedArrayUpdate(updates, 'pushSeenBy', data.pushSeenBy, uniqueStrings(data.pushSeenBy).filter((id) => id !== uid));
      if (data.createdBy === uid) updates.createdBy = FieldValue.delete();
      if (redactedTitle !== data.title) updates.title = redactedTitle;
      if (redactedTeamName !== data.teamName) updates.teamName = redactedTeamName;
      const latestMessage = remainingMessages.sort((left, right) => timestampMs(right.createdAt) - timestampMs(left.createdAt))[0];
      if (latestMessage) {
        const summary = summarizeMessage(latestMessage);
        updates.lastMessageText = summary;
        if (Object.hasOwn(data, 'lastMessage')) updates.lastMessage = summary;
        if (latestMessage.senderId) updates.lastMessageSenderId = latestMessage.senderId;
        else updates.lastMessageSenderId = FieldValue.delete();
        if (latestMessage.createdAt) updates.updatedAt = latestMessage.createdAt;
      } else {
        updates.lastMessageText = FieldValue.delete();
        if (Object.hasOwn(data, 'lastMessage')) updates.lastMessage = FieldValue.delete();
        updates.lastMessageSenderId = FieldValue.delete();
        updates.updatedAt = FieldValue.serverTimestamp();
      }
      queue.update(thread.ref, updates);
    }
  }

  records.chatUnread.forEach((record) => {
    const data = record.data;
    const deleteUnread = data.userId === uid
      || record.id.startsWith(`${uid}__`)
      || threadIdReferencesUser(record.id, uid)
      || valueReferencesIdentity(data, identity)
      || deletedThreadIds.has(data.threadId)
      || deletedTeamIds.has(data.teamId)
      || [...deletedThreadIds].some((threadId) => record.id.includes(threadId));
    if (deleteUnread) {
      queue.delete(record.ref);
      sensitiveIds.add(record.id);
      return;
    }
    if (affectedThreadIds.has(data.threadId)) {
      queue.update(record.ref, { unreadCount: 0, updatedAt: FieldValue.serverTimestamp() });
    }
  });

  records.dispatchBetaChecklistRuns.forEach((record) => {
    if (record.id === uid || valueReferencesIdentity(record.data, identity)) {
      queue.recursiveDelete(record.ref);
      sensitiveIds.add(record.id);
    }
  });

  const deletedDeliveryIds = new Set();
  records.pushDeliveries.forEach((record) => {
    const data = record.data;
    if (valueReferencesIdentity(data, identity, true)
      || deletedSourcePaths.has(data.sourcePath)
      || valueContainsAny(data, sensitiveIds)) {
      queue.delete(record.ref);
      if (typeof data.deliveryId === 'string') {
        deletedDeliveryIds.add(data.deliveryId);
        sensitiveIds.add(data.deliveryId);
      }
      sensitiveIds.add(record.id);
    }
  });
  records.pushTickets.forEach((record) => {
    const data = record.data;
    if (valueReferencesIdentity(data, identity, true)
      || deletedDeliveryIds.has(data.deliveryId)
      || valueContainsAny(data, sensitiveIds)) {
      queue.delete(record.ref);
      sensitiveIds.add(record.id);
    }
  });

  const avatarPath = storagePathFromAttachment({ id: userData.avatarStoragePath, url: userData.avatarUrl });
  if (avatarPath) storagePaths.add(avatarPath);
  const storageFiles = await collectOwnedStorageFiles(bucket, uid, deletedThreadIds, storagePaths);
  const storageObjectsDeleted = await deleteStorageFiles(storageFiles);

  const recursiveDeletes = queue.recursiveValues();
  for (const ref of recursiveDeletes) await db.recursiveDelete(ref);
  const operations = queue.values();
  await commitOperations(db, operations);
  const residualDocumentsDeleted = await deleteResidualIdentityRecords({
    db,
    identity,
    collectionNames: [
      'workerInvites',
      'managerInvites',
      'inviteTokens',
      'secureInvites',
      'secureInviteCodes',
      'roleAssignmentNotifications',
      'userNotifications',
      'chatUnread',
      'mail',
      'pushDeliveries',
      'pushTickets',
    ],
    deletedSourcePaths,
    sensitiveIds,
  });
  await db.collection('users').doc(uid).delete();

  return {
    firestoreDocumentsDeleted: operations.filter((operation) => operation.type === 'delete').length
      + recursiveDeletes.length
      + residualDocumentsDeleted
      + 1,
    firestoreDocumentsUpdated: operations.filter((operation) => operation.type === 'update').length,
    recursiveRootsDeleted: recursiveDeletes.length,
    residualDocumentsDeleted,
    storageObjectsDeleted,
    organizationsDeleted: deletedOrgIds.size,
    eventsDeleted: deletedEventIds.size,
    chatsDeleted: deletedThreadIds.size,
  };
}

module.exports = {
  ACCOUNT_DELETION_COLLECTIONS,
  buildDeletionIdentity,
  canonicalizeEmail,
  deleteDispatchUserData,
  identityMatchesEmail,
  redactIdentityText,
  sanitizeEventRoles,
  sanitizeTemplateRoles,
  storagePathBelongsToUser,
  storagePathFromAttachment,
  threadIdReferencesUser,
  valueReferencesIdentity,
};
