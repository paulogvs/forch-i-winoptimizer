import { runPowerShell, parsePowerShellJson, toArray } from './powershell';
import { resolveActiveAdapter } from './network-adapter';

/** Strict IPv4 validation — the address is interpolated into a PowerShell script. */
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isValidIPv4(value: string): boolean {
  const match = IPV4_PATTERN.exec(value.trim());
  if (!match) return false;
  return match.slice(1).every((part) => Number(part) <= 255);
}

export interface PrivacySetting {
  id: string;
  name: string;
  description: string;
  category: 'telemetry' | 'privacy' | 'security' | 'updates';
  registryPath: string;
  valueName: string;
  recommendedValue: number;
  currentValue: number | null;
  isApplied: boolean;
  impact: 'low' | 'medium' | 'high';
}

export interface SecurityAction {
  id: string;
  name: string;
  description: string;
  category: 'defender' | 'copilot' | 'recall' | 'privacy';
  command: string;
  warning?: string;
  isReversible: boolean;
}

export interface DNSBenchmarkResult {
  name: string;
  primaryDNS: string;
  secondaryDNS: string;
  avgLatency: number;
  reliability: number;
  isRecommended: boolean;
}

const PRIVACY_SETTINGS: PrivacySetting[] = [
  // Telemetry
  {
    id: 'telemetry-level',
    name: 'Telemetry Level',
    description: 'Set telemetry to minimum',
    category: 'telemetry',
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection',
    valueName: 'AllowTelemetry',
    recommendedValue: 0,
    currentValue: null,
    isApplied: false,
    impact: 'high',
  },
  {
    id: 'telemetry-disable',
    name: 'Disable Telemetry Service',
    description: 'Disable the Connected User Experiences and Telemetry service',
    category: 'telemetry',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\DiagTrack',
    valueName: 'Start',
    recommendedValue: 4,
    currentValue: null,
    isApplied: false,
    impact: 'high',
  },

  // Privacy
  {
    id: 'disable-cortana',
    name: 'Disable Cortana',
    description: 'Disable Cortana assistant',
    category: 'privacy',
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search',
    valueName: 'AllowCortana',
    recommendedValue: 0,
    currentValue: null,
    isApplied: false,
    impact: 'medium',
  },
  {
    id: 'disable-ads',
    name: 'Disable Ads',
    description: 'Disable personalized ads',
    category: 'privacy',
    registryPath: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo',
    valueName: 'Enabled',
    recommendedValue: 0,
    currentValue: null,
    isApplied: false,
    impact: 'low',
  },
  {
    id: 'disable-activity-history',
    name: 'Disable Activity History',
    description: 'Disable activity history collection',
    category: 'privacy',
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System',
    valueName: 'EnableActivityFeed',
    recommendedValue: 0,
    currentValue: null,
    isApplied: false,
    impact: 'medium',
  },
  {
    id: 'disable-location',
    name: 'Disable Location',
    description: 'Disable location tracking',
    category: 'privacy',
    registryPath:
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DeviceAccess\\Global\\{BFA794E4-F964-4FDB-90F6-51056CFE4B44}',
    valueName: 'Value',
    recommendedValue: 0,
    currentValue: null,
    isApplied: false,
    impact: 'medium',
  },
  {
    id: 'disable-feedback',
    name: 'Disable Feedback',
    description: 'Disable feedback notifications',
    category: 'privacy',
    registryPath: 'HKCU:\\SOFTWARE\\Microsoft\\Siuf\\Rules',
    valueName: 'NumberOfSIUFInPeriod',
    recommendedValue: 0,
    currentValue: null,
    isApplied: false,
    impact: 'low',
  },
  {
    id: 'disable-tailored',
    name: 'Disable Tailored Experiences',
    description: 'Disable tailored experiences',
    category: 'privacy',
    registryPath: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy',
    valueName: 'TailoredExperiencesWithDiagnosticDataEnabled',
    recommendedValue: 0,
    currentValue: null,
    isApplied: false,
    impact: 'low',
  },
  {
    id: 'disable-app-diag',
    name: 'Disable App Diagnostics',
    description: 'Disable app diagnostics',
    category: 'privacy',
    registryPath: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppDiagnostics',
    valueName: 'AppDiagnosticsEnabled',
    recommendedValue: 0,
    currentValue: null,
    isApplied: false,
    impact: 'low',
  },
  {
    id: 'disable-input-personalization',
    name: 'Disable Input Personalization',
    description: 'Disable input personalization and typing data collection',
    category: 'privacy',
    registryPath: 'HKCU:\\SOFTWARE\\Microsoft\\InputPersonalization',
    valueName: 'RestrictImplicitInkCollection',
    recommendedValue: 1,
    currentValue: null,
    isApplied: false,
    impact: 'low',
  },
  {
    id: 'disable-speech',
    name: 'Disable Speech Recognition',
    description: 'Disable online speech recognition',
    category: 'privacy',
    registryPath: 'HKCU:\\SOFTWARE\\Microsoft\\Speech_OneCore\\Settings\\OnlineSpeechPrivacy',
    valueName: 'HasAccepted',
    recommendedValue: 0,
    currentValue: null,
    isApplied: false,
    impact: 'medium',
  },

  // Security
  {
    id: 'disable-remote-assist',
    name: 'Disable Remote Assistance',
    description: 'Disable remote assistance',
    category: 'security',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Remote Assistance',
    valueName: 'fAllowToGetHelp',
    recommendedValue: 0,
    currentValue: null,
    isApplied: false,
    impact: 'medium',
  },
  {
    id: 'disable-autorun',
    name: 'Disable Autorun',
    description: 'Disable autorun for all drives',
    category: 'security',
    registryPath: 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer',
    valueName: 'NoDriveTypeAutoRun',
    recommendedValue: 255,
    currentValue: null,
    isApplied: false,
    impact: 'medium',
  },
  {
    id: 'enable-uac',
    name: 'Enable UAC',
    description: 'Enable User Account Control',
    category: 'security',
    registryPath: 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
    valueName: 'EnableLUA',
    recommendedValue: 1,
    currentValue: null,
    isApplied: false,
    impact: 'high',
  },
  {
    id: 'disable-smb1',
    name: 'Disable SMBv1',
    description: 'Disable SMBv1 protocol (security risk)',
    category: 'security',
    registryPath: 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters',
    valueName: 'SMB1',
    recommendedValue: 0,
    currentValue: null,
    isApplied: false,
    impact: 'high',
  },

  // Updates
  {
    id: 'disable-auto-update',
    name: 'Disable Automatic Updates',
    description: 'Disable automatic Windows updates',
    category: 'updates',
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU',
    valueName: 'NoAutoUpdate',
    recommendedValue: 1,
    currentValue: null,
    isApplied: false,
    impact: 'medium',
  },
  {
    id: 'disable-update-restart',
    name: 'Disable Update Restart',
    description: 'Disable automatic restart after updates',
    category: 'updates',
    registryPath: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU',
    valueName: 'NoAutoRebootWithLoggedOnUsers',
    recommendedValue: 1,
    currentValue: null,
    isApplied: false,
    impact: 'medium',
  },
];

