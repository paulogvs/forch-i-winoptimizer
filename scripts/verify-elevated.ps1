#Requires -Version 5.1
<#
.SYNOPSIS
    FORCH.iA WinOptimizer - elevated verification kit (repo tool; never shipped).

.DESCRIPTION
    Runs the checks that need administrator rights and cannot be driven from a
    non-elevated session. It self-elevates once (one UAC prompt), then:

      1. Runs the REAL security scanner (the same 22 checks the app uses, via
         scripts/security-scan-report.cjs against the compiled dist/) and stores
         every check's status + evidence.
      2. Optionally (-ApplyFixes) APPLIES the three pending reversible security
         fixes -- smb1, guest-account and smb-signing -- capturing each original
         value, writing the hardened value, RE-READING it and reporting
         before/after plus the exact command to revert. A fix whose read-back does
         not confirm the target is reported as a REAL failure, never as success.
      3. Exercises the remote-desktop auto-fix cycle revert -> apply -> revert
         (plus a final hardening apply), verifying each step by RE-READING
         fDenyTSConnections. It refuses to touch the registry while an RDP logon
         session exists (fail-closed).
      4. Reports the final state of the system: SMBv1, RDP and DNS.
      5. Optionally (-EnableBitLocker) plans or performs a guarded BitLocker
         enable on the OS volume: prerequisites first, USB startup key or
         password protector (no TPM + Legacy BIOS), a VERIFIED recovery-key
         backup BEFORE any encryption, Used Space Only encryption, then
         manage-bde status confirmation. Without a verified backup it refuses
         to encrypt. No exceptions.
      6. Optionally (-TestPerMachine) installs 7-Zip per-machine via winget
         (--scope machine), verifies it, uninstalls it through the REAL MSI
         channel resolved with the same grammar the app uses for
         UninstallString, and verifies the registry is clean.
      7. Optionally (-InstallOfferedDrivers) reads Windows Update for offered
         drivers (read-only, same query the app uses). Only when at least one
         driver is offered it runs the real pipeline: verified restore point
         -> install -> re-verify versions. Zero offered (or no WU answer) is a
         no-op that touches nothing.

    In -DryRun mode it never elevates and never writes: it runs the reads and the
    fix PLANNING so the report can be produced (and the mode verified) without
    administrator rights. -DryRun composes with -ApplyFixes, -EnableBitLocker,
    -TestPerMachine and -InstallOfferedDrivers.

    Output JSON is written next to the log so the result can be reviewed after
    the elevated window closes.

    SECURITY: -BitLockerPassword is a SecureString and is NEVER written to the
    log or the JSON. It cannot cross the UAC relaunch boundary, so when the kit
    self-elevates the elevated session prompts for it again with Read-Host
    -AsSecureString if a password protector is needed.

.EXAMPLE
    # From a normal PowerShell in the repo root:
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1

.EXAMPLE
    # Only the scan + final state, without touching the RDP registry value:
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -SkipRdpCycle

.EXAMPLE
    # Apply the three pending reversible security fixes (smb1, guest-account,
    # smb-signing) and verify each one by read-back:
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -ApplyFixes

.EXAMPLE
    # Plan + report only, no elevation and no changes (safe preview):
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -ApplyFixes -DryRun

.EXAMPLE
    # Plan a guarded BitLocker enable (no UAC, no writes):
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -EnableBitLocker -BitLockerRecoveryPath 'D:\bitlocker-recovery.txt' -DryRun

.EXAMPLE
    # Real guarded BitLocker enable (one UAC prompt; prompts for a password
    # only when no USB startup key is available):
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -EnableBitLocker -BitLockerRecoveryPath 'D:\bitlocker-recovery.txt'

.EXAMPLE
    # Controlled per-machine MSI test with 7-Zip (one UAC prompt):
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -TestPerMachine

.EXAMPLE
    # Install only drivers Windows Update actually offers (no-op when 0 offered):
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -InstallOfferedDrivers
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -InstallOfferedDrivers -DryRun

.NOTES
    Exit codes: 0 success | 1 a step failed (including a fix whose read-back did
    not confirm the target, a BitLocker/per-machine/driver mode that aborted
    with work left undone) | 2 the RDP cycle was skipped because an active RDP
    session was detected.
