<#
.SYNOPSIS
  Install or upgrade a prebuilt Zoveli runtime on Windows.

.DESCRIPTION
  Downloads the matching GitHub release archive, verifies its SHA-256
  checksum, and extracts it. Upgrades first create and verify a backup of the
  existing vault under ~/.zoveli/backups. No Git, Node, pnpm, Python, or
  compiler toolchain is required on the target machine. The user PATH is not
  changed unless -AddToPath is passed.

  The primary one-command installer is install/install.ps1. This runtime
  installer remains the engine used by "zoveli update" and by the primary
  installer. It is safe to invoke in-process from the primary installer: set
  ZOVELI_INSTALLER_INPROCESS=1 and failures throw instead of exiting.

  Windows PowerShell 5.1 reads .ps1 files as ANSI without a BOM, so this file
  is intentionally ASCII-only.

.EXAMPLE
  irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install-zoveli-runtime.ps1 | iex

.EXAMPLE
  .\install-zoveli-runtime.ps1 -Yes -Archive .\zoveli-0.1.3-windows-x64.tar.gz -Dir "$env:LOCALAPPDATA\Zoveli"

.EXAMPLE
  .\install-zoveli-runtime.ps1 -Yes -AddToPath
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
  [switch]$SkipBackup,
  [switch]$AddToPath,
  [switch]$Unblock,
  [switch]$Check
)

if ($PSVersionTable.PSEdition -eq 'Desktop' -and $env:ZOVELI_INSTALLER_INPROCESS -ne '1') {
  $env:PSModulePath = @(
    (Join-Path $PSHOME 'Modules'),
    (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
  ) -join ';'
}

$ErrorActionPreference = 'Stop'
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }
$Repo = 'blessandy9104-hue/zoveli-ai'
$Branch = $(if ($env:ZOVELI_BRANCH) { $env:ZOVELI_BRANCH } else { 'main' })
$UseColor = [string]::IsNullOrEmpty($env:NO_COLOR)

# Set ZOVELI_INSTALL_LOG to a file path to record temp/download diagnostics.
# The log is off by default so normal installs stay quiet.
$script:InstallLogPath = $env:ZOVELI_INSTALL_LOG
function Write-InstallLog([string]$Message) {
  if ([string]::IsNullOrWhiteSpace($script:InstallLogPath)) { return }
  try {
    $line = '{0:o} pid={1} {2}' -f (Get-Date).ToUniversalTime(), $PID, $Message
    Add-Content -LiteralPath $script:InstallLogPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
  } catch { }
}

function Info([string]$Message) {
  if ($UseColor) { Write-Host $Message -ForegroundColor Green } else { Write-Host $Message }
}
function Warn([string]$Message) {
  if ($UseColor) { Write-Host $Message -ForegroundColor Yellow } else { Write-Host $Message }
}
function Fail([string]$Message) {
  if ($env:ZOVELI_INSTALLER_INPROCESS -eq '1') {
    throw [System.InvalidOperationException]::New([string]$Message)
  }
  if ($UseColor) { Write-Host $Message -ForegroundColor Red } else { Write-Host $Message }
  exit 1
}

# Progress goes to stderr and only when stderr is an interactive terminal.
# Piped installs, CI logs, and terminals without a console stay clean.
function Test-InteractiveConsole {
  if ($env:CI -and $env:CI -ne '0' -and $env:CI -ne 'false') { return $false }
  if ($env:TERM -eq 'dumb') { return $false }
  try {
    if (-not [Environment]::UserInteractive) { return $false }
    if ([Console]::IsErrorRedirected) { return $false }
    return $true
  } catch {
    return $false
  }
}

function Format-Megabytes([double]$Bytes) {
  return [string]::Format(
    [System.Globalization.CultureInfo]::InvariantCulture,
    '{0:N1} MB',
    ($Bytes / 1MB)
  )
}

function New-DownloadProgress([string]$Label, [long]$TotalBytes) {
  if (-not $script:ShowProgress) { return $null }
  return @{
    Label = $Label
    Total = $TotalBytes
    Started = [DateTime]::UtcNow
    LastWrite = [DateTime]::MinValue
    Active = $false
    Broken = $false
    Width = 78
  }
}

function Write-DownloadProgress($Progress, [long]$ReceivedBytes, [switch]$Complete) {
  if ($null -eq $Progress -or $Progress.Broken) { return }
  $now = [DateTime]::UtcNow
  if (-not $Progress.Active) {
    $Progress.Started = $now
    $Progress.LastWrite = $now
  } elseif (-not $Complete -and ($now - $Progress.LastWrite).TotalMilliseconds -lt 200) {
    return
  }
  $seconds = [Math]::Max(($now - $Progress.Started).TotalSeconds, 0.001)
  $rate = $ReceivedBytes / $seconds
  if ($Progress.Total -gt 0) {
    $percent = [Math]::Min(100, [Math]::Floor(($ReceivedBytes / $Progress.Total) * 100))
    $line = 'Downloading {0} {1}% ({2} of {3}, {4}/s)' -f $Progress.Label, $percent, (Format-Megabytes $ReceivedBytes), (Format-Megabytes $Progress.Total), (Format-Megabytes $rate)
  } else {
    $line = 'Downloading {0} {1} ({2}/s)' -f $Progress.Label, (Format-Megabytes $ReceivedBytes), (Format-Megabytes $rate)
  }
  if ($line.Length -ge $Progress.Width) {
    $line = $line.Substring(0, $Progress.Width)
  } else {
    $line = $line.PadRight($Progress.Width)
  }
  try {
    [Console]::Error.Write("`r$line")
    $Progress.Active = $true
    $Progress.LastWrite = $now
  } catch {
    $Progress.Broken = $true
  }
}

