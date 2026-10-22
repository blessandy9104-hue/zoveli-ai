<#
.SYNOPSIS
  Install a prebuilt Zoveli runtime on Windows.

.DESCRIPTION
  Downloads the matching GitHub release archive, verifies its SHA-256
  checksum, and extracts it. Upgrades first create and verify a backup of the
  existing vault under ~/.zoveli/backups. No Git, Node, pnpm, Python, or
  compiler toolchain is required on the target machine.

.EXAMPLE
  irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli-runtime.ps1 | iex

.EXAMPLE
  .\install-zoveli-runtime.ps1 -Yes -Archive .\zoveli-0.1.0-windows-x64.tar.gz -Dir "$env:LOCALAPPDATA\Zoveli"
#>
[CmdletBinding()]
param(
  [Alias('y')][switch]$Yes,
  [string]$Dir = (Join-Path $(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $HOME }) 'Zoveli'),
  [string]$Version = $env:ZOVELI_VERSION,
  [string]$Archive = '',
  [string]$Url = $env:ZOVELI_RUNTIME_URL,
  [switch]$NoVerify,
  [switch]$Force,
  [switch]$SkipBackup
)

if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $env:PSModulePath = @(
    (Join-Path $PSHOME 'Modules'),
    (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
  ) -join ';'
}

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Repo = 'blessandy9104-hue/zoveli-ai'
$Branch = $(if ($env:ZOVELI_BRANCH) { $env:ZOVELI_BRANCH } else { 'main' })