#>
[CmdletBinding()]
param(
    # Internal: set when this process was relaunched elevated. Do not pass by hand.
    [switch]$Elevated,

    # Where the JSON + transcript are written. Defaults to
    # <repo>\artifacts\elevated-verification.
    [string]$OutDir,

    # Skip the RDP revert -> apply -> revert cycle (scan only).
    [switch]$SkipRdpCycle,

    # Apply the three pending reversible security fixes (smb1, guest-account and
    # smb-signing): capture the original, write the hardened value and confirm it
    # by read-back. Requires elevation.
    [switch]$ApplyFixes,

    # Plan + report only: read the machine, compute the fix plan and the exact
    # revert commands, but never write and never self-elevate.
    [switch]$DryRun,

    # Guarded BitLocker enable on the OS volume. Requires elevation (unless
    # -DryRun, which only plans). Needs -BitLockerRecoveryPath; the protector
    # is a USB startup key when a removable drive is present, otherwise the
    # -BitLockerPassword SecureString (prompted in the elevated session when
    # it cannot cross the UAC boundary).
    [switch]$EnableBitLocker,

    # SecureString password protector for BitLocker. NEVER logged, NEVER stored
    # in the JSON. Cannot survive the self-elevation relaunch: the elevated
    # session re-prompts when a password is needed.
    [System.Security.SecureString]$BitLockerPassword,

    # Where the BitLocker recovery-key backup file is written. The kit refuses
    # to encrypt unless this file exists AND contains the valid recovery key.
    [string]$BitLockerRecoveryPath,

    # Controlled per-machine MSI test: install 7-Zip per-machine via winget,
    # verify it, uninstall it through its real MSI UninstallString, verify the
    # registry is clean. Requires elevation (unless -DryRun, read-only plan).
    [switch]$TestPerMachine,

    # Real driver pipeline, but ONLY when Windows Update offers at least one
    # driver (same read-only query the app uses). Zero offered (or no WU
    # answer) is a no-op. Requires elevation for the install path (unless
    # -DryRun, which only reads WU and plans).
    [switch]$InstallOfferedDrivers
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
if (-not (Test-IsAdmin) -and -not $DryRun) {
    if ($Elevated) {
        Write-Error 'Elevation was requested but the process is still not elevated.'
        exit 1
    }
    Write-Host 'FORCH.iA WinOptimizer - elevated verification kit'
    Write-Host 'Requesting administrator rights (one UAC prompt)...'
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Elevated -OutDir "{1}"' -f `
        $PSCommandPath, $OutDir
    if ($SkipRdpCycle) { $arguments += ' -SkipRdpCycle' }
    if ($ApplyFixes) { $arguments += ' -ApplyFixes' }
    if ($EnableBitLocker) {
        $arguments += ' -EnableBitLocker'
        if ($BitLockerRecoveryPath) { $arguments += (' -BitLockerRecoveryPath "{0}"' -f $BitLockerRecoveryPath) }
    }
    if ($TestPerMachine) { $arguments += ' -TestPerMachine' }
    if ($InstallOfferedDrivers) { $arguments += ' -InstallOfferedDrivers' }
    if ($null -ne $BitLockerPassword) {
        Write-Warning 'The -BitLockerPassword SecureString cannot cross the UAC relaunch boundary. The elevated session will prompt for it again (Read-Host -AsSecureString) when a password protector is needed. It is never logged.'
    }
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
    elevated         = (Test-IsAdmin)
    dryRun           = [bool]$DryRun
    applyFixes       = [bool]$ApplyFixes
    machine          = $env:COMPUTERNAME
    user             = "$env:USERDOMAIN\$env:USERNAME"
    aborted          = $false
    abortReason      = $null
    rdpGuard         = [ordered]@{ sessionCount = 0; sessions = @(); reason = $null; skippedCycle = $false }
    security         = $null
    securityCheckCount = 0
    fixes            = New-Object System.Collections.ArrayList
    fixesPlanned     = 0
    fixesApplied     = 0
    fixesFailed      = 0
    rdpCycleExecuted = $false
    rdpCycle         = New-Object System.Collections.ArrayList
    bitlocker        = $null
    perMachineTest   = $null
    offeredDrivers   = $null
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

# ---------------------------------------------------------------------------
# Reversible security fixes (smb1 / guest-account / smb-signing)
# ---------------------------------------------------------------------------
# Each fix: READ the original -> APPLY the hardened value -> READ BACK to confirm.
# The captured original is mapped to a human-readable revert command so the
# operator can undo the change by hand. In -DryRun nothing is written.

function Read-Smb1State {
    $available = $false; $enabled = $null
    try {
        $c = Get-SmbServerConfiguration -ErrorAction Stop
        $enabled = [bool]$c.EnableSMB1Protocol; $available = $true
    } catch {
        try {
            $v = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters' -Name 'SMB1' -ErrorAction Stop).SMB1
            $enabled = ([int]$v -eq 1); $available = $true
        } catch { $available = $false }
    }
    return [ordered]@{ available = $available; enabled = $enabled }
}

function Read-GuestState {
    $available = $false; $name = $null; $enabled = $null
    try {
        $u = Get-LocalUser -ErrorAction Stop | Where-Object { $_.SID.Value -like '*-501' } | Select-Object -First 1
        if ($u) { $available = $true; $name = [string]$u.Name; $enabled = [bool]$u.Enabled }
    } catch {
        try {
            $u = Get-CimInstance -ClassName Win32_UserAccount -Filter "LocalAccount=True" -ErrorAction Stop | Where-Object { $_.SID -like '*-501' } | Select-Object -First 1
            if ($u) { $available = $true; $name = [string]$u.Name; $enabled = (-not [bool]$u.Disabled) }
        } catch { $available = $false }
    }
    return [ordered]@{ available = $available; name = $name; enabled = $enabled }
}

function Read-SmbSigningState {
    $available = $false; $require = $null; $enable = $null
    try {
        $c = Get-SmbServerConfiguration -ErrorAction Stop
        $require = [bool]$c.RequireSecuritySignature
        $enable = [bool]$c.EnableSecuritySignature
        $available = $true
    } catch {
        try {
            $base = 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters'
            $r = (Get-ItemProperty -Path $base -Name 'RequireSecuritySignature' -ErrorAction Stop).RequireSecuritySignature
            $require = ([int]$r -eq 1)
            $e = (Get-ItemProperty -Path $base -Name 'EnableSecuritySignature' -ErrorAction SilentlyContinue).EnableSecuritySignature
            if ($null -ne $e) { $enable = ([int]$e -eq 1) }
            $available = $true
        } catch { $available = $false }
    }
    return [ordered]@{ available = $available; require = $require; enable = $enable }
}

function Format-Smb1State {
    param($State)
    if (-not $State.available -or $null -eq $State.enabled) { return 'unknown' }
    if ($State.enabled) { return 'SMBv1 enabled' } else { return 'SMBv1 disabled' }
}

function Format-GuestState {
    param($State)
    if (-not $State.available -or $null -eq $State.enabled) { return 'unknown' }
    $n = ''
    if ($State.name) { $n = " ($($State.name))" }
    if ($State.enabled) { return "Guest account$n enabled" } else { return "Guest account$n disabled" }
}

function Format-SmbSigningState {
    param($State)
    if (-not $State.available -or $null -eq $State.require) { return 'unknown' }
    $r = if ($State.require) { 'True' } else { 'False' }
    $e = if ($null -eq $State.enable) { 'unknown' } elseif ($State.enable) { 'True' } else { 'False' }
    return "RequireSecuritySignature=$r, EnableSecuritySignature=$e"
}

function Test-Smb1Target { param($State) return ($State.available -and $State.enabled -eq $false) }
function Test-GuestTarget { param($State) return ($State.available -and $State.enabled -eq $false) }
function Test-SmbSigningTarget { param($State) return ($State.available -and $State.require -eq $true) }

function Get-FixTargetText {
    param([string]$CheckId)
    switch ($CheckId) {
        'smb1' { return 'SMBv1 disabled' }
        'guest-account' { return 'Guest account disabled' }
        'smb-signing' { return 'RequireSecuritySignature=True, EnableSecuritySignature=True' }
    }
    return 'unknown'
}

function Get-RevertText {
    param([string]$CheckId, [string]$Original, $State)
    $reg = 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters'
    switch ($CheckId) {
        'smb1' {
            if ($Original -eq 'enabled') {
                return "Set-SmbServerConfiguration -EnableSMB1Protocol `$true -Force  (fallback: Set-ItemProperty -Path '$reg' -Name 'SMB1' -Value 1 -Type DWord -Force)"
            }
            return "Set-SmbServerConfiguration -EnableSMB1Protocol `$false -Force  (fallback: Set-ItemProperty -Path '$reg' -Name 'SMB1' -Value 0 -Type DWord -Force)"
        }
        'guest-account' {
            if ($Original -eq 'enabled') {
                $n = if ($State.name) { $State.name } else { 'Guest' }
                return "Enable-LocalUser -Name '$n'  (fallback: net.exe user '$n' /active:yes)"
            }
            return 'No revert needed: the Guest account was already disabled before this run.'
        }
        'smb-signing' {
            $m = [regex]::Match($Original, '^require=(absent|0|1);enable=(absent|0|1)$')
            if (-not $m.Success) { return $Original }
            $r = $m.Groups[1].Value; $e = $m.Groups[2].Value
            $rb = if ($r -eq '1') { '$true' } else { '$false' }
            $eb = if ($e -eq '1') { '$true' } else { '$false' }
            $parts = @()
            if ($r -ne 'absent' -and $e -ne 'absent') {
                $parts += "Set-SmbServerConfiguration -RequireSecuritySignature $rb -EnableSecuritySignature $eb -Force"
            }
            if ($r -eq 'absent') {
                $parts += "Remove-ItemProperty -Path '$reg' -Name 'RequireSecuritySignature'"
            } elseif ($r -eq '0') {
                $parts += "Set-ItemProperty -Path '$reg' -Name 'RequireSecuritySignature' -Value 0 -Type DWord -Force"
            }
            if ($e -eq 'absent') {
                $parts += "Remove-ItemProperty -Path '$reg' -Name 'EnableSecuritySignature'"
            } elseif ($e -eq '0') {
                $parts += "Set-ItemProperty -Path '$reg' -Name 'EnableSecuritySignature' -Value 0 -Type DWord -Force"
            }
            return ($parts -join '  |  ')
        }
    }
    return 'unknown'
}

function Invoke-SecurityFixApply {
    param([string]$CheckId)
    switch ($CheckId) {
        'smb1' {
            $ok = $false
            try { Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force -ErrorAction Stop; $ok = $true } catch {
                try { Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters' -Name 'SMB1' -Value 0 -Type DWord -Force -ErrorAction Stop; $ok = $true } catch { }
            }
            return $ok
        }
        'guest-account' {
            $ok = $false
            try {
                $u = Get-LocalUser -ErrorAction Stop | Where-Object { $_.SID.Value -like '*-501' } | Select-Object -First 1
                if ($u) { Disable-LocalUser -Name $u.Name -ErrorAction Stop; $ok = $true }
            } catch {
                try {
                    $u = Get-CimInstance -ClassName Win32_UserAccount -Filter "LocalAccount=True" -ErrorAction Stop | Where-Object { $_.SID -like '*-501' } | Select-Object -First 1
                    if ($u) { & net.exe user $u.Name /active:no 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { $ok = $true } }
                } catch { }
            }
            return $ok
        }
        'smb-signing' {
            $ok = $false
            try {
                Set-SmbServerConfiguration -RequireSecuritySignature $true -EnableSecuritySignature $true -Force -ErrorAction Stop
                $ok = $true
            } catch {
                try {
                    Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters' -Name 'RequireSecuritySignature' -Value 1 -Type DWord -Force -ErrorAction Stop
                    Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters' -Name 'EnableSecuritySignature' -Value 1 -Type DWord -Force -ErrorAction Stop
                    $ok = $true
                } catch { $ok = $false }
            }
            return $ok
        }
    }
    return $false
}

function Invoke-SecurityFixes {
    param([System.Collections.ArrayList]$Fixes)
    $fixIds = @('smb1', 'guest-account', 'smb-signing')
    foreach ($id in $fixIds) {
        $title = switch ($id) {
            'smb1' { 'Disable SMBv1' }
            'guest-account' { 'Disable the built-in Guest account' }
            'smb-signing' { 'Require SMB signing' }
        }
        $beforeState = switch ($id) {
            'smb1' { Read-Smb1State }
            'guest-account' { Read-GuestState }
            'smb-signing' { Read-SmbSigningState }
        }
        $beforeText = switch ($id) {
            'smb1' { Format-Smb1State $beforeState }
            'guest-account' { Format-GuestState $beforeState }
            'smb-signing' { Format-SmbSigningState $beforeState }
        }
        $original = switch ($id) {
            'smb1' { if ($beforeState.enabled) { 'enabled' } else { 'disabled' } }
            'guest-account' { if ($beforeState.enabled) { 'enabled' } else { 'disabled' } }
            'smb-signing' {
                $tri = { param($v) if ($null -eq $v) { 'absent' } elseif ($v) { '1' } else { '0' } }
                'require={0};enable={1}' -f (& $tri $beforeState.require), (& $tri $beforeState.enable)
            }
        }
        $already = switch ($id) {
            'smb1' { Test-Smb1Target $beforeState }
            'guest-account' { Test-GuestTarget $beforeState }
            'smb-signing' { Test-SmbSigningTarget $beforeState }
        }

        $entry = [ordered]@{
            checkId       = $id
            title         = $title
            before        = $beforeText
            target        = (Get-FixTargetText $id)
            after         = $null
            original      = $original
            revert        = (Get-RevertText -CheckId $id -Original $original -State $beforeState)
            planned       = $false
            applied       = $false
            confirmed     = $false
            skipped       = $false
            skippedReason = $null
        }

        if (-not $beforeState.available) {
            $entry.skipped = $true; $entry.skippedReason = 'state unavailable'; $entry.after = $beforeText
            [void]$Fixes.Add($entry)
            Write-Host ("  [SKIP] {0}: state could not be read" -f $id)
            continue
        }
        if ($already) {
            $entry.skipped = $true; $entry.skippedReason = 'already at target'; $entry.after = $beforeText
            [void]$Fixes.Add($entry)
            Write-Host ("  [OK]   {0}: already hardened ({1})" -f $id, $beforeText)
            continue
        }

        $entry.planned = $true
        if ($DryRun) {
            [void]$Fixes.Add($entry)
            Write-Host ("  [PLAN] {0}: {1} -> {2}" -f $id, $beforeText, $entry.target)
            Write-Host ("         revert: {0}" -f $entry.revert)
            continue
        }

        $writeOk = Invoke-SecurityFixApply -CheckId $id
        $afterState = switch ($id) {
            'smb1' { Read-Smb1State }
            'guest-account' { Read-GuestState }
            'smb-signing' { Read-SmbSigningState }
        }
        $afterText = switch ($id) {
            'smb1' { Format-Smb1State $afterState }
            'guest-account' { Format-GuestState $afterState }
            'smb-signing' { Format-SmbSigningState $afterState }
        }
        $confirmed = switch ($id) {
            'smb1' { Test-Smb1Target $afterState }
            'guest-account' { Test-GuestTarget $afterState }
            'smb-signing' { Test-SmbSigningTarget $afterState }
        }

        $entry.applied = $true
        $entry.confirmed = $confirmed
        $entry.after = $afterText
        if (-not $confirmed) { $entry.skippedReason = 'read-back did not confirm the target' }
        [void]$Fixes.Add($entry)
        $tag = if ($confirmed) { 'OK' } else { 'FAIL' }
        Write-Host ("  [{0}] {1}: {2} -> {3} (write reported {4})" -f $tag, $id, $beforeText, $afterText, $(if ($writeOk) { 'OK' } else { 'FAILED' }))
    }
}

# ---------------------------------------------------------------------------
# BitLocker mode (-EnableBitLocker)
# ---------------------------------------------------------------------------
# Guarded enable for machines without TPM on Legacy BIOS. Protector choice:
# USB startup key when a removable drive is present, otherwise a password
# (SecureString, never logged). Order is strict:
#   prereqs -> protector -> recovery backup -> VERIFY backup -> encrypt
#   (Used Space Only) -> manage-bde -status confirmation.
# Without a verified recovery copy, nothing is encrypted. No exceptions.

function Get-BitLockerEditionSupport {
    $edition = $null
    try {
        $edition = (Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop).Caption
    } catch { }
    $cmdlet = $null
    try { $cmdlet = Get-Command 'Enable-BitLocker' -ErrorAction SilentlyContinue } catch { }
    $supported = ($null -ne $cmdlet)
    $reason = if ($supported) { "edition '$edition' exposes Enable-BitLocker" } else { "edition '$edition' has no Enable-BitLocker cmdlet (e.g. Home)" }
    return [ordered]@{ supported = $supported; edition = $edition; reason = $reason }
}

function Get-NoTpmPolicy {
    # Policy "Require additional authentication at startup" allowing BitLocker
    # without a compatible TPM lives under HKLM:\SOFTWARE\Policies\Microsoft\FVE.
    $allowed = $false; $detail = 'policy key not present'
    try {
        $fve = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\FVE' -ErrorAction Stop
        $advanced = $fve.UseAdvancedStartup
        $noTpm = $fve.EnableBDEWithNoTPM
        # UseAdvancedStartup=1 enables the policy page; EnableBDEWithNoTPM=1
        # permits TPM-less startup.
        $allowed = (([int]$advanced -eq 1) -and ([int]$noTpm -eq 1))
        $detail = "UseAdvancedStartup=$advanced; EnableBDEWithNoTPM=$noTpm"
    } catch {
        $detail = 'HKLM:\SOFTWARE\Policies\Microsoft\FVE not present'
    }
    $howTo = 'gpedit.msc > Computer Configuration > Administrative Templates > Windows Components > ' + `
        'BitLocker Drive Encryption > Operating System Drives > "Require additional authentication at startup" = Enabled ' + `
        'with "Allow BitLocker without a compatible TPM" ticked. The kit never enables this policy by itself.'
    return [ordered]@{ allowed = $allowed; detail = $detail; howTo = $howTo }
}

function Get-UsbRemovableDrives {
    $drives = @()
    try {
        $drives = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=2' -ErrorAction Stop |
                ForEach-Object { [string]$_.DeviceID })
    } catch { }
    return @($drives)
}

function Get-OsVolumeFree {
    $freeBytes = $null; $ok = $false
    try {
        $vol = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$env:SystemDrive'" -ErrorAction Stop
        $freeBytes = [long]$vol.FreeSpace
        $ok = ($freeBytes -gt 104857600)
    } catch { }
    return [ordered]@{ ok = $ok; freeBytes = $freeBytes }
}

function Test-RecoveryBackup {
    param([string]$Path, [string]$ExpectedKey)
    try {
        if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
        if (-not (Test-Path -LiteralPath $Path)) { return $false }
        $content = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
        if ([string]::IsNullOrWhiteSpace($ExpectedKey)) {
            return ([regex]::IsMatch($content, '(\d{6}-){7}\d{6}'))
        }
        return $content.Contains($ExpectedKey)
    } catch { return $false }
}

function Get-BitLockerReadyCommand {
    param([string]$RecoveryPath)
    $rp = if ($RecoveryPath) { $RecoveryPath } else { '<path>' }
    return "powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -EnableBitLocker -BitLockerRecoveryPath '$rp'"
}

function Invoke-BitLockerMode {
    param([System.Security.SecureString]$Password, [string]$RecoveryPath)

    $mode = [ordered]@{
        mode             = 'bitlocker'
        ready            = $false
        abortReason      = $null
        readyCommand     = $null
        edition          = $null
        policy           = $null
        firmware         = $null
        hasTpm           = $null
        protector        = $null
        tradeOff         = $null
        usbDrives        = @()
        recoveryPath     = $RecoveryPath
        recoveryVerified = $false
        encryptStarted   = $false
        initialProgress  = $null
        revert           = 'To revert: manage-bde -off C: (decrypts the drive; keep the recovery key until decryption reaches 0%). Verify with manage-bde -status C:.'
    }

    # --- Prereq 1: edition ------------------------------------------------
    $ed = Get-BitLockerEditionSupport
    $mode.edition = $ed
    if (-not $ed.supported) {
        $mode.abortReason = "This Windows edition does not support BitLocker ($($ed.reason)). Nothing was changed."
        $mode.readyCommand = (Get-BitLockerReadyCommand -RecoveryPath $RecoveryPath) + '  # once running a Pro/Enterprise/Education edition'
        Write-Host "  [ABORT] bitlocker: $($mode.abortReason)"
        return $mode
    }

    # --- Prereq 2: no-TPM policy (explain, never force) --------------------
    $pol = Get-NoTpmPolicy
    $mode.policy = $pol
    if (-not $pol.allowed) {
        $mode.abortReason = "Group policy 'Allow BitLocker without a compatible TPM' is not enabled ($($pol.detail)). $($pol.howTo) Nothing was changed."
        $mode.readyCommand = (Get-BitLockerReadyCommand -RecoveryPath $RecoveryPath)
        Write-Host "  [ABORT] bitlocker: $($mode.abortReason)"
        return $mode
    }

    # --- Prereq 3: firmware + TPM readout (informative) --------------------
    try {
        $mode.firmware = (Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop).BootupState
    } catch { }
    try {
        $tpm = Get-CimInstance -Namespace 'Root\CIMv2\Security\MicrosoftTpm' -ClassName Win32_Tpm -ErrorAction Stop
        $mode.hasTpm = ($null -ne $tpm)
    } catch { $mode.hasTpm = $false }

    # --- Prereq 4: free space ----------------------------------------------
    $vol = Get-OsVolumeFree
    if (-not $vol.ok) {
        $mode.abortReason = 'Not enough free space on the OS volume for BitLocker. Nothing was changed.'
        $mode.readyCommand = (Get-BitLockerReadyCommand -RecoveryPath $RecoveryPath) + '  # after freeing disk space'
        Write-Host "  [ABORT] bitlocker: $($mode.abortReason)"
        return $mode
    }

    # --- Protector choice ---------------------------------------------------
    $mode.usbDrives = @(Get-UsbRemovableDrives)
    $wantsPassword = ($null -ne $Password)
    if ($mode.usbDrives.Count -gt 0) {
        $mode.protector = 'usb-startup-key'
        $mode.tradeOff = 'Trade-off: a USB startup key boots unattended while inserted (anyone with the USB + PC boots); ' + `
            'losing the USB blocks boot until the recovery key is used. A password is typed at every boot but needs no hardware token.'
    } elseif ($wantsPassword) {
        $mode.protector = 'password'
        $mode.tradeOff = 'Trade-off: a password must be typed at every boot (slower, shoulder-surfing risk); ' + `
            'a USB startup key would boot unattended while inserted but is lost if the drive fails. Insert a USB drive to use the startup-key protector instead.'
    } else {
        if ($DryRun) {
            $mode.abortReason = 'DryRun plan: no USB drive detected and no -BitLockerPassword provided, so the plan stops at protector selection (no writes in DryRun).'
            $mode.readyCommand = "powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -EnableBitLocker -BitLockerRecoveryPath '<path>' -BitLockerPassword (Read-Host -AsSecureString -Prompt 'BitLocker password')"
            Write-Host '  [PLAN] bitlocker: protector pending (USB or password). No writes in DryRun.'
            return $mode
        }
        try {
            Write-Host '  No USB startup key available: enter the BitLocker password (SecureString, never logged).'
            $Password = Read-Host -AsSecureString -Prompt 'BitLocker password'
            $wantsPassword = ($null -ne $Password)
        } catch { $wantsPassword = $false }
        if (-not $wantsPassword) {
            $mode.abortReason = 'No TPM and no viable protector: no USB drive and no password provided. Nothing was changed.'
            $mode.readyCommand = "powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -EnableBitLocker -BitLockerRecoveryPath '<path>' -BitLockerPassword (Read-Host -AsSecureString -Prompt 'BitLocker password')"
            Write-Host "  [ABORT] bitlocker: $($mode.abortReason)"
            return $mode
        }
        $mode.protector = 'password'
        $mode.tradeOff = 'Trade-off: a password must be typed at every boot; a USB startup key would boot unattended while inserted.'
    }

    # --- Recovery path is mandatory -----------------------------------------
    if ([string]::IsNullOrWhiteSpace($RecoveryPath)) {
        $mode.abortReason = 'No recovery-key backup path was provided (-BitLockerRecoveryPath). Without a VERIFIED recovery copy the kit refuses to encrypt. No exceptions. Nothing was changed.'
        $mode.readyCommand = Get-BitLockerReadyCommand -RecoveryPath $null
        Write-Host "  [ABORT] bitlocker: $($mode.abortReason)"
        return $mode
    }

    if ($DryRun) {
        $mode.ready = $true
        Write-Host ("  [PLAN] bitlocker: protector={0}; would write recovery backup to '{1}', VERIFY it, then encrypt Used Space Only." -f $mode.protector, $RecoveryPath)
        Write-Host ("         revert: {0}" -f $mode.revert)
        return $mode
    }

    if (-not (Test-IsAdmin)) {
        $mode.abortReason = 'BitLocker enable requires elevation and this session is not elevated. Nothing was changed.'
        $mode.readyCommand = (Get-BitLockerReadyCommand -RecoveryPath $RecoveryPath)
        Write-Host "  [ABORT] bitlocker: $($mode.abortReason)"
        return $mode
    }

    # --- Real path: enable first, then backup + VERIFY the recovery key -------
    # Enable-BitLocker generates the recovery password protector; it is read
    # back from the volume and only then written to the backup file. If the
    # backup cannot be written or verified, encryption is reverted at once.
    $osVolume = $env:SystemDrive
    try {
        if ($mode.protector -eq 'usb-startup-key') {
            $usbRoot = $mode.usbDrives[0]
            Enable-BitLocker -MountPoint $osVolume -StartupKeyProtector -StartupKeyDirectory $usbRoot -UsedSpaceOnly -ErrorAction Stop | Out-Null
        } else {
            $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password))
            try {
                Enable-BitLocker -MountPoint $osVolume -PasswordProtector -Password $plain -UsedSpaceOnly -ErrorAction Stop | Out-Null
            } finally {
                $plain = $null
            }
        }
    } catch {
        $mode.abortReason = "Enable-BitLocker refused to start: $($_.Exception.Message). Nothing was encrypted."
        $mode.readyCommand = (Get-BitLockerReadyCommand -RecoveryPath $RecoveryPath)
        Write-Host "  [ABORT] bitlocker: $($mode.abortReason)"
        return $mode
    }

    # Read back the recovery key the system generated, write the backup, VERIFY.
    $recoveryKey = $null
    try {
        $protectors = (Get-BitLockerVolume -MountPoint $osVolume -ErrorAction Stop).KeyProtector |
            Where-Object { $_.KeyProtectorType -eq 'RecoveryPassword' }
        $recoveryKey = @($protectors | Select-Object -ExpandProperty RecoveryPassword -ErrorAction SilentlyContinue)[0]
    } catch { }
    if ([string]::IsNullOrWhiteSpace($recoveryKey)) {
        $mode.abortReason = 'BitLocker started but no recovery password could be read back: keeping the volume as-is and reporting failure. Copy the recovery key from manage-bde -protectors -get C: before rebooting.'
        Write-Host "  [ABORT] bitlocker: $($mode.abortReason)"
        return $mode
    }
    try {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RecoveryPath) | Out-Null
        Set-Content -LiteralPath $RecoveryPath -Value ("BitLocker recovery key for $osVolume (generated $(Get-Date -Format o)):`r`n$recoveryKey`r`n") -Encoding ASCII -ErrorAction Stop
    } catch {
        $mode.abortReason = "Could not write the recovery backup to '$RecoveryPath': $($_.Exception.Message). Reverting encryption (manage-bde -off $osVolume)."
        try { & manage-bde.exe -off $osVolume 2>&1 | Out-Null } catch { }
        Write-Host "  [ABORT] bitlocker: $($mode.abortReason)"
        return $mode
    }
    $mode.recoveryVerified = Test-RecoveryBackup -Path $RecoveryPath -ExpectedKey $recoveryKey
    if (-not $mode.recoveryVerified) {
        $mode.abortReason = "The recovery backup at '$RecoveryPath' does not contain the valid key: reverting encryption (manage-bde -off $osVolume). Nothing is left encrypting without a verified copy."
        try { & manage-bde.exe -off $osVolume 2>&1 | Out-Null } catch { }
        Write-Host "  [ABORT] bitlocker: $($mode.abortReason)"
        return $mode
    }

    # --- Confirm encryption started ------------------------------------------
    try {
        $status = & manage-bde.exe -status $osVolume 2>&1 | Out-String
        $mode.encryptStarted = ($status -match 'Percentage Encrypted|Conversion Status|Encryption in progress|Fully Encrypted')
        $m = [regex]::Match($status, 'Percentage Encrypted:\s*([0-9]+%)')
        if ($m.Success) { $mode.initialProgress = $m.Groups[1].Value }
    } catch { }
    $mode.ready = $mode.encryptStarted -and $mode.recoveryVerified
    if ($mode.ready) {
        Write-Host ("  [OK] bitlocker: protector={0}; recovery backup verified at '{1}'; encryption started (progress {2})." -f $mode.protector, $RecoveryPath, $mode.initialProgress)
    } else {
        $mode.abortReason = 'manage-bde -status did not confirm encryption started. Recovery backup IS verified; check manage-bde -status manually.'
        Write-Host "  [FAIL] bitlocker: $($mode.abortReason)"
    }
    return $mode
}

