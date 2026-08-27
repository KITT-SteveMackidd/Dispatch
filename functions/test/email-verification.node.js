const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EMAIL_VERIFICATION_COOLDOWN_MS,
  buildVerificationEmail,
  verificationCooldownSeconds,
} = require('../lib/email-verification');

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
