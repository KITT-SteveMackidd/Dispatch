[CmdletBinding(SupportsShouldProcess = $true)]
param()

. (Join-Path $PSScriptRoot 'billing-test-common.ps1')

$logPath = Join-Path $script:BillingTestRepoRoot '.expo\billing-firestore-firewall.log'
New-Item -ItemType Directory -Path (Split-Path -Parent $logPath) -Force | Out-Null
Start-Transcript -Path $logPath -Append | Out-Null
$resultCode = 0

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from PowerShell opened with Run as administrator.'
  }

  $app = Read-BillingTestEnvFile -Path (Get-BillingTestFiles).App
  if ($app['EXPO_PUBLIC_USE_FIREBASE_EMULATORS'] -ne 'true' -or $app['EXPO_PUBLIC_FIREBASE_PROJECT_ID'] -ne $script:BillingTestProjectId) {
    throw 'This firewall helper requires the isolated demo-dispatch-billing emulator configuration.'
  }

  $hostAddress = $app['EXPO_PUBLIC_FIREBASE_EMULATOR_HOST']
  $address = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $hostAddress -ErrorAction Stop
  $profile = Get-NetConnectionProfile -InterfaceIndex $address.InterfaceIndex
  if ($profile.NetworkCategory -ne 'Private') {
    throw 'The emulator LAN interface must already use the Private network profile.'
  }

  $javaPath = Enable-BillingTestJava
  $bytes = [Net.IPAddress]::Parse($hostAddress).GetAddressBytes()
  for ($index = 0; $index -lt 4; $index++) {
    $bits = [Math]::Min(8, [Math]::Max(0, $address.PrefixLength - 8 * $index))
    $mask = [byte](256 - [Math]::Pow(2, 8 - $bits))
    $bytes[$index] = $bytes[$index] -band $mask
  }
  $subnet = ($bytes -join '.') + '/' + $address.PrefixLength

  $blockingFilters = @(
    Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True |
      Where-Object { $_.Profile.ToString() -eq 'Private' } |
      ForEach-Object {
        $rule = $_
        $application = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule
        $port = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule
        if ($application.Program -ieq $javaPath -and $port.Protocol -in @('TCP', '6')) {
          if (($port.LocalPort -join ',') -eq 'Any') {
            $port
          } elseif (($port.LocalPort -join ',') -ne '1-8079,8081-65535') {
            throw 'An unexpected Java TCP block rule exists. Review it manually before opening Firestore.'
          }
        }
      }
  )

  Write-Host "Allow Java TCP 8080 at $hostAddress from $subnet on the Private profile."
  Write-Host 'Existing Java TCP blocks will continue covering every other port. UDP rules are unchanged.'
  if ($PSCmdlet.ShouldProcess("$javaPath / $hostAddress`:8080 / $subnet / Private", 'Allow the local Firestore emulator')) {
    # An explicit block overrides an allow rule. Exempt only Firestore's port.
    foreach ($filter in $blockingFilters) {
      Set-NetFirewallPortFilter -InputObject $filter -LocalPort @('1-8079', '8081-65535')
    }
    try {
      $ruleName = 'Dispatch-Billing-Firestore-LAN'
      $existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
      if ($existing) {
        Set-NetFirewallRule -Name $ruleName -Enabled True -Direction Inbound -Action Allow -Profile Private -Program $javaPath -Protocol TCP -LocalPort 8080 -LocalAddress $hostAddress -RemoteAddress $subnet
      } else {
        New-NetFirewallRule -Name $ruleName -DisplayName 'Dispatch billing: Firestore on private LAN' -Direction Inbound -Action Allow -Profile Private -Program $javaPath -Protocol TCP -LocalPort 8080 -LocalAddress $hostAddress -RemoteAddress $subnet | Out-Null
      }
    } catch {
      foreach ($filter in $blockingFilters) {
        Set-NetFirewallPortFilter -InputObject $filter -LocalPort Any
      }
      throw
    }
    Write-Host 'Firestore LAN firewall configuration applied.' -ForegroundColor Green
  }
} catch {
  Write-Error $_ -ErrorAction Continue
  $resultCode = 1
} finally {
  Stop-Transcript | Out-Null
}

exit $resultCode
