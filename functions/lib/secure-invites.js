const crypto = require('node:crypto');

const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 12;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function normalizeInviteCode(value) {
  return typeof value === 'string'
    ? value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    : '';
}

function hashInviteValue(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashInviteToken(token) {
  return hashInviteValue(typeof token === 'string' ? token.trim() : '');
}

function hashInviteCode(code) {
  return hashInviteValue(normalizeInviteCode(code));
}

function generateInviteSecrets() {
  const token = crypto.randomBytes(32).toString('base64url');
  const codeBytes = crypto.randomBytes(INVITE_CODE_LENGTH);
  let code = '';
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    code += INVITE_CODE_ALPHABET[codeBytes[index] % INVITE_CODE_ALPHABET.length];
  }
  return { token, code };
}

function maskEmail(value) {
  const email = normalizeEmail(value);
  const [local, domain] = email.split('@');
  if (!local || !domain) return '';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function canAdoptInviteRole({ currentRole, targetRole, currentOrganizationId }) {
  const normalizedCurrentRole = typeof currentRole === 'string' ? currentRole.trim().toLowerCase() : '';
  const normalizedTargetRole = typeof targetRole === 'string' ? targetRole.trim().toLowerCase() : '';
  if (!['manager', 'worker'].includes(normalizedTargetRole)) return false;
  if (!['manager', 'worker'].includes(normalizedCurrentRole) || normalizedCurrentRole === normalizedTargetRole) return true;
  return !(typeof currentOrganizationId === 'string' && currentOrganizationId.trim());
}

function cleanBaseUrl(value) {
  const fallback = 'https://dispatchcrewmanager.com/invite';
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return candidate.replace(/\/+$/, '');
}

function buildInviteUrls(token, webBaseUrl) {
  const encodedToken = encodeURIComponent(token);
  return {
    webUrl: `${cleanBaseUrl(webBaseUrl)}/${encodedToken}`,
    appUrl: `dispatch://invite/${encodedToken}`,
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildSecureInviteEmail({
  deliveryEmail,
  inviteKind,
  organizationName,
  teamName,
  inviterName,
  inviteId,
  webUrl,
  appUrl,
  code,
}) {
  const isManager = inviteKind === 'manager';
  const destination = isManager
    ? organizationName || 'an organization'
    : teamName || organizationName || 'Dispatch';
  const roleLabel = isManager ? 'Manager' : 'Worker';
  const safeDestination = escapeHtml(destination);
  const safeInviter = escapeHtml(inviterName || 'A Dispatch manager');
  const safeWebUrl = escapeHtml(webUrl);
  const safeAppUrl = escapeHtml(appUrl);
  const safeCode = escapeHtml(code);

  return {
    to: [deliveryEmail],
    message: {
      subject: `You are invited to join ${destination} on Dispatch`,
      text: `${inviterName || 'A Dispatch manager'} invited you to join ${destination} as a ${roleLabel}. Open ${webUrl}. If Dispatch is installed, the app opens with your invitation ready. If it is not installed, the page provides the iPhone and Android preview downloads; install Dispatch, return to this email, and open the link again. Sign in or create your account with Apple, Google, or email. Your sign-in email does not need to match this delivery address. Backup invitation code: ${code}. Installed-app fallback: ${appUrl}.`,
      html: `<p><strong>${safeInviter}</strong> invited you to join <strong>${safeDestination}</strong> as a ${roleLabel}.</p><p><a href="${safeWebUrl}"><strong>Open your Dispatch invitation</strong></a>.</p><p>If Dispatch is installed, the app opens with your invitation ready. If it is not installed, the invitation page provides the iPhone and Android preview downloads. Install Dispatch, return to this email, and open the invitation again.</p><p>Sign in or create your account with Apple, Google, or email. Your sign-in email does not need to match this delivery address.</p><p>Backup invitation code: <strong>${safeCode}</strong></p><p>If needed, <a href="${safeAppUrl}">open the installed app directly</a>.</p>`,
    },
    dispatchInvite: {
      inviteId,
      inviteKind,
      organizationName: organizationName || null,
      teamName: teamName || null,
      appLink: webUrl,
      appSchemeLink: appUrl,
      inviteCode: code,
      deliveryEmail,
    },
  };
}

module.exports = {
  INVITE_CODE_LENGTH,
  INVITE_TTL_MS,
  buildInviteUrls,
  buildSecureInviteEmail,
  canAdoptInviteRole,
  generateInviteSecrets,
  hashInviteCode,
  hashInviteToken,
  isValidEmail,
  maskEmail,
  normalizeEmail,
  normalizeInviteCode,
};
