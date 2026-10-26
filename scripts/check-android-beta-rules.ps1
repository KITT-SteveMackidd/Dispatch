. (Join-Path $PSScriptRoot 'billing-test-common.ps1')
Enable-BillingTestJava | Out-Null
$firebase = Get-BillingTestFirebaseCli
Push-Location $script:BillingTestRepoRoot
try {
  # Dedicated ports: never reset or stop the existing Expo Go billing harness.
  & $firebase emulators:exec --config firebase.android-beta-tests.json --project demo-dispatch-android-rules --only firestore,storage 'node --test tests/android-beta-rules.node.mjs'
  $verificationExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $verificationExitCode
