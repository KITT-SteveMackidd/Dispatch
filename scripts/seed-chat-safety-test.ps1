param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9][a-z0-9_-]{2,31}$')]
  [string]$RunId,
  [switch]$RestoreAuthOnly
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
}
$previous = @{}
try {
  foreach ($key in $localEnvironment.Keys) {
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $localEnvironment[$key], 'Process')
  }
  $scriptName = if ($RestoreAuthOnly) { 'restore-chat-safety-test-auth.js' } else { 'seed-chat-safety-test.js' }
  & node (Join-Path $repoRoot "functions\scripts\$scriptName")
  if ($LASTEXITCODE -ne 0) { throw 'Local chat safety seed failed. Existing data was not reset.' }
} finally {
  foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