const SECURITY_ACTIONS: SecurityAction[] = [
  {
    id: 'disable-defender',
    name: 'Disable Windows Defender',
    description: 'Disable Windows Defender real-time protection',
    category: 'defender',
    command: `
      Set-MpPreference -DisableRealtimeMonitoring $true;
      Set-MpPreference -DisableBehaviorMonitoring $true;
      Set-MpPreference -DisableBlockAtFirstSeen $true;
      Set-MpPreference -DisableIOAVProtection $true;
      Set-MpPreference -DisableScriptScanning $true;
      Write-Output "DEFENDER_DISABLED"
    `,
    warning:
      'WARNING: Disabling Windows Defender will leave your system vulnerable to malware. Only disable if you have an alternative antivirus installed.',
    isReversible: true,
  },
  {
    id: 'enable-defender',
    name: 'Enable Windows Defender',
    description: 'Re-enable Windows Defender real-time protection',
    category: 'defender',
    command: `
      Set-MpPreference -DisableRealtimeMonitoring $false;
      Set-MpPreference -DisableBehaviorMonitoring $false;
      Set-MpPreference -DisableBlockAtFirstSeen $false;
      Set-MpPreference -DisableIOAVProtection $false;
      Set-MpPreference -DisableScriptScanning $false;
      Write-Output "DEFENDER_ENABLED"
    `,
    isReversible: true,
  },
  {
    id: 'remove-copilot',
    name: 'Remove Copilot',
    description: 'Remove Windows Copilot integration',
    category: 'copilot',
    command: `
      $regPath = "HKCU:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot";
      if (!(Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null; }
      Set-ItemProperty -Path $regPath -Name "TurnOffWindowsCopilot" -Value 1 -Type DWord;
      Write-Output "COPILOT_REMOVED"
    `,
    isReversible: true,
  },
  {
    id: 'remove-recall',
    name: 'Remove Recall',
    description: 'Disable Windows Recall feature',
    category: 'recall',
    command: `
      $regPath = "HKCU:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI";
      if (!(Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null; }
      Set-ItemProperty -Path $regPath -Name "DisableAIDataAnalysis" -Value 1 -Type DWord;
      Write-Output "RECALL_REMOVED"
    `,
    isReversible: true,
  },
  {
    id: 'disable-telemetry-tasks',
    name: 'Disable Telemetry Tasks',
    description: 'Disable all telemetry-related scheduled tasks',
    category: 'privacy',
    command: `
      $tasks = @(
        "Microsoft Compatibility Appraiser",
        "ProgramDataUpdater",
        "Consolidator",
        "KernelCeipTask",
        "UsbCeip",
        "DmClient",
        "DmClientOnScenarioDownload"
      );
      foreach ($task in $tasks) {
        Disable-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue | Out-Null;
      };
      Write-Output "TELEMETRY_TASKS_DISABLED"
    `,
    isReversible: true,
  },
  {
    id: 'disable-customer-experience',
    name: 'Disable Customer Experience Improvement',
    description: 'Disable the Customer Experience Improvement Program',
    category: 'privacy',
    command: `
      $regPath = "HKLM:\\SOFTWARE\\Policies\\Microsoft\\SQMClient\\Windows";
      if (!(Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null; }
      Set-ItemProperty -Path $regPath -Name "CEIPEnable" -Value 0 -Type DWord;
      Write-Output "CEIP_DISABLED"
    `,
    isReversible: true,
  },
];

