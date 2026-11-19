# Regression test for the installer download path.
#
# The download functions are extracted from install-zoveli-runtime.ps1, so this
# test runs the real code without installing the runtime. It covers:
#   - downloads stream to an open file instead of buffering the whole body
#   - the staging directory is app-owned, not under %TEMP%
#   - a missing staging directory triggers exactly one retry
#   - HTTP failures are never retried
#
# Usage (Windows PowerShell 5.1 or PowerShell 7):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/installer-download-test.ps1

param(
  [string]$Installer = (Join-Path $PSScriptRoot '..\install\install-zoveli-runtime.ps1'),
  [string]$RetryUrl = 'https://github.com/blessandy9104-hue/zoveli-ai/releases/download/v0.1.5/zoveli-0.1.5-windows-x64.tar.gz.sha256',
  [string]$MissingUrl = 'https://github.com/blessandy9104-hue/zoveli-ai/releases/download/v0.0.0-missing/zoveli-0.0.0-windows-x64.tar.gz'
)

$ErrorActionPreference = 'Stop'
$script:Failures = 0

function Pass([string]$Message) {
  Write-Host "[pass] $Message"
}

function Fail([string]$Message) {
  Write-Host "[fail] $Message" -ForegroundColor Red
  $script:Failures++
}

$Installer = (Resolve-Path -LiteralPath $Installer).Path
$source = Get-Content -LiteralPath $Installer -Raw

# Source invariants: staging must stay out of %TEMP%, and the retry budget must
# stay at exactly one extra attempt.
if ($source -match '\[System\.IO\.Path\]::GetTempPath\(\)') {
  Fail 'installer still stages downloads under %TEMP%'
} else {
  Pass 'installer does not use GetTempPath'
}
if ($source -notmatch 'Join-Path \$StateDir ''staging''') {
  Fail 'installer does not stage downloads under the state directory'
} else {
  Pass 'installer stages downloads under the state directory'
}
if ($source -notmatch '\$maxAttempts = 2') {
  Fail 'installer retry budget is not a single bounded retry'
} else {
  Pass 'installer retry budget is one extra attempt'
}

$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$null, [ref]$parseErrors)
if ($parseErrors -and $parseErrors.Count -gt 0) {
  Fail "installer has parse errors: $($parseErrors[0].Message)"
} else {
  Pass 'installer parses cleanly'
}

$wanted = @(
  'Write-InstallLog',
  'Assert-SafeDownloadUrl',
  'Test-InteractiveConsole',
  'Format-Megabytes',
  'New-DownloadProgress',
  'Write-DownloadProgress',
  'Clear-DownloadProgress',
  'Get-InnermostException',
  'Test-RetryableDownloadFailure',
  'Invoke-SafeDownloadAttempt',
  'Invoke-SafeDownload'
)
$definitions = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $wanted -contains $node.Name
  }, $true)
foreach ($name in $wanted) {
  if (-not ($definitions | Where-Object { $_.Name -eq $name })) {
    Fail "installer is missing function $name"
  }
}
if ($script:Failures -gt 0) { exit 1 }

$attempt = ($definitions | Where-Object { $_.Name -eq 'Invoke-SafeDownloadAttempt' }).Extent.Text
if ($attempt -notmatch 'ResponseHeadersRead') {
  Fail 'download attempt does not use ResponseHeadersRead'
} else {
  Pass 'download attempt uses ResponseHeadersRead'
}
$createAt = $attempt.IndexOf('[System.IO.File]::Create')
$readAt = $attempt.IndexOf('$stream.Read(')
if ($createAt -lt 0 -or $readAt -lt 0 -or $createAt -gt $readAt) {
  Fail 'download attempt does not create the destination file before reading the body'
} else {
  Pass 'destination file is created before the body is read'
}
if (-not $attempt.Contains('Write-DownloadProgress')) {
  Fail 'download attempt has no progress reporting'
} else {
  Pass 'download attempt reports progress through the shared helper'
}

