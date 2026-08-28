. (Join-Path $PSScriptRoot 'billing-test-common.ps1')

$files = Get-BillingTestFiles
$app = Read-BillingTestEnvFile -Path $files.App
$functions = Read-BillingTestEnvFile -Path $files.Functions
$secrets = Read-BillingTestEnvFile -Path $files.Secrets
$errors = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

foreach ($entry in @(
  @{ Path = $files.App; Label = '.env.local' },
  @{ Path = $files.Functions; Label = 'functions/.env.local' },
  @{ Path = $files.Secrets; Label = 'functions/.secret.local' }
)) {
  if (-not (Test-Path -LiteralPath $entry.Path)) { $errors.Add("Missing $($entry.Label). Copy its matching config/billing-test example first.") }
}

if ($app['EXPO_PUBLIC_USE_FIREBASE_EMULATORS'] -ne 'true') { $errors.Add('EXPO_PUBLIC_USE_FIREBASE_EMULATORS must be true.') }
if ($app['EXPO_PUBLIC_FIREBASE_PROJECT_ID'] -ne $script:BillingTestProjectId) { $errors.Add("EXPO_PUBLIC_FIREBASE_PROJECT_ID must be $script:BillingTestProjectId.") }
$emulatorHost = $app['EXPO_PUBLIC_FIREBASE_EMULATOR_HOST']
if (-not $emulatorHost -or $emulatorHost -notmatch '^[A-Za-z0-9.-]+$') { $errors.Add('EXPO_PUBLIC_FIREBASE_EMULATOR_HOST must be a hostname or IP address without a scheme or port.') }
$runId = $app['BILLING_TEST_RUN_ID']
if ((Test-BillingTestPlaceholder $runId) -or $runId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$') { $errors.Add('BILLING_TEST_RUN_ID must be a fresh 3-32 character test-run identifier.') }
$testKey = $app['EXPO_PUBLIC_REVENUECAT_TEST_API_KEY']
if ((Test-BillingTestPlaceholder $testKey) -or $testKey -notmatch '^test_') { $errors.Add('Add the RevenueCat Test Store public key (test_...) to .env.local.') }
if ($functions['REVENUECAT_EXPECTED_ENVIRONMENT'] -ne 'sandbox') { $errors.Add('REVENUECAT_EXPECTED_ENVIRONMENT must be sandbox.') }
if (Test-BillingTestPlaceholder $functions['REVENUECAT_PROJECT_ID']) { $errors.Add('Add the RevenueCat project ID to functions/.env.local.') }
$secretApiKey = $secrets['REVENUECAT_SECRET_API_KEY']
if ((Test-BillingTestPlaceholder $secretApiKey) -or $secretApiKey -notmatch '^sk_') { $errors.Add('Add a server-only RevenueCat secret API key (sk_...) to functions/.secret.local.') }

foreach ($optionalSecret in 'REVENUECAT_V2_SECRET_API_KEY','REVENUECAT_WEBHOOK_AUTHORIZATION','REVENUECAT_WEBHOOK_SIGNING_SECRET','REVENUECAT_ALLOWED_APP_IDS') {
  if (Test-BillingTestPlaceholder $secrets[$optionalSecret]) { $warnings.Add("$optionalSecret is not configured; its account-deletion or webhook scenario remains blocked.") }
}

try {
  $java = Enable-BillingTestJava
  Write-Host "Java: ready ($java)"
} catch {
  $errors.Add($_.Exception.Message)
}

Write-Host "Firebase project: $($app['EXPO_PUBLIC_FIREBASE_PROJECT_ID'])"
Write-Host "Emulator host: $emulatorHost"
Write-Host "Billing test run ID: $runId"
Write-Host "RevenueCat Test Store public key: $([bool]($testKey -match '^test_' -and -not (Test-BillingTestPlaceholder $testKey)))"
Write-Host "RevenueCat server verification key: $([bool]($secretApiKey -match '^sk_' -and -not (Test-BillingTestPlaceholder $secretApiKey)))"
foreach ($warning in $warnings) { Write-Warning $warning }

if ($errors.Count -gt 0) {
  foreach ($issue in $errors) { Write-Error $issue -ErrorAction Continue }
  exit 1
}

Write-Host 'Core local billing test configuration is ready.' -ForegroundColor Green
