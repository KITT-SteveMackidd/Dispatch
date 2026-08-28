. (Join-Path $PSScriptRoot 'billing-test-common.ps1')

& (Join-Path $PSScriptRoot 'check-billing-test-config.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npx) { throw 'npx.cmd was not found.' }

Write-Host 'Starting Dispatch in Expo Go with RevenueCat Test Store and demo-project Firebase emulators.' -ForegroundColor Cyan
& $npx.Source expo start --go --lan --clear --port 8083
exit $LASTEXITCODE
