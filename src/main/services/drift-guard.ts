import { runPowerShell, parsePowerShellJson } from './powershell';
import type { DriftEvent, DriftGuardStatus } from '@shared/types';

interface TweakSnapshot {
  id: string;
  name: string;
  registryPath: string;
  valueName: string;
  expectedValue: string;
  category: string;
}

// Known tweaks that Windows Update might revert
const MONITORED_TWEAKS: TweakSnapshot[] = [
  {
    id: 'telemetry-disabled',
    name: 'Disable Telemetry',
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection',
    valueName: 'AllowTelemetry',
    expectedValue: '0',
    category: 'privacy',
  },
  {
    id: 'disable-cortana',
    name: 'Disable Cortana',
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search',
    valueName: 'AllowCortana',
    expectedValue: '0',
    category: 'privacy',
  },
  {
    id: 'disable-ads',
    name: 'Disable Ads in Start Menu',
    registryPath: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    valueName: 'SystemPaneSuggestionsEnabled',
    expectedValue: '0',
    category: 'privacy',
  },
  {
    id: 'disable-background-apps',
    name: 'Disable Background Apps',
    registryPath:
      'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications',
    valueName: 'GlobalUserDisabled',
    expectedValue: '1',
    category: 'performance',
  },
  {
    id: 'disable-superfetch',
    name: 'Disable Superfetch',
    registryPath:
      'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters',
    valueName: 'EnableSuperfetch',
    expectedValue: '0',
    category: 'performance',
  },
  {
    id: 'disable-hibernation',
    name: 'Disable Hibernation',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power',
    valueName: 'HibernateEnabled',
    expectedValue: '0',
    category: 'performance',
  },
  {
    id: 'disable-remote-assistance',
    name: 'Disable Remote Assistance',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Remote Assistance',
    valueName: 'fAllowToGetHelp',
    expectedValue: '0',
    category: 'security',
  },
  {
    id: 'disable-autorun',
    name: 'Disable Autorun',
    registryPath: 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer',
    valueName: 'NoDriveTypeAutoRun',
    expectedValue: '255',
    category: 'security',
  },
];

let monitoringInterval: ReturnType<typeof setInterval> | null = null;
let lastSnapshot: Map<string, string> = new Map();
let driftEvents: DriftEvent[] = [];

export async function takeTweakSnapshot(): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();

  for (const tweak of MONITORED_TWEAKS) {
    const result = await runPowerShell(`
      $value = Get-ItemProperty -Path "${tweak.registryPath}" -Name "${tweak.valueName}" -ErrorAction SilentlyContinue;
      if ($value) {
        Write-Output $value.${tweak.valueName}
      } else {
        Write-Output "NOT_SET"
      }
    `);

    if (result.success) {
      snapshot.set(tweak.id, result.stdout.trim());
    }
  }

  return snapshot;
}

export async function checkForDrift(): Promise<DriftEvent[]> {
  const currentSnapshot = await takeTweakSnapshot();
  const newDrifts: DriftEvent[] = [];

  for (const tweak of MONITORED_TWEAKS) {
    const currentValue = currentSnapshot.get(tweak.id) ?? 'NOT_SET';
    const expectedValue = tweak.expectedValue;

    if (currentValue !== expectedValue) {
      // Check if this is a new drift (was correct before, now wrong)
      const previousValue = lastSnapshot.get(tweak.id);
      if (previousValue === expectedValue) {
        newDrifts.push({
          id: `drift-${Date.now()}-${tweak.id}`,
          tweakId: tweak.id,
          tweakName: tweak.name,
          previousValue,
          currentValue,
          timestamp: new Date(),
          autoFixed: false,
        });
      }
    }
  }

  lastSnapshot = currentSnapshot;
  driftEvents = [...driftEvents, ...newDrifts];
  return newDrifts;
}

export async function reapplyTweak(tweakId: string): Promise<{
  success: boolean;
  message: string;
}> {
  const tweak = MONITORED_TWEAKS.find((t) => t.id === tweakId);
  if (!tweak) {
    return { success: false, message: `Tweak ${tweakId} not found` };
  }

  // Apply with terminating errors, then RE-READ the value; success is derived
  // from the observed state, never from an unconditional SUCCESS print.
  const result = await runPowerShell(`
    $ErrorActionPreference = 'Stop';
    $err = '';
    try {
      if (!(Test-Path "${tweak.registryPath}")) {
        New-Item -Path "${tweak.registryPath}" -Force | Out-Null;
      }
      Set-ItemProperty -Path "${tweak.registryPath}" -Name "${tweak.valueName}" -Value ${tweak.expectedValue} -Type DWord -Force -ErrorAction Stop;
    } catch { $err = $_.Exception.Message }
    $v = (Get-ItemProperty -Path "${tweak.registryPath}" -Name "${tweak.valueName}" -ErrorAction SilentlyContinue).${tweak.valueName};
    @{ verified = ($err -eq '') -and ($null -ne $v) -and ([string]$v -eq '${tweak.expectedValue}'); error = $err; value = $v } | ConvertTo-Json -Compress
  `);

  const payload = result.success
    ? parsePowerShellJson<{ verified?: boolean; error?: string }>(result.stdout)
    : null;
  const success = payload?.verified === true;
  if (success) {
    // Mark drift events as auto-fixed
    driftEvents = driftEvents.map((e) => (e.tweakId === tweakId ? { ...e, autoFixed: true } : e));
  }

  return {
    success,
    message: success
      ? `Successfully re-applied tweak: ${tweak.name}`
      : `Failed to re-apply tweak: ${
          payload?.error || result.stderr || 'the change was not confirmed'
        }`,
  };
}

export async function reapplyAllTweaks(): Promise<{
  success: boolean;
  message: string;
  fixed: number;
  failed: number;
}> {
  let fixed = 0;
  let failed = 0;

  for (const tweak of MONITORED_TWEAKS) {
    const result = await reapplyTweak(tweak.id);
    if (result.success) fixed++;
    else failed++;
  }

  return {
    success: failed === 0,
    message: `Re-applied ${fixed} tweaks, ${failed} failed`,
    fixed,
    failed,
  };
}

export function startDriftMonitoring(intervalMs: number = 300000): void {
  if (monitoringInterval) return;

  // Take initial snapshot
  takeTweakSnapshot().then((snapshot) => {
    lastSnapshot = snapshot;
  });

  monitoringInterval = setInterval(async () => {
    const drifts = await checkForDrift();
    if (drifts.length > 0) {
      // Notify renderer about drift events
      // This would be sent via IPC in a real implementation
      console.log(`[DriftGuard] Detected ${drifts.length} drift events`);
    }
  }, intervalMs);
}

export function stopDriftMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

export function getDriftStatus(): DriftGuardStatus {
  return {
    isMonitoring: monitoringInterval !== null,
    lastCheck: new Date(),
    driftEvents,
    tweaksAtRisk: driftEvents.filter((e) => !e.autoFixed).length,
  };
}

export function getMonitoredTweaks(): TweakSnapshot[] {
  return MONITORED_TWEAKS;
}
