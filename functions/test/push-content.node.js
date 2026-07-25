const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chatPushContent,
  eventReminderTargets,
  normalizeExpoPushTokens,
  rolePushContent,
} = require('../lib/push-content');

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

test('builds role invite content', () => {
  const content = rolePushContent({
    id: 'invite-1',
    action: 'assign',
    eventId: 'event-1',
    eventName: 'Concert',
    roleName: 'Box Office',
  });
  assert.equal(content.title, 'New role invite');
  assert.match(content.body, /Concert.*Box Office/);
  assert.equal(content.data.relatedEventId, 'event-1');
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
