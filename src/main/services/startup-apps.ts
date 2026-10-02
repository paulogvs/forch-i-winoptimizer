import { runPowerShell, parsePowerShellJson, toArray } from './powershell';
import {
  classifyStartupImpact,
  decodeExecutablePath,
  normalizeSignatureStatus,
  originFromLocation,
  type StartupOrigin,
  type StartupSignals,
} from './startup-impact';

export interface StartupApp {
  id: string;
  name: string;
  path: string;
  publisher: string;
  enabled: boolean;
  impact: 'low' | 'medium' | 'high';
  description: string;
}

interface RegistryStartupItem {
  Name: string;
  Command: string;
  Location: string;
  Origin?: string;
  ExePath?: string | null;
  Exists?: boolean;
  SigStatus?: string;
  Signer?: string;
  UnderSystem?: boolean;
  Running?: boolean;
  CpuSeconds?: number | string | null;
  MemoryMb?: number | string | null;
}

function extractCommonName(subject: string): string {
  const match = /CN=([^,]+)/i.exec(subject);
  const commonName = match?.[1];
  return (commonName ?? subject).trim();
}

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Enumerate real startup entries and classify their impact from observable
 * signals only (see `startup-impact.ts`). There is NO product/vendor/AV list:
 * every entry is measured the same way, so the result is useful on any PC.
 *
 * Sources (all read in ONE PowerShell process, mirroring system-audit.ts):
 *  - Run keys: HKLM (64-bit + WOW6432Node) and HKCU.
 *  - Startup folders (per-user + common), resolving `.lnk` targets.
 *  - Root scheduled tasks that are enabled and have an executable action.
 *  - Third-party auto-start services that are running (non-Windows binaries).
 *
 * Per entry we gather: origin, resolved exe path, existence, Authenticode
 * status, whether it lives under a protected system location, and — when the
 * process is live — its measured CPU time and working set.
 */
