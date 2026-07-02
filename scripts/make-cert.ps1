#requires -Version 5.1
<#
.SYNOPSIS
  Create a local "The Corner Spore" code-signing certificate, issued by a self-signed
  Corner Spore Root CA, for signing MCP Command Center builds on machines you control.

.DESCRIPTION
  Generates a two-tier chain:
    The Corner Spore Root CA   (self-signed, 10y, CA=true)
      └─ The Corner Spore Code Signing  (3y, EKU = Code Signing), signed by the CA

  Exports to .\certs:
    tcs-root-ca.cer          public root cert        -> distribute + trust on your machines
    tcs-code-signing.cer     public leaf cert        -> add to Trusted Publishers (optional)
    tcs-code-signing.pfx     leaf + private key      -> SECRET, used to sign builds
    tcs-code-signing.pfx.b64 base64 of the .pfx       -> SECRET, for CI (CSC_LINK)

  Signing works regardless of trust. Trust only decides whether a machine *accepts*
  the signature without warnings: import tcs-root-ca.cer into Trusted Root on each
  target machine (locally, or org-wide via Group Policy / Intune).

  This earns trust only on machines you control. It does NOT make the public trust the
  app, and it does nothing for macOS Gatekeeper (which needs an Apple Developer ID).

.PARAMETER OutDir
  Where to write the cert files. Default: <repo>\certs (gitignored).

.PARAMETER Password
  Password for the .pfx. If omitted you'll be prompted securely.

.PARAMETER Trust
  Also import the root CA into LocalMachine Trusted Root + Trusted Publishers so THIS
  machine trusts the signature. Requires an elevated (Administrator) PowerShell.

.EXAMPLE
  pwsh ./scripts/make-cert.ps1
  # then, to sign a build:
  $env:CSC_LINK = (Resolve-Path ./certs/tcs-code-signing.pfx)
  $env:CSC_KEY_PASSWORD = '<your password>'
  npm run dist:win
#>
[CmdletBinding()]
param(
  [string]$OutDir = (Join-Path $PSScriptRoot '..\certs'),
  [string]$Password,
  [switch]$Trust
)

$ErrorActionPreference = 'Stop'

if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
  Write-Error 'Windows code-signing certs can only be created on Windows (uses the Windows cert store).'
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

if (-not $Password) {
  $secure = Read-Host 'Choose a password for the .pfx' -AsSecureString
} else {
  $secure = ConvertTo-SecureString $Password -AsPlainText -Force
}

$subjectSuffix = 'O=The Corner Spore, DC=thecornerspore, DC=dev'

# Idempotent: clear ONLY the exact certs this script creates from a previous run, so
# signtool never sees duplicate subjects. Match the full CN (NOT a substring of the org
# name) so we never touch unrelated certificates that merely contain "The Corner Spore".
$mineCN = @('CN=The Corner Spore Root CA,', 'CN=The Corner Spore Code Signing,')
Get-ChildItem 'Cert:\CurrentUser\My' |
  Where-Object { $s = $_.Subject; $mineCN | Where-Object { $s -like ($_ + '*') } } |
  Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host '==> Creating Corner Spore Root CA...' -ForegroundColor Cyan
$ca = New-SelfSignedCertificate `
  -Type Custom `
  -Subject "CN=The Corner Spore Root CA, $subjectSuffix" `
  -FriendlyName 'The Corner Spore Root CA' `
  -KeyExportPolicy Exportable `
  -KeyUsage CertSign, CRLSign `
  -KeyAlgorithm RSA -KeyLength 4096 -HashAlgorithm SHA256 `
  -NotAfter (Get-Date).AddYears(10) `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -TextExtension @('2.5.29.19={critical}{text}CA=true&pathlength=0')

Write-Host '==> Creating Corner Spore Code Signing cert (signed by the CA)...' -ForegroundColor Cyan
$leaf = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=The Corner Spore Code Signing, $subjectSuffix" `
  -FriendlyName 'The Corner Spore Code Signing' `
  -KeyExportPolicy Exportable `
  -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
  -NotAfter (Get-Date).AddYears(3) `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -Signer $ca

$rootCer = Join-Path $OutDir 'tcs-root-ca.cer'
$leafCer = Join-Path $OutDir 'tcs-code-signing.cer'
$leafPfx = Join-Path $OutDir 'tcs-code-signing.pfx'

Export-Certificate -Cert $ca -FilePath $rootCer | Out-Null
Export-Certificate -Cert $leaf -FilePath $leafCer | Out-Null
Export-PfxCertificate -Cert $leaf -FilePath $leafPfx -Password $secure -ChainOption EndEntityCertOnly | Out-Null

# base64 of the pfx, handy for the CSC_LINK GitHub secret
[Convert]::ToBase64String([IO.File]::ReadAllBytes($leafPfx)) | Set-Content -Path "$leafPfx.b64" -NoNewline

# Signing uses the .pfx FILE, not the store. Remove the store copies so signtool never
# finds two certs with the same subject. The public root.cer is kept for trust install.
Remove-Item -Path ("Cert:\CurrentUser\My\" + $leaf.Thumbprint) -Force -ErrorAction SilentlyContinue
Remove-Item -Path ("Cert:\CurrentUser\My\" + $ca.Thumbprint) -Force -ErrorAction SilentlyContinue

if ($Trust) {
  Write-Host '==> Installing root CA into LocalMachine trust stores (needs admin)...' -ForegroundColor Yellow
  Import-Certificate -FilePath $rootCer -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
  Import-Certificate -FilePath $leafCer -CertStoreLocation 'Cert:\LocalMachine\TrustedPublisher' | Out-Null
  Write-Host '    Trusted on this machine.' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Done. Files in:' $OutDir -ForegroundColor Green
Write-Host ('  thumbprint (leaf): ' + $leaf.Thumbprint)
Write-Host ''
Write-Host 'To sign a build:' -ForegroundColor Cyan
Write-Host "  `$env:CSC_LINK = '$leafPfx'"
Write-Host "  `$env:CSC_KEY_PASSWORD = '<your password>'"
Write-Host '  npm run dist:win'
Write-Host ''
Write-Host 'To trust the signature on another machine you control:' -ForegroundColor Cyan
Write-Host "  Import-Certificate -FilePath tcs-root-ca.cer -CertStoreLocation Cert:\LocalMachine\Root  (as admin)"
Write-Host ''
Write-Host 'NOTE: certs/ is gitignored. NEVER commit the .pfx or .b64 (they contain the private key).' -ForegroundColor Yellow
