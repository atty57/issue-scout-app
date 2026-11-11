param(
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$ExpectedPublisher,
  [string]$SigningConfig
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scoutProject = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $scoutProject
try {
  $scoutBuilderArgs = @('node_modules/electron-builder/cli.js', '--win', 'nsis', '--x64', '--publish', 'never')
  if ($SigningConfig) {
    $scoutConfigPath = (Resolve-Path -LiteralPath $SigningConfig).Path
    $scoutBuilderArgs += @('--config', $scoutConfigPath)
  }
  # Enforce these after any supplied configuration. Builds never upload artifacts.
  $scoutBuilderArgs += @('-c.forceCodeSigning=true', '-c.directories.output=release-signed')
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) { throw 'Tests failed; signing was not attempted.' }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Production build failed; signing was not attempted.' }
  & node @scoutBuilderArgs
  if ($LASTEXITCODE -ne 0) { throw 'Signed packaging failed. No release was published.' }
  & (Join-Path $PSScriptRoot 'verify-windows-release.ps1') -ArtifactDirectory 'release-signed' -ExpectedPublisher $ExpectedPublisher
} finally { Pop-Location }
