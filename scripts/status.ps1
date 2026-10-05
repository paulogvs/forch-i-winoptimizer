<#
  status.ps1 - FORCH.iA WinOptimizer

  One-shot, READ-ONLY status view for the USER (not the dev). It answers, in
  plain words: which portable build do I actually run, is there an NSIS install,
  what is the latest published release, is my copy up to date, and how did the
  security scan go.

  It never elevates, never writes to the system and never runs a mutating
  action. The only thing it may write is the optional -Json report file.

  Usage:
      powershell -ExecutionPolicy Bypass -File .\scripts\status.ps1
      powershell -ExecutionPolicy Bypass -File .\scripts\status.ps1 -Json
      powershell -ExecutionPolicy Bypass -File .\scripts\status.ps1 -Json -OutFile .\status-report.json
      powershell -ExecutionPolicy Bypass -File .\scripts\status.ps1 -SkipSecurityScan

  Notes:
      - The security block reuses the real scanner through
        scripts/security-scan-report.cjs (read-only, ~25 s). If the app was not
        built yet it is skipped with a clear message.
      - requires-admin checks mean "the datum needs elevation"; they are not
        failures and stay out of the score.
      - This script is ASCII-only on purpose (Windows PowerShell 5.1 safe).
#>
[CmdletBinding()]
param(
  [switch]$Json,
  [string]$OutFile,
  [string]$Repo = 'paulogvs/forch-i-winoptimizer',
  [int]$ScanTimeoutSec = 180,
  [switch]$SkipSecurityScan
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StableDir = Join-Path (Join-Path $env:USERPROFILE 'Apps') 'FORCH.iA WinOptimizer'
$StableExe = Join-Path $StableDir 'FORCH.iA WinOptimizer (Portable).exe'
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'FORCH.iA WinOptimizer.lnk'
$NsisDir = Join-Path (Join-Path $env:LOCALAPPDATA 'Programs') 'FORCH.iA WinOptimizer'
$ScanScript = Join-Path $PSScriptRoot 'security-scan-report.cjs'
$ScannerJs = Join-Path $RepoRoot 'dist\main\services\security-scan.js'
$DefaultJsonOut = Join-Path $RepoRoot 'artifacts\status-report.json'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Get-FileVersionString {
  param([Parameter(Mandatory)][string]$Path)
  try {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $v = (Get-Item -LiteralPath $Path -ErrorAction Stop).VersionInfo
    if ($v -and $v.FileVersion) { return ([string]$v.FileVersion).Trim() }
    return $null
  } catch {
    return $null
  }
}

function Get-ShortcutTarget {
  param([Parameter(Mandatory)][string]$Path)
  try {
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($Path)
    return $sc.TargetPath
  } catch {
    return $null
  }
}

function Compare-VersionStrings {
  param([string]$A, [string]$B)
  try {
    $va = [version](([string]$A) -replace '^[vV]', '').Trim()
    $vb = [version](([string]$B) -replace '^[vV]', '').Trim()
    return $va.CompareTo($vb)
  } catch {
    return $null
  }
}

# Runs a scriptblock in a background job with a hard timeout so the script can
# never hang. Falls back to a direct (untimed) call if jobs are unavailable.
function Invoke-WithTimeout {
  param(
    [Parameter(Mandatory)][scriptblock]$ScriptBlock,
    [object[]]$ArgumentList = @(),
    [int]$TimeoutSec = 30
  )
  $result = [ordered]@{ Completed = $false; Output = @() }
  try {
    $job = Start-Job -ScriptBlock $ScriptBlock -ArgumentList $ArgumentList -ErrorAction Stop
  } catch {
    try {
      $result.Output = @(& $ScriptBlock @ArgumentList 2>&1)
    } catch {
      $result.Output = @($_.Exception.Message)
    }
    $result.Completed = $true
    return [pscustomobject]$result
  }
  $done = Wait-Job -Job $job -Timeout $TimeoutSec
  if ($done) {
    $result.Output = @(Receive-Job -Job $job -ErrorAction SilentlyContinue)
    $result.Completed = $true
  } else {
    Stop-Job -Job $job -ErrorAction SilentlyContinue
  }
  Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
  return [pscustomobject]$result
}

function Write-Section {
  param([string]$Title)
  Write-Host ''
  Write-Host ("[{0}]" -f $Title) -ForegroundColor Cyan
}

# ---------------------------------------------------------------------------
# 1. Stable portable
# ---------------------------------------------------------------------------

$portableExists = Test-Path -LiteralPath $StableExe
$portableVersion = if ($portableExists) { Get-FileVersionString -Path $StableExe } else { $null }

$shortcutExists = Test-Path -LiteralPath $ShortcutPath
$shortcutTarget = if ($shortcutExists) { Get-ShortcutTarget -Path $ShortcutPath } else { $null }
$shortcutOk = $false
if ($shortcutExists -and $shortcutTarget) {
  try {
    $resolvedTarget = [IO.Path]::GetFullPath($shortcutTarget)
    $resolvedExe = [IO.Path]::GetFullPath($StableExe)
    $shortcutOk = ($resolvedTarget -ieq $resolvedExe)
  } catch {
    $shortcutOk = ($shortcutTarget -ieq $StableExe)
  }
}

# ---------------------------------------------------------------------------
# 2. NSIS install
# ---------------------------------------------------------------------------

$nsisExists = Test-Path -LiteralPath $NsisDir
$nsisExe = $null
$nsisVersion = $null
if ($nsisExists) {
  $candidate = Get-ChildItem -LiteralPath $NsisDir -Filter '*.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike 'Uninstall*' } |
    Select-Object -First 1
  if ($candidate) {
    $nsisExe = $candidate.FullName
    $nsisVersion = Get-FileVersionString -Path $candidate.FullName
  }
}

# ---------------------------------------------------------------------------
# 3. Latest published release (GitHub)
# ---------------------------------------------------------------------------

$latestTag = $null
$latestName = $null
$releaseLookupOk = $false

$ghJob = {
  param($repo)
  gh release list --limit 1 --json 'tagName,name,publishedAt' -R $repo 2>&1
}
$ghResult = Invoke-WithTimeout -ScriptBlock $ghJob -ArgumentList @($Repo) -TimeoutSec 25
if ($ghResult.Completed -and $ghResult.Output.Count -gt 0) {
  $ghText = (($ghResult.Output | ForEach-Object { [string]$_ }) -join "`n").Trim()
  if ($ghText -match '^\s*\[') {
    try {
      $arr = @($ghText | ConvertFrom-Json)
      if ($arr.Count -ge 1) {
        $latestTag = [string]$arr[0].tagName
        $latestName = [string]$arr[0].name
        $releaseLookupOk = $true
      }
    } catch {
      $releaseLookupOk = $false
    }
  }
}

$portableStatus = 'DESCONOCIDO'
$portableCmp = $null
if ($portableExists -and $portableVersion -and $releaseLookupOk -and $latestTag) {
  $portableCmp = Compare-VersionStrings -A $portableVersion -B $latestTag
  if ($portableCmp -eq 0) { $portableStatus = 'AL DIA' }
  elseif ($portableCmp -lt 0) { $portableStatus = 'DESACTUALIZADO' }
  elseif ($portableCmp -gt 0) { $portableStatus = 'ADELANTADO' }
}

# ---------------------------------------------------------------------------
# 4. Security scan summary (read-only, reuses the real scanner)
# ---------------------------------------------------------------------------

$sec = [ordered]@{
  Available      = $false
  Score          = $null
  ScoredChecks   = 0
  ExcludedChecks = 0
  TotalChecks    = 0
  Summary        = @{ pass = 0; warn = 0; fail = 0; unknown = 0; 'not-applicable' = 0; 'requires-admin' = 0 }
  NonPass        = @()
  Note           = ''
}

if ($SkipSecurityScan) {
  $sec.Note = 'Omitido por -SkipSecurityScan.'
} elseif (-not (Test-Path -LiteralPath $ScanScript)) {
  $sec.Note = 'No se encontro scripts/security-scan-report.cjs; escaneo omitido.'
} elseif (-not (Test-Path -LiteralPath $ScannerJs)) {
  $sec.Note = 'Escaneo no disponible: falta compilar (npm run build) -> dist/main/services/security-scan.js'
} else {
  $scanOut = Join-Path $env:TEMP ('forchi-status-scan-' + [guid]::NewGuid().ToString('N') + '.json')
  $scanJob = {
    param($scanScript, $outFile)
    & node $scanScript --out $outFile
    $LASTEXITCODE
  }
  $scanResult = Invoke-WithTimeout -ScriptBlock $scanJob -ArgumentList @($ScanScript, $scanOut) -TimeoutSec $ScanTimeoutSec

  if (-not $scanResult.Completed) {
    $sec.Note = ("Escaneo excedio el timeout de {0}s; resultado parcial omitido." -f $ScanTimeoutSec)
  } elseif (Test-Path -LiteralPath $scanOut) {
    try {
      $raw = Get-Content -LiteralPath $scanOut -Raw -ErrorAction Stop
      $report = $raw | ConvertFrom-Json
      $sec.Available = $true
      $sec.Score = $report.score
      $sec.ScoredChecks = [int]$report.scoredChecks
      $sec.ExcludedChecks = [int]$report.excludedChecks
      $sec.TotalChecks = [int]$report.totalChecks
      $sec.Summary = $report.summary
      $nonPass = @()
      foreach ($c in @($report.checks)) {
        if ($c.status -ne 'pass') {
          $nonPass += [pscustomobject]@{
            status = [string]$c.status
            id     = [string]$c.id
            reason = [string]$c.reason
          }
        }
      }
      $sec.NonPass = $nonPass
      $sec.Note = 'requires-admin = el dato necesita elevacion (corre la app como admin); no es un fallo y queda fuera del score.'
    } catch {
      $sec.Note = ('No se pudo leer el resultado del escaneo: {0}' -f $_.Exception.Message)
    }
  } else {
    $sec.Note = 'El escaneo no produjo salida (revisa que Node y dist/ esten disponibles).'
  }
  Remove-Item -LiteralPath $scanOut -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# Console output
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host '==========================================================' -ForegroundColor DarkGray
Write-Host ' FORCH.iA WinOptimizer - Estado' -ForegroundColor White
Write-Host '==========================================================' -ForegroundColor DarkGray

Write-Section '1. Portable estable (uso diario)'
Write-Host ("    Ruta     : {0}" -f $StableExe)
if ($portableExists) {
  Write-Host ("    Version  : {0}" -f $portableVersion) -ForegroundColor Green
} else {
  Write-Host '    Version  : NO ENCONTRADO' -ForegroundColor Red
}
if ($shortcutOk) {
  Write-Host ("    Acceso   : OK -> {0}" -f $shortcutTarget) -ForegroundColor Green
} elseif (-not $shortcutExists) {
  Write-Host '    Acceso   : FALTA el acceso directo en el Escritorio' -ForegroundColor Yellow
} elseif ($shortcutTarget) {
  Write-Host ("    Acceso   : apunta a OTRO archivo -> {0}" -f $shortcutTarget) -ForegroundColor Yellow
} else {
  Write-Host '    Acceso   : no se pudo leer el destino del acceso directo' -ForegroundColor Yellow
}

Write-Section '2. Instalacion NSIS (opcional)'
if ($nsisExists) {
  Write-Host ("    Instalada: SI" ) -ForegroundColor Green
  if ($nsisExe) { Write-Host ("    Ruta     : {0}" -f $nsisExe) }
  Write-Host ("    Version  : {0}" -f $nsisVersion)
} else {
  Write-Host '    Instalada: NO (solo portable)' -ForegroundColor DarkGray
}

Write-Section '3. Ultima publicada (GitHub)'
if ($releaseLookupOk) {
  Write-Host ("    Ultima   : {0}" -f $latestTag)
  if ($latestName) { Write-Host ("    Titulo   : {0}" -f $latestName) }
  switch ($portableStatus) {
    'AL DIA' { Write-Host '    Estado   : AL DIA' -ForegroundColor Green }
    'DESACTUALIZADO' {
      Write-Host ("    Estado   : DESACTUALIZADO (portable {0} < ultima {1})" -f $portableVersion, $latestTag) -ForegroundColor Red
      Write-Host '               -> actualizar, ver docs/USER_GUIDE.md' -ForegroundColor Red
    }
    'ADELANTADO' { Write-Host ("    Estado   : ADELANTADO (portable {0} > ultima {1})" -f $portableVersion, $latestTag) -ForegroundColor Yellow }
    default { Write-Host '    Estado   : DESCONOCIDO (no se pudo comparar)' -ForegroundColor Yellow }
  }
} else {
  Write-Host '    No se pudo consultar GitHub (sin red o gh no disponible).' -ForegroundColor Yellow
}

Write-Section '4. Scan de seguridad (solo lectura)'
if ($sec.Available) {
  $scoreText = if ($null -eq $sec.Score) { 'not scored' } else { [string]$sec.Score }
  Write-Host ("    Puntaje  : {0} / 100   ({1} de {2} checks medidos)" -f $scoreText, $sec.ScoredChecks, $sec.TotalChecks)
  $s = $sec.Summary
  Write-Host ("    Conteo   : pass {0} | warn {1} | fail {2} | unknown {3} | n/a {4} | requires-admin {5}" -f `
      $s.pass, $s.warn, $s.fail, $s.unknown, $s.'not-applicable', $s.'requires-admin')
  if (@($sec.NonPass).Count -eq 0) {
    Write-Host '    Todo en pass.' -ForegroundColor Green
  } else {
    Write-Host '    No estan en pass:'
    foreach ($item in $sec.NonPass) {
      $color = switch ($item.status) {
        'fail' { 'Red' }
        'warn' { 'Yellow' }
        default { 'DarkGray' }
      }
      Write-Host ("      {0,-16} {1,-22} {2}" -f $item.status, $item.id, $item.reason) -ForegroundColor $color
    }
  }
  Write-Host ("    Nota     : {0}" -f $sec.Note) -ForegroundColor DarkGray
} else {
  Write-Host ("    {0}" -f $sec.Note) -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

$issues = @()
if (-not $portableExists) { $issues += 'No hay portable estable.' }
if ($portableStatus -eq 'DESACTUALIZADO') { $issues += 'El portable estable esta desactualizado.' }
if (-not $shortcutOk) { $issues += 'El acceso directo del Escritorio falta o apunta a otro archivo.' }
if ($sec.Available -and [int]$sec.Summary.fail -gt 0) { $issues += ("{0} check(s) de seguridad en fail." -f $sec.Summary.fail) }

Write-Section 'Resumen'
if ($issues.Count -eq 0) {
  Write-Host '    Todo en orden.' -ForegroundColor Green
} else {
  Write-Host ("    {0} punto(s) a revisar:" -f $issues.Count) -ForegroundColor Yellow
  foreach ($i in $issues) { Write-Host ("      - {0}" -f $i) -ForegroundColor Yellow }
}
Write-Host ''

# ---------------------------------------------------------------------------
# Optional JSON report
# ---------------------------------------------------------------------------

if ($Json) {
  $outPath = if ($OutFile) { $OutFile } else { $DefaultJsonOut }
  try {
    $outDir = Split-Path -Parent $outPath
    if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
      New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }
    $jsonReport = [ordered]@{
      generatedAt = (Get-Date).ToString('o')
      portable    = [ordered]@{
        path    = $StableExe
        exists  = $portableExists
        version = $portableVersion
      }
      shortcut    = [ordered]@{
        path    = $ShortcutPath
        exists  = $shortcutExists
        target  = $shortcutTarget
        ok      = $shortcutOk
      }
      nsis        = [ordered]@{
        installed = $nsisExists
        path      = $nsisExe
        version   = $nsisVersion
      }
      release     = [ordered]@{
        latest     = $latestTag
        name       = $latestName
        lookupOk   = $releaseLookupOk
        status     = $portableStatus
      }
      security    = [ordered]@{
        available      = $sec.Available
        score          = $sec.Score
        scoredChecks   = $sec.ScoredChecks
        excludedChecks = $sec.ExcludedChecks
        totalChecks    = $sec.TotalChecks
        summary        = $sec.Summary
        nonPass        = $sec.NonPass
        note           = $sec.Note
      }
      issues      = $issues
    }
    ($jsonReport | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $outPath -Encoding UTF8
    Write-Host ("[JSON] Reporte escrito en: {0}" -f ([IO.Path]::GetFullPath($outPath))) -ForegroundColor Green
  } catch {
    Write-Host ("[JSON] No se pudo escribir el reporte: {0}" -f $_.Exception.Message) -ForegroundColor Red
  }
}

exit 0
