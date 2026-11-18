<#
.SYNOPSIS
  Acceptance test for install/install.ps1 on Windows.

.DESCRIPTION
  Runs the primary installer against a local runtime archive in a throwaway
  profile, then checks the doctor report, install metadata, PATH opt-in,
  idempotency, forced reinstall, uninstall, vault preservation, purge,
  protected-directory refusal, and Mark-of-the-Web handling. Used by the
  Runtime Artifacts workflow. Windows PowerShell 5.1 reads .ps1 files as ANSI
  without a BOM, so this file is intentionally ASCII-only.

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-acceptance.ps1 -Archive release/zoveli-0.1.3-windows-x64.tar.gz

.EXAMPLE
  pwsh -NoProfile -File scripts/install-acceptance.ps1 -Archive release/zoveli-0.1.3-windows-x64.tar.gz -PowerShellPath C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
#>
[CmdletBinding()]
param(
  [string]$Archive = '',
  [string]$Installer = '',
  [string]$RuntimeInstaller = '',
  [string]$PowerShellPath = '',
  [switch]$Keep,
  [switch]$SkipMotw
)

$ErrorActionPreference = 'Stop'
$script:Sandbox = ''
$script:Success = $false
$script:OriginalPath = $null
$script:OriginalPathKind = $null
$script:HadUserPath = $false
$script:SavedEnvironment = @{}

function Pass([string]$Message) {
  Write-Host "[pass] $Message"
}

function Fail([string]$Message) {
  throw [System.InvalidOperationException]::New($Message)
}

