#Requires -Version 5.1
<#
.SYNOPSIS
  Sign a Windows release artifact with an Authenticode certificate.
.DESCRIPTION
  Reads WINDOWS_CERTIFICATE_BASE64 and WINDOWS_CERTIFICATE_PASSWORD, imports
  the .pfx into a temporary file, signs with SHA-256 and an RFC 3161 timestamp,
  then verifies the signature. Release-only: secrets are required.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Description = 'Zoveli runtime installer'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Path)) { throw "artifact not found: $Path" }
if (-not $env:WINDOWS_CERTIFICATE_BASE64) { throw 'WINDOWS_CERTIFICATE_BASE64 is required' }
if (-not $env:WINDOWS_CERTIFICATE_PASSWORD) { throw 'WINDOWS_CERTIFICATE_PASSWORD is required' }

function Find-SignTool {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }
  $roots = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'),
    (Join-Path $env:ProgramFiles 'Windows Kits\10\bin')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  foreach ($root in $roots) {
    $candidate = Get-ChildItem -LiteralPath $root -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }
  throw 'signtool.exe was not found (install the Windows SDK)'
}

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('zoveli-sign-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
$pfx = Join-Path $temp 'certificate.pfx'
try {
  [System.IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_BASE64))
  $signtool = Find-SignTool
  & $signtool sign /fd SHA256 /tr 'http://timestamp.digicert.com' /td SHA256 `
    /f $pfx /p $env:WINDOWS_CERTIFICATE_PASSWORD /d $Description $Path
  if ($LASTEXITCODE -ne 0) { throw "signtool sign exited with $LASTEXITCODE" }
  & $signtool verify /pa /v $Path
  if ($LASTEXITCODE -ne 0) { throw "signtool verify exited with $LASTEXITCODE" }
  Write-Output "signed and verified $Path"
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
