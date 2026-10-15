const EXPO_PUSH_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;
const VALID_PLATFORMS = new Set(['ios', 'android', 'web', 'unknown']);
const VALID_PERMISSION_STATUSES = new Set(['granted', 'denied', 'undetermined']);

function normalizePushTokenRegistration(input = {}) {
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (!EXPO_PUSH_TOKEN_PATTERN.test(token)) {
    throw new Error('A valid Expo push token is required.');
  }

  const rawPlatform = typeof input.platform === 'string' ? input.platform.trim().toLowerCase() : 'unknown';
  const rawPermissionStatus = typeof input.permissionStatus === 'string'
    ? input.permissionStatus.trim().toLowerCase()
    : 'undetermined';

  return {
    token,
    platform: VALID_PLATFORMS.has(rawPlatform) ? rawPlatform : 'unknown',
    permissionStatus: VALID_PERMISSION_STATUSES.has(rawPermissionStatus) ? rawPermissionStatus : 'undetermined',
  };
}

function stalePushTokenOwnerIds(ownerIds, currentUserId) {
  return [...new Set((Array.isArray(ownerIds) ? ownerIds : [])
    .filter((ownerId) => typeof ownerId === 'string' && ownerId.trim())
    .map((ownerId) => ownerId.trim()))]
    .filter((ownerId) => ownerId !== currentUserId);
}

module.exports = {
  normalizePushTokenRegistration,
  stalePushTokenOwnerIds,
};
