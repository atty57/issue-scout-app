param(
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$ExpectedPublisher,
  [string]$ArtifactDirectory = 'release-signed',
  [string]$InstalledDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scoutProject = Split-Path -Parent $PSScriptRoot
$scoutMetadata = Get-Content -LiteralPath (Join-Path $scoutProject 'package.json') -Raw | ConvertFrom-Json
$scoutArtifactRoot = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$scoutInstallerName = 'Issue-Scout-Setup-' + $scoutMetadata.version + '-x64.exe'
$scoutRequired = @(
  $scoutInstallerName,
  'win-unpacked\Issue Scout.exe',
  'win-unpacked\resources\elevate.exe'
)
$scoutVerified = foreach ($scoutRelative in $scoutRequired) {
  $scoutFile = Join-Path $scoutArtifactRoot $scoutRelative
  if (-not (Test-Path -LiteralPath $scoutFile -PathType Leaf)) { throw "Missing release file: $scoutRelative" }
  $scoutSignature = Get-AuthenticodeSignature -LiteralPath $scoutFile
  if ($scoutSignature.Status -ne 'Valid') { throw "Invalid or missing signature on $scoutRelative ($($scoutSignature.Status))." }
  $scoutPublisher = $scoutSignature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if (-not [string]::Equals($scoutPublisher, $ExpectedPublisher, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected publisher on $scoutRelative." }
  if ($null -eq $scoutSignature.TimeStamperCertificate) { throw "Missing trusted timestamp on $scoutRelative." }
  [pscustomobject]@{
    file = $scoutRelative.Replace('\', '/')
    sha256 = (Get-FileHash -LiteralPath $scoutFile -Algorithm SHA256).Hash.ToLowerInvariant()
    publisher = $scoutPublisher
    signerThumbprint = $scoutSignature.SignerCertificate.Thumbprint
    timestampThumbprint = $scoutSignature.TimeStamperCertificate.Thumbprint
  }
}
if (-not $InstalledDirectory) {
  Write-Output 'Verified the signed installer, app and elevate.exe. Install this build in a test environment, then rerun with -InstalledDirectory to verify its embedded uninstaller. No release manifest created yet.'
  return
}
$scoutUninstaller = Join-Path (Resolve-Path -LiteralPath $InstalledDirectory).Path 'Uninstall Issue Scout.exe'
$scoutUninstallSignature = Get-AuthenticodeSignature -LiteralPath $scoutUninstaller
if ($scoutUninstallSignature.Status -ne 'Valid' -or $null -eq $scoutUninstallSignature.TimeStamperCertificate) { throw 'The installed uninstaller is not validly signed and timestamped.' }
$scoutUninstallPublisher = $scoutUninstallSignature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
if (-not [string]::Equals($scoutUninstallPublisher, $ExpectedPublisher, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected uninstaller publisher.' }
$scoutInstalledArchive = Join-Path $InstalledDirectory 'resources\app.asar'
$scoutPackagedArchive = Join-Path $scoutArtifactRoot 'win-unpacked\resources\app.asar'
if ((Get-FileHash -LiteralPath $scoutInstalledArchive).Hash -ne (Get-FileHash -LiteralPath $scoutPackagedArchive).Hash) { throw 'Installed app does not match the release package.' }
$scoutVerified += [pscustomobject]@{
  file = 'installed/Uninstall Issue Scout.exe'
  sha256 = (Get-FileHash -LiteralPath $scoutUninstaller -Algorithm SHA256).Hash.ToLowerInvariant()
  publisher = $scoutUninstallPublisher
  signerThumbprint = $scoutUninstallSignature.SignerCertificate.Thumbprint
  timestampThumbprint = $scoutUninstallSignature.TimeStamperCertificate.Thumbprint
}
# Only a fully verified set receives a manifest and download checksum.
$scoutManifest = [pscustomobject]@{ version = $scoutMetadata.version; verifiedAt = [DateTime]::UtcNow.ToString('o'); files = @($scoutVerified) }
$scoutManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $scoutArtifactRoot 'release-manifest.json') -Encoding utf8
($scoutVerified[0].sha256 + '  ' + $scoutInstallerName) | Set-Content -LiteralPath (Join-Path $scoutArtifactRoot 'SHA256SUMS.txt') -Encoding ascii
Write-Output "Verified all four signed release files for $ExpectedPublisher. No files uploaded."
