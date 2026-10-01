import { runPowerShell } from './powershell';
import type { FreeMemoryResult } from '@shared/electron-api';

const toMb = (bytes: number): number => Math.round(bytes / (1024 * 1024));

/**
 * Builds the PowerShell script that trims the working set of this app
 * (main process + direct children) via psapi EmptyWorkingSet, falling back
 * to a .NET GC collect when Add-Type/psapi is unavailable.
 *
 * Returns '' for any pid that is not a positive integer so an invalid value
 * can never reach the script (injection guard, same rule as wingetId).
 */
export function buildFreeMemoryScript(pid: number): string {
  if (!Number.isInteger(pid) || pid <= 0) return '';

  return `
    $trimmed = $false
    $targets = @(${pid})
    try {
      $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" -ErrorAction SilentlyContinue
      if ($children) { $targets += @($children | ForEach-Object { $_.ProcessId }) }
    } catch { }
    try {
      Add-Type -Namespace Forchi -Name Psapi -MemberDefinition '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr h);' -ErrorAction Stop
      foreach ($id in $targets) {
        try {
          $p = Get-Process -Id $id -ErrorAction Stop
          if ([Forchi.Psapi]::EmptyWorkingSet([IntPtr]$p.Handle)) { $trimmed = $true }
        } catch { }
      }
    } catch { }
    if ($trimmed) { Write-Output 'OK' }
    else {
      [System.GC]::Collect()
      [System.GC]::WaitForPendingFinalizers()
      Write-Output 'FALLBACK'
    }
  `;
}

/**
 * Quick "Free RAM" action (P1.1): trims this app's own working set with
 * EmptyWorkingSet and reports the RSS delta measured in Node.
 */
export async function freeMemory(pid: number = process.pid): Promise<FreeMemoryResult> {
  const rssBeforeMb = toMb(process.memoryUsage().rss);

  const script = buildFreeMemoryScript(pid);
  if (!script) {
    return {
      success: false,
      freedMb: 0,
      rssBeforeMb,
      rssAfterMb: rssBeforeMb,
      error: `invalid pid: ${pid}`,
    };
  }

  const result = await runPowerShell(script).catch(() => null);
  const rssAfterMb = toMb(process.memoryUsage().rss);

  const accepted = Boolean(result?.success && /^(OK|FALLBACK)\s*$/m.test(result.stdout.trim()));
  if (!accepted) {
    return {
      success: false,
      freedMb: 0,
      rssBeforeMb,
      rssAfterMb,
      error: result?.stderr?.trim() || 'PowerShell failed while trimming the working set',
    };
  }

  return {
    success: true,
    freedMb: Math.max(0, rssBeforeMb - rssAfterMb),
    rssBeforeMb,
    rssAfterMb,
  };
}
