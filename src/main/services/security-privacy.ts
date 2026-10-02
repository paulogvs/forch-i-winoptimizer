import { runPowerShell, parsePowerShellJson, toArray } from './powershell';

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
}> {
  const setting = PRIVACY_SETTINGS.find((s) => s.id === settingId);
  if (!setting) {
    return { success: false, message: `Setting ${settingId} not found` };
  }

  const result = await runPowerShell(`
    try {
      if (!(Test-Path "${setting.registryPath}")) {
        New-Item -Path "${setting.registryPath}" -Force | Out-Null;
      }
      Set-ItemProperty -Path "${setting.registryPath}" -Name "${setting.valueName}" -Value ${setting.recommendedValue} -Type DWord -Force;
      Write-Output "SUCCESS"
    } catch {
      Write-Output "FAILED: $_"
    }
  `);

  return {
    success: result.success && result.stdout.includes('SUCCESS'),
    message:
      result.success && result.stdout.includes('SUCCESS')
        ? `Successfully applied: ${setting.name}`
        : `Failed to apply setting: ${result.stderr}`,
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

  const result = await runPowerShell(action.command);

  return {
    success: result.success && !result.stdout.includes('FAILED'),
    message:
      result.success && !result.stdout.includes('FAILED')
        ? `Successfully executed: ${action.name}`
        : `Failed to execute action: ${result.stderr}`,
  };
}

export function getSecurityActions(): SecurityAction[] {
  return SECURITY_ACTIONS;
}

export async function benchmarkDNS(): Promise<DNSBenchmarkResult[]> {
  // Every server is pinged concurrently. The previous serial `for ... of await`
  // paid each server's full timeout one after another — `dns:benchmark` measured
  // at 35 s when a server was unreachable.
  const results = await Promise.all(
    DNS_SERVERS.map(async (dns) => {
      const result = await runPowerShell(`
      $ping = Test-Connection -ComputerName ${dns.primaryDNS} -Count 4 -ErrorAction SilentlyContinue;
      if ($ping) {
        $avgLatency = ($ping | Measure-Object -Property ResponseTime -Average).Average;
        Write-Output "$avgLatency"
      } else {
        Write-Output "0"
      }
    `);

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
}> {
  const result = await runPowerShell(`
    try {
      $adapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1;
      if ($adapter) {
        Set-DnsClientServerAddress -InterfaceIndex $adapter.InterfaceIndex -ServerAddresses ("${primaryDNS}", "${secondaryDNS}");
        Write-Output "SUCCESS"
      } else {
        Write-Output "NO_ADAPTER"
      }
    } catch {
      Write-Output "FAILED: $_"
    }
  `);

  return {
    success: result.success && result.stdout.includes('SUCCESS'),
    message:
      result.success && result.stdout.includes('SUCCESS')
        ? `DNS set to ${primaryDNS} / ${secondaryDNS}`
        : `Failed to set DNS: ${result.stderr}`,
  };
}