export async function getStartupApps(): Promise<StartupApp[]> {
  const result = await runPowerShell(`
    $script:items = New-Object System.Collections.ArrayList;
    $script:sigCache = @{};
    $procMap = @{};
    Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        if ($_.Path) {
          $procMap[$_.Path.ToLowerInvariant()] = @{ cpu = [double]$_.TotalProcessorTime.TotalSeconds; mem = [math]::Round($_.WorkingSet64 / 1MB, 1) };
        }
      } catch {}
    };

    function Get-ExePath {
      param([string]$cmd)
      if ([string]::IsNullOrWhiteSpace($cmd)) { return $null }
      $c = $cmd.Trim();
      if ($c.StartsWith('"')) {
        $end = $c.IndexOf('"', 1);
        if ($end -gt 1) { return $c.Substring(1, $end - 1) }
      }
      $first = ($c -split '\\s+')[0].Trim('"');
      if ($first -match '\\.(exe|com|bat|cmd|ps1)$') { return $first }
      $m = [regex]::Match($c, '([A-Za-z]:\\\\[^"]+?\\.(exe|com|bat|cmd|ps1))', 'IgnoreCase');
      if ($m.Success) { return $m.Groups[1].Value }
      return $null;
    }

    function Add-Startup {
      param([string]$name, [string]$cmd, [string]$loc, [string]$origin)
      if ([string]::IsNullOrWhiteSpace($name)) { return }
      $exe = Get-ExePath $cmd;
      $exists = $false; $sig = ''; $signer = '';
      if ($exe -and (Test-Path -LiteralPath $exe -ErrorAction SilentlyContinue)) {
        $exists = $true;
        $key = $exe.ToLowerInvariant();
        if ($script:sigCache.ContainsKey($key)) {
          $sig = $script:sigCache[$key].status; $signer = $script:sigCache[$key].signer;
        } else {
          try {
            $s = Get-AuthenticodeSignature -LiteralPath $exe -ErrorAction SilentlyContinue;
            if ($s) {
              $sig = [string]$s.Status;
              if ($s.SignerCertificate) { $signer = [string]$s.SignerCertificate.Subject }
            }
          } catch {}
          $script:sigCache[$key] = @{ status = $sig; signer = $signer };
        }
      }
      $under = $false;
      if ($exe) {
        $roots = @([Environment]::GetFolderPath('Windows'), [Environment]::GetFolderPath('ProgramFiles'), [Environment]::GetFolderPath('ProgramFilesX86'));
        foreach ($root in $roots) {
          if ($root -and $exe.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
            $tail = $exe.Substring($root.Length).TrimStart('\\');
            if ($tail.StartsWith('System32', [System.StringComparison]::OrdinalIgnoreCase) -or $tail.StartsWith('SysWOW64', [System.StringComparison]::OrdinalIgnoreCase) -or $tail.StartsWith('Windows', [System.StringComparison]::OrdinalIgnoreCase) -or $tail.StartsWith('Microsoft', [System.StringComparison]::OrdinalIgnoreCase)) { $under = $true }
            break;
          }
        }
      }
      $running = $false; $cpu = $null; $mem = $null;
      if ($exe) {
        $pkey = $exe.ToLowerInvariant();
        if ($procMap.ContainsKey($pkey)) { $running = $true; $cpu = $procMap[$pkey].cpu; $mem = $procMap[$pkey].mem }
      }
      [void]$script:items.Add(@{
        Name = $name; Command = $cmd; Location = $loc; Origin = $origin; ExePath = $exe; Exists = $exists;
        SigStatus = $sig; Signer = $signer; UnderSystem = $under; Running = $running; CpuSeconds = $cpu; MemoryMb = $mem
      });
    };

    $runRoots = @(
      @{ Path = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'; Origin = 'hklm-run'; Source = 'HKLM' },
      @{ Path = 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; Origin = 'hklm-run'; Source = 'HKLM' },
      @{ Path = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'; Origin = 'hkcu-run'; Source = 'HKCU' }
    );
    foreach ($r in $runRoots) {
      $props = Get-ItemProperty -Path $r.Path -ErrorAction SilentlyContinue;
      if ($props) {
        $props.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
          Add-Startup $_.Name ([string]$_.Value) $r.Source $r.Origin;
        }
      }
    }

    $shell = $null;
    try { $shell = New-Object -ComObject WScript.Shell } catch {}
    foreach ($folder in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
      if ($folder -and (Test-Path -LiteralPath $folder)) {
        Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
          $target = $null;
          if ($shell) { try { $target = $shell.CreateShortcut($_.FullName).TargetPath } catch {} }
          if ($target) { Add-Startup $_.BaseName $target $folder 'startup-folder' }
          else { Add-Startup $_.BaseName $_.FullName $folder 'startup-folder' }
        }
      }
    }

    try {
      Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
        $_.State -ne 'Disabled' -and $_.TaskPath -eq '\\' -and @($_.Actions).Count -gt 0 -and @($_.Actions)[0].Execute
      } | ForEach-Object {
        Add-Startup $_.TaskName ([string]@($_.Actions)[0].Execute) ('ScheduledTask:' + $_.TaskPath) 'scheduled-task';
      }
    } catch {}

    try {
      Get-CimInstance -ClassName Win32_Service -ErrorAction SilentlyContinue | Where-Object {
        $_.StartMode -eq 'Auto' -and $_.State -eq 'Running' -and $_.PathName -and ($_.PathName -notlike '*\\Windows\\*')
      } | ForEach-Object {
        Add-Startup $_.Name ([string]$_.PathName) 'Service' 'service';
      }
    } catch {}

    $script:items | ConvertTo-Json -Compress -Depth 6
  `);

  const apps: StartupApp[] = [];
  const seen = new Set<string>();

  if (!result.success || !result.stdout) return apps;

  const parsed = parsePowerShellJson<RegistryStartupItem[]>(result.stdout);
  for (const item of toArray(parsed)) {
    const name = item?.Name;
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const exePath = item.ExePath || decodeExecutablePath(item.Command);
    const signals: StartupSignals = {
      origin: (item.Origin as StartupOrigin) || originFromLocation(item.Location),
      command: item.Command ?? '',
      exePath: exePath || null,
      binaryExists: Boolean(item.Exists),
      signature: normalizeSignatureStatus(item.SigStatus),
      signer: item.Signer ? extractCommonName(item.Signer) : null,
      underSystemPath: Boolean(item.UnderSystem),
      running: Boolean(item.Running),
      cpuSeconds: toNumber(item.CpuSeconds),
      memoryMb: toNumber(item.MemoryMb),
      name,
    };

    const assessment = classifyStartupImpact(signals);

    apps.push({
      id: `startup-${name}`,
      name,
      // Keep the raw command so disabling/re-enabling round-trips faithfully.
      path: item.Command ?? '',
      publisher: assessment.publisher,
      enabled: true,
      impact: assessment.impact,
      description: assessment.reasons.join('; '),
    });
  }

  return apps;
}

export async function toggleStartupApp(
  appId: string,
  enabled: boolean
): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    // Get the app details first
    const apps = await getStartupApps();
    const app = apps.find((a) => a.id === appId);

    if (!app) {
      return { success: false, message: 'Startup app not found' };
    }

    if (enabled) {
      // Re-enable by adding back to registry
      const result = await runPowerShell(`
        $regPath = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
        Set-ItemProperty -Path $regPath -Name "${app.name}" -Value "${app.path.replace(/"/g, '\\"')}" -ErrorAction Stop;
        Write-Output "OK"
      `);
      return {
        success: result.success,
        message: result.success
          ? `Startup app ${app.name} enabled`
          : 'Failed to enable startup app',
      };
    } else {
      // Disable by removing from registry
      const result = await runPowerShell(`
        $regPath = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
        Remove-ItemProperty -Path $regPath -Name "${app.name}" -ErrorAction Stop;
        Write-Output "OK"
      `);
      return {
        success: result.success,
        message: result.success
          ? `Startup app ${app.name} disabled`
          : 'Failed to disable startup app',
      };
    }
  } catch {
    return {
      success: false,
      message: 'Failed to toggle startup app',
    };
  }
}
