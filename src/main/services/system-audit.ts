import { runPowerShell } from './powershell';
import type { AuditCheck, AuditReport } from '@shared/types';

/** One check's stdout payload: the exact shape the check bodies already read. */
type CheckOutput = { stdout: string };

const EMPTY_OUTPUT: CheckOutput = { stdout: '' };

const marker = (index: number): string => `@@FCHK_${index}@@`;

/**
 * Wrap every check script in its own scope and print a marker before it, so a
 * single PowerShell process serves all checks and stdout can be split back
 * apart. try/catch keeps one failing check from aborting the remaining ones.
 */
function buildAuditScript(scripts: readonly string[]): string {
  return scripts
    .map(
      (script, index) =>
        `Write-Output '${marker(index)}'\ntry {\n& {\n${script}\n}\n} catch { Write-Output '' }`
    )
    .join('\n');
}

/**
 * Split the combined stdout into one payload per script, in script order.
 * Missing markers (failed or aborted run) yield empty payloads - the same
 * degradation a single failed `runPowerShell` call used to produce.
 */
export function splitAuditOutput(stdout: string, count: number): string[] {
  const payloads: string[] = Array.from({ length: count }, () => '');
  let current = -1;
  let buffer: string[] = [];

  const flush = (): void => {
    if (current >= 0 && current < count) payloads[current] = buffer.join('\n').trim();
    buffer = [];
  };

  for (const line of stdout.split(/\r?\n/)) {
    const match = /^@@FCHK_(\d+)@@$/.exec(line.trim());
    if (match) {
      flush();
      current = Number(match[1]);
      continue;
    }
    if (current >= 0) buffer.push(line);
  }
  flush();
  return payloads;
}

/**
 * Startup-app count from a JSON payload, degrading to 0 instead of throwing:
 * one non-JSON block (a stray warning, an aborted check) must not reject the
 * whole `audit:run` for the other 30 checks.
 */
function countFromJson(stdout: string): number {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (Array.isArray(parsed)) return parsed.length;
    return parsed !== null && typeof parsed === 'object' ? 1 : 0;
  } catch {
    return 0;
  }
}
const PRIVACY_SCRIPTS: string[] = [
  // Telemetry level
  `
    $value = Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" -Name "AllowTelemetry" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.AllowTelemetry } else { Write-Output "NOT_SET" }
  `,

  // Cortana
  `
    $value = Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search" -Name "AllowCortana" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.AllowCortana } else { Write-Output "NOT_SET" }
  `,

  // Activity History
  `
    $value = Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" -Name "EnableActivityFeed" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.EnableActivityFeed } else { Write-Output "NOT_SET" }
  `,

  // Advertising ID
  `
    $value = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo" -Name "Enabled" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.Enabled } else { Write-Output "NOT_SET" }
  `,

  // Location tracking
  `
    $value = Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DeviceAccess\\Global\\{BFA794E4-F964-4FDB-90F6-51056CFE4B44}" -Name "Value" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.Value } else { Write-Output "NOT_SET" }
  `,

  // Feedback notifications
  `
    $value = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Siuf\\Rules" -Name "NumberOfSIUFInPeriod" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.NumberOfSIUFInPeriod } else { Write-Output "NOT_SET" }
  `,

  // App diagnostics
  `
    $value = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppDiagnostics" -Name "AppDiagnosticsEnabled" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.AppDiagnosticsEnabled } else { Write-Output "NOT_SET" }
  `,

  // Tailored experiences
  `
    $value = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy" -Name "TailoredExperiencesWithDiagnosticDataEnabled" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.TailoredExperiencesWithDiagnosticDataEnabled } else { Write-Output "NOT_SET" }
  `,
];