# ---------------------------------------------------------------------------
# Per-machine MSI test (-TestPerMachine)
# ---------------------------------------------------------------------------
# Controlled, reversible target: 7-Zip per-machine via winget. The uninstall
# goes through the REAL MSI channel resolved with the SAME grammar the app
# uses (parseUninstallString in src/main/services/installed-apps.ts):
#   MsiExec.exe /x {GUID}
# Anything else (unparseable string, unexpected MSI behavior) aborts and the
# kit restores the prior state.

function Get-SevenZipRegistryEntry {
    $paths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($p in $paths) {
        try {
            $hits = Get-ItemProperty -Path $p -ErrorAction SilentlyContinue |
                Where-Object { $_.DisplayName -like '7-Zip*' -and $_.UninstallString } |
                Select-Object -First 1 DisplayName, UninstallString, DisplayVersion
            if ($hits) { return $hits }
        } catch { }
    }
    return $null
}

function Resolve-MsiGuid {
    param([string]$UninstallString)
    # Strict /X matches the app parser (parseUninstallString). Some per-machine
    # MSIs (7-Zip on real machines) register /I with the SAME product code;
    # the kit extracts it and always executes the canonical msiexec /x uninstall.
    # Returns @{ guid; flag } or $null when the string must be refused.
    $m = [regex]::Match($UninstallString.Trim(), '^MsiExec(?:\.exe)?\s*/([xXIi])\s*\{([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}\s*$')
    if ($m.Success) { return [ordered]@{ guid = $m.Groups[2].Value; flag = $m.Groups[1].Value.ToUpper() } }
    return $null
}

