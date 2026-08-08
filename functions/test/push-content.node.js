const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chatPushContent,
  chatPushRecipientIds,
  documentKey,
  eventReminderTargets,
  normalizeExpoPushTokens,
  rolePushContent,
  rolePushRecipientId,
} = require('../lib/push-content');

test('creates stable Firestore-safe delivery keys', () => {
  const key = documentKey('user-notification:late-task:manager-1');
  assert.equal(key, documentKey('user-notification:late-task:manager-1'));
  assert.match(key, /^[a-f0-9]{64}$/);
});

test('normalizes and deduplicates Expo push tokens', () => {
  assert.deepEqual(normalizeExpoPushTokens([
    'ExpoPushToken[abc]',
    'ExpoPushToken[abc]',
    'ExponentPushToken[xyz]',
    'not-a-token',
  ]), ['ExpoPushToken[abc]', 'ExponentPushToken[xyz]']);
});

test('builds chat notification content and routing data', () => {
  assert.deepEqual(chatPushContent({
    threadId: 'thread-1',
    senderId: 'manager-1',
    senderName: 'Alex',
    recipientIds: ['worker-1'],
    text: 'Call time changed.',
  }, { participants: ['manager-1', 'worker-1'] }), {
    title: 'New message from Alex',
    body: 'Call time changed.',
    data: {
      kind: 'chat',
      threadId: 'thread-1',
      senderId: 'manager-1',
      teamId: undefined,
      organizationId: undefined,
      threadTitle: undefined,
      participantIds: ['manager-1', 'worker-1'],
    },
  });
});

test('never sends a chat push to the sender', () => {
  assert.deepEqual(chatPushRecipientIds({
    senderId: 'manager-1',
    recipientIds: ['manager-1', 'worker-1', 'worker-1'],
  }), ['worker-1']);
  assert.deepEqual(chatPushRecipientIds({ senderId: 'manager-1' }, {
    participants: ['manager-1', 'worker-1'],
  }), ['worker-1']);
});

test('does not push a chat message to a recipient actively viewing the thread', () => {
  assert.deepEqual(chatPushRecipientIds({
    senderId: 'manager-1',
    recipientIds: ['worker-1', 'worker-2'],
  }, {}, ['worker-1']), ['worker-2']);
});

test('builds role invite content', () => {
  const content = rolePushContent({
    id: 'invite-1',
    action: 'assign',
    eventId: 'event-1',
    eventName: 'Concert',
    roleName: 'Box Office',
    statusReason: 'Worker must accept or decline this role assignment before it is finalized.',
  });
  assert.equal(content.title, 'New role invite');
  assert.equal(content.body, 'Concert: You were invited to Box Office. Accept or decline in Dispatch.');
  assert.equal(content.data.relatedEventId, 'event-1');
});

test('sends a role invite only to a Worker who is not the sending Manager', () => {
  assert.equal(rolePushRecipientId({ workerId: 'worker-1', managerId: 'manager-1' }), 'worker-1');
  assert.equal(rolePushRecipientId({ workerId: 'manager-1', managerId: 'manager-1' }), null);
  assert.equal(rolePushRecipientId({ managerId: 'manager-1' }), null);
});

test('returns every assigned worker and their roles for reminders', () => {
  assert.deepEqual(eventReminderTargets({
    roles: [
      { name: 'Box Office', assignedWorkerIds: ['worker-1'] },
      { name: 'Usher', assignedWorkerIds: ['worker-1', 'worker-2'] },
    ],
  }), [
    { userId: 'worker-1', roleNames: ['Box Office', 'Usher'] },
    { userId: 'worker-2', roleNames: ['Usher'] },
  ]);
});
