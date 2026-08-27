const EMAIL_VERIFICATION_COOLDOWN_MS = 60 * 1000;

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildVerificationEmail({ deliveryEmail, displayName, verificationLink }) {
  const name = typeof displayName === 'string' && displayName.trim()
    ? displayName.trim()
    : 'Dispatch user';
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(verificationLink);

  return {
    to: [deliveryEmail],
    message: {
      subject: 'Verify your Dispatch email',
      text: `Hi ${name}, verify your email address to finish creating your Dispatch account: ${verificationLink} If you did not create this account, you can ignore this email.`,
      html: `<p>Hi <strong>${safeName}</strong>,</p><p>Verify your email address to finish creating your Dispatch account.</p><p><a href="${safeLink}"><strong>Verify my Dispatch email</strong></a></p><p>If you did not create this account, you can ignore this email.</p>`,
    },
  };
}

function verificationCooldownSeconds(lastRequestedAtMs, nowMs = Date.now()) {
  if (!Number.isFinite(lastRequestedAtMs) || lastRequestedAtMs <= 0) return 0;
  const remainingMs = EMAIL_VERIFICATION_COOLDOWN_MS - (nowMs - lastRequestedAtMs);
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

module.exports = {
  EMAIL_VERIFICATION_COOLDOWN_MS,
  buildVerificationEmail,
  verificationCooldownSeconds,
};