function buildPrivacyChecks(outputs: readonly CheckOutput[]): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const [
    telemetryResult = EMPTY_OUTPUT,
    cortanaResult = EMPTY_OUTPUT,
    activityResult = EMPTY_OUTPUT,
    adIdResult = EMPTY_OUTPUT,
    locationResult = EMPTY_OUTPUT,
    feedbackResult = EMPTY_OUTPUT,
    diagResult = EMPTY_OUTPUT,
    tailoredResult = EMPTY_OUTPUT,
  ] = outputs;

  const telemetryValue = telemetryResult.stdout.trim();
  checks.push({
    id: 'privacy-telemetry',
    name: 'Telemetry Level',
    category: 'privacy',
    status: telemetryValue === '0' ? 'pass' : telemetryValue === '1' ? 'warning' : 'critical',
    description:
      telemetryValue === '0'
        ? 'Telemetry is disabled'
        : telemetryValue === '1'
          ? 'Telemetry is set to minimum'
          : 'Telemetry is at default level',
    recommendation: 'Set telemetry to 0 (Security) via Group Policy or registry',
    impact: 'medium',
    autoFixable: true,
  });

  const cortanaValue = cortanaResult.stdout.trim();
  checks.push({
    id: 'privacy-cortana',
    name: 'Cortana Enabled',
    category: 'privacy',
    status: cortanaValue === '0' ? 'pass' : 'warning',
    description: cortanaValue === '0' ? 'Cortana is disabled' : 'Cortana is enabled',
    recommendation: 'Disable Cortana to reduce data collection',
    impact: 'medium',
    autoFixable: true,
  });

  const activityValue = activityResult.stdout.trim();
  checks.push({
    id: 'privacy-activity-history',
    name: 'Activity History',
    category: 'privacy',
    status: activityValue === '0' ? 'pass' : 'warning',
    description:
      activityValue === '0' ? 'Activity history is disabled' : 'Activity history is enabled',
    recommendation: 'Disable activity history tracking',
    impact: 'low',
    autoFixable: true,
  });

  const adIdValue = adIdResult.stdout.trim();
  checks.push({
    id: 'privacy-advertising-id',
    name: 'Advertising ID',
    category: 'privacy',
    status: adIdValue === '0' ? 'pass' : 'warning',
    description: adIdValue === '0' ? 'Advertising ID is disabled' : 'Advertising ID is enabled',
    recommendation: 'Disable advertising ID for personalized ads',
    impact: 'low',
    autoFixable: true,
  });

  const locationValue = locationResult.stdout.trim();
  checks.push({
    id: 'privacy-location',
    name: 'Location Tracking',
    category: 'privacy',
    status: locationValue === 'Deny' ? 'pass' : 'warning',
    description:
      locationValue === 'Deny' ? 'Location tracking is disabled' : 'Location tracking is enabled',
    recommendation: 'Disable location tracking',
    impact: 'medium',
    autoFixable: true,
  });

  const feedbackValue = feedbackResult.stdout.trim();
  checks.push({
    id: 'privacy-feedback',
    name: 'Feedback Notifications',
    category: 'privacy',
    status: feedbackValue === '0' ? 'pass' : 'warning',
    description:
      feedbackValue === '0'
        ? 'Feedback notifications are disabled'
        : 'Feedback notifications are enabled',
    recommendation: 'Disable feedback notifications',
    impact: 'low',
    autoFixable: true,
  });

  const diagValue = diagResult.stdout.trim();
  checks.push({
    id: 'privacy-app-diagnostics',
    name: 'App Diagnostics',
    category: 'privacy',
    status: diagValue === '0' ? 'pass' : 'warning',
    description: diagValue === '0' ? 'App diagnostics are disabled' : 'App diagnostics are enabled',
    recommendation: 'Disable app diagnostics to prevent data collection',
    impact: 'low',
    autoFixable: true,
  });

  const tailoredValue = tailoredResult.stdout.trim();
  checks.push({
    id: 'privacy-tailored-experiences',
    name: 'Tailored Experiences',
    category: 'privacy',
    status: tailoredValue === '0' ? 'pass' : 'warning',
    description:
      tailoredValue === '0'
        ? 'Tailored experiences are disabled'
        : 'Tailored experiences are enabled',
    recommendation: 'Disable tailored experiences',
    impact: 'low',
    autoFixable: true,
  });

  return checks;
}

