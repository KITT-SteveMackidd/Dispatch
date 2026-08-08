const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FIREBASE_APPLE_REVOKE_URL,
  firebaseIdTokenFromAuthorizationHeader,
  revokeAppleAuthorization,
} = require('../lib/apple-account-revocation');

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test('firebaseIdTokenFromAuthorizationHeader extracts a callable bearer token', () => {
  assert.equal(
    firebaseIdTokenFromAuthorizationHeader('Bearer firebase-id-token'),
    'firebase-id-token'
  );
  assert.throws(
    () => firebaseIdTokenFromAuthorizationHeader('Basic credentials'),
    /Firebase ID token is required/
  );
});

test('revokeAppleAuthorization uses the Firebase Identity Platform authorization-code flow', async () => {
  const calls = [];
  const result = await revokeAppleAuthorization({
    authorizationCode: 'fresh-apple-code',
    firebaseIdToken: 'firebase-id-token',
    apiKey: 'firebase api key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, {});
    },
  });

  assert.deepEqual(result, { revoked: true, tokenType: 'authorization_code' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${FIREBASE_APPLE_REVOKE_URL}?key=firebase%20api%20key`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    providerId: 'apple.com',
    tokenType: '3',
    token: 'fresh-apple-code',
    idToken: 'firebase-id-token',
  });
});

test('revokeAppleAuthorization fails closed without exposing credentials', async () => {
  await assert.rejects(
    () => revokeAppleAuthorization({
      authorizationCode: 'secret-apple-code',
      firebaseIdToken: 'secret-firebase-token',
      apiKey: 'firebase-key',
      fetchImpl: async () => jsonResponse(400, {
        error: { message: 'INVALID_OAUTH_TOKEN' },
      }),
    }),
    (error) => {
      assert.match(error.message, /INVALID_OAUTH_TOKEN/);
      assert.doesNotMatch(error.message, /secret-apple-code|secret-firebase-token/);
      return true;
    }
  );
});
