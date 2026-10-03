#Requires -Version 5.1
<#
.SYNOPSIS
    FORCH.iA WinOptimizer — elevated verification kit (repo tool; never shipped).

.DESCRIPTION
    Runs the checks that need administrator rights and cannot be driven from a
    non-elevated session. It self-elevates once (one UAC prompt), then:

      1. Runs the REAL security scanner (the same 22 checks the app uses, via
         scripts/security-scan-report.cjs against the compiled dist/) and stores
         every check's status + evidence.
      2. Exercises the remote-desktop auto-fix cycle revert -> apply -> revert
         (plus a final hardening apply), verifying each step by RE-READING
         fDenyTSConnections. It refuses to touch the registry while an RDP logon
         session exists (fail-closed).
      3. Reports the final state of the system: SMBv1, RDP and DNS.

    Output JSON is written next to the log so the result can be reviewed after
    the elevated window closes.

.EXAMPLE
    # From a normal PowerShell in the repo root:
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1

.EXAMPLE
    # Only the scan + final state, without touching the RDP registry value:
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -SkipRdpCycle

.NOTES
    Exit codes: 0 success · 1 a step failed · 2 the RDP cycle was skipped because
    an active RDP session was detected.
#>
[CmdletBinding()]
param(
    # Internal: set when this process was relaunched elevated. Do not pass by hand.
    [switch]$Elevated,

    # Where the JSON + transcript are written. Defaults to
    # <repo>\artifacts\elevated-verification.
    [string]$OutDir,

    # Skip the RDP revert -> apply -> revert cycle (scan only).
    [switch]$SkipRdpCycle
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $RepoRoot 'artifacts\elevated-verification'
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---------------------------------------------------------------------------
# Self-elevation (one UAC prompt)
# ---------------------------------------------------------------------------
if (-not (Test-IsAdmin)) {
    if ($Elevated) {
        Write-Error 'Elevation was requested but the process is still not elevated.'
        exit 1
    }
    Write-Host 'FORCH.iA WinOptimizer — elevated verification kit'
    Write-Host 'Requesting administrator rights (one UAC prompt)...'
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Elevated -OutDir "{1}"' -f `
        $PSCommandPath, $OutDir
    if ($SkipRdpCycle) { $arguments += ' -SkipRdpCycle' }
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments | Out-Null
    } catch {
        Write-Error "Could not start the elevated process: $($_.Exception.Message)"
        exit 1
    }
    Write-Host "Elevated run started. Results will be written to: $OutDir"
    exit 0
}

# ---------------------------------------------------------------------------
# Result scaffolding
# ---------------------------------------------------------------------------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$logPath = Join-Path $OutDir "elevated-verification-$stamp.log"
$jsonPath = Join-Path $OutDir 'elevated-verification-latest.json'
$jsonPathStamped = Join-Path $OutDir "elevated-verification-$stamp.json"
$transcriptStarted = $false

$result = [ordered]@{
    tool             = 'forch-i-winoptimizer/verify-elevated'
    appVersion       = $null
    startedAt        = (Get-Date).ToString('o')
    finishedAt       = $null
    elevated         = $true
    machine          = $env:COMPUTERNAME
    user             = "$env:USERDOMAIN\$env:USERNAME"
    aborted          = $false
    abortReason      = $null
    rdpGuard         = [ordered]@{ sessionCount = 0; sessions = @(); reason = $null; skippedCycle = $false }
    security         = $null
    securityCheckCount = 0
    rdpCycleExecuted = $false
    rdpCycle         = New-Object System.Collections.ArrayList
    finalState       = $null
    success          = $false
}

$exitCode = 0

function Get-RdpDeny {
    try {
        $value = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' `
                -Name 'fDenyTSConnections' -ErrorAction Stop).fDenyTSConnections
        return [int]$value
    } catch {
        return $null
    }
}

function Set-RdpDeny {
    param([int]$Value)
    Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' `
        -Name 'fDenyTSConnections' -Value $Value -Type DWord -Force -ErrorAction Stop
}

