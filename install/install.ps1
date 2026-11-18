<#
.SYNOPSIS
  Zoveli AI - primary one-command installer for Windows 10 and 11.

.DESCRIPTION
  Installs, upgrades, checks, or uninstalls the prebuilt Zoveli runtime on
  Windows. The default command is non-interactive and installs the latest
  published release into %LOCALAPPDATA%\Zoveli. No administrator rights are
  required. The user PATH is not changed unless -AddToPath is passed. The vault
  and configuration under %USERPROFILE%\.zoveli survive upgrades and normal
  uninstalls.

  The Windows PowerShell 5.1 parser reads .ps1 files as ANSI without a BOM, so
  this file is intentionally ASCII-only.

.EXAMPLE
  irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.ps1 | iex

.EXAMPLE
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.ps1))) -Check

.EXAMPLE
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.ps1))) -AddToPath

.EXAMPLE
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/blessandy9104-hue/zoveli-ai/main/install/install.ps1))) -Uninstall -Yes
#>
[CmdletBinding()]
param(
  [Alias('y')][switch]$Yes,
  [string]$Dir = '',
  [string]$Version = $env:ZOVELI_VERSION,
  [string]$Archive = $env:ZOVELI_ARCHIVE,
  [string]$Url = $env:ZOVELI_RUNTIME_URL,
  [switch]$NoVerify,
  [switch]$Force,
  [switch]$SkipBackup,
  [switch]$AddToPath,
  [switch]$Check,
  [switch]$Uninstall,
  [switch]$Purge,
  [switch]$Unblock,
  [string]$Branch = $env:ZOVELI_BRANCH,
  [string]$RuntimeInstaller = $env:ZOVELI_RUNTIME_INSTALLER
)

# Defaults may come from ZOVELI_* environment variables. Only explicit
# parameters should conflict with -Uninstall.
$ExplicitInstallArgs = $PSBoundParameters.ContainsKey('Version') -or
  $PSBoundParameters.ContainsKey('Archive') -or
  $PSBoundParameters.ContainsKey('Url')

