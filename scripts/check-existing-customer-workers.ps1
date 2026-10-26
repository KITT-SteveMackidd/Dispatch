. (Join-Path $PSScriptRoot 'billing-test-common.ps1')
Enable-BillingTestJava | Out-Null
$firebase = Get-BillingTestFirebaseCli
Push-Location $script:BillingTestRepoRoot
try {
  # Isolated demo namespace and dedicated ports; this command never deploys.
  & $firebase emulators:exec --config firebase.existing-customer-tests.json --project demo-dispatch-existing-workers --only firestore 'node --test tests/existing-backend-worker.node.mjs'
  $verificationExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $verificationExitCode