function Test-WingetLists7Zip {
    try {
        $out = & winget.exe list --id 7zip.7zip --accept-source-agreements 2>&1 | Out-String
        return ($out -match '7zip\.7zip|7-Zip')
    } catch { return $false }
}

function Invoke-PerMachineTestMode {
    $mode = [ordered]@{
        mode             = 'per-machine-msi'
        target           = '7zip.7zip'
        before           = $null
        installVerified  = $false
        uninstallGuid    = $null
        uninstallChannel = $null
        note             = $null
        after            = $null
        registryClean    = $false
        aborted          = $false
        abortReason      = $null
        success          = $false
    }

    $beforeEntry = Get-SevenZipRegistryEntry
    $beforeWinget = Test-WingetLists7Zip
    $wasInstalled = (($null -ne $beforeEntry) -or $beforeWinget)
    $mode.before = [ordered]@{
        installed      = $wasInstalled
        displayName    = if ($beforeEntry) { [string]$beforeEntry.DisplayName } else { $null }
        displayVersion = if ($beforeEntry) { [string]$beforeEntry.DisplayVersion } else { $null }
        wingetListed   = $beforeWinget
        uninstallString = if ($beforeEntry) { [string]$beforeEntry.UninstallString } else { $null }
    }
    Write-Host ("  before: installed={0} wingetListed={1}" -f $wasInstalled, $beforeWinget)

    if ($DryRun) {
        # Read-only: prove the parser finds the UninstallString when present.
        if ($beforeEntry) {
            $resolved = Resolve-MsiGuid -UninstallString $beforeEntry.UninstallString
            if ($resolved) {
                $mode.uninstallGuid = $resolved.guid
                $mode.uninstallChannel = if ($resolved.flag -eq 'X') { 'msi' } else { 'msi-product-code' }
                if ($resolved.flag -ne 'X') {
                    $mode.note = "Registered with /$($resolved.flag) (the app parser accepts /X only); the real run executes the canonical msiexec /x on the same product code."
                    Write-Host ("         NOTE: {0}" -f $mode.note)
                }
                Write-Host ("  [PLAN] per-machine-msi: would install 7-Zip --scope machine, verify, uninstall via msiexec /x {{{0}}} /qn /norestart, verify clean." -f $resolved.guid)
                Write-Host ("         parser resolved UninstallString '{0}' to product code {1} (same grammar as the app)." -f $beforeEntry.UninstallString, $resolved.guid)
            } else {
                $mode.aborted = $true
                $mode.abortReason = "Parser refused the installed 7-Zip UninstallString ('$($beforeEntry.UninstallString)'): the real run would abort without touching the system."
                Write-Host "  [PLAN] per-machine-msi: $($mode.abortReason)"
            }
        } else {
            Write-Host '  [PLAN] per-machine-msi: 7-Zip not installed; the real run would winget install --scope machine, verify (registry + winget list), uninstall via the MSI channel, verify clean. No writes in DryRun.'
        }
        $mode.success = $true
        return $mode
    }

    if (-not (Test-IsAdmin)) {
        $mode.aborted = $true
        $mode.abortReason = 'Per-machine install requires elevation and this session is not elevated. Nothing was changed.'
        Write-Host "  [ABORT] per-machine-msi: $($mode.abortReason)"
        return $mode
    }

    # --- Install per-machine -------------------------------------------------
    if (-not $wasInstalled) {
        Write-Host '  Installing 7-Zip per-machine (winget install --id 7zip.7zip --scope machine)...'
        & winget.exe install --id 7zip.7zip --scope machine -e --silent `
            --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            $mode.aborted = $true
            $mode.abortReason = "winget install exited with code $LASTEXITCODE. Nothing else was attempted."
            Write-Host "  [ABORT] per-machine-msi: $($mode.abortReason)"
            return $mode
        }
    } else {
        Write-Host '  7-Zip already installed: skipping install, testing the uninstall channel only.'
    }

    $afterInstall = Get-SevenZipRegistryEntry
    $afterWinget = Test-WingetLists7Zip
    $mode.installVerified = (($null -ne $afterInstall) -and $afterWinget)
    Write-Host ("  installed: registry={0} winget={1}" -f ($null -ne $afterInstall), $afterWinget)
    if (-not $mode.installVerified) {
        $mode.aborted = $true
        $mode.abortReason = 'Install could not be verified (registry + winget list). Aborting before any uninstall; leaving the system as found.'
        Write-Host "  [ABORT] per-machine-msi: $($mode.abortReason)"
        return $mode
    }

    # --- Resolve the REAL uninstall channel (same grammar as the app) ---------
    $resolved = Resolve-MsiGuid -UninstallString $afterInstall.UninstallString
    if (-not $resolved) {
        $mode.aborted = $true
        $mode.abortReason = "Parser refused the 7-Zip UninstallString ('$($afterInstall.UninstallString)'): aborting, system left as it was (7-Zip still installed)."
        Write-Host "  [ABORT] per-machine-msi: $($mode.abortReason)"
        return $mode
    }
    $guid = $resolved.guid
    $mode.uninstallGuid = $guid
    $mode.uninstallChannel = if ($resolved.flag -eq 'X') { 'msi' } else { 'msi-product-code' }
    if ($resolved.flag -ne 'X') {
        $mode.note = "Registered with /$($resolved.flag) (the app parser accepts /X only); executing the canonical msiexec /x on the same product code."
        Write-Host ("  NOTE: {0}" -f $mode.note)
    }
    Write-Host ("  uninstall channel: msiexec /x {{{0}}} /qn /norestart" -f $guid)

    # --- Uninstall via the MSI channel ----------------------------------------
    $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList "/x {$guid} /qn /norestart" -Wait -PassThru
    if (($proc.ExitCode -ne 0) -and ($proc.ExitCode -ne 3010)) {
        $mode.aborted = $true
        $mode.abortReason = "msiexec exited with code $($proc.ExitCode) (unexpected): aborting and reporting; 7-Zip may still be installed."
        Write-Host "  [ABORT] per-machine-msi: $($mode.abortReason)"
        return $mode
    }

    # --- Verify clean ----------------------------------------------------------
    $afterEntry = Get-SevenZipRegistryEntry
    $afterList = Test-WingetLists7Zip
    $mode.after = [ordered]@{
        displayName  = if ($afterEntry) { [string]$afterEntry.DisplayName } else { $null }
        wingetListed = $afterList
    }
    $mode.registryClean = (($null -eq $afterEntry) -and (-not $afterList))
    if ($wasInstalled) {
        # 7-Zip was there before: we only tested the channel; warn that the
        # pre-existing install was removed and give the exact reinstall.
        Write-Host '  NOTE: 7-Zip was already installed before this run and was removed by the channel test.'
        Write-Host '  Reinstall with: winget install --id 7zip.7zip --scope machine -e --silent --accept-package-agreements --accept-source-agreements'
    }
    $mode.success = $mode.registryClean
    $tag = if ($mode.registryClean) { 'OK' } else { 'FAIL' }
    Write-Host ("  [{0}] per-machine-msi: registry clean={1} (before installed={2})." -f $tag, $mode.registryClean, $wasInstalled)
    return $mode
}

# ---------------------------------------------------------------------------
# Offered-drivers mode (-InstallOfferedDrivers)
# ---------------------------------------------------------------------------
# Read-only Windows Update query first (same query the app uses:
# IsInstalled=0 AND Type='Driver'). Zero offered (or no WU answer) is a
# no-op: nothing is touched. Otherwise: verified restore point -> install via
# Windows Update -> re-verify versions.

function Get-OfferedDriverUpdates {
    $offered = @(); $responded = $false; $errorText = ''
    try {
        $session = New-Object -ComObject Microsoft.Update.Session
        $searcher = $session.CreateUpdateSearcher()
        $searcher.Online = $true
        $res = $searcher.Search("IsInstalled=0 AND Type='Driver'")
        $responded = $true
        foreach ($u in $res.Updates) {
            $offered += [ordered]@{ title = [string]$u.Title }
        }
    } catch {
        $errorText = $_.Exception.Message
    }
    return [ordered]@{ responded = $responded; error = $errorText; updates = @($offered) }
}

function New-VerifiedRestorePoint {
    param([string]$Description)
    $err = ''
    try {
        Enable-ComputerRestore -Drive 'C:\' -ErrorAction Stop
        Checkpoint-Computer -Description $Description -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop
    } catch { $err = $_.Exception.Message }
    $rp = $null
    try {
        $rp = Get-ComputerRestorePoint -ErrorAction SilentlyContinue |
            Sort-Object -Property SequenceNumber -Descending | Select-Object -First 1
    } catch { }
    $verified = (($err -eq '') -and ($null -ne $rp))
    $seq = $null
    if ($rp) { $seq = $rp.SequenceNumber }
    return [ordered]@{ verified = $verified; error = $err; sequence = $seq }
}

function Invoke-OfferedDriversMode {
    $mode = [ordered]@{
        mode          = 'offered-drivers'
        wuResponded   = $false
        wuError       = $null
        offeredCount  = 0
        offered       = @()
        action        = 'noop'
        restorePoint  = $null
        installedCount = 0
        verifiedCount = 0
        aborted       = $false
        abortReason   = $null
        success       = $false
    }

    Write-Host '  Querying Windows Update for offered drivers (read-only)...'
    $wu = Get-OfferedDriverUpdates
    $mode.wuResponded = $wu.responded
    $mode.wuError = $wu.error
    $mode.offered = @($wu.updates | ForEach-Object { $_.title })
    $mode.offeredCount = $mode.offered.Count
    Write-Host ("  WU responded={0}; offered={1}" -f $mode.wuResponded, $mode.offeredCount)

    if (-not $mode.wuResponded) {
        $mode.action = 'noop'
        $mode.abortReason = "Windows Update did not answer ($($mode.wuError)): cannot claim up to date, nothing to install. System untouched."
        $mode.success = $true
        Write-Host "  [NOOP] offered-drivers: $($mode.abortReason)"
        return $mode
    }
    if ($mode.offeredCount -eq 0) {
        $mode.action = 'noop'
        $mode.abortReason = 'Windows Update offered 0 drivers: nothing to install. System untouched.'
        $mode.success = $true
        Write-Host '  [NOOP] offered-drivers: nothing to install.'
        return $mode
    }

    $mode.action = 'install-pipeline'
    if ($DryRun) {
        Write-Host ("  [PLAN] offered-drivers: would create a VERIFIED restore point, install {0} offered driver(s) via Windows Update, then re-verify versions. No writes in DryRun." -f $mode.offeredCount)
        foreach ($t in $mode.offered) { Write-Host ("         - {0}" -f $t) }
        $mode.success = $true
        return $mode
    }

    if (-not (Test-IsAdmin)) {
        $mode.aborted = $true
        $mode.abortReason = 'Installing drivers requires elevation and this session is not elevated. Nothing was changed.'
        Write-Host "  [ABORT] offered-drivers: $($mode.abortReason)"
        return $mode
    }

    # --- Verified restore point BEFORE any install -----------------------------
    Write-Host '  Creating a restore point (must verify before installing)...'
    $rp = New-VerifiedRestorePoint -Description 'FORCH.iA WinOptimizer offered-drivers'
    $mode.restorePoint = $rp
    if (-not $rp.verified) {
        $mode.aborted = $true
        $mode.abortReason = "Restore point was not verified ($($rp.error)): aborting the pipeline before any install."
        Write-Host "  [ABORT] offered-drivers: $($mode.abortReason)"
        return $mode
    }
    Write-Host ("  Restore point verified (sequence {0})." -f $rp.sequence)

    # --- Install the offered set via Windows Update ------------------------------
    try {
        $session = New-Object -ComObject Microsoft.Update.Session
        $searcher = $session.CreateUpdateSearcher()
        $searcher.Online = $true
        $res = $searcher.Search("IsInstalled=0 AND Type='Driver'")
        $installer = $session.CreateUpdateInstaller()
        $list = New-Object -ComObject Microsoft.Update.UpdateColl
        foreach ($u in $res.Updates) { $list.Add($u) | Out-Null }
        $installer.Updates = $list
        $dl = $installer.Download()
        if ($dl.ResultCode -ne 2) {
            $mode.aborted = $true
            $mode.abortReason = "Driver download did not complete (ResultCode $($dl.ResultCode)). Nothing was installed beyond what WU staged."
            Write-Host "  [ABORT] offered-drivers: $($mode.abortReason)"
            return $mode
        }
        $ir = $installer.Install()
        $mode.installedCount = $mode.offeredCount
        if (($ir.ResultCode -ne 2) -and ($ir.ResultCode -ne 3)) {
            $mode.aborted = $true
            $mode.abortReason = "Driver install did not report success (ResultCode $($ir.ResultCode)). Reboot may be required; verify versions manually."
            Write-Host "  [ABORT] offered-drivers: $($mode.abortReason)"
            return $mode
        }
        if ($ir.RebootRequired) { Write-Host '  NOTE: Windows requests a reboot to complete the install. The kit never reboots by itself.' }
    } catch {
        $mode.aborted = $true
        $mode.abortReason = "Driver install threw: $($_.Exception.Message). Verify versions manually."
        Write-Host "  [ABORT] offered-drivers: $($mode.abortReason)"
        return $mode
    }

    # --- Re-verify versions -------------------------------------------------------
    try {
        $drivers = Get-CimInstance -ClassName Win32_PnPSignedDriver -ErrorAction Stop
        $mode.verifiedCount = @($drivers).Count
        Write-Host ("  Re-read {0} signed drivers after install." -f $mode.verifiedCount)
        $mode.success = $true
    } catch {
        $mode.aborted = $true
        $mode.abortReason = "Install ran but versions could not be re-read: $($_.Exception.Message)."
        Write-Host "  [ABORT] offered-drivers: $($mode.abortReason)"
        return $mode
    }
    return $mode
}

try {
    try {
        Start-Transcript -Path $logPath -Force | Out-Null
        $transcriptStarted = $true
    } catch {
        Write-Warning "Could not start the transcript: $($_.Exception.Message)"
    }

    Write-Host '=== FORCH.iA WinOptimizer - elevated verification ==='
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
        Write-Host '  dist/ not built - running "npm run build" (this may take a minute)...'
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

    # --- Optional reversible security fixes ----------------------------------
    if ($ApplyFixes) {
        Write-Host ''
        Write-Host '[fix] Reversible security fixes (smb1, guest-account, smb-signing)...'
        if ($DryRun) {
            Write-Host '  DRY RUN: computing the plan only; nothing will be written.'
        } elseif (-not $result.elevated) {
            Write-Warning '  Not elevated: the writes will be attempted but are expected to be refused.'
        }
        Invoke-SecurityFixes -Fixes $result.fixes
        $result.fixesPlanned = @($result.fixes | Where-Object { $_.planned }).Count
        $result.fixesApplied = @($result.fixes | Where-Object { $_.confirmed }).Count
        $result.fixesFailed = @($result.fixes | Where-Object { $_.applied -and -not $_.confirmed }).Count
        Write-Host ("  Fixes planned: {0}; confirmed: {1}; real failures: {2}" -f `
                $result.fixesPlanned, $result.fixesApplied, $result.fixesFailed)
        if (-not $DryRun -and $result.fixesFailed -gt 0 -and $exitCode -eq 0) { $exitCode = 1 }
    }

    # --- RDP revert -> apply -> revert (+ final harden) ----------------------
    Write-Host ''
    if ($SkipRdpCycle) {
        Write-Host '[3/4] RDP cycle skipped (-SkipRdpCycle).'
    } elseif ($DryRun) {
        Write-Host '[3/4] RDP cycle skipped (-DryRun: no writes).'
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

    # --- BitLocker mode (optional, -EnableBitLocker) --------------------------
    if ($EnableBitLocker) {
        Write-Host ''
        Write-Host '[bitlocker] Guarded BitLocker enable (prereqs -> protector -> verified backup -> Used Space Only)...'
        if ($DryRun) {
            Write-Host '  DRY RUN: prerequisites + plan only; never elevates, never writes.'
        }
        $result.bitlocker = Invoke-BitLockerMode -Password $BitLockerPassword -RecoveryPath $BitLockerRecoveryPath
        if ((-not $DryRun) -and (-not $result.bitlocker.ready) -and ($exitCode -eq 0)) { $exitCode = 1 }
    }

    # --- Per-machine MSI test (optional, -TestPerMachine) ----------------------
    if ($TestPerMachine) {
        Write-Host ''
        Write-Host '[permachine] Controlled per-machine MSI test (7-Zip via winget --scope machine)...'
        if ($DryRun) {
            Write-Host '  DRY RUN: reads only (registry + winget list + parser check).'
        }
        $result.perMachineTest = Invoke-PerMachineTestMode
        if ((-not $DryRun) -and (($result.perMachineTest.aborted) -or (-not $result.perMachineTest.success)) -and ($exitCode -eq 0)) { $exitCode = 1 }
    }

    # --- Offered-drivers mode (optional, -InstallOfferedDrivers) -----------------
    if ($InstallOfferedDrivers) {
        Write-Host ''
        Write-Host '[drivers] Offered-drivers pipeline (only what Windows Update offers)...'
        if ($DryRun) {
            Write-Host '  DRY RUN: WU read + plan only.'
        }
        $result.offeredDrivers = Invoke-OfferedDriversMode
        if ((-not $DryRun) -and (($result.offeredDrivers.aborted) -or (-not $result.offeredDrivers.success)) -and ($exitCode -eq 0)) { $exitCode = 1 }
    }

    # --- Verdict -------------------------------------------------------------
    if ($DryRun) {
        # A dry run only needs the read + the plan to be produced honestly.
        # Mode planning aborts (e.g. BitLocker without a protector yet) are
        # reported in the JSON with the exact ready command, not failures.
        $result.success = (($null -ne $result.security) -and ($result.fixesFailed -eq 0))
        if (-not $result.success -and $exitCode -eq 0) { $exitCode = 1 }
    } elseif ($exitCode -eq 2) {
        $result.success = $false
    } elseif ($result.rdpCycleExecuted) {
        $result.success = ($cycleOk -and $result.finalState.rdpDisabled -and ($null -ne $result.security))
        if (-not $result.success -and $exitCode -eq 0) { $exitCode = 1 }
    } else {
        $result.success = ($null -ne $result.security)
    }

    # --- New modes factor into the verdict (real runs only) ----------------------
    if (-not $DryRun) {
        $modesFailed = $false
        if ($EnableBitLocker -and (($null -eq $result.bitlocker) -or (-not $result.bitlocker.ready))) { $modesFailed = $true }
        if ($TestPerMachine -and (($null -eq $result.perMachineTest) -or (-not $result.perMachineTest.success))) { $modesFailed = $true }
        if ($InstallOfferedDrivers -and (($null -eq $result.offeredDrivers) -or (-not $result.offeredDrivers.success))) { $modesFailed = $true }
        if ($modesFailed) {
            $result.success = $false
            if ($exitCode -eq 0) { $exitCode = 1 }
        }
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
        # BOM-less UTF-8 so both PowerShell (ConvertFrom-Json) and node
        # (JSON.parse) read the report. Set-Content -Encoding UTF8 writes a BOM.
        $noBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($jsonPath, $json, $noBom)
        [System.IO.File]::WriteAllText($jsonPathStamped, $json, $noBom)
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
