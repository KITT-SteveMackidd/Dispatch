param([string]$EmulatorHost, [switch]$Watch)

. (Join-Path $PSScriptRoot 'billing-test-common.ps1')

$baseline = Read-BillingTestEnvFile -Path (Join-Path $script:BillingTestRepoRoot '.env.local')
if ($baseline['EXPO_PUBLIC_FIREBASE_PROJECT_ID'] -ne $script:BillingTestProjectId -or $baseline['EXPO_PUBLIC_USE_FIREBASE_EMULATORS'] -ne 'true') {
  throw 'The local baseline must use demo-dispatch-billing with Firebase emulators enabled. No environment files were changed.'
}
if (-not $EmulatorHost) { $EmulatorHost = $baseline['EXPO_PUBLIC_FIREBASE_EMULATOR_HOST'] }
$address = $null
if ($EmulatorHost -ne 'localhost') {
  if (-not [System.Net.IPAddress]::TryParse($EmulatorHost, [ref]$address) -or $address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'EmulatorHost must be localhost or a private IPv4 address reachable from the test phone.'
  }
  $octets = $address.GetAddressBytes()
  if (-not ($octets[0] -eq 127 -or $octets[0] -eq 10 -or ($octets[0] -eq 192 -and $octets[1] -eq 168) -or ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31))) {
    throw 'A public emulator address is not permitted.'
  }
}

$hub = Invoke-RestMethod -Uri 'http://127.0.0.1:4400/emulators' -TimeoutSec 5
foreach ($service in @(@{Name='auth';Port=9099}, @{Name='firestore';Port=8080}, @{Name='functions';Port=5001}, @{Name='storage';Port=9199})) {
  $entry = $hub.PSObject.Properties[$service.Name]
  if (-not $entry -or $entry.Value.host -ne '127.0.0.1' -or $entry.Value.port -ne $service.Port) {
    throw "Expected existing local $($service.Name) emulator on port $($service.Port). This script never restarts or clears emulators."
  }
}
$probe = [System.Net.Sockets.TcpClient]::new()
try {
  $connection = $probe.ConnectAsync('127.0.0.1', 8086)
  try { $connection.Wait(500) | Out-Null } catch { }
  if ($probe.Connected) { throw 'Port 8086 is already in use. Verify that server before starting another preview.' }
} finally { $probe.Dispose() }

$previewEnvironment = @{
  # Expo's CI mode disables Metro's file watcher. Use a stable phone-review
  # session by default on this OneDrive checkout; -Watch opts into hot reload.
  CI = $(if ($Watch) { '' } else { '1' })
  DISPATCH_LOCAL_CHAT_SAFETY_PREVIEW = 'true'
  EXPO_NO_DOTENV = '1'
  EAS_BUILD_PROFILE = ''
  EXPO_PUBLIC_EAS_BUILD_PROFILE = ''
  EXPO_PUBLIC_FIREBASE_API_KEY = 'demo-api-key'
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN = 'demo-dispatch-billing.firebaseapp.com'
  EXPO_PUBLIC_FIREBASE_PROJECT_ID = 'demo-dispatch-billing'
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET = 'demo-dispatch-billing.firebasestorage.app'
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '000000000000'
  EXPO_PUBLIC_FIREBASE_APP_ID = '1:000000000000:web:dispatchchatsafetylocal'
  EXPO_PUBLIC_USE_FIREBASE_EMULATORS = 'true'
  EXPO_PUBLIC_FIREBASE_EMULATOR_HOST = $EmulatorHost
}
# Retain only an already configured public Test Store key. Native/live payment keys are excluded.
if ($baseline['EXPO_PUBLIC_REVENUECAT_TEST_API_KEY'] -match '^test_') {
  $previewEnvironment['EXPO_PUBLIC_REVENUECAT_TEST_API_KEY'] = $baseline['EXPO_PUBLIC_REVENUECAT_TEST_API_KEY']
}
$keys = @(@(Get-ChildItem Env: | Where-Object Name -like 'EXPO_PUBLIC_*' | ForEach-Object Name) + @($previewEnvironment.Keys) | Select-Object -Unique)
$previous = @{}
try {
  foreach ($key in $keys) {
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $previewEnvironment[$key], 'Process')
  }
  & node (Join-Path $PSScriptRoot 'check-expo-go-compatibility.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Expo Go compatibility check failed.' }
  Write-Host "Starting local chat safety preview on port 8086 with $script:BillingTestProjectId at $EmulatorHost. No payments are exercised." -ForegroundColor Cyan
  if (-not $Watch) { Write-Host 'Stable phone preview: file watching is disabled. Restart this launcher after code changes.' -ForegroundColor Cyan }
  & (Join-Path $script:BillingTestRepoRoot 'node_modules\.bin\expo.cmd') start --go --lan --clear --port 8086
  if ($LASTEXITCODE -ne 0) { throw 'Chat safety Expo preview exited with an error.' }
} finally {
  foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
