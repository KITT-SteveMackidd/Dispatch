. (Join-Path $PSScriptRoot 'billing-test-common.ps1')

& (Join-Path $PSScriptRoot 'check-billing-test-config.ps1')
if (-not $?) { exit 1 }

Enable-BillingTestJava | Out-Null
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
$firebase = Get-BillingTestFirebaseCli

Write-Host "Starting isolated Firebase emulators for $script:BillingTestProjectId. No live Firebase project will be contacted." -ForegroundColor Cyan
& $firebase emulators:start --project $script:BillingTestProjectId --only auth,firestore,functions,storage
exit $LASTEXITCODE
