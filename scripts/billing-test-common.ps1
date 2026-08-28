Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:BillingTestRepoRoot = Split-Path -Parent $PSScriptRoot
$script:BillingTestProjectId = 'demo-dispatch-billing'

function Read-BillingTestEnvFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $values }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $separator = $trimmed.IndexOf('=')
    if ($separator -lt 1) { continue }
    $key = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }
  return $values
}

function Get-BillingTestFiles {
  return @{
    App = Join-Path $script:BillingTestRepoRoot '.env.local'
    Functions = Join-Path $script:BillingTestRepoRoot 'functions\.env.local'
    Secrets = Join-Path $script:BillingTestRepoRoot 'functions\.secret.local'
  }
}

function Test-BillingTestPlaceholder {
  param([AllowNull()][string]$Value)
  return -not $Value -or $Value -match '(?i)replace|not_configured|example|your_'
}

function Enable-BillingTestJava {
  $candidateHomes = @(
    $env:JAVA_HOME,
    'C:\Program Files\Android\Android Studio\jbr'
  ) | Where-Object { $_ }

  foreach ($candidate in $candidateHomes) {
    $java = Join-Path $candidate 'bin\java.exe'
    if (Test-Path -LiteralPath $java) {
      $env:JAVA_HOME = $candidate
      if (-not (($env:Path -split ';') -contains (Join-Path $candidate 'bin'))) {
        $env:Path = "$(Join-Path $candidate 'bin');$env:Path"
      }
      return $java
    }
  }
  throw 'Java was not found. Install Java 21 or Android Studio with its bundled JBR before starting Firebase emulators.'
}

function Get-BillingTestFirebaseCli {
  $localFirebase = Join-Path $script:BillingTestRepoRoot 'functions\node_modules\.bin\firebase.cmd'
  if (Test-Path -LiteralPath $localFirebase) { return $localFirebase }
  $globalFirebase = Get-Command firebase.cmd -ErrorAction SilentlyContinue
  if ($globalFirebase) { return $globalFirebase.Source }
  throw 'Firebase CLI was not found. Run npm install in functions before starting the local harness.'
}