function Info($m) { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Fail($m) { Write-Host $m -ForegroundColor Red; exit 1 }

function Get-Sha256Hex($path) {
  $stream = [System.IO.File]::OpenRead($path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Get-RuntimeVersion($launcher) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $launcher --version 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  return @{
    Code = $code
    Text = "$($output | Select-Object -Last 1)".Trim()
  }
}

function Test-SafeTarget($path) {
  $full = [System.IO.Path]::GetFullPath($path).TrimEnd('\')
  $protected = @(
    [System.IO.Path]::GetPathRoot($full).TrimEnd('\'),
    [System.IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\'),
    [System.IO.Path]::GetFullPath($(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $HOME })).TrimEnd('\')
  )
  return ($protected -notcontains $full)
}

function Backup-ExistingRuntime($dir) {
  if (-not (Test-Path -LiteralPath (Join-Path $dir 'runtime.json'))) { return }
  if ($SkipBackup) {
    Warn 'Skipping the pre-upgrade backup (-SkipBackup).'
    return
  }
  $launcher = Join-Path $dir 'zoveli.cmd'
  if (-not (Test-Path -LiteralPath $launcher)) {
    Fail "Existing runtime has no zoveli.cmd; create a manual backup or pass -SkipBackup: $dir"
  }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
  $homeDir = $(if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME })
  $backupDir = Join-Path (Join-Path $homeDir '.zoveli\backups') "pre-upgrade-$stamp-$suffix"
  Info "Backing up existing data to $backupDir ..."
  $backupOutput = & $launcher backup --out $backupDir --json 2>&1
  if ($LASTEXITCODE -ne 0) {
    Fail "Pre-upgrade backup failed; the existing runtime was not changed.`n$($backupOutput -join "`n")"
  }
  $verifyOutput = & $launcher verify $backupDir --json 2>&1
  if ($LASTEXITCODE -ne 0) {
    Fail "Pre-upgrade backup failed verification; the existing runtime was not changed.`n$($verifyOutput -join "`n")"
  }
  Info "Backup verified: $backupDir"
}

if (-not $Yes) {
  $answer = Read-Host "Install Zoveli into $Dir? [y/N]"
  if ($answer -notmatch '^(y|yes)$') { Fail 'Aborted.' }
}

if (-not (Test-SafeTarget $Dir)) { Fail "Refusing to install into protected directory: $Dir" }

if (-not $Archive) {
  if (-not $Version) {
    Info 'Resolving the current Zoveli version...'
    $manifest = Invoke-RestMethod -Uri "https://raw.githubusercontent.com/$Repo/$Branch/package.json"
    $Version = $manifest.version
  }
  if (-not $Version) { Fail 'Could not resolve Zoveli version.' }
  if (-not $Url) {
    $arch = $(if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { 'x64' })
    $Url = "https://github.com/$Repo/releases/download/v$Version/zoveli-$Version-windows-$arch.tar.gz"
  }
}

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("zoveli-install-" + [guid]::NewGuid().ToString('N'))
$stageRoot = $null
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  if ($Archive) {
    if (-not (Test-Path -LiteralPath $Archive)) { Fail "Archive not found: $Archive" }
    $archivePath = (Resolve-Path -LiteralPath $Archive).Path
  } else {
    $archivePath = Join-Path $temp 'zoveli.tar.gz'
    Info "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $archivePath
    Invoke-WebRequest -Uri "$Url.sha256" -OutFile "$archivePath.sha256"
  }

  if (-not $NoVerify) {
    if (-not (Test-Path -LiteralPath "$archivePath.sha256")) {
      Fail "Checksum file not found: $archivePath.sha256. Use -NoVerify only for a trusted archive."
    }
    $expected = ((Get-Content -LiteralPath "$archivePath.sha256" -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = Get-Sha256Hex $archivePath
    if ($expected -ne $actual) { Fail "SHA-256 verification failed for $archivePath" }
    Info 'Checksum verified.'
  }

  $stage = Join-Path $temp 'extract'
  New-Item -ItemType Directory -Path $stage | Out-Null
  & tar.exe -xzf $archivePath -C $stage
  if ($LASTEXITCODE -ne 0) { Fail 'Could not extract the runtime archive (tar.exe failed).' }

  $src = Get-ChildItem -LiteralPath $stage -Directory | Select-Object -First 1
  if (-not $src -or -not (Test-Path -LiteralPath (Join-Path $src.FullName 'runtime.json')) -or
      -not (Test-Path -LiteralPath (Join-Path $src.FullName 'zoveli.cmd'))) {
    Fail 'Archive does not contain a valid Zoveli runtime.'
  }

  if ((Test-Path -LiteralPath $Dir) -and (Get-ChildItem -LiteralPath $Dir -Force | Select-Object -First 1)) {
    if (-not (Test-Path -LiteralPath (Join-Path $Dir 'runtime.json')) -and -not $Force) {
      Fail "$Dir is not a Zoveli runtime; use -Dir or -Force."
    }
  }

  $stageParent = Split-Path -Parent $Dir
  if (-not $stageParent) { $stageParent = '.' }
  New-Item -ItemType Directory -Path $stageParent -Force | Out-Null
  $stageRoot = Join-Path $stageParent ('.zoveli-stage-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $src.FullName '*') -Destination $stageRoot -Recurse -Force

  $preflight = Get-RuntimeVersion (Join-Path $stageRoot 'zoveli.cmd')
  if ($preflight.Code -ne 0 -or -not $preflight.Text.StartsWith('zoveli ')) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
    Fail "New runtime failed its preflight check; the existing runtime was not changed.`n$($preflight.Text)"
  }
  Info "New runtime preflight: $($preflight.Text)"

  Backup-ExistingRuntime $Dir

  $previous = Join-Path $stageParent ('.zoveli-previous-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $oldMoved = $false
  $newMoved = $false
  $installed = ''
  try {
    if ((Test-Path -LiteralPath $Dir) -and (Get-ChildItem -LiteralPath $Dir -Force | Select-Object -First 1)) {
      Move-Item -LiteralPath $Dir -Destination $previous
      $oldMoved = $true
    } elseif (Test-Path -LiteralPath $Dir) {
      Remove-Item -LiteralPath $Dir -Force
    }
    Move-Item -LiteralPath $stageRoot -Destination $Dir
    $newMoved = $true
    $installedCheck = Get-RuntimeVersion (Join-Path $Dir 'zoveli.cmd')
    $installed = $installedCheck.Text
    if ($installedCheck.Code -ne 0 -or -not $installedCheck.Text.StartsWith('zoveli ')) {
      throw "Installed runtime failed its version check: $($installedCheck.Text)"
    }
  } catch {
    $reason = $_.Exception.Message
    if ($newMoved -and (Test-Path -LiteralPath $Dir)) {
      Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
    }
    $restored = $false
    if ($oldMoved -and (Test-Path -LiteralPath $previous)) {
      Move-Item -LiteralPath $previous -Destination $Dir -ErrorAction SilentlyContinue
      $restored = Test-Path -LiteralPath $Dir
    }
    if ($oldMoved -and -not $restored) {
      Fail "Upgrade failed and automatic rollback did not finish. Previous runtime: $previous`n$reason"
    }
    if ($oldMoved) {
      Fail "Upgrade failed; the previous runtime was restored.`n$reason"
    }
    Fail "Upgrade failed; no runtime was left installed.`n$reason"
  }
  if ($oldMoved -and (Test-Path -LiteralPath $previous)) {
    Remove-Item -LiteralPath $previous -Recurse -Force -ErrorAction SilentlyContinue
  }
  Info "Installed $installed into $Dir"
  Write-Host ''
  Write-Host "Run:"
  Write-Host "  $(Join-Path $Dir 'zoveli.cmd')"
} finally {
  if ($stageRoot -and (Test-Path -LiteralPath $stageRoot)) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