foreach ($definition in $definitions) {
  . ([scriptblock]::Create($definition.Extent.Text))
}

if (Test-InteractiveConsole) {
  Fail 'progress is enabled while stderr is redirected'
} else {
  Pass 'progress stays off while stderr is redirected'
}

function New-TestLog([string]$Root, [string]$Name) {
  $path = Join-Path $Root $Name
  Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  return $path
}

function Read-TestLog([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  return (Get-Content -LiteralPath $Path -Raw)
}

$root = Join-Path ([System.IO.Path]::GetTempPath()) ('zoveli-download-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
try {
  # 1. A missing staging directory is recreated on the single retry.
  $script:InstallLogPath = New-TestLog $root 'retry.log'
  $retryDir = Join-Path $root ('retry-' + [guid]::NewGuid().ToString('N'))
  $retryOut = Join-Path $retryDir 'asset.sha256'
  if (Test-Path -LiteralPath $retryDir) { Fail 'retry test directory already exists' }
  try {
    Invoke-SafeDownload $RetryUrl $retryOut
    $retryLog = Read-TestLog $script:InstallLogPath
    if (-not (Test-Path -LiteralPath $retryOut)) {
      Fail 'retry test did not produce the downloaded file'
    } elseif ((Get-Item -LiteralPath $retryOut).Length -lt 60) {
      Fail 'retry test produced a truncated file'
    } elseif ($retryLog -notmatch 'download\.file-create-failed .*dirExists=False') {
      Fail 'retry test did not fail the first file create on a missing directory'
    } elseif ($retryLog -notmatch 'download\.attempt-failed attempt=1 maxAttempts=2 retryable=True') {
      Fail 'retry test did not classify the missing directory as retryable'
    } elseif ($retryLog -notmatch 'download\.retry attempt=2 .*exists=True') {
      Fail 'retry test did not recreate the staging directory'
    } elseif ([regex]::Matches($retryLog, 'download\.retry ').Count -ne 1) {
      Fail 'retry test used more than one retry'
    } else {
      Pass 'missing staging directory is recreated once and the download succeeds'
    }
  } catch {
    Fail "retry test threw: $($_.Exception.Message)"
  }

  # 2. HTTP failures are not retried.
  $script:InstallLogPath = New-TestLog $root 'http.log'
  $httpDir = Join-Path $root 'http'
  New-Item -ItemType Directory -Path $httpDir -Force | Out-Null
  $httpOut = Join-Path $httpDir 'missing.tar.gz'
  $threw = $false
  try {
    Invoke-SafeDownload $MissingUrl $httpOut
  } catch {
    $threw = $true
  }
  $httpLog = Read-TestLog $script:InstallLogPath
  if (-not $threw) {
    Fail 'HTTP failure test did not throw'
  } elseif ($httpLog -notmatch 'retryable=False') {
    Fail 'HTTP failure was classified as retryable'
  } elseif ($httpLog -match 'download\.retry ') {
    Fail 'HTTP failure was retried'
  } elseif (Test-Path -LiteralPath $httpOut) {
    Fail 'HTTP failure left a partial destination file'
  } else {
    Pass 'HTTP failures fail once without a retry'
  }

  # 3. Retry classification is driven by the innermost exception.
  try {
    throw [System.IO.DirectoryNotFoundException]::new('gone')
  } catch {
    if (-not (Test-RetryableDownloadFailure $_)) {
      Fail 'DirectoryNotFoundException was not classified as retryable'
    } else {
      Pass 'DirectoryNotFoundException is retryable'
    }
  }
  try {
    throw 'Download failed with HTTP 404'
  } catch {
    if (Test-RetryableDownloadFailure $_) {
      Fail 'a plain HTTP error was classified as retryable'
    } else {
      Pass 'plain HTTP errors are not retryable'
    }
  }
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

if ($script:Failures -gt 0) {
  Write-Host "$($script:Failures) check(s) failed."
  exit 1
}
Write-Host 'All installer download checks passed.'
exit 0
