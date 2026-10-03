<#
  unblock-release.ps1 — FORCH.iA WinOptimizer

  Removes the "mark of the web" (Zone.Identifier) from downloaded release
  binaries so Windows SmartScreen does not show

      "Windows protected your PC — unrecognized app"

  This is the FREE path for INTERNAL use (your own PCs). It is NOT a substitute
  for a code-signing certificate when distributing to third parties — see
  docs/CODE_SIGNING.md.

  Usage:
      powershell -ExecutionPolicy Bypass -File .\scripts\unblock-release.ps1
      powershell -ExecutionPolicy Bypass -File .\scripts\unblock-release.ps1 -Path "D:\installers"
#>
[CmdletBinding()]
param(
  [string]$Path = (Join-Path $env:USERPROFILE 'Downloads')
)

$ErrorActionPreference = 'Stop'

Write-Host 'FORCH.iA WinOptimizer - unblock downloaded binaries'
Write-Host ''

if (-not (Test-Path -LiteralPath $Path)) {
  Write-Host "Path not found: $Path" -ForegroundColor Red
  exit 1
}

$target = Get-Item -LiteralPath $Path

if ($target.PSIsContainer) {
  $files = @(Get-ChildItem -LiteralPath $Path -Filter 'FORCH.iA-WinOptimizer-*.exe' -File -ErrorAction SilentlyContinue)
} else {
  $files = @($target)
}

if ($files.Count -eq 0) {
  Write-Host "No FORCH.iA-WinOptimizer-*.exe found in: $Path" -ForegroundColor Yellow
  Write-Host 'Download a release first, then run this script again.'
  exit 0
}

$marked = 0
$cleared = 0

foreach ($file in $files) {
  $before = Get-Item -LiteralPath $file.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue
  if ($null -eq $before) {
    Write-Host ("  [skip]      no internet mark : {0}" -f $file.Name)
    continue
  }

  $marked++
  Unblock-File -LiteralPath $file.FullName

  $after = Get-Item -LiteralPath $file.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue
  if ($null -eq $after) {
    $cleared++
    Write-Host ("  [unblocked] {0}" -f $file.Name) -ForegroundColor Green
  } else {
    Write-Host ("  [FAILED]    {0} (mark still present)" -f $file.Name) -ForegroundColor Red
  }
}

Write-Host ''
Write-Host ("Files with internet mark: {0} | unblocked: {1} | scanned: {2}" -f $marked, $cleared, $files.Count)

if ($marked -gt 0 -and $cleared -eq $marked) {
  Write-Host 'Done. SmartScreen will not warn on the next run of these binaries.' -ForegroundColor Green
}