const DNS_SERVERS: DNSBenchmarkResult[] = [
  {
    name: 'Cloudflare',
    primaryDNS: '1.1.1.1',
    secondaryDNS: '1.0.0.1',
    avgLatency: 0,
    reliability: 0,
    isRecommended: true,
  },
  {
    name: 'Google',
    primaryDNS: '8.8.8.8',
    secondaryDNS: '8.8.4.4',
    avgLatency: 0,
    reliability: 0,
    isRecommended: true,
  },
  {
    name: 'Quad9',
    primaryDNS: '9.9.9.9',
    secondaryDNS: '149.112.112.112',
    avgLatency: 0,
    reliability: 0,
    isRecommended: true,
  },
  {
    name: 'OpenDNS',
    primaryDNS: '208.67.222.222',
    secondaryDNS: '208.67.220.220',
    avgLatency: 0,
    reliability: 0,
    isRecommended: false,
  },
  {
    name: 'Level3',
    primaryDNS: '4.2.2.1',
    secondaryDNS: '4.2.2.2',
    avgLatency: 0,
    reliability: 0,
    isRecommended: false,
  },
];

export async function getPrivacySettings(): Promise<PrivacySetting[]> {
  // Single PowerShell process for every registry read. The previous version
  // awaited one `runPowerShell` per setting (17 serial spawns) — measured as
  // `privacy:get-settings` still pending after 30 s on the Security page.
  const lookups = PRIVACY_SETTINGS.map(
    (setting) => `  @{ Path = '${setting.registryPath}'; ValueName = '${setting.valueName}' }`
  ).join(',\n');

  const result = await runPowerShell(`
    $settings = @(
${lookups}
    );
    $out = @();
    foreach ($s in $settings) {
      $props = Get-ItemProperty -Path $s.Path -Name $s.ValueName -ErrorAction SilentlyContinue;
      $value = $null;
      if ($props) { $value = $props.($s.ValueName) };
      $out += @{ Path = $s.Path; ValueName = $s.ValueName; Value = $value };
    };
    $out | ConvertTo-Json -Compress
  `);

  const parsed = result.success
    ? parsePowerShellJson<
        Array<{ Path?: string; ValueName?: string; Value?: number | string | null }>
      >(result.stdout)
    : null;

  const currentByKey = new Map<string, number | null>();
  for (const row of toArray(parsed)) {
    if (!row || typeof row.Path !== 'string' || typeof row.ValueName !== 'string') continue;
    const raw = row.Value;
    const numeric = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
    currentByKey.set(`${row.Path}|${row.ValueName}`, Number.isFinite(numeric) ? numeric : null);
  }

  return PRIVACY_SETTINGS.map((setting) => {
    const currentValue = currentByKey.get(`${setting.registryPath}|${setting.valueName}`) ?? null;
    return {
      ...setting,
      currentValue,
      isApplied: currentValue === setting.recommendedValue,
    };
  });
}

