import { runPowerShell, parsePowerShellJson, toArray } from './powershell';

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
  try {
    if (enabled) {
      const result = await runPowerShell(`Start-Service -Name "${serviceName}" -ErrorAction Stop`);
      return {
        success: result.success,
        message: result.success
          ? `Service ${serviceName} started`
          : `Failed to start service: ${result.stderr}`,
      };
    } else {
      const result = await runPowerShell(
        `Stop-Service -Name "${serviceName}" -Force -ErrorAction Stop`
      );
      return {
        success: result.success,
        message: result.success
          ? `Service ${serviceName} stopped`
          : `Failed to stop service: ${result.stderr}`,
      };
    }
  } catch {
    return {
      success: false,
      message: `Failed to toggle service ${serviceName}`,
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
  try {
    const result = await runPowerShell(
      `Set-Service -Name "${serviceName}" -StartupType ${startType} -ErrorAction Stop`
    );
    return {
      success: result.success,
      message: result.success
        ? `Service ${serviceName} set to ${startType}`
        : `Failed to set service start type: ${result.stderr}`,
    };
  } catch {
    return {
      success: false,
      message: `Failed to set service start type for ${serviceName}`,
    };
  }
}