# Keep helper functions out of the caller's session when this file is executed
# with "irm ... | iex". The inner scriptblock can read the parameters above.
& {
  $ErrorActionPreference = 'Stop'
  $Repo = 'blessandy9104-hue/zoveli-ai'
  if ([string]::IsNullOrWhiteSpace($Branch)) { $Branch = 'main' }
  $UseColor = [string]::IsNullOrEmpty($env:NO_COLOR)

  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch { }

  function Write-Info([string]$Message) {
    if ($UseColor) { Write-Host $Message -ForegroundColor Green } else { Write-Host $Message }
  }
  function Write-Warn([string]$Message) {
    if ($UseColor) { Write-Host $Message -ForegroundColor Yellow } else { Write-Host $Message }
  }
  function Fail([string]$Message) {
    throw [System.InvalidOperationException]::New($Message)
  }

  function Normalize-Dir([string]$Path) {
    $full = [System.IO.Path]::GetFullPath($Path)
    if ($full -match '^[A-Za-z]:\\$') { return $full }
    return $full.TrimEnd('\')
  }

  function Get-UserProfileDir {
    if ($env:USERPROFILE) { return Normalize-Dir $env:USERPROFILE }
    $value = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    if ($value) { return Normalize-Dir $value }
    return Normalize-Dir $HOME
  }

  function Get-LocalAppDataDir {
    if ($env:LOCALAPPDATA) { return Normalize-Dir $env:LOCALAPPDATA }
    $value = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if ($value) { return Normalize-Dir $value }
    return Normalize-Dir (Join-Path (Get-UserProfileDir) 'AppData\Local')
  }

  function Get-StateDir {
    return Normalize-Dir (Join-Path (Get-UserProfileDir) '.zoveli')
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

  function Assert-SafeTarget([string]$Path, [string]$StateDir) {
    $target = Normalize-Dir $Path
    $userProfile = Get-UserProfileDir
    $localAppData = Get-LocalAppDataDir
    $protected = @()
    $root = [System.IO.Path]::GetPathRoot($target)
    if ($root) { $protected += $root }
    $protected += $userProfile
    $protected += $localAppData
    $protected += $StateDir
    foreach ($name in @('ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'WINDIR')) {
      $value = [Environment]::GetEnvironmentVariable($name)
      if ($value) { $protected += $value }
    }

    foreach ($entry in $protected) {
      if ([string]::IsNullOrWhiteSpace($entry)) { continue }
      $guard = Normalize-Dir $entry
      if ([string]::Equals($target, $guard, [StringComparison]::OrdinalIgnoreCase)) {
        Fail "Refusing to use protected directory: $target"
      }
      if (Test-PathWithin $guard $target) {
        Fail "Refusing to use a directory that contains $guard`: $target"
      }
    }
    if (Test-PathWithin $target $StateDir) {
      Fail "Refusing to install the runtime inside the Zoveli state directory: $target"
    }
    if (Test-ReparsePoint $target) {
      Fail "Refusing to use a reparse point or junction as the install directory: $target"
    }
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

  function ConvertTo-NormalizedPathEntry([string]$Entry) {
    $candidate = [Environment]::ExpandEnvironmentVariables($Entry.Trim()).Trim([char]'"')
    if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }
    try {
      return Normalize-Dir $candidate
    } catch {
      return $candidate.TrimEnd('\')
    }
  }

  function Test-UserPathEntry([string]$Dir) {
    $needle = Normalize-Dir $Dir
    foreach ($entry in ((Get-UserPathRaw) -split ';')) {
      $candidate = ConvertTo-NormalizedPathEntry $entry
      if ($candidate -and [string]::Equals($candidate, $needle, [StringComparison]::OrdinalIgnoreCase)) {
        return $true
      }
    }
    return $false
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

  function Add-UserPath([string]$Dir) {
    $needle = Normalize-Dir $Dir
    if (Test-UserPathEntry $needle) { return $false }
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    if (-not $key) {
      $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
    }
    if (-not $key) { throw 'could not open HKCU\Environment' }
    try {
      $current = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
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
      $next = $(if ([string]::IsNullOrWhiteSpace($trimmed)) { $needle } else { "$trimmed;$needle" })
      $key.SetValue('Path', $next, $kind)
      $verified = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if (-not (Test-UserPathEntry $needle)) { throw 'user PATH write did not persist' }
      return $true
    } finally {
      $key.Dispose()
    }
  }

  function Remove-UserPath([string]$Dir) {
    $needle = Normalize-Dir $Dir
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    if (-not $key) { return $false }
    try {
      $current = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ([string]::IsNullOrWhiteSpace($current)) { return $false }
      $entries = @($current -split ';')
      $kept = New-Object System.Collections.Generic.List[string]
      $removed = $false
      foreach ($entry in $entries) {
        $candidate = ConvertTo-NormalizedPathEntry $entry
        if (-not $removed -and $candidate -and [string]::Equals($candidate, $needle, [StringComparison]::OrdinalIgnoreCase)) {
          $removed = $true
          continue
        }
        $kept.Add($entry)
      }
      if (-not $removed) { return $false }
      $existingKind = $null
      try { $existingKind = $key.GetValueKind('Path') } catch { }
      $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
      if ($existingKind -eq [Microsoft.Win32.RegistryValueKind]::String -or
          $existingKind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) {
        $kind = $existingKind
      }
      $next = ($kept -join ';').TrimEnd(';')
      $key.SetValue('Path', $next, $kind)
      if (Test-UserPathEntry $needle) { throw 'user PATH removal did not persist' }
      return $true
    } finally {
      $key.Dispose()
    }
  }

  function Get-SimulatedProcessPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = Get-UserPathRaw
    $parts = @()
    if ($machine) { $parts += $machine }
    if ($user) { $parts += $user }
    return ($parts -join ';')
  }

  function Test-LauncherOnPath([string]$Dir) {
    $previous = $env:Path
    try {
      $env:Path = "$Dir;$previous"
      $command = Get-Command 'zoveli' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
      return ($command -and [string]::Equals($command.Source, (Join-Path $Dir 'zoveli.cmd'), [StringComparison]::OrdinalIgnoreCase))
    } finally {
      $env:Path = $previous
    }
  }

  function Get-ShadowingLauncher([string]$Dir) {
    $previous = $env:Path
    try {
      $env:Path = Get-SimulatedProcessPath
      $command = Get-Command 'zoveli' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($command -and -not [string]::Equals($command.Source, (Join-Path $Dir 'zoveli.cmd'), [StringComparison]::OrdinalIgnoreCase)) {
        return $command.Source
      }
      return $null
    } finally {
      $env:Path = $previous
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

  function Get-RuntimeVersion([string]$Launcher) {
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

  function Get-InstalledVersion([string]$Dir) {
    if (-not (Test-Path -LiteralPath $Dir)) { return $null }
    $launcher = Join-Path $Dir 'zoveli.cmd'
    if (Test-Path -LiteralPath $launcher) {
      $result = Get-RuntimeVersion $launcher
      if ($result.Code -eq 0 -and $result.Text -match '^zoveli\s+(\S+)') {
        return $Matches[1]
      }
    }
    $metadata = Get-InstallMetadata $Dir
    if ($metadata -and $metadata.version) { return [string]$metadata.version }
    $manifest = Join-Path $Dir 'runtime.json'
    if (Test-Path -LiteralPath $manifest) {
      try {
        $runtime = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
        if ($runtime.version) { return [string]$runtime.version }
      } catch { }
    }
    return $null
  }

  function Get-InstallMetadata([string]$Dir) {
    $path = Join-Path $Dir 'install.json'
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try {
      return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
    } catch {
      return $null
    }
  }

  function Get-InstallMethod([string]$Dir) {
    if (-not (Test-Path -LiteralPath $Dir)) { return 'none' }
    $metadata = Get-InstallMetadata $Dir
    if ($metadata -and [string]$metadata.installer -eq 'install.ps1') { return 'powershell' }
    if (Test-Path -LiteralPath (Join-Path $Dir 'unins000.exe')) { return 'inno' }
    if (-not (Test-Path -LiteralPath (Join-Path $Dir 'runtime.json'))) {
      if (-not (Get-ChildItem -LiteralPath $Dir -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
        return 'none'
      }
      return 'unknown'
    }
    $uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    if (Test-Path $uninstallRoot) {
      foreach ($key in (Get-ChildItem $uninstallRoot -ErrorAction SilentlyContinue)) {
        $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
        if ($props -and $props.DisplayName -like 'Zoveli*' -and $props.InstallLocation) {
          try {
            if ([string]::Equals((Normalize-Dir $props.InstallLocation), $Dir, [StringComparison]::OrdinalIgnoreCase)) {
              return 'inno'
            }
          } catch { }
        }
      }
    }
    if ($metadata -and [string]$metadata.installer -eq 'install-zoveli-runtime.ps1') { return 'runtime' }
    return 'runtime'
  }

  function Assert-SafeUrl([string]$Value) {
    $uri = $null
    try { $uri = [System.Uri]$Value } catch { throw "Invalid download URL: $Value" }
    if ($uri.Scheme -ne 'https') { throw "Refusing non-HTTPS URL: $Value" }
    if ($uri.UserInfo) { throw 'Refusing a URL with embedded credentials.' }
    if ($uri.Port -ne 443) { throw "Refusing a URL on a non-HTTPS port: $Value" }
    $allowed = @(
      'github.com',
      'objects.githubusercontent.com',
      'raw.githubusercontent.com',
      'release-assets.githubusercontent.com',
      'github-releases.githubusercontent.com'
    )
    if ($allowed -notcontains $uri.Host.ToLowerInvariant()) {
      throw "Refusing download from unauthorized host: $($uri.Host)"
    }
  }

  function New-SafeHttpClient {
    Add-Type -AssemblyName System.Net.Http
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromMinutes(10)
    return @{ Client = $client; Handler = $handler }
  }

  function Get-SafeText([string]$Value) {
    $http = New-SafeHttpClient
    $client = $http.Client
    $handler = $http.Handler
    try {
      $current = $Value
      for ($hop = 0; $hop -le 5; $hop++) {
        Assert-SafeUrl $current
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $current)
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        try {
          $code = [int]$response.StatusCode
          if ($code -in 301, 302, 303, 307, 308) {
            $location = $response.Headers.Location
            if ($null -eq $location) { throw "Redirect from $current had no Location header." }
            if (-not $location.IsAbsoluteUri) { $location = [System.Uri]::new([System.Uri]$current, $location) }
            $current = $location.AbsoluteUri
            continue
          }
          if ($code -ne 200) { throw "Download failed with HTTP ${code}: $current" }
          $length = $response.Content.Headers.ContentLength
          if ($length -and $length -gt 2097152) { throw "Refusing an unexpectedly large installer download from $current" }
          return $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
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

  function Get-LatestVersion {
    $http = New-SafeHttpClient
    $client = $http.Client
    $handler = $http.Handler
    try {
      $current = "https://github.com/$Repo/releases/latest"
      for ($hop = 0; $hop -le 5; $hop++) {
        Assert-SafeUrl $current
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $current)
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        try {
          $code = [int]$response.StatusCode
          if ($code -in 301, 302, 303, 307, 308) {
            $location = $response.Headers.Location
            if ($null -eq $location) { throw "Redirect from $current had no Location header." }
            if (-not $location.IsAbsoluteUri) { $location = [System.Uri]::new([System.Uri]$current, $location) }
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
    $http = New-SafeHttpClient
    $client = $http.Client
    $handler = $http.Handler
    try {
      $current = $Value
      for ($hop = 0; $hop -le 5; $hop++) {
        Assert-SafeUrl $current
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $current)
        $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        try {
          $code = [int]$response.StatusCode
          if ($code -in 301, 302, 303, 307, 308) {
            $location = $response.Headers.Location
            if ($null -eq $location) { throw "Redirect from $current had no Location header." }
            if (-not $location.IsAbsoluteUri) { $location = [System.Uri]::new([System.Uri]$current, $location) }
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

  function Get-ArchiveInfo([string]$Path) {
    $name = [System.IO.Path]::GetFileName($Path)
    if ($name -match '^zoveli-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-windows-(x64|arm64)\.tar\.gz$') {
      return @{ Version = $Matches[1]; Arch = $Matches[2] }
    }
    return $null
  }

  function Assert-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
      Fail "Missing required command: $Name. $Hint"
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
    $productName = $null
    try {
      $productName = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name ProductName -ErrorAction SilentlyContinue).ProductName
    } catch { }
    if ($productName -and $productName -match 'Server') {
      Write-Warn "Windows Server detected ($productName). Windows 10 and 11 are the supported client targets; continuing with the CI-compatible path."
    }
    Assert-Command 'tar.exe' 'Windows 10 1809 and later include tar.exe. Update Windows or use the Docker fallback.'
  }

  function Get-HostArch {
    $value = $null
    try {
      $value = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    } catch { }
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

  function Get-ReleaseAssetUrl([string]$TargetVersion, [string]$HostArch) {
    return "https://github.com/$Repo/releases/download/v$TargetVersion/zoveli-$TargetVersion-windows-$HostArch.tar.gz"
  }

  function Assert-ReleaseAsset([string]$TargetVersion, [string]$HostArch, [bool]$ReportOnly) {
    $url = Get-ReleaseAssetUrl $TargetVersion $HostArch
    try {
      $exists = Test-RemoteAsset $url
    } catch {
      if ($ReportOnly) { return 'unknown' }
      throw
    }
    if (-not $exists) {
      if ($HostArch -eq 'arm64') {
        $message = "Release v$TargetVersion does not publish a windows-arm64 archive. This release does not support Windows on ARM natively. Do not guess or install the x64 archive automatically. Install a release that includes the ARM64 archive, or explicitly use the x64 archive with -Archive and -Force only if you accept emulation. See https://github.com/$Repo/releases/tag/v$TargetVersion"
      } else {
        $message = "Release v$TargetVersion does not publish a windows-$HostArch archive. Check the release assets or pass -Version or -Archive. See https://github.com/$Repo/releases/tag/v$TargetVersion"
      }
      if ($ReportOnly) { return $false }
      Fail $message
    }
    if (-not $NoVerify) {
      try {
        $checksum = Test-RemoteAsset "$url.sha256"
      } catch {
        if ($ReportOnly) { return 'unknown' }
        throw
      }
      if (-not $checksum) {
        $message = "Release v$TargetVersion publishes the archive but not its .sha256 checksum. Use -NoVerify only if you trust the archive, or pick another release."
        if ($ReportOnly) { return $false }
        Fail $message
      }
    }
    return $true
  }

  function Get-RuntimeInstallerText {
    if ($RuntimeInstaller) {
      if ($RuntimeInstaller -match '^https?://') {
        Write-Info 'Downloading the Zoveli runtime installer...'
        return Get-SafeText $RuntimeInstaller
      }
      if (-not (Test-Path -LiteralPath $RuntimeInstaller)) {
        Fail "Runtime installer not found: $RuntimeInstaller"
      }
      return Get-Content -LiteralPath $RuntimeInstaller -Raw -Encoding UTF8
    }
    if ($PSScriptRoot) {
      $sibling = Join-Path $PSScriptRoot 'install-zoveli-runtime.ps1'
      if (Test-Path -LiteralPath $sibling) {
        return Get-Content -LiteralPath $sibling -Raw -Encoding UTF8
      }
    }
    $url = "https://raw.githubusercontent.com/$Repo/$Branch/install/install-zoveli-runtime.ps1"
    Write-Info 'Downloading the Zoveli runtime installer...'
    return Get-SafeText $url
  }

  function Invoke-RuntimeInstaller([string]$Text, [hashtable]$Arguments) {
    $hadPrevious = Test-Path Env:\ZOVELI_INSTALLER_INPROCESS
    $previous = $env:ZOVELI_INSTALLER_INPROCESS
    try {
      $block = [scriptblock]::Create($Text)
      $env:ZOVELI_INSTALLER_INPROCESS = '1'
      & $block @Arguments
    } finally {
      if ($hadPrevious) {
        $env:ZOVELI_INSTALLER_INPROCESS = $previous
      } else {
        Remove-Item Env:\ZOVELI_INSTALLER_INPROCESS -ErrorAction SilentlyContinue
      }
    }
  }

  function Write-InstallMetadata([string]$Dir, [string]$TargetVersion, [string]$HostArch, [bool]$PathAdded, [string]$Source) {
    if ([string]::IsNullOrWhiteSpace($TargetVersion)) { return }
    try {
      $installedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
      $metadata = [ordered]@{
        schema = 1
        version = $TargetVersion
        installedAt = $installedAt
        method = 'runtime'
        installer = 'install.ps1'
        dir = $Dir
        platform = 'windows'
        arch = $HostArch
        pathAdded = $PathAdded
        source = $Source
        releaseTag = "v$TargetVersion"
      }
      $json = $metadata | ConvertTo-Json -Depth 4
      $temp = Join-Path $Dir ('.install.json.' + [guid]::NewGuid().ToString('N'))
      try {
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($temp, $json + [Environment]::NewLine, $utf8)
        Move-Item -LiteralPath $temp -Destination (Join-Path $Dir 'install.json') -Force
      } finally {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Write-Warn "Could not write install metadata to $Dir`: $($_.Exception.Message)"
    }
  }

  function Invoke-Doctor {
    $launcher = Join-Path $TargetDir 'zoveli.cmd'
    if (-not (Test-Path -LiteralPath $launcher)) { return }
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $help = & $launcher --help 2>&1 | Out-String
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    if ($help -notmatch 'doctor') {
      Write-Info "This runtime predates 'zoveli doctor'; diagnostics arrive in a newer release."
      return
    }
    & $launcher doctor --offline
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "Installed, but 'zoveli doctor' reported problems."
      Write-Warn "Run '$launcher doctor' for the full report."
    }
  }

  function Show-Done([string]$TargetVersion, [bool]$PathAdded) {
    $launcher = Join-Path $TargetDir 'zoveli.cmd'
    $installerUrl = "https://raw.githubusercontent.com/$Repo/$Branch/install/install.ps1"
    Write-Host ''
    Write-Host "Zoveli $TargetVersion is ready."
    if ($PathAdded -or (Test-UserPathEntry $TargetDir)) {
      Write-Host 'Open a new terminal, then run:'
      Write-Host '  zoveli'
    } else {
      Write-Host 'Run:'
      Write-Host "  $launcher"
      Write-Host ''
      Write-Host "To run 'zoveli' from any new terminal, re-run with -AddToPath."
    }
    Write-Host ''
    Write-Host 'Diagnose:'
    Write-Host "  $launcher doctor"
    Write-Host 'Upgrade:'
    Write-Host '  re-run this installer (or: zoveli update)'
    Write-Host 'Uninstall (keeps %USERPROFILE%\.zoveli):'
    Write-Host "  & ([scriptblock]::Create((irm $installerUrl))) -Uninstall -Yes"
    Write-Host 'Add -Purge to delete the vault and backups as well.'
  }

  function Confirm-Destructive([string]$Message) {
    if ($Yes) { return }
    if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
      $answer = Read-Host "$Message [y/N]"
      if ($answer -notmatch '^(y|yes)$') { Fail 'Aborted.' }
      return
    }
    Fail 'Refusing to continue without -Yes when the console is not interactive.'
  }

  function Remove-StateDir {
    if (-not (Test-Path -LiteralPath $StateDir)) {
      Write-Info "No state directory at $StateDir."
      return
    }
    if (Test-ReparsePoint $StateDir) {
      Fail "Refusing to purge a reparse point or junction: $StateDir"
    }
    Confirm-Destructive "Delete the vault, backups and configuration under $StateDir? This cannot be undone."
    try {
      Remove-Item -LiteralPath $StateDir -Recurse -Force
    } catch {
      Fail "Could not delete $StateDir. Close Zoveli and retry. $($_.Exception.Message)"
    }
    Write-Info "Purged $StateDir"
  }

  function Invoke-Uninstall {
    $metadata = $null
    if (Test-Path -LiteralPath $TargetDir) { $metadata = Get-InstallMetadata $TargetDir }
    if (Test-Path -LiteralPath $TargetDir) {
      $method = Get-InstallMethod $TargetDir
      if ($method -eq 'inno' -and -not $Force) {
        Fail "Refusing to remove an installation created by the unsigned .exe installer. Uninstall Zoveli from Settings > Apps first (the vault is preserved), then install with this one-command installer."
      }
      if ($method -eq 'unknown' -and -not $Force) {
        Fail "Refusing to remove $TargetDir`: it does not look like a Zoveli install (use -Force)."
      }
      if (Test-ReparsePoint $TargetDir) {
        Fail "Refusing to remove a reparse point or junction: $TargetDir"
      }
      Confirm-Destructive "Remove Zoveli from $TargetDir? The vault under $StateDir is preserved."
      try {
        Remove-Item -LiteralPath $TargetDir -Recurse -Force
      } catch {
        Fail "Could not remove $TargetDir. Close Zoveli and any terminal using it, then retry. $($_.Exception.Message)"
      }
      Write-Info "Removed $TargetDir"
    } else {
      Write-Info "No Zoveli runtime found at $TargetDir."
    }

    $pathAdded = $false
    if ($metadata -and $metadata.pathAdded) { $pathAdded = $true }
    if ($pathAdded) {
      try {
        if (Remove-UserPath $TargetDir) {
          try { Send-EnvironmentChange } catch { }
          Write-Info 'Removed the install directory from your user PATH.'
        } else {
          Write-Warn 'The install directory was not on your user PATH; nothing to remove.'
        }
      } catch {
        Write-Warn "Could not remove the install directory from your user PATH: $($_.Exception.Message)"
      }
    } elseif (Test-UserPathEntry $TargetDir) {
      Write-Warn "The install directory is on your user PATH, but this installer did not record adding it. Leaving the entry in place."
    }

    if ($Purge) {
      Remove-StateDir
    } else {
      Write-Info "Preserved vault and state under $StateDir."
      Write-Info 'Use -Purge to delete them as well.'
    }
  }

  function Invoke-Check([string]$HostArch) {
    $installed = Get-InstalledVersion $TargetDir
    $method = Get-InstallMethod $TargetDir
    $onPath = Test-UserPathEntry $TargetDir
    Write-Host "Install directory: $TargetDir"
    if ($installed) { Write-Host "Installed: Zoveli $installed" } else { Write-Host 'Installed: none' }
    if ($TargetVersion) { Write-Host "Target: Zoveli $TargetVersion" } else { Write-Host 'Target: unknown' }
    Write-Host "State: $StateDir"
    Write-Host "Platform: windows-$HostArch"
    Write-Host "Install method: $method"
    if ($onPath) { Write-Host 'User PATH: install directory is present' } else { Write-Host 'User PATH: install directory is not present' }
    if ($Archive) {
      Write-Host "Archive: $ArchivePath"
    } elseif ($TargetVersion -and -not $Url) {
      $asset = Assert-ReleaseAsset $TargetVersion $HostArch $true
      if ($asset -eq $true) {
        Write-Host "Release asset: zoveli-$TargetVersion-windows-$HostArch.tar.gz is available"
      } elseif ($asset -eq $false) {
        Write-Host "Release asset: zoveli-$TargetVersion-windows-$HostArch.tar.gz is NOT available for this release"
      } else {
        Write-Host 'Release asset: could not be verified (network or GitHub error)'
      }
    } elseif ($Url) {
      Write-Host "Runtime URL: $Url"
    }
    if ($installed -and $TargetVersion) {
      $comparison = Compare-Version $installed $TargetVersion
      if ($comparison -lt 0) {
        Write-Info "Update available: Zoveli $installed -> $TargetVersion"
      } elseif ($comparison -gt 0) {
        Write-Info "Installed Zoveli $installed is newer than target $TargetVersion"
      } else {
        Write-Info "Zoveli $installed is up to date"
      }
    }
  }

  # Normalize and validate the target before any network work.
  $StateDir = Get-StateDir
  if ([string]::IsNullOrWhiteSpace($Dir)) { $Dir = Join-Path (Get-LocalAppDataDir) 'Zoveli' }
  $TargetDir = Normalize-Dir $Dir
  Assert-SafeTarget $TargetDir $StateDir

  if ($Purge) { $Uninstall = $true }
  if ($Uninstall -and $Check) { Fail '-Uninstall and -Check cannot be combined.' }
  if ($Uninstall -and $ExplicitInstallArgs) { Fail '-Uninstall cannot be combined with -Version, -Archive, or -Url.' }
  if ($Uninstall -and $AddToPath) { Fail '-Uninstall cannot be combined with -AddToPath.' }

  if ($Uninstall) {
    Invoke-Uninstall
    return
  }

  Assert-WindowsHost
  $HostArch = Get-HostArch
  $ArchivePath = ''
  $ArchiveInfo = $null
  $TargetVersion = ''

  if ($Archive) {
    if (-not (Test-Path -LiteralPath $Archive)) { Fail "Archive not found: $Archive" }
    $ArchivePath = (Resolve-Path -LiteralPath $Archive).Path
    $ArchiveInfo = Get-ArchiveInfo $ArchivePath
    if ($null -eq $ArchiveInfo) {
      # A renamed local archive is allowed; runtime.json is authoritative and
      # the runtime installer verifies it after the checksum passes.
      Write-Warn "Could not read the version and architecture from the archive name: $ArchivePath. They will be checked after extraction."
      if ($Version) { $TargetVersion = $Version.Trim().TrimStart('v') }
    } else {
      $TargetVersion = $ArchiveInfo.Version
      if ($Version) {
        $requested = $Version.Trim().TrimStart('v')
        if ($requested -ne $TargetVersion) {
          Fail "Archive version $TargetVersion does not match requested version $requested."
        }
      }
      if ($ArchiveInfo.Arch -ne $HostArch -and -not $Force) {
        Fail "Archive is for windows-$($ArchiveInfo.Arch), but this machine is windows-$HostArch. Pass -Force only if you accept emulation."
      }
    }
    if (-not $NoVerify -and -not (Test-Path -LiteralPath "$ArchivePath.sha256")) {
      Fail "Checksum file not found: $ArchivePath.sha256. Use -NoVerify only for a trusted archive."
    }
  } elseif ($Version) {
    $TargetVersion = $Version.Trim().TrimStart('v')
    if (-not $TargetVersion) { Fail '-Version requires a value.' }
  }

  if (-not $Check -and -not $Archive -and -not $Url) {
    if (-not $TargetVersion) {
      Write-Info 'Resolving the latest Zoveli release...'
      $TargetVersion = Get-LatestVersion
    }
    Assert-ReleaseAsset $TargetVersion $HostArch $false | Out-Null
  } elseif ($Check -and -not $TargetVersion -and -not $Archive) {
    Write-Info 'Resolving the latest Zoveli release...'
    $TargetVersion = Get-LatestVersion
  }

  $installed = Get-InstalledVersion $TargetDir
  $installMethod = Get-InstallMethod $TargetDir
  if ($installMethod -eq 'inno' -and -not $Force -and -not $Check) {
    Fail "An existing Zoveli installation was created by the unsigned .exe installer. Uninstall it from Settings > Apps first (the vault is preserved), then run this one-command installer."
  }
  if ($installMethod -eq 'unknown' -and -not $Force) {
    Fail "$TargetDir exists but does not look like a Zoveli install. Use -Dir or -Force."
  }

  if ($Check) {
    Invoke-Check $HostArch
    return
  }

  $installVerb = 'Install'
  if ($installed -and $TargetVersion) {
    $comparison = Compare-Version $installed $TargetVersion
    if ($comparison -lt 0) {
      $installVerb = 'Upgrade'
      Write-Info "Upgrading Zoveli $installed -> $TargetVersion"
    } elseif ($comparison -gt 0) {
      if ($Version -or $Archive -or $Url) {
        if (-not $Force) {
          Fail "Installed Zoveli $installed is newer than target $TargetVersion. Pass -Force to downgrade."
        }
        $installVerb = 'Downgrade'
        Write-Warn "Downgrading Zoveli $installed -> $TargetVersion"
      } else {
        Write-Info "Installed Zoveli $installed is newer than the latest published release $TargetVersion; no action taken."
        Invoke-Doctor
        Show-Done $installed $false
        return
      }
    } elseif ($Force) {
      Write-Info "Reinstalling Zoveli $installed"
      $installVerb = 'Reinstall'
    } else {
      Write-Info "Zoveli $installed is already installed in $TargetDir."
      $metadata = Get-InstallMetadata $TargetDir
      $previousPathAdded = $false
      if ($metadata -and $metadata.pathAdded) { $previousPathAdded = $true }
      $pathAdded = $previousPathAdded
      if ($AddToPath) {
        try {
          if (Add-UserPath $TargetDir) {
            try { Send-EnvironmentChange } catch { }
            $pathAdded = $true
            Write-Info "Added $TargetDir to your user PATH."
          } else {
            Write-Info "$TargetDir is already on your user PATH."
          }
        } catch {
          Write-Warn "Could not add $TargetDir to your user PATH: $($_.Exception.Message)"
        }
      }
      if ($installed) {
        Write-InstallMetadata $TargetDir $installed $HostArch $pathAdded 'release'
        Invoke-Doctor
        Show-Done $installed $pathAdded
      }
      return
    }
  } elseif (-not $installed) {
    if ($TargetVersion) {
      Write-Info "Installing Zoveli $TargetVersion into $TargetDir"
    } else {
      Write-Info "Installing Zoveli into $TargetDir"
    }
  }

  if (-not $TargetVersion -and -not $ArchivePath) { Fail 'Could not determine the version to install.' }

  $runtimeText = Get-RuntimeInstallerText
  $runtimeArgs = @{ Dir = $TargetDir; Yes = $true }
  if ($TargetVersion) { $runtimeArgs.Version = $TargetVersion }
  if ($ArchivePath) { $runtimeArgs.Archive = $ArchivePath }
  if ($Url) { $runtimeArgs.Url = $Url }
  if ($NoVerify) { $runtimeArgs.NoVerify = $true }
  if ($Force) { $runtimeArgs.Force = $true }
  if ($SkipBackup) { $runtimeArgs.SkipBackup = $true }
  if ($Unblock) { $runtimeArgs.Unblock = $true }

  try {
    Invoke-RuntimeInstaller $runtimeText $runtimeArgs
  } catch {
    Fail "Zoveli runtime installation failed: $($_.Exception.Message)"
  }

  $installed = Get-InstalledVersion $TargetDir
  if (-not $installed) {
    Fail "The runtime installer finished but no Zoveli launcher was found in $TargetDir."
  }
  if ($TargetVersion -and (Compare-Version $installed $TargetVersion) -ne 0) {
    Write-Warn "Installed version $installed differs from the requested version $TargetVersion."
  }

  $metadata = Get-InstallMetadata $TargetDir
  $previousPathAdded = $false
  if ($metadata -and $metadata.pathAdded) { $previousPathAdded = $true }
  $pathAdded = $previousPathAdded
  if ($AddToPath) {
    try {
      if (Add-UserPath $TargetDir) {
        try { Send-EnvironmentChange } catch { }
        $pathAdded = $true
        Write-Info "Added $TargetDir to your user PATH."
      } else {
        Write-Info "$TargetDir is already on your user PATH."
      }
      $shadow = Get-ShadowingLauncher $TargetDir
      if ($shadow) {
        Write-Warn "Another 'zoveli' command resolves earlier on the user PATH: $shadow"
        Write-Warn 'Remove it or reorder PATH if you want this install to win.'
      }
      if (-not (Test-LauncherOnPath $TargetDir)) {
        Write-Warn 'The launcher was not discoverable in this process; open a new terminal to pick up the PATH change.'
      }
    } catch {
      Write-Warn "Could not add $TargetDir to your user PATH: $($_.Exception.Message)"
    }
  }

  $source = $(if ($ArchivePath) { 'archive' } elseif ($Url) { 'url' } else { 'release' })
  Write-InstallMetadata $TargetDir $installed $HostArch $pathAdded $source
  Invoke-Doctor
  Show-Done $installed $pathAdded
}
