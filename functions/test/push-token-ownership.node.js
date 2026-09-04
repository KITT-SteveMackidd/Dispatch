const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePushTokenRegistration,
  stalePushTokenOwnerIds,
} = require('../lib/push-token-ownership');

test('normalizes a valid Expo push token registration', () => {
  assert.deepEqual(normalizePushTokenRegistration({
    token: ' ExpoPushToken[device] ',
    platform: 'IOS',
    permissionStatus: 'GRANTED',
  }), {
    token: 'ExpoPushToken[device]',
    platform: 'ios',
    permissionStatus: 'granted',
  });
});

test('rejects malformed Expo push tokens', () => {
  assert.throws(() => normalizePushTokenRegistration({ token: 'not-a-token' }), /valid Expo push token/);
});

test('returns only stale unique owners for token reassignment', () => {
  assert.deepEqual(stalePushTokenOwnerIds(
    ['old-user', 'current-user', 'old-user', '', null],
    'current-user'
  ), ['old-user']);
});
