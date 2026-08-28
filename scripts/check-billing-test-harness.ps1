. (Join-Path $PSScriptRoot 'billing-test-common.ps1')

Enable-BillingTestJava | Out-Null
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
$firebase = Get-BillingTestFirebaseCli

$seedCommand = 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/seed-billing-test.ps1'
& $firebase emulators:exec --project $script:BillingTestProjectId --only auth,firestore,functions,storage $seedCommand
exit $LASTEXITCODE
