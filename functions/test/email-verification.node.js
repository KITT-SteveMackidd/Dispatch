const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DISPATCH_VERIFICATION_URL,
  EMAIL_VERIFICATION_COOLDOWN_MS,
  buildDispatchVerificationLink,
  buildVerificationEmail,
  normalizeVerificationInviteToken,
  verificationCooldownSeconds,
} = require('../lib/email-verification');

test('routes Firebase verification action codes through the Dispatch result page', () => {
  const link = buildDispatchVerificationLink(
    'https://dispatch-eb63a.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=abc%2B123&lang=en',
    undefined,
    'secure_invite-123'
  );
  const url = new URL(link);

  assert.equal(`${url.origin}${url.pathname}`, DISPATCH_VERIFICATION_URL);
  assert.equal(url.searchParams.get('mode'), 'verifyEmail');
  assert.equal(url.searchParams.get('oobCode'), 'abc+123');
  assert.equal(url.searchParams.get('lang'), 'en');
  assert.equal(url.searchParams.get('inviteToken'), 'secure_invite-123');
});

test('only carries valid invitation values into verification links', () => {
  assert.equal(normalizeVerificationInviteToken(' invite-code-123 '), 'invite-code-123');
  assert.equal(normalizeVerificationInviteToken('short'), null);
  assert.equal(normalizeVerificationInviteToken('invite/with/path'), null);
  assert.equal(normalizeVerificationInviteToken(null), null);
});

test('rejects malformed Firebase verification links', () => {
  assert.throws(
    () => buildDispatchVerificationLink('https://example.com/?mode=resetPassword&oobCode=abc'),
    /missing a verifyEmail action code/
  );
  assert.throws(
    () => buildDispatchVerificationLink('https://example.com/?mode=verifyEmail'),
    /missing a verifyEmail action code/
  );
});

test('builds a Dispatch verification email with the generated Firebase action link', () => {
  const email = buildVerificationEmail({
    deliveryEmail: 'worker+dispatch@example.com',
    displayName: 'Worker One',
    verificationLink: 'https://dispatch-eb63a.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=abc',
  });

  assert.deepEqual(email.to, ['worker+dispatch@example.com']);
  assert.equal(email.message.subject, 'Verify your Dispatch email');
  assert.match(email.message.text, /verify your email address/i);
  assert.match(email.message.html, /Verify my Dispatch email/);
  assert.match(email.message.html, /mode=verifyEmail/);
});

test('escapes user-controlled values in verification email HTML', () => {
  const email = buildVerificationEmail({
    deliveryEmail: 'worker@example.com',
    displayName: '<Worker & Manager>',
    verificationLink: 'https://example.com/?a=1&b=2',
  });

  assert.doesNotMatch(email.message.html, /<Worker/);
  assert.match(email.message.html, /&lt;Worker &amp; Manager&gt;/);
  assert.match(email.message.html, /a=1&amp;b=2/);
});

test('enforces and expires the verification resend cooldown', () => {
  const now = 1_000_000;
  assert.equal(verificationCooldownSeconds(0, now), 0);
  assert.equal(verificationCooldownSeconds(now, now), EMAIL_VERIFICATION_COOLDOWN_MS / 1000);
  assert.equal(verificationCooldownSeconds(now - 30_500, now), 30);
  assert.equal(verificationCooldownSeconds(now - EMAIL_VERIFICATION_COOLDOWN_MS, now), 0);
});
