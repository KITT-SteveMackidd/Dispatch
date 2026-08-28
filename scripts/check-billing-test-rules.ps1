. (Join-Path $PSScriptRoot 'billing-test-common.ps1')

Enable-BillingTestJava | Out-Null
$firebase = Get-BillingTestFirebaseCli

$verificationCommand = 'node -e "console.log(''billing-rules-emulators-ready'')"'
& $firebase emulators:exec --project $script:BillingTestProjectId --only firestore,storage $verificationCommand
exit $LASTEXITCODE