const PERFORMANCE_SCRIPTS: string[] = [
  // Power plan
  `
    $plan = powercfg /getactivescheme;
    Write-Output $plan
  `,

  // Visual effects
  `
    $value = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects" -Name "VisualFXSetting" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.VisualFXSetting } else { Write-Output "NOT_SET" }
  `,

  // Page file
  `
    $value = Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management" -Name "PagingFiles" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.PagingFiles } else { Write-Output "NOT_SET" }
  `,

  // Startup programs count
  `
    $count = (Get-CimInstance -ClassName Win32_StartupCommand | Measure-Object).Count;
    Write-Output $count
  `,

  // SysMain/Superfetch
  `
    $service = Get-Service -Name "SysMain" -ErrorAction SilentlyContinue;
    if ($service) { Write-Output $service.Status } else { Write-Output "NOT_FOUND" }
  `,

  // Hibernation
  `
    $value = Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power" -Name "HibernateEnabled" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.HibernateEnabled } else { Write-Output "NOT_SET" }
  `,

  // Search indexing
  `
    $service = Get-Service -Name "WSearch" -ErrorAction SilentlyContinue;
    if ($service) { Write-Output $service.Status } else { Write-Output "NOT_FOUND" }
  `,

  // Background apps
  `
    $value = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications" -Name "GlobalUserDisabled" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.GlobalUserDisabled } else { Write-Output "NOT_SET" }
  `,
];

function buildPerformanceChecks(outputs: readonly CheckOutput[]): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const [
    powerResult = EMPTY_OUTPUT,
    visualResult = EMPTY_OUTPUT,
    pageFileResult = EMPTY_OUTPUT,
    startupResult = EMPTY_OUTPUT,
    sysMainResult = EMPTY_OUTPUT,
    hiberResult = EMPTY_OUTPUT,
    searchResult = EMPTY_OUTPUT,
    bgAppsResult = EMPTY_OUTPUT,
  ] = outputs;

  const powerPlan = powerResult.stdout;
  const isHighPerformance =
    powerPlan.includes('High performance') || powerPlan.includes('Ultimate Performance');
  checks.push({
    id: 'perf-power-plan',
    name: 'Power Plan',
    category: 'performance',
    status: isHighPerformance ? 'pass' : 'warning',
    description: isHighPerformance
      ? 'High performance power plan is active'
      : 'Power plan is not optimized for performance',
    recommendation: 'Set power plan to High Performance for better performance',
    impact: 'high',
    autoFixable: true,
  });

  const visualValue = visualResult.stdout.trim();
  checks.push({
    id: 'perf-visual-effects',
    name: 'Visual Effects',
    category: 'performance',
    status: visualValue === '2' ? 'pass' : 'warning',
    description:
      visualValue === '2'
        ? 'Visual effects are optimized for performance'
        : 'Visual effects are not optimized',
    recommendation: 'Adjust visual effects for best performance',
    impact: 'medium',
    autoFixable: true,
  });

  const pageFileValue = pageFileResult.stdout.trim();
  checks.push({
    id: 'perf-page-file',
    name: 'Page File Configuration',
    category: 'performance',
    status: pageFileValue && pageFileValue !== 'NOT_SET' ? 'pass' : 'warning',
    description:
      pageFileValue && pageFileValue !== 'NOT_SET'
        ? 'Page file is configured'
        : 'Page file is not configured',
    recommendation: 'Ensure page file is system managed or set to 1.5x RAM',
    impact: 'medium',
    autoFixable: false,
  });

  const startupCount = parseInt(startupResult.stdout.trim(), 10) || 0;
  checks.push({
    id: 'perf-startup-count',
    name: 'Startup Programs',
    category: 'performance',
    status: startupCount <= 5 ? 'pass' : startupCount <= 10 ? 'warning' : 'critical',
    description: `${startupCount} programs start with Windows`,
    recommendation: 'Disable unnecessary startup programs',
    impact: 'high',
    autoFixable: false,
  });

  const sysMainStatus = sysMainResult.stdout.trim();
  checks.push({
    id: 'perf-sysmain',
    name: 'SysMain (Superfetch)',
    category: 'performance',
    status: sysMainStatus === 'Stopped' ? 'pass' : 'warning',
    description:
      sysMainStatus === 'Stopped'
        ? 'SysMain is disabled (recommended for SSDs)'
        : 'SysMain is running',
    recommendation: 'Disable SysMain if using an SSD',
    impact: 'medium',
    autoFixable: true,
  });

  const hiberValue = hiberResult.stdout.trim();
  checks.push({
    id: 'perf-hibernation',
    name: 'Hibernation',
    category: 'performance',
    status: hiberValue === '0' ? 'pass' : 'warning',
    description: hiberValue === '0' ? 'Hibernation is disabled' : 'Hibernation is enabled',
    recommendation: 'Disable hibernation to save disk space',
    impact: 'low',
    autoFixable: true,
  });

  const searchStatus = searchResult.stdout.trim();
  checks.push({
    id: 'perf-search-indexing',
    name: 'Windows Search Indexing',
    category: 'performance',
    status: searchStatus === 'Running' ? 'warning' : 'pass',
    description:
      searchStatus === 'Running'
        ? 'Search indexing is running (uses resources)'
        : 'Search indexing is disabled',
    recommendation: 'Consider disabling search indexing if not needed',
    impact: 'medium',
    autoFixable: true,
  });

  const bgAppsValue = bgAppsResult.stdout.trim();
  checks.push({
    id: 'perf-background-apps',
    name: 'Background Apps',
    category: 'performance',
    status: bgAppsValue === '1' ? 'pass' : 'warning',
    description:
      bgAppsValue === '1' ? 'Background apps are disabled' : 'Background apps are enabled',
    recommendation: 'Disable background apps to save resources',
    impact: 'medium',
    autoFixable: true,
  });

  return checks;
}

