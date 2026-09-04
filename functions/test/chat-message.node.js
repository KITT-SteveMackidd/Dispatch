const assert = require('node:assert/strict');
const test = require('node:test');
const { buildChatMessageMutation } = require('../lib/chat-message');

const thread = {
  id: 'organization:org-1:all',
  organizationId: 'org-1',
  teamId: null,
  participants: ['manager-1', 'worker-1', 'manager-2'],
};

test('chat messages derive recipients from the stored thread without rewriting participants', () => {
  const result = buildChatMessageMutation({
    thread,
    senderId: 'worker-1',
    senderName: 'Worker One',
    text: '  Hello team  ',
    attachments: [],
  });

  assert.deepEqual(result.recipientIds, ['manager-1', 'manager-2']);
  assert.equal(result.message.text, 'Hello team');
  assert.equal(result.message.senderName, 'Worker One');
  assert.equal(result.threadPatch.lastMessageText, 'Hello team');
  assert.equal(Object.hasOwn(result.threadPatch, 'participants'), false);
});

test('chat messages reject non-participants', () => {
  assert.throws(() => buildChatMessageMutation({
    thread,
    senderId: 'outsider-1',
    senderName: 'Outsider',
    text: 'No access',
    attachments: [],
  }), /not a member/);
});

test('chat attachments are sanitized and can provide the message summary', () => {
  const result = buildChatMessageMutation({
    thread,
    senderId: 'manager-1',
    senderName: 'Manager One',
    text: '',
    attachments: [{
      id: 'chatAttachments/thread/file.pdf',
      kind: 'file',
      name: 'Run sheet.pdf',
      mimeType: 'application/pdf',
      size: 1200,
      url: 'https://firebasestorage.googleapis.com/example',
      ignored: 'not persisted',
    }],
  });

  assert.equal(result.threadPatch.lastMessageText, 'Sent 1 attachment');
  assert.deepEqual(result.message.attachments[0], {
    id: 'chatAttachments/thread/file.pdf',
    kind: 'file',
    name: 'Run sheet.pdf',
    mimeType: 'application/pdf',
    size: 1200,
    url: 'https://firebasestorage.googleapis.com/example',
  });
});

test('chat content limits reject empty and unsafe messages', () => {
  assert.throws(() => buildChatMessageMutation({ thread, senderId: 'worker-1', text: '', attachments: [] }), /Enter a message/);
  assert.throws(() => buildChatMessageMutation({
    thread,
    senderId: 'worker-1',
    text: '',
    attachments: [{ id: 'bad', kind: 'file', name: 'bad', url: 'file:///private/file' }],
  }), /attachment is invalid/);
  assert.throws(() => buildChatMessageMutation({
    thread,
    senderId: 'worker-1',
    text: 'x'.repeat(4001),
    attachments: [],
  }), /4,000/);
});