function Invoke-RdpStep {
    param(
        [System.Collections.ArrayList]$Steps,
        [string]$Name,
        [int]$Target
    )
    $before = Get-RdpDeny
    Set-RdpDeny -Value $Target
    $after = Get-RdpDeny
    $confirmed = ($after -eq $Target)
    [void]$Steps.Add([ordered]@{
            step      = $Name
            target    = $Target
            before    = $before
            after     = $after
            confirmed = $confirmed
        })
    $tag = if ($confirmed) { 'OK' } else { 'FAIL' }
    Write-Host ("  [{0}] {1}: before={2} after={3} target={4}" -f $tag, $Name, $before, $after, $Target)
    return $confirmed
}

try {
    try {
        Start-Transcript -Path $logPath -Force | Out-Null
        $transcriptStarted = $true
    } catch {
        Write-Warning "Could not start the transcript: $($_.Exception.Message)"
    }

    Write-Host '=== FORCH.iA WinOptimizer — elevated verification ==='
    Write-Host "Repo root : $RepoRoot"
    Write-Host "Output dir: $OutDir"
    Write-Host ''

    # --- App version ---------------------------------------------------------
    try {
        $packageJson = Get-Content (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json
        $result.appVersion = [string]$packageJson.version
    } catch { }

    # --- RDP guard (fail-closed) --------------------------------------------
    Write-Host '[1/4] Checking for active RDP logon sessions...'
    $rdpSessions = @()
    try {
        $rdpSessions = @(Get-CimInstance -ClassName Win32_LogonSession -ErrorAction Stop |
                Where-Object { $_.LogonType -eq 10 } |
                ForEach-Object {
                    [ordered]@{
                        logonId   = [string]$_.LogonId
                        startTime = if ($_.StartTime) { $_.StartTime.ToString('o') } else { $null }
                    }
                })
    } catch {
        Write-Warning "Could not enumerate logon sessions: $($_.Exception.Message)"
    }
    $result.rdpGuard.sessionCount = $rdpSessions.Count
    $result.rdpGuard.sessions = $rdpSessions
    if ($rdpSessions.Count -gt 0) {
        $result.rdpGuard.reason = 'active-rdp-sessions'
        $result.rdpGuard.skippedCycle = $true
        Write-Warning "Detected $($rdpSessions.Count) remote-interactive logon session(s); the RDP cycle will be skipped."
    } else {
        Write-Host '  No remote-interactive logon sessions detected.'
    }

    # --- Security scan (real scanner, 22 checks) -----------------------------
    Write-Host ''
    Write-Host '[2/4] Running the real security scanner...'
    $runner = Join-Path $RepoRoot 'scripts\security-scan-report.cjs'
    $distScanner = Join-Path $RepoRoot 'dist\main\services\security-scan.js'
    if (-not (Test-Path $distScanner)) {
        Write-Host '  dist/ not built — running "npm run build" (this may take a minute)...'
        Push-Location $RepoRoot
        try {
            & npm run build *>&1 | Out-Null
        } finally {
            Pop-Location
        }
        if (-not (Test-Path $distScanner)) {
            throw 'The build did not produce dist/main/services/security-scan.js.'
        }
    }
    $scanPath = Join-Path $OutDir "security-scan-$stamp.json"
    & node $runner --out $scanPath
    if ($LASTEXITCODE -ne 0) {
        throw "The security scanner exited with code $LASTEXITCODE."
    }
    $result.security = Get-Content $scanPath -Raw | ConvertFrom-Json
    $result.securityCheckCount = @($result.security.checks).Count
    Write-Host "  Collected $($result.securityCheckCount) checks (score $($result.security.score))."

    # --- RDP revert -> apply -> revert (+ final harden) ----------------------
    Write-Host ''
    if ($SkipRdpCycle) {
        Write-Host '[3/4] RDP cycle skipped (-SkipRdpCycle).'
    } elseif ($rdpSessions.Count -gt 0) {
        Write-Host '[3/4] RDP cycle SKIPPED: an active RDP session is present.'
        $exitCode = 2
    } else {
        Write-Host '[3/4] RDP revert -> apply -> revert cycle (guarded)...'
        $original = Get-RdpDeny
        $originalWasKnown = ($null -ne $original)
        $revertTarget = if ($originalWasKnown) { $original } else { 1 }
        $result.rdpCycleExecuted = $true

        $s1 = Invoke-RdpStep -Steps $result.rdpCycle -Name 'revert-to-original' -Target $revertTarget
        $s2 = Invoke-RdpStep -Steps $result.rdpCycle -Name 'apply-hardened' -Target 1
        $s3 = Invoke-RdpStep -Steps $result.rdpCycle -Name 'revert-to-original' -Target $revertTarget
        $s4 = Invoke-RdpStep -Steps $result.rdpCycle -Name 'final-harden' -Target 1
        $cycleOk = ($s1 -and $s2 -and $s3 -and $s4)

        if (-not $originalWasKnown) {
            Write-Warning '  fDenyTSConnections was absent; the revert target defaulted to 1 (deny).'
        }
        if (-not $cycleOk) {
            Write-Warning '  One or more RDP cycle steps were not confirmed by the read-back.'
            if ($exitCode -eq 0) { $exitCode = 1 }
        }
    }

    # --- Final system state --------------------------------------------------
    Write-Host ''
    Write-Host '[4/4] Verifying the final system state...'
    $smb1 = $null
    try {
        $smb1 = [bool](Get-SmbServerConfiguration -ErrorAction Stop).EnableSMB1Protocol
    } catch {
        try {
            $smb1 = ([int](Get-ItemProperty `
                        -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters' `
                        -Name 'SMB1' -ErrorAction Stop).SMB1 -eq 1)
        } catch { }
    }

    $dnsAdapters = @()
    try {
        $dnsAdapters = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction Stop |
                Where-Object { @($_.ServerAddresses).Count -gt 0 } |
                ForEach-Object {
                    [ordered]@{
                        interface = [string]$_.InterfaceAlias
                        servers   = @($_.ServerAddresses)
                    }
                })
    } catch { }

    $rdpFinal = Get-RdpDeny
    $result.finalState = [ordered]@{
        smb1Enabled          = $smb1
        rdpDenyTSConnections = $rdpFinal
        rdpDisabled          = ($rdpFinal -eq 1)
        dns                  = $dnsAdapters
        checkedAt            = (Get-Date).ToString('o')
    }

    Write-Host ("  SMBv1 enabled          : {0}" -f $(if ($null -eq $smb1) { 'unknown' } else { $smb1 }))
    Write-Host ("  fDenyTSConnections     : {0} (disabled={1})" -f $rdpFinal, ($rdpFinal -eq 1))
    foreach ($adapter in $dnsAdapters) {
        Write-Host ("  DNS {0,-20}: {1}" -f $adapter.interface, ($adapter.servers -join ', '))
    }

    # --- Verdict -------------------------------------------------------------
    if ($exitCode -eq 2) {
        $result.success = $false
    } elseif ($result.rdpCycleExecuted) {
        $result.success = ($cycleOk -and $result.finalState.rdpDisabled -and ($null -ne $result.security))
        if (-not $result.success -and $exitCode -eq 0) { $exitCode = 1 }
    } else {
        $result.success = ($null -ne $result.security)
    }
} catch {
    $result.aborted = $true
    $result.abortReason = "exception: $($_.Exception.Message)"
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    if ($exitCode -eq 0) { $exitCode = 1 }
} finally {
    $result.finishedAt = (Get-Date).ToString('o')
    try {
        $json = $result | ConvertTo-Json -Depth 12
        Set-Content -Path $jsonPath -Value $json -Encoding UTF8
        Set-Content -Path $jsonPathStamped -Value $json -Encoding UTF8
    } catch {
        Write-Host "Could not write the JSON report: $($_.Exception.Message)" -ForegroundColor Red
    }
    if ($transcriptStarted) {
        try { Stop-Transcript | Out-Null } catch { }
    }
    Write-Host ''
    Write-Host "=== Done (exit $exitCode) ==="
    Write-Host "JSON : $jsonPath"
    Write-Host "Log  : $logPath"
}

exit $exitCode