const MEMORY_SCRIPTS: string[] = [
  // Memory usage
  `
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $total = $os.TotalVisibleMemorySize;
    $free = $os.FreePhysicalMemory;
    $usedPercent = [math]::Round((($total - $free) / $total) * 100, 2);
    Write-Output "$usedPercent"
  `,

  // Virtual memory
  `
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $total = $os.TotalVirtualMemorySize;
    $free = $os.FreeVirtualMemory;
    $usedPercent = [math]::Round((($total - $free) / $total) * 100, 2);
    Write-Output "$usedPercent"
  `,

  // Memory compression
  `
    $value = Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management" -Name "DisablePagingExecutive" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.DisablePagingExecutive } else { Write-Output "NOT_SET" }
  `,
];

function buildMemoryChecks(outputs: readonly CheckOutput[]): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const [
    memResult = EMPTY_OUTPUT,
    virtMemResult = EMPTY_OUTPUT,
    memCompressionResult = EMPTY_OUTPUT,
  ] = outputs;

  const memUsage = parseFloat(memResult.stdout.trim()) || 0;
  checks.push({
    id: 'memory-usage',
    name: 'Memory Usage',
    category: 'memory',
    status: memUsage < 70 ? 'pass' : memUsage < 85 ? 'warning' : 'critical',
    description: `Memory usage is at ${memUsage}%`,
    recommendation: 'Close unused programs or upgrade RAM',
    impact: 'high',
    autoFixable: false,
  });

  const virtMemUsage = parseFloat(virtMemResult.stdout.trim()) || 0;
  checks.push({
    id: 'memory-virtual',
    name: 'Virtual Memory Usage',
    category: 'memory',
    status: virtMemUsage < 70 ? 'pass' : virtMemUsage < 85 ? 'warning' : 'critical',
    description: `Virtual memory usage is at ${virtMemUsage}%`,
    recommendation: 'Increase page file size or add more RAM',
    impact: 'medium',
    autoFixable: false,
  });

  const memCompressionValue = memCompressionResult.stdout.trim();
  checks.push({
    id: 'memory-compression',
    name: 'Memory Compression',
    category: 'memory',
    status: memCompressionValue === '1' ? 'pass' : 'warning',
    description:
      memCompressionValue === '1'
        ? 'Memory compression is enabled'
        : 'Memory compression is disabled',
    recommendation: 'Enable memory compression for better performance',
    impact: 'low',
    autoFixable: true,
  });

  return checks;
}

