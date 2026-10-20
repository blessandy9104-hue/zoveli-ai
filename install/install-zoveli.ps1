<#
.SYNOPSIS
  Zoveli AI - opencode-style one-line installer (PowerShell / Windows).
.DESCRIPTION
  Companion to install/install-zoveli.sh. Idempotent via marker file
  `.zoveli-install-done`. Clones (or reuses) the repo, creates a Python venv,
  pip-installs vendored ./mathcore, ensures Node 22 + pnpm 11.7.0,
  runs pnpm install + build, then prints run instructions.
  No telemetry. Only clones from the official repo URL.
  NOTE: ASCII-only on purpose - Windows PowerShell 5.1 reads .ps1 files
  as ANSI without a BOM, so non-ASCII chars can break parsing.
.EXAMPLE
  irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli.ps1 | iex
.EXAMPLE
  .\install-zoveli.ps1 -Yes -Dir "$env:USERPROFILE\zoveli-ai" -Branch main
#>
[CmdletBinding()]
param(
  [Alias('y')][switch]$Yes,
  [string]$Dir = (Join-Path $env:USERPROFILE 'zoveli-ai'),
  [string]$Branch = $(if ($env:ZOVELI_BRANCH) { $env:ZOVELI_BRANCH } else { 'main' })
)

$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/blessandy9104-hue/zoveli-ai.git'
$PnpmVersion = '11.7.0'
$Marker = '.zoveli-install-done'

function Info($m) { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Fail($m) { Write-Host $m -ForegroundColor Red; exit 1 }

function Confirm-Yes($prompt) {
  if ($Yes) { return $true }
  $ans = Read-Host "$prompt [y/N]"
  return ($ans -eq 'y' -or $ans -eq 'Y' -or $ans -eq 'yes' -or $ans -eq 'YES')
}

if ((Test-Path (Join-Path $Dir $Marker)) -and (Test-Path (Join-Path $Dir 'node_modules')) -and (Test-Path (Join-Path $Dir 'apps/cli/dist'))) {
  Info "Already installed in $Dir (marker $Marker present) - skipping expensive steps."
  Info "Run: cd $Dir; .\.venv\Scripts\Activate.ps1; pnpm start"
  exit 0
}

Info "Installing Zoveli AI (branch: $Branch) into $Dir"
if (-not $Yes) {
  Warn 'Review this script before continuing: https://github.com/blessandy9104-hue/zoveli-ai/blob/main/install/install-zoveli.ps1'
  if (-not (Confirm-Yes 'Continue with installation?')) { Fail 'Aborted by user.' }
}

foreach ($cmd in @('git')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Fail "Missing required tool: $cmd. Install via: winget install Git.Git (then re-run)."
  }
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Fail 'Missing Python 3.11+. Install via: winget install Python.Python.3.11 (then re-run).' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Missing Node 22.16+. Install via: winget install OpenJS.NodeJS.LTS (then re-run).' }

if (Test-Path (Join-Path $Dir '.git')) {
  Info "Reusing existing checkout at $Dir"
  Push-Location $Dir
  git fetch origin
  git checkout $Branch
  git pull --ff-only origin $Branch
  Pop-Location
} else {
  if ((Test-Path $Dir) -and (Get-ChildItem $Dir -Force | Select-Object -First 1)) { Fail "Target $Dir exists and is not a Zoveli checkout. Use -Dir <empty-or-new-path>." }
  Info "Cloning $RepoUrl (branch $Branch)..."
  git clone --branch $Branch --depth 1 $RepoUrl $Dir
}
Set-Location $Dir

if (-not (Test-Path '.venv')) { Info 'Creating Python venv (.venv)...'; python -m venv .venv }
& '.\.venv\Scripts\Activate.ps1'
python -m pip install --upgrade pip
Info 'Installing vendored mathcore (verified-math backend)...'
pip install -e .\mathcore
if ($LASTEXITCODE -ne 0) { Fail 'pip install ./mathcore failed. Install Visual Studio Build Tools (C++ workload) + CMake, then re-run.' }

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Info "Installing pnpm@$PnpmVersion..."
  if (Get-Command corepack -ErrorAction SilentlyContinue) { corepack enable; corepack prepare "pnpm@$PnpmVersion" --activate }
  else { npm install -g "pnpm@$PnpmVersion" }
}
$nodeMajor = (node -p "process.versions.node.split('.')[0]")
$nodeMinor = (node -p "process.versions.node.split('.')[1]")
# node:sqlite FTS5 (memory store) needs 22.16+; newer majors are fine.
if (([int]$nodeMajor -lt 22) -or (([int]$nodeMajor -eq 22) -and ([int]$nodeMinor -lt 16))) { Fail "Node 22.16+ required (found $(node -v)). Upgrade Node, then re-run." }

Info 'Installing JS dependencies (pnpm install)...'
pnpm install --frozen-lockfile --prod=false
Info 'Building packages (pnpm run build)...'
pnpm run build

(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + " zoveli-ai $Branch" | Out-File $Marker -Encoding ascii
Info "Zoveli AI installed successfully into $Dir"
Write-Host ""
Write-Host "Run it:"
Write-Host "  cd $Dir; .\.venv\Scripts\Activate.ps1"
Write-Host "  pnpm run doctor       # confirm Node/pnpm/python/mathcore/Ollama"
Write-Host "  pnpm start            # CLI assistant (works fully offline)"
Write-Host "  pnpm run desktop      # Electron desktop shell (dev mode)"
Write-Host ""
Write-Host "Try in the CLI: /math solve x^2 - 5x + 6 = 0 | /sys | /tools | /help"
