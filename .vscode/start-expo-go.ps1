param(
  [ValidateSet("tunnel", "lan")]
  [string]$Mode = "tunnel"
)

$ErrorActionPreference = "Continue"
$env:EXPO_NO_TELEMETRY = "1"

$noAndroidSdk = Join-Path $PSScriptRoot "no-android-sdk"
$env:ANDROID_HOME = $noAndroidSdk
$env:ANDROID_SDK_ROOT = $noAndroidSdk

function Get-ExpoLanIp {
  $preferred = @("Wi-Fi", "Wifi", "Ethernet")

  foreach ($alias in $preferred) {
    $candidate = Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias $alias -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254*" -and $_.IPAddress -notlike "100.*" } |
      Select-Object -First 1

    if ($candidate) {
      return $candidate.IPAddress
    }
  }

  $fallback = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254*" -and
      $_.IPAddress -notlike "100.*" -and
      $_.InterfaceAlias -notmatch "Tailscale|VPN|Loopback|vEthernet|Virtual|Docker|WSL"
    } |
    Select-Object -First 1

  if ($fallback) {
    return $fallback.IPAddress
  }

  return $null
}

function Stop-ExpoNgrok {
  Get-Process -Name "ngrok" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

function Stop-AndroidBridge {
  Get-Process -Name "adb" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

function Invoke-ExpoStart {
  param(
    [ValidateSet("tunnel", "lan")]
    [string]$StartMode
  )

  $expoArgs = @("expo", "start", "--clear", "--go")
  if ($StartMode -eq "tunnel") {
    Remove-Item Env:REACT_NATIVE_PACKAGER_HOSTNAME -ErrorAction SilentlyContinue
    $expoArgs += "--tunnel"
  } else {
    $lanIp = Get-ExpoLanIp
    if ($lanIp) {
      $env:REACT_NATIVE_PACKAGER_HOSTNAME = $lanIp
      Write-Host "Using Expo LAN host IP $lanIp"
    } else {
      Remove-Item Env:REACT_NATIVE_PACKAGER_HOSTNAME -ErrorAction SilentlyContinue
      Write-Host "Expo LAN host IP could not be detected. Expo will choose an interface."
    }

    $expoArgs += "--lan"
  }

  & npx @expoArgs
  return $(if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE })
}

$maxAttempts = if ($Mode -eq "tunnel") { 4 } else { 1 }
$exitCode = 0

for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  if ($Mode -eq "tunnel") {
    Stop-ExpoNgrok
    Stop-AndroidBridge
  }

  if ($attempt -gt 1) {
    $delaySeconds = @(3, 8, 15)[$attempt - 2]
    Write-Host "Retrying Expo tunnel in $delaySeconds seconds... ($attempt of $maxAttempts)"
    Start-Sleep -Seconds $delaySeconds
  }

  $exitCode = Invoke-ExpoStart -StartMode $Mode

  if ($exitCode -eq 0) {
    exit 0
  }
}

exit $exitCode