function Quote-PS([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function Get-UserPathRaw {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $false)
  if (-not $key) { return '' }
  try {
    return [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  } finally {
    $key.Dispose()
  }
}

function Get-UserPathEntries {
  $entries = @()
  foreach ($entry in ((Get-UserPathRaw) -split ';')) {
    $candidate = [Environment]::ExpandEnvironmentVariables($entry.Trim()).Trim('"')
    if ($candidate) {
      try { $candidate = [System.IO.Path]::GetFullPath($candidate).TrimEnd('\') } catch { $candidate = $candidate.TrimEnd('\') }
      $entries += $candidate
    }
  }
  return $entries
}

function Test-UserPathEntry([string]$DirPath) {
  $needle = [System.IO.Path]::GetFullPath($DirPath).TrimEnd('\')
  foreach ($entry in (Get-UserPathEntries)) {
    if ([string]::Equals($entry, $needle, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Count-UserPathEntry([string]$DirPath) {
  $needle = [System.IO.Path]::GetFullPath($DirPath).TrimEnd('\')
  $count = 0
  foreach ($entry in (Get-UserPathEntries)) {
    if ([string]::Equals($entry, $needle, [StringComparison]::OrdinalIgnoreCase)) { $count++ }
  }
  return $count
}

function Send-EnvironmentChange {
  if (-not ('Zoveli.AcceptanceEnvironmentBroadcast' -as [type])) {
    Add-Type -Namespace Zoveli -Name AcceptanceEnvironmentBroadcast -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
  }
  $result = [System.UIntPtr]::Zero
  [void][Zoveli.AcceptanceEnvironmentBroadcast]::SendMessageTimeout([System.IntPtr]0xffff, 0x001A, [System.UIntPtr]::Zero, 'Environment', 0x0002, 5000, [ref]$result)
}

function Invoke-Child([string]$Script, [string]$LogName) {
  $logPath = Join-Path $script:Sandbox $LogName
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $PowerShellPath -NoProfile -ExecutionPolicy Restricted -Command $Script 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  $text = ($output | Out-String)
  Set-Content -LiteralPath $logPath -Value $text -Encoding UTF8
  return @{ Code = $code; Text = $text; Log = $logPath }
}

function Assert-Exit([hashtable]$Result, [string]$What) {
  if ($Result.Code -ne 0) {
    Write-Host $Result.Text
    Fail "$What failed with exit code $($Result.Code); log: $($Result.Log)"
  }
}

function Get-ArchiveVersion([string]$Path) {
  $name = [System.IO.Path]::GetFileName($Path)
  if ($name -match '^zoveli-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-windows-(x64|arm64)\.tar\.gz$') {
    return @{ Version = $Matches[1]; Arch = $Matches[2] }
  }
  return $null
}

function Assert-Metadata([string]$TargetDir, [string]$ExpectedVersion, [string]$ExpectedArch, [bool]$ExpectedPathAdded) {
  $metadataPath = Join-Path $TargetDir 'install.json'
  if (-not (Test-Path -LiteralPath $metadataPath)) { Fail "install.json missing after install: $metadataPath" }
  $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
  if ([string]$metadata.installer -ne 'install.ps1') { Fail "install.json installer was '$($metadata.installer)'" }
  if ([string]$metadata.platform -ne 'windows') { Fail "install.json platform was '$($metadata.platform)'" }
  if ([string]$metadata.arch -ne $ExpectedArch) { Fail "install.json arch was '$($metadata.arch)', expected $ExpectedArch" }
  if ([string]$metadata.version -ne $ExpectedVersion) { Fail "install.json version was '$($metadata.version)', expected $ExpectedVersion" }
  if ([bool]$metadata.pathAdded -ne $ExpectedPathAdded) { Fail "install.json pathAdded was '$($metadata.pathAdded)', expected $ExpectedPathAdded" }
}

function Assert-Doctor([string]$Launcher) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $errPath = Join-Path $script:Sandbox 'doctor.err.txt'
  try {
    $stdout = & $Launcher doctor --json 2> $errPath
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  $doctorLog = Join-Path $script:Sandbox 'doctor.txt'
  $json = ($stdout | Out-String)
  Set-Content -LiteralPath $doctorLog -Value $json -Encoding UTF8
  if ($code -ne 0) {
    Write-Host $json
    if (Test-Path -LiteralPath $errPath) { Get-Content -LiteralPath $errPath | Write-Host }
    Fail "doctor reported a blocking problem; log: $doctorLog"
  }
  $report = $json | ConvertFrom-Json
  if ([string]$report.install.mode -ne 'runtime') { Fail "expected runtime install, got '$($report.install.mode)'" }
  if ([string]$report.status -eq 'fail') {
    $failed = @($report.checks | Where-Object { $_.level -eq 'fail' })
    Fail "doctor failed: $($failed | ConvertTo-Json -Compress)"
  }
  $ids = @($report.checks | ForEach-Object { [string]$_.id })
  foreach ($id in @('runtime', 'install', 'config', 'vault', 'mathcore-command', 'mathcore-probe')) {
    if ($ids -notcontains $id) { Fail "doctor is missing the $id check" }
  }
  $probe = $report.checks | Where-Object { $_.id -eq 'mathcore-probe' } | Select-Object -First 1
  if ([string]$probe.level -ne 'ok') { Fail "mathcore probe was $($probe.level)" }
}

function Set-MarkOfTheWeb([string]$Path) {
  $zone = "[ZoneTransfer]`r`nZoneId=3`r`n"
  Set-Content -LiteralPath $Path -Stream 'Zone.Identifier' -Value $zone -Encoding ASCII
}

function Clear-SavedEnvironment {
  foreach ($name in $script:SavedEnvironment.Keys) {
    $saved = $script:SavedEnvironment[$name]
    if ($null -eq $saved.Existed) { continue }
    if ($saved.Existed) {
      [Environment]::SetEnvironmentVariable($name, $saved.Value, 'Process')
    } else {
      [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
  }
}

try {
  $root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
  if (-not $Installer) { $Installer = Join-Path $root 'install\install.ps1' }
  if (-not $RuntimeInstaller) { $RuntimeInstaller = Join-Path $root 'install\install-zoveli-runtime.ps1' }
  if (-not (Test-Path -LiteralPath $Installer)) { Fail "installer not found: $Installer" }
  if (-not (Test-Path -LiteralPath $RuntimeInstaller)) { Fail "runtime installer not found: $RuntimeInstaller" }
  $Installer = (Resolve-Path -LiteralPath $Installer).Path
  $RuntimeInstaller = (Resolve-Path -LiteralPath $RuntimeInstaller).Path

  if (-not $Archive) {
    $candidate = Get-ChildItem -LiteralPath (Join-Path $root 'release') -Filter 'zoveli-*.tar.gz' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime | Select-Object -Last 1
    if ($candidate) { $Archive = $candidate.FullName }
  }
  if (-not $Archive) { Fail 'no runtime archive found; run pnpm run package:runtime or pass -Archive' }
  if (-not (Test-Path -LiteralPath $Archive)) { Fail "archive not found: $Archive" }
  if (-not (Test-Path -LiteralPath "$Archive.sha256")) { Fail "checksum not found: $Archive.sha256" }
  $Archive = (Resolve-Path -LiteralPath $Archive).Path
  $archiveInfo = Get-ArchiveVersion $Archive
  if (-not $archiveInfo) { Fail "could not read version and architecture from archive name: $Archive" }

  if (-not $PowerShellPath) {
    if ($PSVersionTable.PSEdition -eq 'Desktop') {
      $PowerShellPath = Join-Path $PSHOME 'powershell.exe'
    } else {
      $pwsh = Get-Command 'pwsh.exe' -ErrorAction SilentlyContinue
      if (-not $pwsh) { Fail 'pwsh.exe not found; pass -PowerShellPath' }
      $PowerShellPath = $pwsh.Source
    }
  }
  if (-not (Test-Path -LiteralPath $PowerShellPath) -and -not (Get-Command $PowerShellPath -ErrorAction SilentlyContinue)) {
    Fail "PowerShell not found: $PowerShellPath"
  }

  foreach ($name in @('USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'HOME', 'ZOVELI_VERSION', 'ZOVELI_ARCHIVE', 'ZOVELI_RUNTIME_INSTALLER', 'ZOVELI_RUNTIME_URL', 'ZOVELI_VAULT_PATH', 'ZOVELI_MEMORY_DB', 'NO_COLOR')) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    $script:SavedEnvironment[$name] = @{ Existed = ($null -ne $value); Value = $value }
  }

  $script:Sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ('zoveli acceptance ' + [guid]::NewGuid().ToString('N'))
  $homeDir = Join-Path $script:Sandbox ('home user ' + [char]0x00E9)
  $localAppData = Join-Path $homeDir 'AppData\Local'
  $targetDir = Join-Path $localAppData 'Zoveli'
  $stateDir = Join-Path $homeDir '.zoveli'
  New-Item -ItemType Directory -Path $homeDir -Force | Out-Null
  New-Item -ItemType Directory -Path $localAppData -Force | Out-Null

  $pathKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $false)
  if ($pathKey) {
    try {
      $script:OriginalPath = [string]$pathKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $script:HadUserPath = $null -ne $pathKey.GetValue('Path', $null)
      try { $script:OriginalPathKind = $pathKey.GetValueKind('Path') } catch { }
    } finally {
      $pathKey.Dispose()
    }
  }

  $env:USERPROFILE = $homeDir
  $env:LOCALAPPDATA = $localAppData
  $env:APPDATA = Join-Path $homeDir 'AppData\Roaming'
  $env:HOME = $homeDir
  $env:NO_COLOR = '1'
  $env:ZOVELI_VERSION = $archiveInfo.Version
  $env:ZOVELI_ARCHIVE = $Archive
  $env:ZOVELI_RUNTIME_INSTALLER = $RuntimeInstaller
  Remove-Item Env:\ZOVELI_RUNTIME_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\ZOVELI_VAULT_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:\ZOVELI_MEMORY_DB -ErrorAction SilentlyContinue

  $hostVersion = & $PowerShellPath -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
  if ($LASTEXITCODE -ne 0) { Fail "could not start $PowerShellPath" }
  Pass "powershell ($($hostVersion | Select-Object -First 1))"
  Pass "archive ($($archiveInfo.Version), $($archiveInfo.Arch))"

  $installScript = "Get-Content -LiteralPath $(Quote-PS $Installer) -Raw | Invoke-Expression"

  $checkBefore = Invoke-Child ("& ([scriptblock]::Create((Get-Content -LiteralPath $(Quote-PS $Installer) -Raw))) -Check -Archive $(Quote-PS $Archive)") 'check-before.txt'
  Assert-Exit $checkBefore 'check before install'
  if ($checkBefore.Text -notmatch 'Installed: none') { Fail '--check did not report an empty install' }
  Pass 'check-before'

  # Regression: a local archive may be renamed after download. The installer
  # must still reach checksum verification instead of rejecting the filename.
  $renamedArchive = Join-Path $script:Sandbox 'renamed archive.tar.gz'
  Copy-Item -LiteralPath $Archive -Destination $renamedArchive
  Set-Content -LiteralPath "$renamedArchive.sha256" -Value (('0' * 64) + '  renamed archive.tar.gz') -Encoding ASCII
  $renamedInstall = Join-Path $script:Sandbox 'renamed-install'
  $renamed = Invoke-Child ("& ([scriptblock]::Create((Get-Content -LiteralPath $(Quote-PS $Installer) -Raw))) -Yes -Archive $(Quote-PS $renamedArchive) -Dir $(Quote-PS $renamedInstall)") 'renamed-archive.txt'
  if ($renamed.Code -eq 0) { Fail 'a renamed archive with a mismatched checksum was accepted' }
  if ($renamed.Text -notmatch 'SHA-256 verification failed') {
    Fail 'a renamed archive was rejected before checksum verification'
  }
  if (Test-Path -LiteralPath $renamedInstall) { Fail 'the failed renamed-archive install left a directory behind' }
  Pass 'renamed-archive-checksum'

  $install = Invoke-Child $installScript 'install.txt'
  Assert-Exit $install 'install'
  if ($install.Text -notmatch 'Zoveli .* is ready') {
    Write-Host $install.Text
    Fail 'install output did not include the ready message'
  }
  foreach ($relative in @('zoveli.cmd', 'node.exe', 'runtime.json', 'install.json', 'mathcore\mathcore-mcp.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $targetDir $relative))) { Fail "missing $relative after install" }
  }
  $versionOutput = & (Join-Path $targetDir 'zoveli.cmd') --version | Select-Object -Last 1
  if ($LASTEXITCODE -ne 0 -or "$versionOutput" -notmatch '^zoveli\s+\S+') { Fail "unexpected --version output: $versionOutput" }
  Assert-Metadata $targetDir $archiveInfo.Version $archiveInfo.Arch $false
  Pass "clean-install ($versionOutput)"

  if (Test-UserPathEntry $targetDir) { Fail 'installer changed the user PATH without -AddToPath' }
  Pass 'path-opt-in'

  $rerun = Invoke-Child $installScript 'reinstall.txt'
  Assert-Exit $rerun 'second install'
  if ($rerun.Text -notmatch 'already installed') { Fail 'second install was not idempotent' }
  Pass 'idempotent-second-run'

  $force = Invoke-Child ("& ([scriptblock]::Create((Get-Content -LiteralPath $(Quote-PS $Installer) -Raw))) -Force") 'force-reinstall.txt'
  Assert-Exit $force 'force reinstall'
  if ($force.Text -notmatch 'Reinstalling Zoveli') { Fail '-Force did not reinstall the same version' }
  $forceVersion = & (Join-Path $targetDir 'zoveli.cmd') --version | Select-Object -Last 1
  if ($LASTEXITCODE -ne 0 -or "$forceVersion" -notmatch '^zoveli\s+\S+') { Fail "unexpected --version output after -Force: $forceVersion" }
  Assert-Metadata $targetDir $archiveInfo.Version $archiveInfo.Arch $false
  Pass 'force-reinstall'

  $addPath = Invoke-Child ("& ([scriptblock]::Create((Get-Content -LiteralPath $(Quote-PS $Installer) -Raw))) -AddToPath") 'add-path.txt'
  Assert-Exit $addPath 'add to path'
  if ($addPath.Text -notmatch 'Added .* to your user PATH|already on your user PATH') {
    Write-Host $addPath.Text
    Fail 'add-to-path output was unclear'
  }
  if ((Count-UserPathEntry $targetDir) -ne 1) { Fail 'user PATH entry count was not 1 after -AddToPath' }
  Assert-Metadata $targetDir $archiveInfo.Version $archiveInfo.Arch $true
  Pass 'add-to-path'

  $addPathAgain = Invoke-Child ("& ([scriptblock]::Create((Get-Content -LiteralPath $(Quote-PS $Installer) -Raw))) -AddToPath") 'add-path-again.txt'
  Assert-Exit $addPathAgain 'second add to path'
  if ($addPathAgain.Text -notmatch 'already on your user PATH') { Fail 'second -AddToPath run was not idempotent' }
  if ((Count-UserPathEntry $targetDir) -ne 1) { Fail 'user PATH entry was duplicated by the second -AddToPath run' }
  Pass 'path-idempotent'

  $checkInstalled = Invoke-Child ("& ([scriptblock]::Create((Get-Content -LiteralPath $(Quote-PS $Installer) -Raw))) -Check -Archive $(Quote-PS $Archive)") 'check-installed.txt'
  Assert-Exit $checkInstalled 'check after install'
  if ($checkInstalled.Text -notmatch 'is up to date') { Fail '--check did not report an up-to-date install' }
  if ($checkInstalled.Text -notmatch 'User PATH: install directory is present') { Fail '--check did not report the PATH entry' }
  Pass 'check-installed'

  Assert-Doctor (Join-Path $targetDir 'zoveli.cmd')
  Pass 'doctor'

  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $stateDir 'acceptance-marker.txt') -Value 'keep me' -Encoding ASCII

  $uninstall = Invoke-Child ("& ([scriptblock]::Create((Get-Content -LiteralPath $(Quote-PS $Installer) -Raw))) -Uninstall -Yes") 'uninstall.txt'
  Assert-Exit $uninstall 'uninstall'
  if (Test-Path -LiteralPath $targetDir) { Fail 'uninstall left the runtime behind' }
  if (Test-UserPathEntry $targetDir) { Fail 'uninstall left the user PATH entry behind' }
  if (-not (Test-Path -LiteralPath (Join-Path $stateDir 'acceptance-marker.txt'))) { Fail 'uninstall deleted the vault' }
  Pass 'uninstall-preserves-vault'

  $purge = Invoke-Child ("& ([scriptblock]::Create((Get-Content -LiteralPath $(Quote-PS $Installer) -Raw))) -Uninstall -Purge -Yes") 'purge.txt'
  Assert-Exit $purge 'purge'
  if (Test-Path -LiteralPath $stateDir) { Fail 'purge left the state directory behind' }
  Pass 'purge-removes-vault'

  $protected = Invoke-Child ("& ([scriptblock]::Create((Get-Content -LiteralPath $(Quote-PS $Installer) -Raw))) -Yes -Archive $(Quote-PS $Archive) -Dir " + (Quote-PS ($env:SystemDrive + '\'))) 'protected.txt'
  if ($protected.Code -eq 0) { Fail 'installer accepted the filesystem root as the install directory' }
  if ($protected.Text -notmatch 'Refusing to use protected directory') { Fail 'protected-directory error was unclear' }
  Pass 'protected-directory-refused'

  if (-not $SkipMotw) {
    $motwDir = Join-Path $script:Sandbox 'motw archive'
    New-Item -ItemType Directory -Path $motwDir -Force | Out-Null
    $motwArchive = Join-Path $motwDir ([System.IO.Path]::GetFileName($Archive))
    Copy-Item -LiteralPath $Archive -Destination $motwArchive -Force
    Copy-Item -LiteralPath "$Archive.sha256" -Destination "$motwArchive.sha256" -Force
    Set-MarkOfTheWeb $motwArchive
    if (-not (Get-Item -LiteralPath $motwArchive -Stream 'Zone.Identifier' -ErrorAction SilentlyContinue)) {
      Fail 'could not set Mark-of-the-Web on the test archive'
    }
    $motwTarget = Join-Path $script:Sandbox 'runtime-motw'
    $motwInstall = Invoke-Child ("& ([scriptblock]::Create((Get-Content -LiteralPath $(Quote-PS $Installer) -Raw))) -Archive $(Quote-PS $motwArchive) -Dir $(Quote-PS $motwTarget) -Unblock -Yes") 'motw-install.txt'
    Assert-Exit $motwInstall 'Mark-of-the-Web install'
    if ($motwInstall.Text -notmatch 'Removed Mark-of-the-Web from the archive') {
      Write-Host $motwInstall.Text
      Fail 'installer did not report removing Mark-of-the-Web'
    }
    if (Get-Item -LiteralPath $motwArchive -Stream 'Zone.Identifier' -ErrorAction SilentlyContinue) {
      Fail 'Mark-of-the-Web was not removed from the archive'
    }
    Assert-Metadata $motwTarget $archiveInfo.Version $archiveInfo.Arch $false
    $motwUninstall = Invoke-Child ("& ([scriptblock]::Create((Get-Content -LiteralPath $(Quote-PS $Installer) -Raw))) -Uninstall -Yes -Dir $(Quote-PS $motwTarget)") 'motw-uninstall.txt'
    Assert-Exit $motwUninstall 'Mark-of-the-Web uninstall'
    Pass 'mark-of-the-web-unblock'
  }

  $script:Success = $true
  Write-Host 'install acceptance: PASS'
} catch {
  Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  try {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    if ($key) {
      try {
        if ($script:HadUserPath) {
          $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
          if ($script:OriginalPathKind -eq [Microsoft.Win32.RegistryValueKind]::String -or
              $script:OriginalPathKind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) {
            $kind = $script:OriginalPathKind
          }
          $key.SetValue('Path', [string]$script:OriginalPath, $kind)
        } else {
          try { $key.DeleteValue('Path', $false) } catch { }
        }
      } finally {
        $key.Dispose()
      }
      try { Send-EnvironmentChange } catch { }
    }
  } catch {
    Write-Host "warning: could not restore the user PATH: $($_.Exception.Message)" -ForegroundColor Yellow
  }
  Clear-SavedEnvironment
  if ($script:Sandbox -and (Test-Path -LiteralPath $script:Sandbox)) {
    if ($script:Success -and -not $Keep) {
      Remove-Item -LiteralPath $script:Sandbox -Recurse -Force -ErrorAction SilentlyContinue
    } else {
      Write-Host "acceptance sandbox kept for debugging: $script:Sandbox" -ForegroundColor Yellow
    }
  }
}
