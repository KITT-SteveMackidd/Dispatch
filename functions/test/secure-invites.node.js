const assert = require('node:assert/strict');
const test = require('node:test');
const {
  INVITE_CODE_LENGTH,
  buildInviteUrls,
  buildSecureInviteEmail,
  canAdoptInviteRole,
  generateInviteSecrets,
  hashInviteCode,
  hashInviteToken,
  maskEmail,
  normalizeInviteCode,
} = require('../lib/secure-invites');

test('generates independent high-entropy token and fallback code', () => {
  const first = generateInviteSecrets();
  const second = generateInviteSecrets();

  assert.ok(first.token.length >= 40);
  assert.equal(first.code.length, INVITE_CODE_LENGTH);
  assert.match(first.code, /^[A-HJ-NP-Z2-9]+$/);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.code, second.code);
});

test('hashes tokens exactly and codes in a human-friendly normalized form', () => {
  assert.notEqual(hashInviteToken('TokenValue'), hashInviteToken('tokenvalue'));
  assert.equal(hashInviteCode('abcd-2345-efgh'), hashInviteCode('ABCD2345EFGH'));
  assert.equal(normalizeInviteCode(' abcd-2345 efgh '), 'ABCD2345EFGH');
});

test('builds web and installed-app links without storing the raw token', () => {
  const links = buildInviteUrls('secret/token', 'https://dispatchcrewmanager.com/invite/');
  assert.equal(links.webUrl, 'https://dispatchcrewmanager.com/invite/secret%2Ftoken');
  assert.equal(links.appUrl, 'dispatch://invite/secret%2Ftoken');
  assert.equal(maskEmail('Worker+Apple@example.com'), 'wo**********@example.com');
});

test('invitation email permits Apple, Google, or email identities', () => {
  const email = buildSecureInviteEmail({
    deliveryEmail: 'delivery@example.com',
    inviteKind: 'worker',
    organizationName: 'Example Org',
    teamName: 'Tech Team',
    inviterName: 'Manager One',
    inviteId: 'invite-1',
    webUrl: 'https://dispatchcrewmanager.com/invite/token',
    appUrl: 'dispatch://invite/token',
    code: 'ABCD2345EFGH',
  });

  assert.deepEqual(email.to, ['delivery@example.com']);
  assert.match(email.message.text, /sign in or create your account with Apple, Google, or email/i);
  assert.match(email.message.text, /does not need to match this delivery address/i);
  assert.match(email.message.text, /iPhone and Android preview downloads/i);
  assert.match(email.message.text, /return to this email/i);
  assert.match(email.message.html, /Open your Dispatch invitation/i);
  assert.equal(email.dispatchInvite.inviteCode, 'ABCD2345EFGH');
});

test('allows an unaffiliated account to adopt the role carried by an invitation', () => {
  assert.equal(canAdoptInviteRole({ currentRole: 'manager', targetRole: 'worker', currentOrganizationId: null }), true);
  assert.equal(canAdoptInviteRole({ currentRole: 'worker', targetRole: 'manager', currentOrganizationId: '' }), true);
  assert.equal(canAdoptInviteRole({ currentRole: 'worker', targetRole: 'worker', currentOrganizationId: 'org-1' }), true);
});

test('protects an affiliated account from silently changing roles', () => {
  assert.equal(canAdoptInviteRole({ currentRole: 'manager', targetRole: 'worker', currentOrganizationId: 'org-1' }), false);
  assert.equal(canAdoptInviteRole({ currentRole: 'worker', targetRole: 'manager', currentOrganizationId: 'org-1' }), false);
  assert.equal(canAdoptInviteRole({ currentRole: 'worker', targetRole: 'invalid', currentOrganizationId: null }), false);
});
