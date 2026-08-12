const assert = require('node:assert/strict');
const test = require('node:test');
const { deleteDispatchUserData } = require('../lib/account-deletion');

const DELETE_FIELD = Symbol('delete-field');
const FieldValue = {
  delete: () => DELETE_FIELD,
  serverTimestamp: () => ({ __serverTimestamp: true }),
};

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
      update: (ref, data) => writes.push({ type: 'update', ref, data }),
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
  constructor(names) {
    this.files = new Set(names);
    this.deleted = new Set();
  }

  file(name) {
    return new FakeStorageFile(this, name);
  }

  async getFiles({ prefix }) {
    return [[...this.files]
      .filter((name) => name.startsWith(prefix))
      .map((name) => new FakeStorageFile(this, name))];
  }
}

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
        'event-keep:two-hours',
      ],
    },
    'users/manager-other': { displayName: 'Other', role: 'manager', organizationId: 'org-2' },
    'organizations/org-1': {
      name: 'Steve Manager Events',
      managerIds: [deletingUid, 'manager-keep'],
      workerIds: ['worker-1'],
      createdBy: deletingUid,
    },
    'organizations/org-2': { name: 'Other Org', managerIds: ['manager-other'], workerIds: [] },
    'teams/team-1': {
      managerId: deletingUid,
      managerIds: [deletingUid, 'manager-keep'],
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
    'mail/mail-1': { to: ['steve+dispatch@example.com'], message: { text: 'Hello Steve Manager' } },
    'mail/mail-1/delivery/status': { state: 'SUCCESS' },
    'pushDeliveries/push-1': { userId: deletingUid, deliveryId: 'delivery-1' },
    'pushTickets/ticket-1': { userId: deletingUid, deliveryId: 'delivery-1' },
  });
  const bucket = new FakeStorageBucket([
    `dispatchTemplateAttachments/${deletingUid}/task-1/brief.pdf`,
    `chatAttachments/organization:org-1:all/${deletingUid}/photo.jpg`,
    'chatAttachments/organization:org-1:all/manager-keep/keep.jpg',
  ]);

  const result = await deleteDispatchUserData({
    db,
    bucket,
    FieldValue,
    authUser: {
      uid: deletingUid,
      email: 'steve+dispatch@example.com',
      displayName: 'Steve Manager',
      providerData: [],
    },
  });

  assert.equal(db.documents.has(`users/${deletingUid}`), false);
  assert.deepEqual(db.documents.get('organizations/org-1').managerIds, ['manager-keep']);
  assert.equal(db.documents.get('organizations/org-1').createdBy, 'manager-keep');
  assert.equal(db.documents.get('organizations/org-1').name, 'Deleted user Events');
  assert.equal(db.documents.get('users/worker-1').organizationName, 'Deleted user Events');
  assert.deepEqual(db.documents.get('users/worker-1').scheduledEventReminderKeys, [
    'event-delete:two-hours',
    'event-keep:two-hours',
  ]);
  assert.equal(db.documents.get('teams/team-1').managerId, 'manager-keep');
  assert.equal(db.documents.get('teams/team-1').name, 'Deleted user Team');
  assert.equal(db.documents.get('events/event-keep').managerId, 'manager-keep');
  assert.equal(db.documents.get('events/event-keep').name, 'Deleted user Launch');
  assert.deepEqual(db.documents.get('events/event-keep').roles[0].tasks[0].attachments, []);
  assert.equal(db.documents.get('events/event-delete').managerId, 'manager-other');
  assert.equal(db.documents.has('events/event-orphan'), false);
  assert.equal(db.documents.get('eventTemplates/template-1').managerId, 'manager-keep');
  assert.equal(db.documents.get('workerInvites/invite-out').managerId, 'manager-keep');
  assert.equal(db.documents.get('workerInvites/invite-out').statusReason, 'Invited by Deleted user');
  assert.equal(db.documents.has('workerInvites/invite-in'), false);
  assert.equal(db.documents.has('workerInvites/invite-other-alias'), true);
  assert.equal(db.documents.get('managerInvites/manager-invite').inviterId, 'manager-keep');
  assert.equal(db.documents.get('inviteTokens/invite-out').managerId, 'manager-keep');
  assert.equal(db.documents.has('inviteTokens/invite-in'), false);
  assert.equal(db.documents.has('inviteTokens/invite-other-alias'), true);
  assert.equal(db.documents.get('roleAssignmentNotifications/role-note').managerId, 'manager-keep');
  assert.equal(db.documents.get('roleAssignmentNotifications/role-note').eventName, 'Deleted user Launch');
  assert.equal(db.documents.has('userNotifications/delete-note'), false);
  assert.equal(db.documents.get('userNotifications/redact-note').body, 'Deleted user accepted the invite.');

  const sharedThread = db.documents.get('chatThreads/organization:org-1:all');
  assert.deepEqual(sharedThread.participants, ['manager-keep', 'worker-1']);
  assert.equal(sharedThread.title, 'Deleted user Events');
  assert.equal(db.documents.has('chatThreads/organization:org-1:all/messages/deleted-message'), false);
  assert.equal(
    db.documents.get('chatThreads/organization:org-1:all/messages/keep-message').text,
    'Thanks Deleted user'
  );
  assert.deepEqual(
    db.documents.get('chatThreads/organization:org-1:all/messages/keep-message').recipientIds,
    ['worker-1']
  );
  assert.equal(db.documents.has(`chatThreads/dm:${deletingUid}__worker-1`), false);
  assert.equal(db.documents.has(`chatUnread/${deletingUid}__organization:org-1:all`), false);
  assert.equal(db.documents.get('chatUnread/worker-1__organization:org-1:all').unreadCount, 0);
  assert.equal(db.documents.has(`dispatchBetaChecklistRuns/${deletingUid}`), false);
  assert.equal(db.documents.has('mail/mail-1'), false);
  assert.equal(db.documents.has('pushDeliveries/push-1'), false);
  assert.equal(db.documents.has('pushTickets/ticket-1'), false);
  assert.equal(bucket.deleted.has(`dispatchTemplateAttachments/${deletingUid}/task-1/brief.pdf`), true);
  assert.equal(bucket.deleted.has(`chatAttachments/organization:org-1:all/${deletingUid}/photo.jpg`), true);
  assert.equal(bucket.files.has('chatAttachments/organization:org-1:all/manager-keep/keep.jpg'), true);
  assert.ok(result.firestoreDocumentsDeleted > 0);
  assert.ok(result.firestoreDocumentsUpdated > 0);
});
