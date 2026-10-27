param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9][a-z0-9_-]{2,31}$')]
  [string]$RunId,
  [switch]$ResumeAttachments,
  [switch]$QueriesOnly,
  [switch]$AuthoringOnly,
  [switch]$ReportsOnly,
  [switch]$ModerationOnly,
  [switch]$ModerationCleanupOnly,
  [switch]$ScopesOnly,
  [switch]$NotificationsOnly,
  [switch]$NotificationCleanupOnly,
  [switch]$ResumeNotificationFence
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$localEnvironment = @{
  GCLOUD_PROJECT = 'demo-dispatch-billing'
  GOOGLE_CLOUD_PROJECT = 'demo-dispatch-billing'
  GCP_PROJECT = 'demo-dispatch-billing'
  FIREBASE_CONFIG = '{"projectId":"demo-dispatch-billing","storageBucket":"demo-dispatch-billing.firebasestorage.app"}'
  FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
  FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
  CHAT_SAFETY_TEST_RUN_ID = $RunId
  CHAT_SAFETY_RESUME_ATTACHMENTS = $ResumeAttachments.IsPresent.ToString().ToLowerInvariant()
  CHAT_SAFETY_RESUME_NOTIFICATION_FENCE = $ResumeNotificationFence.IsPresent.ToString().ToLowerInvariant()
}
$previous = @{}
try {
  foreach ($key in $localEnvironment.Keys) {
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $localEnvironment[$key], 'Process')
  }
  if (@($QueriesOnly, $AuthoringOnly, $ReportsOnly, $ModerationOnly, $ModerationCleanupOnly, $ScopesOnly, $NotificationsOnly, $NotificationCleanupOnly, $ResumeNotificationFence, $ResumeAttachments | Where-Object IsPresent).Count -gt 1) { throw 'Choose only one verification phase.' }
  $scriptName = if ($QueriesOnly) { 'check-chat-safety-queries.js' } elseif ($AuthoringOnly) { 'check-chat-safety-authoring.js' } elseif ($ReportsOnly) { 'check-chat-safety-reports.js' } elseif ($ModerationOnly) { 'check-chat-safety-moderation.js' } elseif ($ModerationCleanupOnly) { 'check-chat-safety-moderation-cleanup.js' } elseif ($ScopesOnly) { 'check-chat-safety-scopes.js' } elseif ($NotificationsOnly) { 'check-chat-safety-notifications.js' } elseif ($NotificationCleanupOnly -or $ResumeNotificationFence) { 'check-chat-safety-notification-cleanup.js' } else { 'check-chat-safety-local.js' }
  & node (Join-Path $repoRoot "functions\scripts\$scriptName")
  if ($LASTEXITCODE -ne 0) { throw 'Local chat-safety verification failed. Check the saved run results; do not reset existing emulator data.' }
} finally {
  foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