export async function applyPrivacySetting(settingId: string): Promise<{
  success: boolean;
  message: string;
  before?: number | null;
  after?: number | null;
}> {
  const setting = PRIVACY_SETTINGS.find((s) => s.id === settingId);
  if (!setting) {
    return { success: false, message: `Setting ${settingId} not found` };
  }

  // Capture -> apply (errors TERMINATE) -> RE-READ -> compare. A write that does
  // not change the observed value is reported as a real failure, never as
  // SUCCESS. (Previously a non-terminating error printed SUCCESS regardless.)
  const result = await runPowerShell(`
    $ErrorActionPreference = 'Stop';
    $path = '${setting.registryPath}';
    $name = '${setting.valueName}';
    $target = ${setting.recommendedValue};
    function Read-Value {
      try { return (Get-ItemProperty -LiteralPath $path -Name $name -ErrorAction Stop).$name } catch { return $null }
    }
    $before = Read-Value;
    try {
      if (-not (Test-Path -LiteralPath $path)) { New-Item -Path $path -Force | Out-Null }
      Set-ItemProperty -LiteralPath $path -Name $name -Value $target -Type DWord -Force -ErrorAction Stop;
      $after = Read-Value;
      $ok = ($null -ne $after) -and ([int]$after -eq [int]$target);
      @{ status = if ($ok) { 'SUCCESS' } else { 'VERIFY_FAILED' }; before = $before; after = $after } | ConvertTo-Json -Compress
    } catch {
      @{ status = 'FAILED'; error = $_.Exception.Message; before = $before; after = (Read-Value) } | ConvertTo-Json -Compress
    }
  `);

  const payload = result.success
    ? parsePowerShellJson<{
        status?: string;
        error?: string;
        before?: number | null;
        after?: number | null;
      }>(result.stdout)
    : null;
  const status = payload?.status ?? 'FAILED';
  const ok = status === 'SUCCESS';

  return {
    success: ok,
    message: ok
      ? `Applied: ${setting.name} = ${setting.recommendedValue}`
      : `Failed to apply setting: ${payload?.error ?? result.stderr ?? 'value did not change'}`,
    before: payload?.before ?? null,
    after: payload?.after ?? null,
  };
}

export async function applyAllPrivacySettings(): Promise<{
  success: boolean;
  message: string;
  applied: number;
  failed: number;
}> {
  let applied = 0;
  let failed = 0;

  for (const setting of PRIVACY_SETTINGS) {
    const result = await applyPrivacySetting(setting.id);
    if (result.success) applied++;
    else failed++;
  }

  return {
    success: failed === 0,
    message: `Applied ${applied} settings, ${failed} failed`,
    applied,
    failed,
  };
}

export async function runSecurityAction(actionId: string): Promise<{
  success: boolean;
  message: string;
}> {
  const action = SECURITY_ACTIONS.find((a) => a.id === actionId);
  if (!action) {
    return { success: false, message: `Action ${actionId} not found` };
  }

  // Wrap so non-terminating errors become terminating and can never be
  // swallowed into a success-shaped result. The action's own marker proves it
  // reached the end of the command; a caught error prints FAILED.
  const result = await runPowerShell(`
    $ErrorActionPreference = 'Stop';
    try {
      ${action.command}
    } catch {
      Write-Output ("FAILED: " + $_.Exception.Message)
    }
  `);

  const failed = !result.success || /FAILED/i.test(result.stdout);
  return {
    success: !failed,
    message: failed
      ? `Failed to execute action: ${result.stdout.trim() || result.stderr || 'unknown error'}`
      : `Successfully executed: ${action.name}`,
  };
}

export function getSecurityActions(): SecurityAction[] {
  return SECURITY_ACTIONS;
}

/**
 * Per-server timeout for `dns:benchmark` (Fase 1.7). `Test-Connection -Count 4`
 * to an unreachable host blocks for many seconds; without a cap the slowest
 * server holds the whole `Promise.all` hostage. A server that exceeds the
 * budget degrades to latency 0 / reliability 0 (honest "unreachable", never a
 * hang). The PowerShell process itself still has its own 60s timeout; the race
 * only releases the benchmark early.
 */
export const DNS_SERVER_TIMEOUT_MS = 10_000;

function withServerTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function benchmarkDNS(
  serverTimeoutMs = DNS_SERVER_TIMEOUT_MS
): Promise<DNSBenchmarkResult[]> {
  // Every server is pinged concurrently. The previous serial `for ... of await`
  // paid each server's full timeout one after another — `dns:benchmark` measured
  // at 35 s when a server was unreachable.
  const results = await Promise.all(
    DNS_SERVERS.map(async (dns) => {
      const ping = runPowerShell(`
      $ping = Test-Connection -ComputerName ${dns.primaryDNS} -Count 2 -ErrorAction SilentlyContinue;
      if ($ping) {
        $avgLatency = ($ping | Measure-Object -Property ResponseTime -Average).Average;
        Write-Output "$avgLatency"
      } else {
        Write-Output "0"
      }
    `);

      // `-Count 2` (was 4): same honest average, roughly half the worst case.
      // The race caps the straggler; a timeout is reported as unreachable.
      const result = await withServerTimeout(ping, serverTimeoutMs, () => ({
        success: false as const,
        stdout: '0',
        stderr: 'timeout',
        exitCode: 124,
      }));

      const latency = parseInt(result.stdout.trim(), 10) || 0;

      return {
        ...dns,
        avgLatency: latency,
        reliability: latency > 0 ? 100 : 0,
      };
    })
  );

  // Sort by latency
  results.sort((a, b) => a.avgLatency - b.avgLatency);

  return results;
}

export async function setDNS(
  primaryDNS: string,
  secondaryDNS: string
): Promise<{
  success: boolean;
  message: string;
  adapter?: string;
  before?: string[];
  after?: string[];
}> {
  if (!isValidIPv4(primaryDNS) || !isValidIPv4(secondaryDNS)) {
    return { success: false, message: 'Invalid DNS server address' };
  }

  // Resolve the adapter that actually carries traffic (default route, physical
  // preferred). Selecting the first `Status -eq 'Up'` NIC used to pick a tunnel
  // such as Tailscale on this machine.
  const adapter = await resolveActiveAdapter();
  if (!adapter) {
    return { success: false, message: 'No active network adapter found' };
  }

  const result = await runPowerShell(`
    $ErrorActionPreference = 'Stop';
    $ifIndex = ${adapter.interfaceIndex};
    $primary = '${primaryDNS.trim()}';
    $secondary = '${secondaryDNS.trim()}';
    $desired = @($primary, $secondary);
    function Read-Servers {
      try { return @((Get-DnsClientServerAddress -InterfaceIndex $ifIndex -AddressFamily IPv4 -ErrorAction Stop).ServerAddresses | Where-Object { $_ }) } catch { return @() }
    }
    $before = @(Read-Servers);
    $applied = $false;
    try {
      Set-DnsClientServerAddress -InterfaceIndex $ifIndex -ServerAddresses $desired -ErrorAction Stop;
      $applied = $true;
      $after = @(Read-Servers);
      $match = $true;
      foreach ($d in $desired) { if ($after -notcontains $d) { $match = $false } }
      if ($match) {
        @{ status = 'SUCCESS'; before = $before; after = $after } | ConvertTo-Json -Compress
      } else {
        # Read-back did not confirm the change: undo it before reporting failure.
        if ($before.Count -gt 0) { Set-DnsClientServerAddress -InterfaceIndex $ifIndex -ServerAddresses $before -ErrorAction SilentlyContinue }
        else { Set-DnsClientServerAddress -InterfaceIndex $ifIndex -ResetServerAddresses -ErrorAction SilentlyContinue }
        @{ status = 'VERIFY_FAILED'; before = $before; after = $after } | ConvertTo-Json -Compress
      }
    } catch {
      if ($applied -and $before.Count -gt 0) {
        try { Set-DnsClientServerAddress -InterfaceIndex $ifIndex -ServerAddresses $before -ErrorAction SilentlyContinue } catch {}
      }
      @{ status = 'FAILED'; error = $_.Exception.Message; before = $before; after = @(Read-Servers) } | ConvertTo-Json -Compress
    }
  `);

  const payload = result.success
    ? parsePowerShellJson<{
        status?: string;
        error?: string;
        before?: string[];
        after?: string[];
      }>(result.stdout)
    : null;
  const status = payload?.status ?? 'FAILED';

  if (status === 'SUCCESS') {
    return {
      success: true,
      message: `DNS on ${adapter.name} set to ${primaryDNS} / ${secondaryDNS}`,
      adapter: adapter.name,
      before: payload?.before ?? [],
      after: payload?.after ?? [],
    };
  }

  return {
    success: false,
    message:
      status === 'VERIFY_FAILED'
        ? `DNS change was not confirmed on ${adapter.name} (reverted)`
        : `Failed to set DNS on ${adapter.name}: ${payload?.error ?? result.stderr ?? 'unknown error'}`,
    adapter: adapter.name,
    before: payload?.before ?? [],
    after: payload?.after ?? [],
  };
}
