const FIREBASE_APPLE_REVOKE_URL =
  'https://identitytoolkit.googleapis.com/v2/accounts:revokeToken';

function normalizeRequiredString(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function firebaseIdTokenFromAuthorizationHeader(value) {
  const header = Array.isArray(value) ? value[0] : value;
  const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  if (!match?.[1]) throw new Error('A Firebase ID token is required.');
  return match[1];
}

async function readFirebaseError(response) {
  const payload = await response.json().catch(() => ({}));
  const message = payload && typeof payload.error?.message === 'string'
    ? payload.error.message
    : `http_${response.status}`;
  return message;
}

async function revokeAppleAuthorization(params) {
  const authorizationCode = normalizeRequiredString(
    params.authorizationCode,
    'Apple authorization code'
  );
  const firebaseIdToken = normalizeRequiredString(params.firebaseIdToken, 'Firebase ID token');
  const apiKey = normalizeRequiredString(params.apiKey, 'Firebase API key');
  const fetchImpl = params.fetchImpl || fetch;
  const response = await fetchImpl(
    `${FIREBASE_APPLE_REVOKE_URL}?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        providerId: 'apple.com',
        tokenType: '3',
        token: authorizationCode,
        idToken: firebaseIdToken,
      }),
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(10_000)
        : undefined,
    }
  );

  if (!response.ok) {
    const code = await readFirebaseError(response);
    throw new Error(`Firebase Apple authorization revocation failed (${code}).`);
  }

  return { revoked: true, tokenType: 'authorization_code' };
}

module.exports = {
  FIREBASE_APPLE_REVOKE_URL,
  firebaseIdTokenFromAuthorizationHeader,
  revokeAppleAuthorization,
};
