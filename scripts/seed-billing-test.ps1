. (Join-Path $PSScriptRoot 'billing-test-common.ps1')

$files = Get-BillingTestFiles
$app = Read-BillingTestEnvFile -Path $files.App
$runId = $app['BILLING_TEST_RUN_ID']
if ((Test-BillingTestPlaceholder $runId) -or $runId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$') {
  throw 'BILLING_TEST_RUN_ID must be a fresh 3-32 character identifier in .env.local.'
}

$env:GCLOUD_PROJECT = $script:BillingTestProjectId
$env:FIREBASE_CONFIG = "{`"projectId`":`"$script:BillingTestProjectId`",`"storageBucket`":`"$script:BillingTestProjectId.firebasestorage.app`"}"
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
$env:BILLING_TEST_RUN_ID = $runId.ToLowerInvariant()

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw 'node.exe was not found.' }

& $node.Source (Join-Path $script:BillingTestRepoRoot 'functions\scripts\seed-billing-test.js')
exit $LASTEXITCODE