const STORAGE_SCRIPTS: string[] = [
  // Disk space
  `
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'";
    $freePercent = [math]::Round(($disk.FreeSpace / $disk.Size) * 100, 2);
    Write-Output "$freePercent"
  `,

  // Temp files
  `
    $tempPath = $env:TEMP;
    $size = (Get-ChildItem -Path $tempPath -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum;
    $sizeMB = [math]::Round($size / 1MB, 2);
    Write-Output "$sizeMB"
  `,

  // Recycle bin
  `
    $size = (Get-ChildItem -LiteralPath 'C:\\$Recycle.Bin' -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum;
    $sizeMB = [math]::Round($size / 1MB, 2);
    Write-Output "$sizeMB"
  `,

  // Windows Update cache
  `
    $size = (Get-ChildItem -Path "C:\\Windows\\SoftwareDistribution\\Download" -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum;
    $sizeMB = [math]::Round($size / 1MB, 2);
    Write-Output "$sizeMB"
  `,

  // Disk fragmentation (SSD check)
  `
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'";
    $defrag = Get-DefragAnalysis -DriveLetter C -ErrorAction SilentlyContinue;
    if ($defrag) { Write-Output $defrag.Fragmentation } else { Write-Output "0" }
  `,
];

function buildStorageChecks(outputs: readonly CheckOutput[]): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const [
    diskResult = EMPTY_OUTPUT,
    tempResult = EMPTY_OUTPUT,
    recycleResult = EMPTY_OUTPUT,
    wuResult = EMPTY_OUTPUT,
    fragResult = EMPTY_OUTPUT,
  ] = outputs;

  const freePercent = parseFloat(diskResult.stdout.trim()) || 0;
  checks.push({
    id: 'storage-disk-space',
    name: 'Disk Space (C:)',
    category: 'storage',
    status: freePercent > 20 ? 'pass' : freePercent > 10 ? 'warning' : 'critical',
    description: `${freePercent}% free space on C:`,
    recommendation: 'Free up disk space by removing unnecessary files',
    impact: 'high',
    autoFixable: false,
  });

  const tempSize = parseFloat(tempResult.stdout.trim()) || 0;
  checks.push({
    id: 'storage-temp-files',
    name: 'Temporary Files',
    category: 'storage',
    status: tempSize < 500 ? 'pass' : tempSize < 2000 ? 'warning' : 'critical',
    description: `${tempSize} MB of temporary files`,
    recommendation: 'Clean temporary files to free up space',
    impact: 'medium',
    autoFixable: true,
  });

  const recycleSize = parseFloat(recycleResult.stdout.trim()) || 0;
  checks.push({
    id: 'storage-recycle-bin',
    name: 'Recycle Bin',
    category: 'storage',
    status: recycleSize < 500 ? 'pass' : recycleSize < 2000 ? 'warning' : 'critical',
    description: `${recycleSize} MB in recycle bin`,
    recommendation: 'Empty the recycle bin',
    impact: 'low',
    autoFixable: true,
  });

  const wuSize = parseFloat(wuResult.stdout.trim()) || 0;
  checks.push({
    id: 'storage-wu-cache',
    name: 'Windows Update Cache',
    category: 'storage',
    status: wuSize < 500 ? 'pass' : wuSize < 2000 ? 'warning' : 'critical',
    description: `${wuSize} MB of Windows Update cache`,
    recommendation: 'Clean Windows Update cache',
    impact: 'medium',
    autoFixable: true,
  });

  const fragPercent = parseFloat(fragResult.stdout.trim()) || 0;
  checks.push({
    id: 'storage-fragmentation',
    name: 'Disk Fragmentation',
    category: 'storage',
    status: fragPercent < 10 ? 'pass' : fragPercent < 30 ? 'warning' : 'critical',
    description: `Disk fragmentation is at ${fragPercent}%`,
    recommendation: 'Defragment the disk (not needed for SSDs)',
    impact: 'medium',
    autoFixable: true,
  });

  return checks;
}

