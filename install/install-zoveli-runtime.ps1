<#
.SYNOPSIS
  Install a prebuilt Zoveli runtime on Windows.

.DESCRIPTION
  Downloads the matching GitHub release archive, verifies its SHA-256
  checksum, and extracts it. No Git, Node, pnpm, Python, or compiler
  toolchain is required on the target machine.

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
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Repo = 'blessandy9104-hue/zoveli-ai'
$Branch = $(if ($env:ZOVELI_BRANCH) { $env:ZOVELI_BRANCH } else { 'main' })

function Info($m) { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Fail($m) { Write-Host $m -ForegroundColor Red; exit 1 }

function Test-SafeTarget($path) {
  $full = [System.IO.Path]::GetFullPath($path).TrimEnd('\')
  $protected = @(
    [System.IO.Path]::GetPathRoot($full).TrimEnd('\'),
    [System.IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\'),
    [System.IO.Path]::GetFullPath($(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $HOME })).TrimEnd('\')
  )
  return ($protected -notcontains $full)
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
    $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
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

  New-Item -ItemType Directory -Path $Dir -Force | Out-Null
  Get-ChildItem -LiteralPath $Dir -Force | Remove-Item -Recurse -Force
  Copy-Item -Path (Join-Path $src.FullName '*') -Destination $Dir -Recurse -Force

  $installed = (& (Join-Path $Dir 'zoveli.cmd') --version | Select-Object -Last 1).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $installed.StartsWith('zoveli ')) {
    Fail "Installed runtime failed its version check: $installed"
  }
  Info "Installed $installed into $Dir"
  Write-Host ''
  Write-Host "Run:"
  Write-Host "  $(Join-Path $Dir 'zoveli.cmd')"
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
