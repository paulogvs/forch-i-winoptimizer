import { runPowerShell, parsePowerShellJson, toArray } from './powershell';

/** Escape a value for a PowerShell single-quoted string literal. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface SystemService {
  id: string;
  name: string;
  displayName: string;
  description: string;
  status: 'running' | 'stopped' | 'paused';
  startType: 'automatic' | 'manual' | 'disabled';
  canOptimize: boolean;
  recommendedAction: 'keep' | 'disable' | 'manual';
  protection: 'safe' | 'caution' | 'protected';
  impact: 'low' | 'medium' | 'high';
}

interface PowerShellService {
  Name: string;
  DisplayName: string;
  Description: string;
  Status: string;
  StartType: string;
}

const PROTECTED_SERVICES = [
  'wuauserv',
  'WinDefend',
  'MpsSvc',
  'EventLog',
  'RpcSs',
  'DcomLaunch',
  'PlugPlay',
  'Power',
  'LanmanServer',
  'LanmanWorkstation',
  'Netlogon',
  'NTDS',
  'DNS',
  'DHCP',
  'BITS',
  'CryptSvc',
  'Dhcp',
  'Dnscache',
  'iphlpsvc',
  'nsi',
  'TermService',
  'Themes',
  'AudioSrv',
  'AudioEndpointBuilder',
  'BFE',
  'CDPUserSvc',
  'CoreMessagingRegistrar',
  'DusmSvc',
  'EventSystem',
  'FontCache',
  'hidserv',
  'IKEEXT',
  'iphlpsvc',
  'KeyIso',
  'LSM',
  'mpssvc',
  'Netman',
  'PcaSvc',
  'PerfHost',
  'RasMan',
  'RemoteAccess',
  'RemoteRegistry',
  'RpcLocator',
  'SamSs',
  'Schedule',
  'SENS',
  'SharedAccess',
  'ShellHWDetection',
  'Spooler',
  'SSDPSRV',
  'StateRepository',
  'stisvc',
  'SysMain',
  'SystemEventsBroker',
  'TextInputManagementService',
  'TimeBrokerSvc',
  'TokenBroker',
  'TrkWks',
  'UI0Detect',
  'UmRdpService',
  'upnphost',
  'UserManager',
  'UserDataSvc',
  'UsoSvc',
  'VaultSvc',
  'W32Time',
  'Wcmsvc',
  'WdiService',
  'WdiSystemHost',
  'WebClient',
  'Wecsvc',
  'WEPHOSTSVC',
  'wercplsupport',
  'WerSvc',
  'WinHttpAutoProxySvc',
  'Winmgmt',
  'WinRM',
  'WlanSvc',
  'wlidsvc',
  'wmiApSrv',
  'WMPNetworkSvc',
  'workfolderssvc',
  'WSearch',
  'wuauserv',
  'XblAuthManager',
  'XblGameSave',
  'XboxNetApiSvc',
  'XboxGipSvc',
  'xboxgip',
  'xboxnetapi',
];

const OPTIMIZABLE_SERVICES: Record<
  string,
  { action: 'disable' | 'manual'; impact: 'low' | 'medium' | 'high'; reason: string }
> = {
  DiagTrack: { action: 'disable', impact: 'low', reason: 'Telemetry service' },
  dmwappushservice: { action: 'disable', impact: 'low', reason: 'WAP Push service' },
  MapsBroker: { action: 'disable', impact: 'low', reason: 'Downloaded Maps Manager' },
  RetailDemo: { action: 'disable', impact: 'low', reason: 'Retail Demo service' },
  SysMain: { action: 'disable', impact: 'medium', reason: 'Superfetch - not needed on SSDs' },
  WSearch: { action: 'manual', impact: 'high', reason: 'Windows Search - affects Start search' },
  XblAuthManager: { action: 'disable', impact: 'low', reason: 'Xbox Live Auth Manager' },
  XblGameSave: { action: 'disable', impact: 'low', reason: 'Xbox Live Game Save' },
  XboxNetApiSvc: { action: 'disable', impact: 'low', reason: 'Xbox Net API' },
  BITS: { action: 'manual', impact: 'low', reason: 'Background Intelligent Transfer' },
  Themes: { action: 'disable', impact: 'low', reason: 'Themes service' },
  TabletInputService: { action: 'disable', impact: 'low', reason: 'Tablet PC Input' },
};

export async function getSystemServices(): Promise<SystemService[]> {
  // One bulk CIM enumeration, then a hashtable join in PowerShell. The previous
  // version ran `Get-CimInstance -Filter "Name='...'"` once per service: ~300 WMI
  // queries inside a single call, measured at 68 s on the Security page.
  const result = await runPowerShell(`
    $services = Get-Service | Where-Object { $_.Name -ne 'WMPNetworkSvc' -or $_.Status -eq 'Running' };
    $cimByName = @{};
    foreach ($cimService in (Get-CimInstance -ClassName Win32_Service)) {
      $cimByName[$cimService.Name] = $cimService;
    }
    $result = @();
    foreach ($service in $services) {
      $cimService = $cimByName[$service.Name];
      $result += @{
        Name = $service.Name;
        DisplayName = $service.DisplayName;
        Description = $(if ($cimService) { $cimService.Description } else { $null });
        Status = $service.Status.ToString();
        StartType = $service.StartType.ToString()
      }
    };
    $result | ConvertTo-Json -Compress
  `);

  if (!result.success || !result.stdout) {
    return [];
  }

  const parsed = parsePowerShellJson<PowerShellService[]>(result.stdout);
  if (!parsed) {
    return [];
  }

  return toArray(parsed).map((service) => {
    const isProtected = PROTECTED_SERVICES.includes(service.Name);
    const optimization = OPTIMIZABLE_SERVICES[service.Name];

    return {
      id: service.Name,
      name: service.Name,
      displayName: service.DisplayName ?? service.Name,
      description: service.Description ?? '',
      status: service.Status.toLowerCase() as 'running' | 'stopped' | 'paused',
      startType: service.StartType.toLowerCase() as 'automatic' | 'manual' | 'disabled',
      canOptimize: !isProtected && !!optimization,
      recommendedAction: optimization?.action ?? 'keep',
      protection: isProtected ? 'protected' : optimization ? 'caution' : 'safe',
      impact: optimization?.impact ?? 'low',
    };
  });
}

export async function toggleService(
  serviceName: string,
  enabled: boolean
): Promise<{
  success: boolean;
  message: string;
}> {
  const name = psQuote(serviceName);
  const desired = enabled ? 'Running' : 'Stopped';
  try {
    // Apply, then RE-READ the service status. The command's exit code alone used
    // to be treated as success even when the service did not change state.
    const result = await runPowerShell(`
      $ErrorActionPreference = 'Stop';
      $name = ${name};
      $err = '';
      try {
        if (${enabled ? '$true' : '$false'}) { Start-Service -Name $name -ErrorAction Stop }
        else { Stop-Service -Name $name -Force -ErrorAction Stop }
      } catch { $err = $_.Exception.Message }
      if ($err -ne '') { Write-Output ("FAILED: " + $err) }
      else {
        $svc = Get-Service -Name $name -ErrorAction Stop;
        if ($svc.Status.ToString() -eq '${desired}') { Write-Output 'OK' }
        else { Write-Output ("FAILED: status is " + $svc.Status.ToString()) }
      }
    `);

    const output = result.stdout.trim();
    const success = result.success && output === 'OK';
    return {
      success,
      message: success
        ? `Service ${serviceName} ${enabled ? 'started' : 'stopped'}`
        : `Failed to ${enabled ? 'start' : 'stop'} service ${serviceName}: ${
            output || result.stderr || 'unknown error'
          }`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to toggle service ${serviceName}: ${String(error)}`,
    };
  }
}

export async function setServiceStartType(
  serviceName: string,
  startType: 'automatic' | 'manual' | 'disabled'
): Promise<{
  success: boolean;
  message: string;
}> {
  const name = psQuote(serviceName);
  const desired = startType.charAt(0).toUpperCase() + startType.slice(1);
  try {
    // Apply, then RE-READ the configured start type.
    const result = await runPowerShell(`
      $ErrorActionPreference = 'Stop';
      $name = ${name};
      $err = '';
      try { Set-Service -Name $name -StartupType ${desired} -ErrorAction Stop } catch { $err = $_.Exception.Message }
      if ($err -ne '') { Write-Output ("FAILED: " + $err) }
      else {
        $svc = Get-Service -Name $name -ErrorAction Stop;
        if ($svc.StartType.ToString() -eq '${desired}') { Write-Output 'OK' }
        else { Write-Output ("FAILED: start type is " + $svc.StartType.ToString()) }
      }
    `);

    const output = result.stdout.trim();
    const success = result.success && output === 'OK';
    return {
      success,
      message: success
        ? `Service ${serviceName} set to ${startType}`
        : `Failed to set service start type for ${serviceName}: ${
            output || result.stderr || 'unknown error'
          }`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to set service start type for ${serviceName}: ${String(error)}`,
    };
  }
}