const STARTUP_SCRIPTS: string[] = [
  // Startup apps
  `
    $apps = Get-CimInstance -ClassName Win32_StartupCommand;
    $result = @();
    foreach ($app in $apps) {
      $result += @{
        Name = $app.Name;
        Command = $app.Command;
        Location = $app.Location
      }
    };
    $result | ConvertTo-Json -Compress
  `,

  // Boot time
  `
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $lastBoot = $os.LastBootUpTime;
    $uptime = (Get-Date) - $lastBoot;
    $bootTime = $uptime.TotalSeconds;
    Write-Output "$bootTime"
  `,

  // Scheduled tasks
  `
    $tasks = Get-ScheduledTask | Where-Object { $_.State -eq 'Ready' -and $_.Triggers -match 'AtStartup' };
    $count = ($tasks | Measure-Object).Count;
    Write-Output "$count"
  `,
];

function buildStartupChecks(outputs: readonly CheckOutput[]): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const [startupResult = EMPTY_OUTPUT, bootResult = EMPTY_OUTPUT, tasksResult = EMPTY_OUTPUT] =
    outputs;

  const startupCount = countFromJson(startupResult.stdout);
  checks.push({
    id: 'startup-apps',
    name: 'Startup Applications',
    category: 'startup',
    status: startupCount <= 5 ? 'pass' : startupCount <= 10 ? 'warning' : 'critical',
    description: `${startupCount} applications start with Windows`,
    recommendation: 'Disable unnecessary startup applications',
    impact: 'high',
    autoFixable: false,
  });

  const bootTime = parseFloat(bootResult.stdout.trim()) || 0;
  checks.push({
    id: 'startup-boot-time',
    name: 'Boot Time',
    category: 'startup',
    status: bootTime < 60 ? 'pass' : bootTime < 120 ? 'warning' : 'critical',
    description: `Last boot took ${Math.round(bootTime)} seconds`,
    recommendation: 'Optimize startup to reduce boot time',
    impact: 'high',
    autoFixable: false,
  });

  const tasksCount = parseInt(tasksResult.stdout.trim(), 10) || 0;
  checks.push({
    id: 'startup-scheduled-tasks',
    name: 'Startup Scheduled Tasks',
    category: 'startup',
    status: tasksCount <= 5 ? 'pass' : tasksCount <= 10 ? 'warning' : 'critical',
    description: `${tasksCount} scheduled tasks run at startup`,
    recommendation: 'Review and disable unnecessary startup tasks',
    impact: 'medium',
    autoFixable: false,
  });

  return checks;
}

const NETWORK_SCRIPTS: string[] = [
  // DNS configuration
  `
    $dns = Get-DnsClientServerAddress | Where-Object { $_.ServerAddresses };
    $result = @();
    foreach ($d in $dns) {
      $result += @{
        Interface = $d.InterfaceAlias;
        Servers = $d.ServerAddresses
      }
    };
    $result | ConvertTo-Json -Compress
  `,

  // Network adapter status
  `
    $adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' };
    $count = ($adapters | Measure-Object).Count;
    Write-Output "$count"
  `,

  // Firewall status
  `
    $fw = Get-NetFirewallProfile | Where-Object { $_.Enabled -eq 'True' };
    $count = ($fw | Measure-Object).Count;
    Write-Output "$count"
  `,

  // Proxy settings
  `
    $proxy = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyEnable" -ErrorAction SilentlyContinue;
    if ($proxy) { Write-Output $proxy.ProxyEnable } else { Write-Output "NOT_SET" }
  `,
];

