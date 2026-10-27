const assert = require('node:assert/strict');
const test = require('node:test');
const { deleteDispatchUserData } = require('../lib/account-deletion');

const DELETE_FIELD = Symbol('delete-field');
const FieldValue = {
  delete: () => DELETE_FIELD,
  serverTimestamp: () => ({ __serverTimestamp: true }),
  increment: value => ({ __increment: value }),
};

function assertNoUndefined(value, path = 'update') {
  if (value === undefined) throw new Error(`Firestore update contains undefined at ${path}`);
  if (!value || typeof value !== 'object' || value === DELETE_FIELD) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUndefined(item, `${path}[${index}]`));
    return;
  }
  Object.entries(value).forEach(([key, item]) => assertNoUndefined(item, `${path}.${key}`));
}

class FakeDocumentSnapshot {
  constructor(db, ref) {
    this.db = db;
    this.ref = ref;
    this.id = ref.id;
  }

  get exists() {
    return this.db.documents.has(this.ref.path);
  }

  data() {
    return this.db.documents.get(this.ref.path);
  }
}

class FakeDocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split('/').at(-1);
  }

  collection(name) {
    return new FakeCollectionReference(this.db, `${this.path}/${name}`);
  }

  async delete() {
    this.db.documents.delete(this.path);
  }

  async get() { return new FakeDocumentSnapshot(this.db, this); }

  async set(data, options = {}) {
    const previous = this.db.documents.get(this.path) || {};
    const next = options.merge ? { ...previous } : {};
    for (const [key, value] of Object.entries(data)) {
      next[key] = value?.__increment ? Number(previous[key] || 0) + value.__increment : value;
    }
    this.db.documents.set(this.path, next);
  }
}

class FakeQuery {
  constructor(collection, limitValue = 400, cursor = null) {
    this.collectionRef = collection;
    this.limitValue = limitValue;
    this.cursor = cursor;
  }

  limit(value) {
    return new FakeQuery(this.collectionRef, value, this.cursor);
  }

  startAfter(cursor) {
    return new FakeQuery(this.collectionRef, this.limitValue, cursor);
  }

  async get() {
    const prefix = `${this.collectionRef.path}/`;
    const depth = this.collectionRef.path.split('/').length + 1;
    const paths = [...this.collectionRef.db.documents.keys()]
      .filter((path) => path.startsWith(prefix) && path.split('/').length === depth)
      .sort()
      .filter((path) => !this.cursor || path > this.cursor.ref.path)
      .slice(0, this.limitValue);
    const docs = paths.map((path) => new FakeDocumentSnapshot(
      this.collectionRef.db,
      new FakeDocumentReference(this.collectionRef.db, path)
    ));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class FakeCollectionReference extends FakeQuery {
  constructor(db, path) {
    super(null);
    this.db = db;
    this.path = path;
    this.collectionRef = this;
  }

  doc(id) {
    return new FakeDocumentReference(this.db, `${this.path}/${id}`);
  }
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
  }

  collection(name) {
    return new FakeCollectionReference(this, name);
  }

  batch() {
    const writes = [];
    return {
      delete: (ref) => writes.push({ type: 'delete', ref }),
      update: (ref, data) => {
        assertNoUndefined(data, ref.path);
        writes.push({ type: 'update', ref, data });
      },
      commit: async () => {
        writes.forEach((write) => {
          if (write.type === 'delete') {
            this.documents.delete(write.ref.path);
            return;
          }
          const current = this.documents.get(write.ref.path);
          if (!current) throw new Error(`Missing document for update: ${write.ref.path}`);
          const next = { ...current };
          Object.entries(write.data).forEach(([field, value]) => {
            if (value === DELETE_FIELD) delete next[field];
            else next[field] = value;
          });
          this.documents.set(write.ref.path, next);
        });
      },
    };
  }

  async recursiveDelete(ref) {
    [...this.documents.keys()].forEach((path) => {
      if (path === ref.path || path.startsWith(`${ref.path}/`)) this.documents.delete(path);
    });
  }
}

class FakeStorageFile {
  constructor(bucket, name) {
    this.bucket = bucket;
    this.name = name;
  }

  async delete() {
    this.bucket.deleted.add(this.name);
    this.bucket.files.delete(this.name);
  }
}

class FakeStorageBucket {
  constructor(names, lateChatFile = null) {
    this.files = new Set(names);
    this.deleted = new Set();
    this.lateChatFile = lateChatFile;
    this.chatListCount = 0;
  }

  file(name) {
    return new FakeStorageFile(this, name);
  }

