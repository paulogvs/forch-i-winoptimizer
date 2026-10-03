import { parsePowerShellJson, runPowerShell } from './powershell';
import type { FreeMemoryResult } from '@shared/electron-api';

interface FreeMemoryPayload {
  trimmed?: number;
  beforeMb?: number;
  afterMb?: number;
}

/**
 * Builds the PowerShell script that trims the working set of this app
 * (main process + direct children) via psapi EmptyWorkingSet.
 *
 * The script MEASURES the working set before and after and reports how many
 * processes were actually trimmed, so the caller can tell a real trim from a
 * no-op instead of assuming success.
 *
 * Returns '' for any pid that is not a positive integer so an invalid value
 * can never reach the script (injection guard, same rule as wingetId).
 */
export function buildFreeMemoryScript(pid: number): string {
  if (!Number.isInteger(pid) || pid <= 0) return '';

  return `
    $targets = @(${pid})
    try {
      $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" -ErrorAction SilentlyContinue
      if ($children) { $targets += @($children | ForEach-Object { $_.ProcessId }) }
    } catch { }
    $trimmed = 0
    $beforeBytes = 0
    $afterBytes = 0
    try {
      Add-Type -Namespace Forchi -Name Psapi -MemberDefinition '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr h);' -ErrorAction Stop
      foreach ($id in $targets) {
        try {
          $p = Get-Process -Id $id -ErrorAction Stop
          $beforeBytes += [double]$p.WorkingSet64
          if ([Forchi.Psapi]::EmptyWorkingSet([IntPtr]$p.Handle)) { $trimmed++ }
          $refreshed = Get-Process -Id $id -ErrorAction SilentlyContinue
          if ($refreshed) { $afterBytes += [double]$refreshed.WorkingSet64 } else { $afterBytes += [double]$p.WorkingSet64 }
        } catch { }
      }
    } catch { }
    @{
      trimmed = $trimmed;
      beforeMb = [math]::Round($beforeBytes / 1MB, 1);
      afterMb = [math]::Round($afterBytes / 1MB, 1)
    } | ConvertTo-Json -Compress
  `;
}

/**
 * Quick "Free RAM" action (P1.1): trims this app's own working set with
 * EmptyWorkingSet and reports the measured delta.
 *
 * `success` is only true when at least one process was really trimmed; a
 * fallback/no-op run is reported as a failure, never as a silent success.
 */
export async function freeMemory(pid: number = process.pid): Promise<FreeMemoryResult> {
  const script = buildFreeMemoryScript(pid);
  if (!script) {
    return {
      success: false,
      freedMb: 0,
      rssBeforeMb: 0,
      rssAfterMb: 0,
      error: `invalid pid: ${pid}`,
    };
  }

  const result = await runPowerShell(script).catch(() => null);
  const payload = result?.success ? parsePowerShellJson<FreeMemoryPayload>(result.stdout) : null;

  const trimmed = Number(payload?.trimmed ?? 0);
  const beforeMb = Math.round(Number(payload?.beforeMb ?? 0));
  const afterMb = Math.round(Number(payload?.afterMb ?? 0));

  if (!result?.success || !payload || !(trimmed > 0)) {
    return {
      success: false,
      freedMb: 0,
      rssBeforeMb: beforeMb,
      rssAfterMb: afterMb,
      error:
        result?.stderr?.trim() ||
        'No process working set was trimmed (nothing to free or access denied).',
    };
  }

  return {
    success: true,
    freedMb: Math.max(0, beforeMb - afterMb),
    rssBeforeMb: beforeMb,
    rssAfterMb: afterMb,
  };
}