function buildNetworkChecks(outputs: readonly CheckOutput[]): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const [
    dnsResult = EMPTY_OUTPUT,
    adapterResult = EMPTY_OUTPUT,
    fwResult = EMPTY_OUTPUT,
    proxyResult = EMPTY_OUTPUT,
  ] = outputs;

  const dnsConfig = dnsResult.stdout.trim();
  checks.push({
    id: 'network-dns',
    name: 'DNS Configuration',
    category: 'network',
    status: dnsConfig && dnsConfig !== 'NOT_SET' ? 'pass' : 'warning',
    description:
      dnsConfig && dnsConfig !== 'NOT_SET'
        ? 'DNS servers are configured'
        : 'DNS servers are not configured',
    recommendation: 'Use reliable DNS servers like 8.8.8.8 or 1.1.1.1',
    impact: 'medium',
    autoFixable: true,
  });

  const adapterCount = parseInt(adapterResult.stdout.trim(), 10) || 0;
  checks.push({
    id: 'network-adapters',
    name: 'Network Adapters',
    category: 'network',
    status: adapterCount > 0 ? 'pass' : 'critical',
    description:
      adapterCount > 0 ? `${adapterCount} network adapter(s) active` : 'No active network adapters',
    recommendation: 'Check network adapter drivers and connections',
    impact: 'high',
    autoFixable: false,
  });

  const fwCount = parseInt(fwResult.stdout.trim(), 10) || 0;
  checks.push({
    id: 'network-firewall',
    name: 'Firewall Status',
    category: 'network',
    status: fwCount >= 3 ? 'pass' : fwCount >= 1 ? 'warning' : 'critical',
    description: `${fwCount} firewall profile(s) enabled`,
    recommendation: 'Enable firewall for all network profiles',
    impact: 'high',
    autoFixable: true,
  });

  const proxyValue = proxyResult.stdout.trim();
  checks.push({
    id: 'network-proxy',
    name: 'Proxy Configuration',
    category: 'network',
    status: proxyValue === '0' ? 'pass' : 'warning',
    description: proxyValue === '0' ? 'No proxy configured' : 'Proxy is configured',
    recommendation: 'Disable proxy if not needed for better connectivity',
    impact: 'low',
    autoFixable: true,
  });

  return checks;
}

const CHECK_GROUPS: ReadonlyArray<{
  scripts: readonly string[];
  build: (outputs: readonly CheckOutput[]) => AuditCheck[];
}> = [
  { scripts: PRIVACY_SCRIPTS, build: buildPrivacyChecks },
  { scripts: PERFORMANCE_SCRIPTS, build: buildPerformanceChecks },
  { scripts: MEMORY_SCRIPTS, build: buildMemoryChecks },
  { scripts: STORAGE_SCRIPTS, build: buildStorageChecks },
  { scripts: STARTUP_SCRIPTS, build: buildStartupChecks },
  { scripts: NETWORK_SCRIPTS, build: buildNetworkChecks },
];

export async function runSystemAudit(): Promise<AuditReport> {
  const scripts = CHECK_GROUPS.flatMap((group) => group.scripts);

  // One PowerShell process for the whole audit. Each spawn costs ~1.8 s on this
  // machine, so the old per-check spawns paid ~31 of them: `audit:run` measured
  // 73 s end to end. The combined script stays under CreateProcess 32 767-char
  // command-line limit (the script is UTF-16 then base64 encoded).
  const result = await runPowerShell(buildAuditScript(scripts));
  const payloads = splitAuditOutput(result.stdout, scripts.length);

  const checks: AuditCheck[] = [];
  let cursor = 0;
  for (const group of CHECK_GROUPS) {
    const outputs = payloads
      .slice(cursor, cursor + group.scripts.length)
      .map((stdout) => ({ stdout }));
    cursor += group.scripts.length;
    checks.push(...group.build(outputs));
  }

  const passedCount = checks.filter((c) => c.status === 'pass').length;
  const warningCount = checks.filter((c) => c.status === 'warning').length;
  const criticalCount = checks.filter((c) => c.status === 'critical').length;

  // Score: 100 - (warnings * 5) - (criticals * 15)
  const score = Math.max(0, 100 - warningCount * 5 - criticalCount * 15);

  return {
    checks,
    totalChecks: checks.length,
    passedCount,
    warningCount,
    criticalCount,
    score,
    timestamp: new Date(),
  };
}