function Clear-DownloadProgress($Progress) {
  if ($null -eq $Progress -or -not $Progress.Active -or $Progress.Broken) { return }
  try { [Console]::Error.Write("`r" + (' ' * $Progress.Width) + "`r") } catch { }
  $Progress.Active = $false
}

$script:ShowProgress = [bool](Test-InteractiveConsole)

function Normalize-Path([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetPathRoot($full)
  if ([string]::Equals($full, $root, [StringComparison]::OrdinalIgnoreCase)) { return $full }
  return $full.TrimEnd('\')
}

function Get-UserProfileDir {
  if ($env:USERPROFILE) { return Normalize-Path $env:USERPROFILE }
  $value = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
  if ($value) { return Normalize-Path $value }
  return Normalize-Path $HOME
}

function Get-LocalAppDataDir {
  if ($env:LOCALAPPDATA) { return Normalize-Path $env:LOCALAPPDATA }
  $value = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if ($value) { return Normalize-Path $value }
  return Normalize-Path (Join-Path (Get-UserProfileDir) 'AppData\Local')
}

function Get-StateDir {
  return Normalize-Path (Join-Path (Get-UserProfileDir) '.zoveli')
}

function Test-PathWithin([string]$Child, [string]$Parent) {
  $prefix = $Parent
  if (-not $prefix.EndsWith('\')) { $prefix = $prefix + '\' }
  return $Child.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Test-ReparsePoint([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  try {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    return [bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
  } catch {
    return $false
  }
}

function Assert-SafeTarget([string]$Path) {
  $target = Normalize-Path $Path
  $stateDir = Get-StateDir
  $guardRaws = @(
    [System.IO.Path]::GetPathRoot($target),
    (Get-UserProfileDir),
    (Get-LocalAppDataDir),
    $stateDir
  )
  foreach ($name in @('ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'WINDIR', 'SystemRoot')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $guardRaws += $value }
  }

  foreach ($guardRaw in $guardRaws) {
    if ([string]::IsNullOrWhiteSpace($guardRaw)) { continue }
    $guard = Normalize-Path $guardRaw
    if ([string]::Equals($target, $guard, [StringComparison]::OrdinalIgnoreCase)) {
      Fail "Refusing to use protected directory: $target"
    }
    if (Test-PathWithin $guard $target) {
      Fail "Refusing to use a directory that contains $guard`: $target"
    }
  }

  if (Test-PathWithin $target $stateDir) {
    Fail "Refusing to install the runtime inside the Zoveli state directory: $target"
  }
  if (Test-ReparsePoint $target) {
    Fail "Refusing to use a reparse point or junction as the install directory: $target"
  }
}

function Get-Sha256Hex($Path) {
  $stream = [System.IO.File]::OpenRead($Path)
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

function Assert-SafeDownloadUrl([string]$Value) {
  $uri = $null
  try { $uri = [System.Uri]$Value } catch { throw "Invalid download URL: $Value" }
  if ($uri.Scheme -ne 'https') { throw "Refusing non-HTTPS download URL: $Value" }
  if ($uri.UserInfo) { throw 'Refusing download URL with embedded credentials.' }
  if ($uri.Port -ne 443) { throw "Refusing download URL on a non-HTTPS port: $Value" }
  $allowed = @(
    'github.com',
    'objects.githubusercontent.com',
    'raw.githubusercontent.com',
    'release-assets.githubusercontent.com',
    'github-releases.githubusercontent.com'
  )
  $hostName = $uri.Host.ToLowerInvariant()
  if ($allowed -notcontains $hostName) {
    throw "Refusing download from unauthorized host: $hostName"
  }
}

# Unwrap MethodInvocationException and TargetInvocationException so retry
# decisions use the real I/O error rather than the PowerShell wrapper.
function Get-InnermostException($ErrorRecord) {
  $ex = $ErrorRecord.Exception
  while ($ex -and $ex.InnerException) { $ex = $ex.InnerException }
  return $ex
}

# Only a missing destination directory is retryable. HTTP errors, timeouts,
# and anything else must fail without a second attempt.
function Test-RetryableDownloadFailure($ErrorRecord) {
  $ex = Get-InnermostException $ErrorRecord
  if ($null -eq $ex) { return $false }
  if ($ex -is [System.IO.DirectoryNotFoundException]) { return $true }
  if ($ex -is [System.IO.FileNotFoundException]) { return $true }
  if ($ex -is [System.IO.IOException]) {
    # ERROR_FILE_NOT_FOUND (2) and ERROR_PATH_NOT_FOUND (3).
    $code = $ex.HResult -band 0xFFFF
    if ($code -eq 2 -or $code -eq 3) { return $true }
  }
  return $false
}

# Follow redirects by hand so a redirect cannot point at localhost, a
# link-local metadata service, or another machine on the user's network.
function Invoke-SafeDownloadAttempt([string]$Value, [string]$OutFile, [switch]$ShowProgress) {
  Add-Type -AssemblyName System.Net.Http
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromMinutes(10)
  try {
    $current = $Value
    for ($hop = 0; $hop -le 5; $hop++) {
      Assert-SafeDownloadUrl $current
      $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $current)
      $outDir = [System.IO.Path]::GetDirectoryName($OutFile)
      Write-InstallLog "download.request url=$current out=$OutFile outDir=$outDir dirExists=$(Test-Path -LiteralPath $outDir)"
      # ResponseHeadersRead returns as soon as the headers arrive. The body is
      # streamed straight to disk, so the destination file exists and stays
      # open for the whole transfer instead of leaving an empty directory that
      # a temp cleaner can remove while the archive is buffered in memory.
      $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
      try {
        $code = [int]$response.StatusCode
        Write-InstallLog "download.response status=$code outDir=$outDir dirExists=$(Test-Path -LiteralPath $outDir)"
        if ($code -in 301, 302, 303, 307, 308) {
          $location = $response.Headers.Location
          if ($null -eq $location) { throw "Redirect from $current had no Location header." }
          if (-not $location.IsAbsoluteUri) {
            $location = [System.Uri]::new([System.Uri]$current, $location)
          }
          $current = $location.AbsoluteUri
          continue
        }
        if ($code -ne 200) { throw "Download failed with HTTP ${code}: $current" }
        Write-InstallLog "download.file-create file=$OutFile dirExists=$(Test-Path -LiteralPath $outDir)"
        try {
          $file = [System.IO.File]::Create($OutFile)
        } catch {
          $free = 'unknown'
          try { $free = [math]::Round((New-Object System.IO.DriveInfo ([System.IO.Path]::GetPathRoot($OutFile))).AvailableFreeSpace / 1MB, 1) } catch { }
          Write-InstallLog "download.file-create-failed file=$OutFile dirExists=$(Test-Path -LiteralPath $outDir) freeMB=$free error=$($_.Exception.GetType().FullName): $($_.Exception.Message)"
          throw
        }
        try {
          Write-InstallLog "download.file-created file=$OutFile exists=$(Test-Path -LiteralPath $OutFile)"
          $totalBytes = [long]0
          if ($null -ne $response.Content.Headers.ContentLength) {
            $totalBytes = [long]$response.Content.Headers.ContentLength
          }
          $progress = $null
          if ($ShowProgress) {
            $progress = New-DownloadProgress ([System.IO.Path]::GetFileName($OutFile)) $totalBytes
          }
          $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
          try {
            $buffer = New-Object byte[] 1048576
            $received = [long]0
            while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
              $file.Write($buffer, 0, $read)
              $received += $read
              Write-DownloadProgress $progress $received
            }
            $file.Flush()
            Write-DownloadProgress $progress $received -Complete
          } finally {
            Clear-DownloadProgress $progress
            $stream.Dispose()
          }
        } finally {
          $file.Dispose()
        }
        Write-InstallLog "download.complete file=$OutFile exists=$(Test-Path -LiteralPath $OutFile) bytes=$((Get-Item -LiteralPath $OutFile -ErrorAction SilentlyContinue).Length)"
        return
      } finally {
        $response.Dispose()
        $request.Dispose()
      }
    }
    throw "Too many redirects while downloading $Value"
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
}

function Invoke-SafeDownload([string]$Value, [string]$OutFile, [switch]$ShowProgress) {
  # One bounded retry exists only for the narrow race where a cleaner removes
  # the staging directory before the destination file is created. The staging
  # directory is recreated from scratch instead of being reused.
  $maxAttempts = 2
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    try {
      Invoke-SafeDownloadAttempt $Value $OutFile -ShowProgress:$ShowProgress
      return
    } catch {
      $retryable = Test-RetryableDownloadFailure $_
      Write-InstallLog "download.attempt-failed attempt=$attempt maxAttempts=$maxAttempts retryable=$retryable error=$($_.Exception.GetType().FullName): $($_.Exception.Message)"
      Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
      if (-not $retryable -or $attempt -ge $maxAttempts) {
        Write-InstallLog "download.failed out=$OutFile error=$($_.Exception.GetType().FullName): $($_.Exception.Message)"
        throw
      }
      $outDir = [System.IO.Path]::GetDirectoryName($OutFile)
      if ($outDir) {
        $outRoot = [System.IO.Path]::GetPathRoot($outDir)
        if ($outRoot -and [string]::Equals($outDir.TrimEnd('\'), $outRoot.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
          Write-InstallLog "download.retry-refused reason=volume-root outDir=$outDir"
          throw
        }
        Remove-Item -LiteralPath $outDir -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
      }
      Write-InstallLog "download.retry attempt=$($attempt + 1) outDir=$outDir exists=$(Test-Path -LiteralPath $outDir)"
      Start-Sleep -Milliseconds 250
    }
  }
}

function Get-LatestVersion {
  Add-Type -AssemblyName System.Net.Http
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromMinutes(2)
  try {
    $current = "https://github.com/$Repo/releases/latest"
    for ($hop = 0; $hop -le 5; $hop++) {
      Assert-SafeDownloadUrl $current
      $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $current)
      $response = $client.SendAsync($request).GetAwaiter().GetResult()
      try {
        $code = [int]$response.StatusCode
        if ($code -in 301, 302, 303, 307, 308) {
          $location = $response.Headers.Location
          if ($null -eq $location) { throw "Redirect from $current had no Location header." }
          if (-not $location.IsAbsoluteUri) {
            $location = [System.Uri]::new([System.Uri]$current, $location)
          }
          $current = $location.AbsoluteUri
          continue
        }
        if ($code -ne 200) { throw "Could not resolve the latest release: HTTP ${code}" }
        if ($current -match '/releases/tag/v([^/?#]+)$') { return $Matches[1] }
        throw "Could not read the latest release tag from $current"
      } finally {
        $response.Dispose()
        $request.Dispose()
      }
    }
    throw 'Too many redirects while resolving the latest release.'
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
}

function Test-RemoteAsset([string]$Value) {
  Add-Type -AssemblyName System.Net.Http
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromMinutes(2)
  try {
    $current = $Value
    for ($hop = 0; $hop -le 5; $hop++) {
      Assert-SafeDownloadUrl $current
      $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $current)
      $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
      try {
        $code = [int]$response.StatusCode
        if ($code -in 301, 302, 303, 307, 308) {
          $location = $response.Headers.Location
          if ($null -eq $location) { throw "Redirect from $current had no Location header." }
          if (-not $location.IsAbsoluteUri) {
            $location = [System.Uri]::new([System.Uri]$current, $location)
          }
          $current = $location.AbsoluteUri
          continue
        }
        if ($code -eq 404) { return $false }
        if ($code -ne 200) { throw "Could not verify the release asset: HTTP ${code} from $current" }
        return $true
      } finally {
        $response.Dispose()
        $request.Dispose()
      }
    }
    throw 'Too many redirects while checking the release asset.'
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
}

function Test-MarkOfTheWeb([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  try {
    $null = Get-Item -LiteralPath $Path -Stream 'Zone.Identifier' -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Get-BlockHint([string]$ArchivePath) {
  $hint = 'If Windows Security or another antivirus blocked the bundled node.exe, review its protection history, allow the file, then retry. Do not disable protections.'
  if ($ArchivePath -and (Test-MarkOfTheWeb $ArchivePath)) {
    return "`nThe archive has Mark-of-the-Web. $hint You can also unblock the archive (Properties > Unblock) or rerun with -Unblock."
  }
  return "`n$hint"
}

function Clear-MarkOfTheWeb([string]$Path) {
  if (-not (Test-MarkOfTheWeb $Path)) { return $false }
  try {
    Unblock-File -LiteralPath $Path -ErrorAction Stop
    return $true
  } catch {
    Warn "Could not remove Mark-of-the-Web from $Path`: $($_.Exception.Message)"
    return $false
  }
}

function Get-RuntimeVersion($Launcher) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $Launcher --version 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  return @{
    Code = $code
    Text = "$($output | Select-Object -Last 1)".Trim()
  }
}

function ConvertTo-VersionParts([string]$Value) {
  $clean = ($Value.Trim() -replace '^v', '').Split('-')[0]
  $parts = $clean.Split('.')
  if ($parts.Count -lt 3) { return $null }
  $numbers = @()
  foreach ($part in $parts[0..2]) {
    $number = 0
    if (-not [int]::TryParse($part, [ref]$number)) { return $null }
    $numbers += $number
  }
  return $numbers
}

function Compare-Version([string]$Left, [string]$Right) {
  $a = ConvertTo-VersionParts $Left
  $b = ConvertTo-VersionParts $Right
  if ($null -eq $a -or $null -eq $b) { return 0 }
  for ($i = 0; $i -lt 3; $i++) {
    if ($a[$i] -lt $b[$i]) { return -1 }
    if ($a[$i] -gt $b[$i]) { return 1 }
  }
  return 0
}

function Get-InstallMetadata([string]$DirPath) {
  $path = Join-Path $DirPath 'install.json'
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Write-InstallMetadata([string]$DirPath, [string]$InstalledVersion, [string]$Source, [object]$Existing, [bool]$PathAdded, [string]$HostArch) {
  if ([string]::IsNullOrWhiteSpace($InstalledVersion)) { return }
  $metadata = [ordered]@{}
  if ($Existing) {
    foreach ($property in $Existing.PSObject.Properties) {
      $metadata[$property.Name] = $property.Value
    }
  }
  $metadata['schema'] = 1
  $metadata['version'] = $InstalledVersion
  $metadata['installedAt'] = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $metadata['method'] = 'runtime'
  if (-not $metadata.Contains('installer')) { $metadata['installer'] = 'install-zoveli-runtime.ps1' }
  if (-not $metadata.Contains('platform')) { $metadata['platform'] = 'windows' }
  $metadata['arch'] = $HostArch
  $metadata['dir'] = $DirPath
  $metadata['pathAdded'] = $PathAdded
  $metadata['source'] = $Source
  $metadata['releaseTag'] = "v$InstalledVersion"
  $json = $metadata | ConvertTo-Json -Depth 4
  $temp = Join-Path $DirPath ('.install.json.' + [guid]::NewGuid().ToString('N'))
  try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temp, $json + [Environment]::NewLine, $utf8)
    Move-Item -LiteralPath $temp -Destination (Join-Path $DirPath 'install.json') -Force
  } catch {
    Warn "Could not write install metadata to $DirPath`: $($_.Exception.Message)"
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

function Get-InstalledVersion([string]$DirPath) {
  if (-not (Test-Path -LiteralPath $DirPath)) { return $null }
  $launcher = Join-Path $DirPath 'zoveli.cmd'
  if (Test-Path -LiteralPath $launcher) {
    $result = Get-RuntimeVersion $launcher
    if ($result.Code -eq 0 -and $result.Text -match '^zoveli\s+(\S+)') {
      return $Matches[1]
    }
  }
  $metadata = Get-InstallMetadata $DirPath
  if ($metadata -and $metadata.version) { return [string]$metadata.version }
  $manifest = Join-Path $DirPath 'runtime.json'
  if (Test-Path -LiteralPath $manifest) {
    try {
      $runtime = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
      if ($runtime.version) { return [string]$runtime.version }
    } catch { }
  }
  return $null
}

function Test-PathEntry([string]$PathValue, [string]$DirPath) {
  $needle = Normalize-Path $DirPath
  foreach ($entry in ($PathValue -split ';')) {
    $candidate = [Environment]::ExpandEnvironmentVariables($entry.Trim()).Trim('"')
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    try { $candidate = Normalize-Path $candidate } catch { $candidate = $candidate.TrimEnd('\') }
    if ([string]::Equals($candidate, $needle, [StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }
  return $false
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

function Add-UserPath([string]$DirPath) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  if (-not $key) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
  }
  if (-not $key) { throw 'could not open HKCU\Environment' }
  try {
    $current = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if (Test-PathEntry $current $DirPath) { return $false }

    $existingKind = $null
    try { $existingKind = $key.GetValueKind('Path') } catch { }
    $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
    if ($existingKind -eq [Microsoft.Win32.RegistryValueKind]::String -or
        $existingKind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) {
      $kind = $existingKind
    } elseif ($null -ne $existingKind) {
      throw "unsupported user PATH value kind: $existingKind"
    }

    $trimmed = $current.TrimEnd(';')
    $next = $(if ([string]::IsNullOrWhiteSpace($trimmed)) { $DirPath } else { "$trimmed;$DirPath" })
    $key.SetValue('Path', $next, $kind)
    $verified = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if (-not (Test-PathEntry $verified $DirPath)) { throw 'user PATH write did not persist' }
    return $true
  } finally {
    $key.Dispose()
  }
}

function Send-EnvironmentChange {
  if (-not ('Zoveli.EnvironmentBroadcast' -as [type])) {
    Add-Type -Namespace Zoveli -Name EnvironmentBroadcast -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
  }
  $result = [System.UIntPtr]::Zero
  [void][Zoveli.EnvironmentBroadcast]::SendMessageTimeout([System.IntPtr]0xffff, 0x001A, [System.UIntPtr]::Zero, 'Environment', 0x0002, 5000, [ref]$result)
}

function Test-LauncherOnPath([string]$DirPath) {
  $previous = $env:Path
  try {
    $env:Path = "$DirPath;$previous"
    $command = Get-Command 'zoveli' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    return ($command -and [string]::Equals($command.Source, (Join-Path $DirPath 'zoveli.cmd'), [StringComparison]::OrdinalIgnoreCase))
  } finally {
    $env:Path = $previous
  }
}

function Move-ItemWithRetry([string]$Source, [string]$Destination) {
  # Antivirus scanners and just-exited child processes can hold a handle for a
  # moment after a backup or version check. Rename is atomic, so retrying a
  # failed move is safe and avoids aborting an otherwise valid upgrade.
  $attempts = 12
  for ($attempt = 1; $attempt -le $attempts; $attempt++) {
    try {
      Move-Item -LiteralPath $Source -Destination $Destination -ErrorAction Stop
      return
    } catch {
      if ($attempt -eq $attempts) { throw }
      Start-Sleep -Milliseconds 250
    }
  }
}

function Backup-ExistingRuntime([string]$DirPath) {
  if (-not (Test-Path -LiteralPath (Join-Path $DirPath 'runtime.json'))) { return }
  if ($SkipBackup) {
    Warn 'Skipping the pre-upgrade backup (-SkipBackup).'
    return
  }
  $launcher = Join-Path $DirPath 'zoveli.cmd'
  if (-not (Test-Path -LiteralPath $launcher)) {
    Fail "Existing runtime has no zoveli.cmd; create a manual backup or pass -SkipBackup: $DirPath"
  }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
  $backupDir = Join-Path (Join-Path (Get-StateDir) 'backups') "pre-upgrade-$stamp-$suffix"
  Info "Backing up existing data to $backupDir ..."
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $backupOutput = & $launcher backup --out $backupDir --json 2>&1
    $backupCode = $LASTEXITCODE
    $verifyOutput = & $launcher verify $backupDir --json 2>&1
    $verifyCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($backupCode -ne 0) {
    Fail "Pre-upgrade backup failed; the existing runtime was not changed.`n$($backupOutput -join "`n")"
  }
  if ($verifyCode -ne 0) {
    Fail "Pre-upgrade backup failed verification; the existing runtime was not changed.`n$($verifyOutput -join "`n")"
  }
  Info "Backup verified: $backupDir"
}

function Get-HostArch {
  $value = $null
  try {
    $value = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  } catch { }
  $alt = $env:PROCESSOR_ARCHITEW6432
  if ($alt -and $alt -match 'ARM64') { $value = 'Arm64' }
  if ([string]::IsNullOrWhiteSpace($value)) {
    if ($env:PROCESSOR_ARCHITEW6432) { $value = $env:PROCESSOR_ARCHITEW6432 } else { $value = $env:PROCESSOR_ARCHITECTURE }
  }
  switch ($value.ToLowerInvariant()) {
    'x64' { return 'x64' }
    'amd64' { return 'x64' }
    'arm64' { return 'arm64' }
    default { Fail "Unsupported architecture: $value. Only x64 and ARM64 are supported." }
  }
}

function Assert-WindowsHost {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Fail 'This installer is for Windows. Linux and macOS users should use install/install.sh.'
  }
  if ($PSVersionTable.PSVersion.Major -lt 5 -or
      ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -lt 1)) {
    Fail "Windows PowerShell 5.1 or later is required. Detected $($PSVersionTable.PSVersion)."
  }
  $build = [Environment]::OSVersion.Version.Build
  if ($build -lt 17763) {
    Fail "Windows 10 version 1809 (build 17763) or later is required. This build is $build. Update Windows or use the Docker fallback."
  }
  if (-not (Get-Command 'tar.exe' -ErrorAction SilentlyContinue)) {
    Fail 'Missing required command: tar.exe. Windows 10 1809 and later include tar.exe. Update Windows or use the Docker fallback.'
  }
}

function Get-ReleaseAssetUrl([string]$TargetVersion, [string]$HostArch) {
  return "https://github.com/$Repo/releases/download/v$TargetVersion/zoveli-$TargetVersion-windows-$HostArch.tar.gz"
}

function Assert-ReleaseAsset([string]$TargetVersion, [string]$HostArch) {
  $assetUrl = Get-ReleaseAssetUrl $TargetVersion $HostArch
  if (-not (Test-RemoteAsset $assetUrl)) {
    if ($HostArch -eq 'arm64') {
      Fail "Release v$TargetVersion does not publish a windows-arm64 archive. This release does not support Windows on ARM natively. Do not guess or install the x64 archive automatically. Install a release that includes the ARM64 archive, or explicitly use the x64 archive with -Archive and -Force only if you accept emulation. See https://github.com/$Repo/releases/tag/v$TargetVersion"
    }
    Fail "Release v$TargetVersion does not publish a windows-$HostArch archive. Check the release assets or pass -Version or -Archive. See https://github.com/$Repo/releases/tag/v$TargetVersion"
  }
  if (-not $NoVerify -and -not (Test-RemoteAsset "$assetUrl.sha256")) {
    Fail "Release v$TargetVersion publishes the archive but not its .sha256 checksum. Use -NoVerify only if you trust the archive, or pick another release."
  }
}

function Get-ArchiveInfo([string]$Path) {
  $name = [System.IO.Path]::GetFileName($Path)
  if ($name -match '^zoveli-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-windows-(x64|arm64)\.tar\.gz$') {
    return @{ Version = $Matches[1]; Arch = $Matches[2] }
  }
  return $null
}

Assert-WindowsHost
$HostArch = Get-HostArch
$Dir = Normalize-Path $Dir
Assert-SafeTarget $Dir
$StateDir = Get-StateDir

if ($Version) { $Version = $Version.Trim().TrimStart('v') }
$ArchivePath = ''
$ArchiveInfo = $null
$Source = 'release'
$ExistingMetadata = Get-InstallMetadata $Dir

if ($Archive) {
  if (-not (Test-Path -LiteralPath $Archive)) { Fail "Archive not found: $Archive" }
  $ArchivePath = (Resolve-Path -LiteralPath $Archive).Path
  $ArchiveInfo = Get-ArchiveInfo $ArchivePath
  if ($null -eq $ArchiveInfo) {
    # A local archive may be renamed (for example, a copy you verified
    # yourself). Its version and architecture are checked from runtime.json
    # after the checksum passes and the archive is extracted.
    Warn "Could not read the version and architecture from the archive name: $ArchivePath. They will be checked after extraction."
  } else {
    if ($Version -and $Version -ne $ArchiveInfo.Version) {
      Fail "Archive version $($ArchiveInfo.Version) does not match requested version $Version."
    }
    $Version = $ArchiveInfo.Version
    if ($ArchiveInfo.Arch -ne $HostArch -and -not $Force) {
      Fail "Archive is for windows-$($ArchiveInfo.Arch), but this machine is windows-$HostArch. Pass -Force only if you accept emulation."
    }
  }
  if (-not $NoVerify -and -not (Test-Path -LiteralPath "$ArchivePath.sha256")) {
    Fail "Checksum file not found: $ArchivePath.sha256. Use -NoVerify only for a trusted archive."
  }
  $Source = 'archive'
} elseif ($Url -and -not $Version) {
  try {
    $urlName = [System.IO.Path]::GetFileName(([System.Uri]$Url).AbsolutePath)
    $urlInfo = Get-ArchiveInfo $urlName
    if ($urlInfo) { $Version = $urlInfo.Version }
  } catch { }
}

$installedVersion = Get-InstalledVersion $Dir

if ($Check) {
  if (-not $Version -and -not $Url -and -not $Archive) {
    try {
      $Version = Get-LatestVersion
    } catch {
      Warn "Could not resolve the latest release: $($_.Exception.Message)"
    }
  }
  Write-Host "Install directory: $Dir"
  if ($installedVersion) { Write-Host "Installed: Zoveli $installedVersion" } else { Write-Host 'Installed: none' }
  if ($Version) { Write-Host "Target: Zoveli $Version" } else { Write-Host 'Target: unknown' }
  Write-Host "State: $StateDir"
  Write-Host "Platform: windows-$HostArch"
  if ($ArchivePath) { Write-Host "Archive: $ArchivePath" } elseif ($Url) { Write-Host "Runtime URL: $Url" }
  if ($installedVersion -and $Version) {
    $comparison = Compare-Version $installedVersion $Version
    if ($comparison -lt 0) {
      Info "Update available: Zoveli $installedVersion -> $Version"
    } elseif ($comparison -gt 0) {
      Info "Installed Zoveli $installedVersion is newer than target $Version"
    } else {
      Info "Zoveli $installedVersion is up to date"
    }
  }
  return
}

if (-not $Archive) {
  if (-not $Version) {
    Info 'Resolving the latest Zoveli release...'
    $Version = Get-LatestVersion
    if (-not $Version) { Fail 'Could not resolve the latest Zoveli release.' }
  }
  if (-not $Url) {
    Assert-ReleaseAsset $Version $HostArch
    $Url = Get-ReleaseAssetUrl $Version $HostArch
  } else {
    $Source = 'url'
  }
}

$archiveNameUnknown = [bool]($ArchivePath -and -not $ArchiveInfo)
$installVerb = 'Install'
if ($installedVersion -and $archiveNameUnknown) {
  # The archive filename does not identify its version, so the same-version
  # no-op cannot be decided yet. The archive is validated after extraction.
  Warn "Zoveli $installedVersion is already installed in $Dir; the archive will be verified after extraction."
} elseif ($installedVersion) {
  $comparison = 0
  if ($Version) { $comparison = Compare-Version $installedVersion $Version }
  if ($Version -and $comparison -lt 0) {
    Info "Upgrading Zoveli $installedVersion -> $Version"
    $installVerb = 'Upgrade'
  } elseif ($Version -and $comparison -gt 0) {
    if (-not $Force) {
      Fail "Installed Zoveli $installedVersion is newer than target $Version. Pass -Force to downgrade."
    }
    Warn "Downgrading Zoveli $installedVersion -> $Version"
    $installVerb = 'Downgrade'
  } else {
    Warn "Zoveli $installedVersion is already installed in $Dir."
    if (-not $Force -and -not $AddToPath) {
      Warn 'Use -Force to reinstall the runtime.'
      return
    }
  }
}

if (-not $Yes) {
  $prompt = $(if ($installVerb -eq 'Install') { "Install Zoveli into $Dir? [y/N]" } else { "$installVerb Zoveli in $Dir? [y/N]" })
  $answer = Read-Host $prompt
  if ($answer -notmatch '^(y|yes)$') { Fail 'Aborted.' }
}

# Stage downloads under the app-owned state directory, never %TEMP%. Storage
# Sense and third-party cleaners remove temp files without warning; that race
# deleted the empty %TEMP%\zoveli-install-* directory mid-download.
$downloadRoot = Join-Path $StateDir 'staging'
$temp = Join-Path $downloadRoot ('download-' + [guid]::NewGuid().ToString('N'))
$stageRoot = $null
Write-InstallLog "temp.before-create path=$temp tempRoot=$downloadRoot freeMB=$([math]::Round((New-Object System.IO.DriveInfo ([System.IO.Path]::GetPathRoot($temp))).AvailableFreeSpace / 1MB, 1))"
New-Item -ItemType Directory -Path $temp -Force | Out-Null
Write-InstallLog "temp.created path=$temp exists=$(Test-Path -LiteralPath $temp)"
try {
  if ($ArchivePath) {
    $archivePath = $ArchivePath
    if (Test-MarkOfTheWeb $archivePath) {
      if ($Unblock) {
        if (Clear-MarkOfTheWeb $archivePath) { Info 'Removed Mark-of-the-Web from the archive.' }
      } else {
        Warn "The archive has Mark-of-the-Web. Windows SmartScreen or antivirus software may block the bundled node.exe. Right-click the archive, choose Properties, select Unblock, then retry. Or rerun with -Unblock."
      }
    }
  } else {
    $archivePath = Join-Path $temp 'zoveli.tar.gz'
    Info "Downloading $Url"
    try {
      Invoke-SafeDownload $Url $archivePath -ShowProgress
      if (-not $NoVerify) {
        Info 'Downloading checksum...'
        Invoke-SafeDownload "$Url.sha256" "$archivePath.sha256"
      }
    } catch {
      Fail "Could not download the Zoveli runtime. $($_.Exception.Message)"
    }
    if (Test-MarkOfTheWeb $archivePath) {
      if ($Unblock) {
        if (Clear-MarkOfTheWeb $archivePath) { Info 'Removed Mark-of-the-Web from the downloaded archive.' }
      } else {
        Warn "The downloaded archive has Mark-of-the-Web. SmartScreen or antivirus software may block the bundled node.exe. Rerun with -Unblock if the runtime fails to start."
      }
    }
  }

  if (-not $NoVerify) {
    if (-not (Test-Path -LiteralPath "$archivePath.sha256")) {
      Fail "Checksum file not found: $archivePath.sha256. Use -NoVerify only for a trusted archive."
    }
    $expected = ((Get-Content -LiteralPath "$archivePath.sha256" -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = Get-Sha256Hex $archivePath
    if ($expected -ne $actual) { Fail "SHA-256 verification failed for $archivePath" }
    Info 'Checksum verified.'
  } else {
    Warn 'Skipping checksum verification (-NoVerify).'
  }

  $stage = Join-Path $temp 'extract'
  New-Item -ItemType Directory -Path $stage | Out-Null
  & tar.exe -xzf $archivePath -C $stage
  if ($LASTEXITCODE -ne 0) {
    Fail "Could not extract the runtime archive (tar.exe failed). Antivirus software may have blocked a file in the archive; check Windows Security protection history.$(Get-BlockHint $archivePath)"
  }

  $src = Get-ChildItem -LiteralPath $stage -Directory | Select-Object -First 1
  if (-not $src -or -not (Test-Path -LiteralPath (Join-Path $src.FullName 'runtime.json')) -or
      -not (Test-Path -LiteralPath (Join-Path $src.FullName 'zoveli.cmd'))) {
    Fail 'Archive does not contain a valid Zoveli runtime.'
  }

  # The archive contents are authoritative. This also supports local archives
  # that were renamed after download.
  $runtimeMeta = $null
  try {
    $runtimeMeta = Get-Content -LiteralPath (Join-Path $src.FullName 'runtime.json') -Raw | ConvertFrom-Json
  } catch {
    Fail "Could not read runtime.json from the archive: $($_.Exception.Message)"
  }
  $archiveVersion = [string]$runtimeMeta.version
  $archiveArch = [string]$runtimeMeta.arch
  if ([string]::IsNullOrWhiteSpace($archiveVersion)) {
    Fail 'The archive runtime.json does not declare a version.'
  }
  if ($Version -and $archiveVersion -ne $Version) {
    Fail "Archive version $archiveVersion does not match requested version $Version."
  }
  $Version = $archiveVersion
  if ($archiveArch -and $archiveArch -ne $HostArch -and -not $Force) {
    Fail "Archive is for windows-$archiveArch, but this machine is windows-$HostArch. Pass -Force only if you accept emulation."
  }

  if ((Test-Path -LiteralPath $Dir) -and (Get-ChildItem -LiteralPath $Dir -Force | Select-Object -First 1)) {
    if ((Test-Path -LiteralPath (Join-Path $Dir 'unins000.exe')) -and -not $Force) {
      Fail "Refusing to overwrite an installation created by the .exe installer. Uninstall Zoveli from Settings > Apps first (the vault is preserved), then retry."
    }
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
    Fail "New runtime failed its preflight check; the existing runtime was not changed.`n$($preflight.Text)$(Get-BlockHint $archivePath)"
  }
  Info "New runtime preflight: $($preflight.Text)"

  Backup-ExistingRuntime $Dir

  $previous = Join-Path $stageParent ('.zoveli-previous-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $oldMoved = $false
  $newMoved = $false
  $installed = ''
  try {
    if ((Test-Path -LiteralPath $Dir) -and (Get-ChildItem -LiteralPath $Dir -Force | Select-Object -First 1)) {
      Move-ItemWithRetry $Dir $previous
      $oldMoved = $true
    } elseif (Test-Path -LiteralPath $Dir) {
      Remove-Item -LiteralPath $Dir -Force
    }
    Move-ItemWithRetry $stageRoot $Dir
    $newMoved = $true
    $installedCheck = Get-RuntimeVersion (Join-Path $Dir 'zoveli.cmd')
    $installed = $installedCheck.Text
    if ($installedCheck.Code -ne 0 -or -not $installedCheck.Text.StartsWith('zoveli ')) {
      throw "Installed runtime failed its version check: $($installedCheck.Text)$(Get-BlockHint $archivePath)"
    }
  } catch {
    $reason = $_.Exception.Message
    if ($newMoved -and (Test-Path -LiteralPath $Dir)) {
      Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (-not $newMoved -and (Test-Path -LiteralPath $stageRoot)) {
      Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    $restored = $false
    if ($oldMoved -and (Test-Path -LiteralPath $previous)) {
      try {
        Move-ItemWithRetry $previous $Dir
        $restored = Test-Path -LiteralPath $Dir
      } catch {
        $restored = $false
      }
    }
    if ($oldMoved -and -not $restored) {
      Fail "Upgrade failed and automatic rollback did not finish. Previous runtime: $previous`n$reason"
    }
    if ($oldMoved) {
      Fail "Upgrade failed; the previous runtime was restored.`n$reason"
    }
    if ((Test-Path -LiteralPath $Dir) -and (Test-Path -LiteralPath (Join-Path $Dir 'runtime.json'))) {
      Fail "Upgrade failed; the existing runtime was left in place.`n$reason"
    }
    Fail "Upgrade failed; no runtime was left installed.`n$reason"
  }
  if ($oldMoved -and (Test-Path -LiteralPath $previous)) {
    Remove-Item -LiteralPath $previous -Recurse -Force -ErrorAction SilentlyContinue
  }
  Info "Installed $installed into $Dir"

  if ($Unblock) {
    foreach ($relative in @('node.exe', 'mathcore\mathcore-mcp.exe')) {
      $candidate = Join-Path $Dir $relative
      if ((Test-Path -LiteralPath $candidate) -and (Test-MarkOfTheWeb $candidate)) {
        if (Clear-MarkOfTheWeb $candidate) { Info "Removed Mark-of-the-Web from $relative." }
      }
    }
  }

  if (-not (Test-Path -LiteralPath (Join-Path $Dir 'mathcore\mathcore-mcp.exe'))) {
    Warn 'The bundled mathcore-mcp.exe is missing after installation. Antivirus software may have quarantined it. Check Windows Security protection history, restore the file, then rerun. Knowledge features will not work until it is restored.'
  } elseif (Test-MarkOfTheWeb (Join-Path $Dir 'mathcore\mathcore-mcp.exe')) {
    Warn 'The bundled mathcore-mcp.exe has Mark-of-the-Web. If knowledge features fail to start, unblock it or rerun with -Unblock.'
  }

  $installedVersion = Get-InstalledVersion $Dir
  if (-not $installedVersion) {
    $installedVersion = $(if ($installed -match '^zoveli\s+(\S+)') { $Matches[1] } else { $Version })
  }
  if ($Version -and $installedVersion -and (Compare-Version $installedVersion $Version) -ne 0) {
    Warn "Installed version $installedVersion differs from the requested version $Version."
  }

  $pathAdded = $false
  if ($ExistingMetadata -and $ExistingMetadata.pathAdded) { $pathAdded = $true }
  if ($AddToPath) {
    $added = $null
    try {
      $added = Add-UserPath $Dir
    } catch {
      Warn "Could not add $Dir to your user PATH: $($_.Exception.Message)"
    }
    if ($null -ne $added) {
      try { Send-EnvironmentChange } catch { }
      if ($added) {
        $pathAdded = $true
        Info "Added $Dir to your user PATH."
      } else {
        Info "$Dir is already on your user PATH."
      }
      if (-not (Test-LauncherOnPath $Dir)) {
        Warn 'The launcher was not discoverable in this process; open a new terminal to pick up the PATH change.'
      }
    }
  }

  Write-InstallMetadata $Dir $installedVersion $Source $ExistingMetadata $pathAdded $HostArch

  Write-Host ''
  if ($AddToPath) {
    Write-Host 'Open a new terminal, then run:'
    Write-Host '  zoveli'
  } else {
    $onUserPath = $false
    try { $onUserPath = Test-PathEntry (Get-UserPathRaw) $Dir } catch { }
    if ($onUserPath) {
      Write-Host 'Already on your user PATH. Open a new terminal, then run:'
      Write-Host '  zoveli'
    } else {
      Write-Host 'Run:'
      Write-Host "  $(Join-Path $Dir 'zoveli.cmd')"
      Write-Host ''
      Write-Host "To run 'zoveli' from any new terminal, reinstall with -AddToPath."
    }
  }
} finally {
  Write-InstallLog "temp.cleanup begin path=$temp exists=$(Test-Path -LiteralPath $temp)"
  if ($stageRoot -and (Test-Path -LiteralPath $stageRoot)) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  Write-InstallLog "temp.cleanup done path=$temp exists=$(Test-Path -LiteralPath $temp)"
}