  async getFiles({ prefix }) {
    const files = [...this.files]
      .filter((name) => name.startsWith(prefix))
      .map((name) => new FakeStorageFile(this, name));
    if (prefix === 'chatAttachments/' && this.chatListCount === 0 && this.lateChatFile) {
      this.files.add(this.lateChatFile);
    }
    if (prefix === 'chatAttachments/') this.chatListCount += 1;
    return [files];
  }
}

test('account deletion erases secure grants, late uploads and private safety data without deleting other owners', async () => {
  const grantId = 'a'.repeat(40);
  const keepGrantId = 'b'.repeat(40);
  const prefix = `chatSafetyAttachments/${grantId}/`;
  const keepPath = `chatSafetyAttachments/${keepGrantId}/keep.pdf`;
  const db = new FakeFirestore({
    'users/delete': { uid: 'delete', role: 'worker', organizationId: 'org' },
    'users/manager': { uid: 'manager', role: 'manager', organizationId: 'org' },
    'organizations/org': { managerIds: ['manager'], workerIds: ['delete'] },
    'users/delete/chatSafetyState/current': { version: 1 },
    'users/delete/chatBlocks/manager': { targetUserId: 'manager' },
    'users/manager/chatBlocks/delete': { targetUserId: 'delete', displayName: 'Deleted member' },
    'users/manager/chatSafetyState/current': { version: 3 },
    [`chatUploadGrants/${grantId}`]: { ownerId: 'delete', threadId: 'group', organizationId: 'org', objectPath: `${prefix}file.pdf` },
    [`chatUploadGrants/${keepGrantId}`]: { ownerId: 'manager', threadId: 'group', organizationId: 'org', objectPath: keepPath },
    'chatThreads/group': { organizationId: 'org', kind: 'organization', participants: ['delete', 'manager'] },
  });
  const bucket = new FakeStorageBucket([`${prefix}file.pdf`, keepPath]);
  const originalList = bucket.getFiles.bind(bucket);
  let listed = false;
  bucket.getFiles = async options => {
    const result = await originalList(options);
    if (options.prefix === prefix && !listed) { listed = true; bucket.files.add(`${prefix}late.pdf`); }
    return result;
  };
  await deleteDispatchUserData({ db, bucket, FieldValue, authUser: { uid: 'delete', providerData: [] } });
  assert.equal([...db.documents.keys()].some(path => path === 'users/delete' || path.startsWith('users/delete/')), false);
  assert.equal(db.documents.has('users/manager/chatBlocks/delete'), false);
  assert.equal(db.documents.get('users/manager/chatSafetyState/current').version, 4);
  assert.equal(db.documents.has(`chatUploadGrants/${grantId}`), false);
  assert.equal(db.documents.has(`chatUploadGrants/${keepGrantId}`), true);
  assert.equal([...bucket.files].some(path => path.startsWith(prefix)), false);
  assert.equal(bucket.files.has(keepPath), true);
});

test('account deletion removes involved reports and counters while redacting bystander text in retained reports', async () => {
  const db = new FakeFirestore({
    'users/removed-person': { uid: 'removed-person', role: 'worker', organizationId: 'org' },
    'users/manager': { uid: 'manager', role: 'manager', organizationId: 'org' },
    'organizations/org': { managerIds: ['manager'], workerIds: ['removed-person'] },
    'users/removed-person/chatReportLimits/current': { hourCount: 2 },
    'chatSafetyReports/by-removed': { reporterUserId: 'removed-person', targetUserId: 'manager', organizationId: 'org' },
    'chatSafetyReports/about-removed': { reporterUserId: 'manager', targetUserId: 'removed-person', organizationId: 'org' },
    'chatSafetyReports/retained': {
      reporterUserId: 'manager', targetUserId: 'someone-else', organizationId: 'org', details: 'Contact removed-person about it',
      evidence: { message: { senderId: 'someone-else', text: 'removed-person was mentioned', attachments: [] } },
    },
    'chatSafetyReports/unrelated': { reporterUserId: 'other-manager', targetUserId: 'other-worker', organizationId: 'other', details: 'Unrelated' },
  });
  await deleteDispatchUserData({ db, bucket: new FakeStorageBucket([]), FieldValue, authUser: { uid: 'removed-person', providerData: [] } });
  assert.equal(db.documents.has('chatSafetyReports/by-removed'), false);
  assert.equal(db.documents.has('chatSafetyReports/about-removed'), false);
  assert.equal(db.documents.has('users/removed-person/chatReportLimits/current'), false);
  assert.equal(db.documents.get('chatSafetyReports/unrelated').details, 'Unrelated');
  const retained = db.documents.get('chatSafetyReports/retained');
  assert.equal(retained.details.includes('removed-person'), false);
  assert.equal(retained.evidence.message.text.includes('removed-person'), false);
  assert.equal(retained.evidence.message.senderId, 'someone-else');
  assert.ok(db.documents.has('users/manager/chatSafetyState/current'));
});

test('deletion removes private review sources and linked alerts while retaining anonymized enforcement deduplication', async () => {
  const db = new FakeFirestore({
    'users/removed-person': { uid: 'removed-person', role: 'worker', organizationId: 'org' },
    'users/manager': { uid: 'manager', role: 'manager', organizationId: 'org' },
    'users/worker': { uid: 'worker', role: 'worker', organizationId: 'org' },
    'organizations/org': { managerIds: ['manager'], workerIds: ['removed-person', 'worker'] },
    'chatSafetyReports/reporter': { reporterUserId: 'removed-person', targetUserId: 'worker', organizationId: 'org' },
    'chatSafetyReports/target': { reporterUserId: 'worker', targetUserId: 'removed-person', organizationId: 'org' },
    'chatSafetyReports/enforcement': { reporterUserId: 'removed-person', targetUserId: 'worker', organizationId: 'org' },
    'chatUserModerationState/worker': { active: true, sourceReportId: 'enforcement' },
    ...Object.fromEntries(['recipient', 'reporter', 'target', 'enforcement', 'unrelated'].map(id => [`chatReviewNotificationSources/${id}`, {
      reportId: id, organizationId: 'org', recipientUserId: id === 'recipient' ? 'removed-person' : 'manager',
      reporterUserId: ['reporter', 'enforcement'].includes(id) ? 'removed-person' : 'worker',
      targetUserId: id === 'target' ? 'removed-person' : 'worker',
    }])),
    ...Object.fromEntries(['recipient', 'reporter', 'target', 'enforcement', 'unrelated'].map(id => [`userNotifications/${id}`, {
      userId: id === 'recipient' ? 'removed-person' : 'manager', kind: 'chat_safety_report', body: 'A chat safety report is ready for review.',
    }])),
    'pushDeliveries/reporter-delivery': { deliveryId: 'reporter-delivery', sourcePath: 'userNotifications/reporter', userId: 'manager' },
    'pushTickets/reporter-ticket': { deliveryId: 'reporter-delivery', userId: 'manager' },
  });
  await deleteDispatchUserData({ db, bucket: new FakeStorageBucket([]), FieldValue, authUser: { uid: 'removed-person', providerData: [] } });
  for (const id of ['recipient', 'reporter', 'target']) {
    assert.equal(db.documents.has(`chatReviewNotificationSources/${id}`), false, id);
    assert.equal(db.documents.has(`userNotifications/${id}`), false, id);
  }
  assert.equal(db.documents.has('pushDeliveries/reporter-delivery'), false);
  assert.equal(db.documents.has('pushTickets/reporter-ticket'), false);
  assert.equal(db.documents.get('chatReviewNotificationSources/enforcement').reporterUserId, null);
  assert.equal(db.documents.has('userNotifications/enforcement'), true);
  assert.equal(db.documents.has('chatReviewNotificationSources/unrelated'), true);
  assert.equal(db.documents.has('userNotifications/unrelated'), true);
});

test('deleteDispatchUserData cleans personal records and preserves shared work under the correct manager', async () => {
  const deletingUid = 'manager-delete';
  const db = new FakeFirestore({
    [`users/${deletingUid}`]: {
      displayName: 'Steve Manager',
      email: 'steve+dispatch@example.com',
      role: 'manager',
      organizationId: 'org-1',
      organizationName: 'Steve Manager Events',
      pushTokens: ['ExponentPushToken[delete]'],
      avatarStoragePath: 'chatAttachments/organization:org-1:all/manager-keep/keep.jpg',
    },
    'users/manager-keep': {
      displayName: 'Keep Manager',
      role: 'manager',
      organizationId: 'org-1',
      organizationName: 'Steve Manager Events',
    },
    'users/worker-1': {
      displayName: 'Worker One',
      role: 'worker',
      organizationId: 'org-1',
      organizationName: 'Steve Manager Events',
      scheduledEventReminderKeys: [
        'event-delete:two-hours',
        'event-orphan:two-hours',
        'event-orphaned:two-hours',
        'event-keep:two-hours',
      ],
    },
    'users/manager-other': { displayName: 'Other', role: 'manager', organizationId: 'org-2' },
    'organizations/org-1': {
      name: 'Steve Manager Events',
      managerIds: [deletingUid, 'manager-stale', 'manager-keep'],
      workerIds: ['worker-1'],
      createdBy: deletingUid,
      billingManagerId: deletingUid,
      billingManagerTransferredBy: deletingUid,
    },
    'organizations/org-2': { name: 'Steve Manager Other Org', managerIds: ['manager-other'], workerIds: [] },
    'organizationBilling/org-1': {
      planId: 'production',
      billingPeriod: 'annual',
      status: 'active',
      accessMode: 'full',
      seatLimit: 50,
      purchaserUserId: deletingUid,
      sourceStore: 'app_store',
      productIdentifier: 'dispatch_production_50_annual',
      willRenew: true,
      pendingPlanId: 'crew',
    },
    'organizationBilling/org-2': {
      planId: 'crew',
      billingPeriod: 'monthly',
      status: 'grace',
      accessMode: 'full',
      seatLimit: 20,
      purchaserUserId: deletingUid,
      sourceStore: 'play_store',
      productIdentifier: 'dispatch_crew_20_monthly',
      willRenew: true,
    },
    'billingAuditEvents/audit-scrub': {
      organizationId: 'org-1',
      actorUserId: 'manager-keep',
      targetUserId: deletingUid,
      previousBillingManagerId: deletingUid,
      nextBillingManagerId: 'manager-keep',
    },
    'revenueCatCustomers/customer-delete': {
      purchaserUserId: deletingUid,
      organizationId: 'org-1',
      active: true,
      state: 'active',
    },
    'revenueCatCustomers/customer-delete-second': {
      purchaserUserId: deletingUid,
      organizationId: 'org-2',
      active: true,
      state: 'active',
    },
    'revenueCatWebhookEvents/transfer-scrub': {
      organizationId: 'org-2',
      purchaserUserId: deletingUid,
      sourcePurchaserUserIds: [deletingUid, 'manager-other'],
      destinationPurchaserUserIds: ['manager-other', deletingUid],
    },
    'teams/team-1': {
      managerId: deletingUid,
      managerIds: [deletingUid, 'manager-stale', 'manager-keep'],
      organizationId: 'org-1',
      organizationName: 'Steve Manager Events',
      name: 'Steve Manager Team',
      workerIds: ['worker-1'],
    },
    'events/event-keep': {
      managerId: deletingUid,
      organizationId: 'org-1',
      name: 'Steve Manager Launch',
      workerIds: ['worker-1'],
      roles: [{
        id: 'role-1',
        name: 'Crew',
        assignedWorkerIds: ['worker-1'],
        openSlots: 0,
        tasks: [{
          id: 'task-1',
          name: 'Brief Steve Manager',
          attachments: [{ id: `dispatchTemplateAttachments/${deletingUid}/task-1/brief.pdf` }],
        }],
      }],
    },
    'events/event-delete': {
      managerId: deletingUid,
      organizationId: 'org-2',
      name: 'Wrong organization owner',
      roles: [],
    },
    'events/event-orphan': {
      managerId: deletingUid,
      organizationId: 'missing-org',
      name: 'Orphaned event',
      roles: [],
    },
    'eventTemplates/template-1': {
      managerId: deletingUid,
      name: 'Steve Manager Template',
      roles: [{ id: 'role-1', name: 'Crew', tasks: [] }],
    },
    'workerInvites/invite-out': {
      managerId: deletingUid,
      organizationId: 'org-1',
      teamId: 'team-1',
      email: 'worker@example.com',
      statusReason: 'Invited by Steve Manager',
    },
    'workerInvites/invite-in': {
      managerId: 'manager-keep',
      organizationId: 'org-1',
      email: 'steve+dispatch@example.com',
    },
    'workerInvites/invite-other-alias': {
      managerId: 'manager-keep',
      organizationId: 'org-1',
      email: 'steve+worker@example.com',
    },
    'managerInvites/manager-invite': {
      inviterId: deletingUid,
      organizationId: 'org-1',
      organizationName: 'Steve Manager Events',
      email: 'new-manager@example.com',
    },
    'inviteTokens/invite-out': {
      inviteId: 'invite-out',
      managerId: deletingUid,
      email: 'worker@example.com',
      token: 'opaque-token',
    },
    'inviteTokens/invite-in': {
      inviteId: 'invite-in',
      managerId: 'manager-keep',
      email: 'steve+dispatch@example.com',
      token: 'incoming-token',
    },
    'inviteTokens/invite-other-alias': {
      inviteId: 'invite-other-alias',
      managerId: 'manager-keep',
      email: 'steve+worker@example.com',
      token: 'other-alias-token',
    },
    'roleAssignmentNotifications/role-note': {
      workerId: 'worker-1',
      managerId: deletingUid,
      eventId: 'event-keep',
      roleId: 'role-1',
      eventName: 'Steve Manager Launch',
    },
    'userNotifications/delete-note': { userId: deletingUid, title: 'Private', body: 'Private' },
    'userNotifications/redact-note': {
      userId: 'manager-keep',
      title: 'Invite accepted',
      body: 'Steve Manager accepted the invite.',
    },
    'chatThreads/organization:org-1:all': {
      organizationId: 'org-1',
      title: 'Steve Manager Events',
      participants: [deletingUid, 'manager-keep', 'worker-1'],
      lastMessage: 'Thanks Steve Manager',
      lastMessageSenderId: deletingUid,
    },
    'chatThreads/organization:org-1:all/messages/deleted-message': {
      senderId: deletingUid,
      senderName: 'Steve Manager',
      recipientIds: ['manager-keep', 'worker-1'],
      text: 'My private message',
      attachments: [{ id: `chatAttachments/organization:org-1:all/${deletingUid}/photo.jpg` }],
      createdAt: new Date('2026-08-07T10:00:00Z'),
    },
    'chatThreads/organization:org-1:all/messages/x': {
      senderId: deletingUid,
      text: 'Short attacker-controlled message ID',
      createdAt: new Date('2026-08-07T08:30:00Z'),
    },
    'chatThreads/organization:org-1:all/messages/keep-message': {
      senderId: 'manager-keep',
      senderName: 'Keep Manager',
      recipientIds: [deletingUid, 'worker-1'],
      text: 'Thanks Steve Manager',
      createdAt: new Date('2026-08-07T09:00:00Z'),
    },
    [`chatThreads/organization:org-1:all/activeViewers/${deletingUid}`]: { userId: deletingUid },
    [`chatThreads/dm:${deletingUid}__worker-1`]: { participants: [deletingUid, 'worker-1'] },
    [`chatThreads/dm:${deletingUid}__worker-1/messages/direct-message`]: {
      senderId: 'worker-1',
      text: 'Direct history',
    },
    [`chatUnread/${deletingUid}__organization:org-1:all`]: {
      userId: deletingUid,
      threadId: 'organization:org-1:all',
      unreadCount: 2,
    },
    'chatUnread/worker-1__organization:org-1:all': {
      userId: 'worker-1',
      threadId: 'organization:org-1:all',
      unreadCount: 2,
    },
    [`dispatchBetaChecklistRuns/${deletingUid}`]: { userId: deletingUid },
    [`dispatchBetaChecklistRuns/${deletingUid}/items/one`]: { done: true },
    [`_emailVerificationRequests/${deletingUid}`]: { uid: deletingUid, lastMailId: 'mail-1' },
    'mail/mail-1': { to: ['steve+dispatch@example.com'], message: { text: 'Hello Steve Manager' } },
    'mail/mail-deleted-invite': {
      to: ['unrelated@example.com'],
      dispatchInvite: { inviteId: 'invite-in' },
      message: { text: 'Typed invitation provenance' },
    },
    'mail/mail-other': { to: ['other@example.com'], message: { text: 'Steve Manager ExponentPushToken[delete]' } },
    'mail/mail-1/delivery/status': { state: 'SUCCESS' },
    'pushDeliveries/push-1': { userId: deletingUid, deliveryId: 'delivery-1' },
    'pushTickets/ticket-1': { userId: deletingUid, deliveryId: 'delivery-1' },
  });
  const lateChatFile = `chatAttachments/dm:${deletingUid}__worker-1/manager-keep/late.jpg`;
  const bucket = new FakeStorageBucket([
    `dispatchTemplateAttachments/${deletingUid}/task-1/brief.pdf`,
    `chatAttachments/organization:org-1:all/${deletingUid}/photo.jpg`,
    'chatAttachments/organization:org-1:all/manager-keep/keep.jpg',
  ], lateChatFile);

  const result = await deleteDispatchUserData({
    db,
    bucket,
    FieldValue,
    authUser: {
      uid: deletingUid,
      email: 'steve+dispatch@example.com',
      emailVerified: true,
      displayName: 'Steve Manager',
      providerData: [],
    },
  });

  assert.equal(db.documents.has(`users/${deletingUid}`), false);
  assert.deepEqual(db.documents.get('organizations/org-1').managerIds, ['manager-keep']);
  assert.equal(db.documents.get('organizations/org-1').createdBy, 'manager-keep');
  assert.equal(db.documents.get('organizations/org-1').billingManagerId, 'manager-keep');
  assert.equal(db.documents.get('organizations/org-1').billingManagerTransferReason, 'account_deleted');
  assert.equal('billingManagerTransferredBy' in db.documents.get('organizations/org-1'), false);
  assert.equal(db.documents.get('organizations/org-1').name, 'Steve Manager Events');
  assert.equal(db.documents.get('organizations/org-2').name, 'Steve Manager Other Org');
  assert.equal(db.documents.get('organizationBilling/org-1').planId, 'free');
  assert.equal(db.documents.get('organizationBilling/org-1').status, 'revoked');
  assert.equal(db.documents.get('organizationBilling/org-1').accessMode, 'read_only');
  assert.equal(db.documents.get('organizationBilling/org-1').seatLimit, 5);
  assert.equal(db.documents.get('organizationBilling/org-1').purchaserUserId, null);
  assert.equal(db.documents.get('organizationBilling/org-2').planId, 'free');
  assert.equal(db.documents.get('organizationBilling/org-2').status, 'revoked');
  assert.equal(db.documents.get('organizationBilling/org-2').accessMode, 'read_only');
  assert.equal(db.documents.get('organizationBilling/org-2').purchaserUserId, null);
  assert.equal('targetUserId' in db.documents.get('billingAuditEvents/audit-scrub'), false);
  assert.equal('previousBillingManagerId' in db.documents.get('billingAuditEvents/audit-scrub'), false);
  assert.equal(db.documents.get('billingAuditEvents/audit-scrub').actorUserId, 'manager-keep');
  assert.equal(db.documents.has('revenueCatCustomers/customer-delete'), false);
  assert.equal(db.documents.has('revenueCatCustomers/customer-delete-second'), false);
  assert.equal('purchaserUserId' in db.documents.get('revenueCatWebhookEvents/transfer-scrub'), false);
  assert.deepEqual(
    db.documents.get('revenueCatWebhookEvents/transfer-scrub').sourcePurchaserUserIds,
    ['manager-other']
  );
  assert.deepEqual(
    db.documents.get('revenueCatWebhookEvents/transfer-scrub').destinationPurchaserUserIds,
    ['manager-other']
  );
  assert.equal(db.documents.get('users/worker-1').organizationName, 'Steve Manager Events');
  assert.deepEqual(db.documents.get('users/worker-1').scheduledEventReminderKeys, [
    'event-delete:two-hours',
    'event-orphaned:two-hours',
    'event-keep:two-hours',
  ]);
  assert.equal(db.documents.get('teams/team-1').managerId, 'manager-keep');
  assert.deepEqual(db.documents.get('teams/team-1').managerIds, ['manager-keep']);
  assert.equal(db.documents.get('teams/team-1').name, 'Steve Manager Team');
  assert.equal(db.documents.get('events/event-keep').managerId, 'manager-keep');
  assert.equal(db.documents.get('events/event-keep').name, 'Steve Manager Launch');
  assert.deepEqual(db.documents.get('events/event-keep').roles[0].tasks[0].attachments, []);
  assert.equal(db.documents.get('events/event-delete').managerId, 'manager-other');
  assert.equal(db.documents.has('events/event-orphan'), false);
  assert.equal(db.documents.get('eventTemplates/template-1').managerId, 'manager-keep');
  assert.equal(db.documents.get('workerInvites/invite-out').managerId, 'manager-keep');
  assert.equal(db.documents.get('workerInvites/invite-out').statusReason, 'Invited by Steve Manager');
  assert.equal(db.documents.has('workerInvites/invite-in'), false);
  assert.equal(db.documents.has('workerInvites/invite-other-alias'), true);
  assert.equal(db.documents.get('managerInvites/manager-invite').inviterId, 'manager-keep');
  assert.equal(db.documents.get('inviteTokens/invite-out').managerId, 'manager-keep');
  assert.equal(db.documents.has('inviteTokens/invite-in'), false);
  assert.equal(db.documents.has('inviteTokens/invite-other-alias'), true);
  assert.equal(db.documents.get('roleAssignmentNotifications/role-note').managerId, 'manager-keep');
  assert.equal(db.documents.get('roleAssignmentNotifications/role-note').eventName, 'Steve Manager Launch');
  assert.equal(db.documents.has('userNotifications/delete-note'), false);
  assert.equal(db.documents.get('userNotifications/redact-note').body, 'Steve Manager accepted the invite.');

  const sharedThread = db.documents.get('chatThreads/organization:org-1:all');
  assert.deepEqual(sharedThread.participants, ['manager-keep', 'worker-1']);
  assert.equal(sharedThread.title, 'Steve Manager Events');
  assert.equal(sharedThread.lastMessage, 'Thanks Steve Manager');
  assert.equal(db.documents.has('chatThreads/organization:org-1:all/messages/deleted-message'), false);
  assert.equal(
    db.documents.get('chatThreads/organization:org-1:all/messages/keep-message').text,
    'Thanks Steve Manager'
  );
  assert.deepEqual(
    db.documents.get('chatThreads/organization:org-1:all/messages/keep-message').recipientIds,
    ['worker-1']
  );
  assert.equal(db.documents.has(`chatThreads/dm:${deletingUid}__worker-1`), true);
  assert.deepEqual(
    db.documents.get(`chatThreads/dm:${deletingUid}__worker-1`).participants,
    ['worker-1']
  );
  assert.equal(
    db.documents.has(`chatThreads/dm:${deletingUid}__worker-1/messages/direct-message`),
    true
  );
  assert.equal(db.documents.has(`chatUnread/${deletingUid}__organization:org-1:all`), false);
  assert.equal(db.documents.get('chatUnread/worker-1__organization:org-1:all').unreadCount, 0);
  assert.equal(db.documents.has(`dispatchBetaChecklistRuns/${deletingUid}`), false);
  assert.equal(db.documents.has(`_emailVerificationRequests/${deletingUid}`), false);
  assert.equal(db.documents.has('mail/mail-1'), false);
  assert.equal(db.documents.has('mail/mail-deleted-invite'), false);
  assert.equal(db.documents.has('mail/mail-other'), true);
  assert.equal(db.documents.has('pushDeliveries/push-1'), false);
  assert.equal(db.documents.has('pushTickets/ticket-1'), false);
  assert.equal(bucket.deleted.has(`dispatchTemplateAttachments/${deletingUid}/task-1/brief.pdf`), true);
  assert.equal(bucket.deleted.has(`chatAttachments/organization:org-1:all/${deletingUid}/photo.jpg`), true);
  assert.equal(bucket.deleted.has(lateChatFile), false);
  assert.equal(bucket.files.has(lateChatFile), true);
  assert.equal(bucket.files.has('chatAttachments/organization:org-1:all/manager-keep/keep.jpg'), true);
  assert.ok(result.firestoreDocumentsDeleted > 0);
  assert.ok(result.firestoreDocumentsUpdated > 0);
});

test('deleteDispatchUserData preserves worker-only organizations in read-only recovery and deletes empty organizations', async () => {
  const deletingUid = 'sole-manager-delete';
  const db = new FakeFirestore({
    [`users/${deletingUid}`]: {
      displayName: 'Only Manager',
      email: 'only.manager@example.com',
      role: 'manager',
      organizationId: 'org-workers',
      organizationName: 'Worker Organization',
    },
    'users/worker-keep': {
      displayName: 'Accepted Worker',
      role: 'worker',
      organizationId: 'org-workers',
      organizationName: 'Worker Organization',
    },
    'organizations/org-workers': {
      name: 'Worker Organization',
      managerIds: [deletingUid, 'stale-manager'],
      workerIds: ['worker-keep', 'stale-worker'],
      createdBy: deletingUid,
      billingManagerId: deletingUid,
      billingManagerTransferredBy: deletingUid,
    },
    'organizations/org-empty': {
      name: 'Empty Organization',
      managerIds: [deletingUid, 'stale-manager'],
      workerIds: ['stale-worker'],
      createdBy: deletingUid,
      billingManagerId: deletingUid,
    },
    'organizationBilling/org-workers': {
      planId: 'production',
      billingPeriod: 'annual',
      status: 'active',
      accessMode: 'full',
      seatLimit: 50,
      purchaserUserId: deletingUid,
      sourceStore: 'app_store',
      productIdentifier: 'dispatch_production_50_annual',
      willRenew: true,
    },
    'organizationBilling/org-empty': {
      planId: 'free',
      status: 'free',
      accessMode: 'full',
      seatLimit: 5,
      purchaserUserId: null,
    },
    'teams/team-workers': {
      managerId: deletingUid,
      managerIds: [deletingUid, 'stale-manager'],
      organizationId: 'org-workers',
      workerIds: ['worker-keep'],
      name: 'Worker Team',
    },
    'teams/team-empty': {
      managerId: deletingUid,
      managerIds: [deletingUid],
      organizationId: 'org-empty',
      workerIds: [],
      name: 'Empty Team',
    },
    'events/event-workers': {
      managerId: deletingUid,
      organizationId: 'org-workers',
      workerIds: ['worker-keep'],
      name: 'Worker Event',
      roles: [{
        id: 'role-workers',
        assignedWorkerIds: ['worker-keep'],
        tasks: [],
      }],
    },
    'events/event-empty': {
      managerId: deletingUid,
      organizationId: 'org-empty',
      workerIds: [],
      name: 'Empty Event',
      roles: [],
    },
    'eventTemplates/template-workers': {
      managerId: deletingUid,
      organizationId: 'org-workers',
      name: 'Worker Template',
      roles: [],
    },
    'eventTemplates/template-empty': {
      managerId: deletingUid,
      organizationId: 'org-empty',
      name: 'Empty Template',
      roles: [],
    },
  });
  const bucket = new FakeStorageBucket([]);

  const result = await deleteDispatchUserData({
    db,
    bucket,
    FieldValue,
    authUser: {
      uid: deletingUid,
      email: 'only.manager@example.com',
      emailVerified: true,
      displayName: 'Only Manager',
      providerData: [],
    },
  });

  const organization = db.documents.get('organizations/org-workers');
  assert.ok(organization);
  assert.deepEqual(organization.managerIds, []);
  assert.deepEqual(organization.workerIds, ['worker-keep']);
  assert.equal('createdBy' in organization, false);
  assert.equal('billingManagerId' in organization, false);
  assert.equal('billingManagerTransferredBy' in organization, false);
  assert.equal(organization.recoveryState, 'orphaned_no_manager');
  assert.equal(organization.billingManagerTransferReason, 'account_deleted_orphaned');

  const billing = db.documents.get('organizationBilling/org-workers');
  assert.equal(billing.planId, 'free');
  assert.equal(billing.status, 'revoked');
  assert.equal(billing.accessMode, 'read_only');
  assert.equal(billing.purchaserUserId, null);
  assert.equal(billing.recoveryState, 'orphaned_no_manager');

  const team = db.documents.get('teams/team-workers');
  assert.ok(team);
  assert.equal('managerId' in team, false);
  assert.deepEqual(team.managerIds, []);
  assert.deepEqual(team.workerIds, ['worker-keep']);
  assert.equal(team.ownershipState, 'orphaned');

  const event = db.documents.get('events/event-workers');
  assert.ok(event);
  assert.equal('managerId' in event, false);
  assert.deepEqual(event.workerIds, ['worker-keep']);
  assert.equal(event.ownershipState, 'orphaned');

  const template = db.documents.get('eventTemplates/template-workers');
  assert.ok(template);
  assert.equal('managerId' in template, false);
  assert.equal(template.ownershipState, 'orphaned');
  assert.equal(db.documents.get('users/worker-keep').organizationId, 'org-workers');
  assert.equal(db.documents.get('users/worker-keep').organizationRecoveryState, 'orphaned_no_manager');

  assert.equal(db.documents.has('organizations/org-empty'), false);
  assert.equal(db.documents.has('organizationBilling/org-empty'), false);
  assert.equal(db.documents.has('teams/team-empty'), false);
  assert.equal(db.documents.has('events/event-empty'), false);
  assert.equal(db.documents.has('eventTemplates/template-empty'), false);
  assert.equal(result.organizationsDeleted, 1);
  assert.equal(result.orphanedOrganizations, 1);
});

test('last Manager deletion locks retained customer-beta profiles and chats without creating billing', async () => {
  const db = new FakeFirestore({
    'users/manager-delete': { role: 'manager', organizationId: 'org-customer' },
    'users/worker-a': { role: 'worker', organizationId: 'org-customer' },
    'users/worker-b': { role: 'worker', organizationId: 'org-customer' },
    'organizations/org-customer': {
      name: 'Customer beta', managerIds: ['manager-delete'], workerIds: ['worker-a', 'worker-b'],
      createdBy: 'manager-delete', billingManagerId: 'manager-delete',
    },
    'chatThreads/workers-only': {
      organizationId: 'org-customer', participants: ['worker-a', 'worker-b'], createdBy: 'worker-a', kind: 'custom',
    },
    'chatThreads/workers-only/messages/retained': { senderId: 'worker-a', recipientIds: ['worker-b'], text: 'Retained history' },
  });
  const bucket = new FakeStorageBucket(['chatAttachments/workers-only/worker-a/retained.txt']);
  await deleteDispatchUserData({ db, bucket, FieldValue, authUser: { uid: 'manager-delete', providerData: [] } });
  assert.equal(db.documents.get('organizations/org-customer').recoveryState, 'orphaned_no_manager');
  assert.equal(db.documents.get('users/worker-a').organizationRecoveryState, 'orphaned_no_manager');
  assert.equal(db.documents.get('users/worker-b').organizationRecoveryState, 'orphaned_no_manager');
  assert.equal(db.documents.get('chatThreads/workers-only').organizationRecoveryState, 'orphaned_no_manager');
  assert.equal(db.documents.get('chatThreads/workers-only/messages/retained').text, 'Retained history');
  assert.equal(bucket.files.has('chatAttachments/workers-only/worker-a/retained.txt'), true);
  assert.equal(db.documents.has('organizationBilling/org-customer'), false);
});
