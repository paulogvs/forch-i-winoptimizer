import { runPowerShell } from './powershell';
import type { AuditCheck, AuditReport } from '@shared/types';

export async function runSystemAudit(): Promise<AuditReport> {
  const checks: AuditCheck[] = [];

  // === Privacy Checks ===
  checks.push(...await runPrivacyChecks());

  // === Performance Checks ===
  checks.push(...await runPerformanceChecks());

  // === Memory Checks ===
  checks.push(...await runMemoryChecks());

  // === Storage Checks ===
  checks.push(...await runStorageChecks());

  // === Startup Checks ===
  checks.push(...await runStartupChecks());

  // === Network Checks ===
  checks.push(...await runNetworkChecks());

  const passedCount = checks.filter((c) => c.status === 'pass').length;
  const warningCount = checks.filter((c) => c.status === 'warning').length;
  const criticalCount = checks.filter((c) => c.status === 'critical').length;

  // Score: 100 - (warnings * 5) - (criticals * 15)
  const score = Math.max(0, 100 - (warningCount * 5) - (criticalCount * 15));

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

async function runPrivacyChecks(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  // Telemetry level
  const telemetryResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" -Name "AllowTelemetry" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.AllowTelemetry } else { Write-Output "NOT_SET" }
  `);
  const telemetryValue = telemetryResult.stdout.trim();
  checks.push({
    id: 'privacy-telemetry',
    name: 'Telemetry Level',
    category: 'privacy',
    status: telemetryValue === '0' ? 'pass' : telemetryValue === '1' ? 'warning' : 'critical',
    description: telemetryValue === '0' ? 'Telemetry is disabled' : telemetryValue === '1' ? 'Telemetry is set to minimum' : 'Telemetry is at default level',
    recommendation: 'Set telemetry to 0 (Security) via Group Policy or registry',
    impact: 'medium',
    autoFixable: true,
  });

  // Cortana
  const cortanaResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search" -Name "AllowCortana" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.AllowCortana } else { Write-Output "NOT_SET" }
  `);
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

  // Activity History
  const activityResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" -Name "EnableActivityFeed" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.EnableActivityFeed } else { Write-Output "NOT_SET" }
  `);
  const activityValue = activityResult.stdout.trim();
  checks.push({
    id: 'privacy-activity-history',
    name: 'Activity History',
    category: 'privacy',
    status: activityValue === '0' ? 'pass' : 'warning',
    description: activityValue === '0' ? 'Activity history is disabled' : 'Activity history is enabled',
    recommendation: 'Disable activity history tracking',
    impact: 'low',
    autoFixable: true,
  });

  // Advertising ID
  const adIdResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo" -Name "Enabled" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.Enabled } else { Write-Output "NOT_SET" }
  `);
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

  // Location tracking
  const locationResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DeviceAccess\\Global\\{BFA794E4-F964-4FDB-90F6-51056CFE4B44}" -Name "Value" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.Value } else { Write-Output "NOT_SET" }
  `);
  const locationValue = locationResult.stdout.trim();
  checks.push({
    id: 'privacy-location',
    name: 'Location Tracking',
    category: 'privacy',
    status: locationValue === 'Deny' ? 'pass' : 'warning',
    description: locationValue === 'Deny' ? 'Location tracking is disabled' : 'Location tracking is enabled',
    recommendation: 'Disable location tracking',
    impact: 'medium',
    autoFixable: true,
  });

  // Feedback notifications
  const feedbackResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Siuf\\Rules" -Name "NumberOfSIUFInPeriod" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.NumberOfSIUFInPeriod } else { Write-Output "NOT_SET" }
  `);
  const feedbackValue = feedbackResult.stdout.trim();
  checks.push({
    id: 'privacy-feedback',
    name: 'Feedback Notifications',
    category: 'privacy',
    status: feedbackValue === '0' ? 'pass' : 'warning',
    description: feedbackValue === '0' ? 'Feedback notifications are disabled' : 'Feedback notifications are enabled',
    recommendation: 'Disable feedback notifications',
    impact: 'low',
    autoFixable: true,
  });

  // App diagnostics
  const diagResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppDiagnostics" -Name "AppDiagnosticsEnabled" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.AppDiagnosticsEnabled } else { Write-Output "NOT_SET" }
  `);
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

  // Tailored experiences
  const tailoredResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy" -Name "TailoredExperiencesWithDiagnosticDataEnabled" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.TailoredExperiencesWithDiagnosticDataEnabled } else { Write-Output "NOT_SET" }
  `);
  const tailoredValue = tailoredResult.stdout.trim();
  checks.push({
    id: 'privacy-tailored-experiences',
    name: 'Tailored Experiences',
    category: 'privacy',
    status: tailoredValue === '0' ? 'pass' : 'warning',
    description: tailoredValue === '0' ? 'Tailored experiences are disabled' : 'Tailored experiences are enabled',
    recommendation: 'Disable tailored experiences',
    impact: 'low',
    autoFixable: true,
  });

  return checks;
}

async function runPerformanceChecks(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  // Power plan
  const powerResult = await runPowerShell(`
    $plan = powercfg /getactivescheme;
    Write-Output $plan
  `);
  const powerPlan = powerResult.stdout;
  const isHighPerformance = powerPlan.includes('High performance') || powerPlan.includes('Ultimate Performance');
  checks.push({
    id: 'perf-power-plan',
    name: 'Power Plan',
    category: 'performance',
    status: isHighPerformance ? 'pass' : 'warning',
    description: isHighPerformance ? 'High performance power plan is active' : 'Power plan is not optimized for performance',
    recommendation: 'Set power plan to High Performance for better performance',
    impact: 'high',
    autoFixable: true,
  });

  // Visual effects
  const visualResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects" -Name "VisualFXSetting" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.VisualFXSetting } else { Write-Output "NOT_SET" }
  `);
  const visualValue = visualResult.stdout.trim();
  checks.push({
    id: 'perf-visual-effects',
    name: 'Visual Effects',
    category: 'performance',
    status: visualValue === '2' ? 'pass' : 'warning',
    description: visualValue === '2' ? 'Visual effects are optimized for performance' : 'Visual effects are not optimized',
    recommendation: 'Adjust visual effects for best performance',
    impact: 'medium',
    autoFixable: true,
  });

  // Page file
  const pageFileResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management" -Name "PagingFiles" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.PagingFiles } else { Write-Output "NOT_SET" }
  `);
  const pageFileValue = pageFileResult.stdout.trim();
  checks.push({
    id: 'perf-page-file',
    name: 'Page File Configuration',
    category: 'performance',
    status: pageFileValue && pageFileValue !== 'NOT_SET' ? 'pass' : 'warning',
    description: pageFileValue && pageFileValue !== 'NOT_SET' ? 'Page file is configured' : 'Page file is not configured',
    recommendation: 'Ensure page file is system managed or set to 1.5x RAM',
    impact: 'medium',
    autoFixable: false,
  });

  // Startup programs count
  const startupResult = await runPowerShell(`
    $count = (Get-CimInstance -ClassName Win32_StartupCommand | Measure-Object).Count;
    Write-Output $count
  `);
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

  // SysMain/Superfetch
  const sysMainResult = await runPowerShell(`
    $service = Get-Service -Name "SysMain" -ErrorAction SilentlyContinue;
    if ($service) { Write-Output $service.Status } else { Write-Output "NOT_FOUND" }
  `);
  const sysMainStatus = sysMainResult.stdout.trim();
  checks.push({
    id: 'perf-sysmain',
    name: 'SysMain (Superfetch)',
    category: 'performance',
    status: sysMainStatus === 'Stopped' ? 'pass' : 'warning',
    description: sysMainStatus === 'Stopped' ? 'SysMain is disabled (recommended for SSDs)' : 'SysMain is running',
    recommendation: 'Disable SysMain if using an SSD',
    impact: 'medium',
    autoFixable: true,
  });

  // Hibernation
  const hiberResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power" -Name "HibernateEnabled" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.HibernateEnabled } else { Write-Output "NOT_SET" }
  `);
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

  // Search indexing
  const searchResult = await runPowerShell(`
    $service = Get-Service -Name "WSearch" -ErrorAction SilentlyContinue;
    if ($service) { Write-Output $service.Status } else { Write-Output "NOT_FOUND" }
  `);
  const searchStatus = searchResult.stdout.trim();
  checks.push({
    id: 'perf-search-indexing',
    name: 'Windows Search Indexing',
    category: 'performance',
    status: searchStatus === 'Running' ? 'warning' : 'pass',
    description: searchStatus === 'Running' ? 'Search indexing is running (uses resources)' : 'Search indexing is disabled',
    recommendation: 'Consider disabling search indexing if not needed',
    impact: 'medium',
    autoFixable: true,
  });

  // Background apps
  const bgAppsResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications" -Name "GlobalUserDisabled" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.GlobalUserDisabled } else { Write-Output "NOT_SET" }
  `);
  const bgAppsValue = bgAppsResult.stdout.trim();
  checks.push({
    id: 'perf-background-apps',
    name: 'Background Apps',
    category: 'performance',
    status: bgAppsValue === '1' ? 'pass' : 'warning',
    description: bgAppsValue === '1' ? 'Background apps are disabled' : 'Background apps are enabled',
    recommendation: 'Disable background apps to save resources',
    impact: 'medium',
    autoFixable: true,
  });

  return checks;
}

async function runMemoryChecks(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  // Memory usage
  const memResult = await runPowerShell(`
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $total = $os.TotalVisibleMemorySize;
    $free = $os.FreePhysicalMemory;
    $usedPercent = [math]::Round((($total - $free) / $total) * 100, 2);
    Write-Output "$usedPercent"
  `);
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

  // Virtual memory
  const virtMemResult = await runPowerShell(`
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $total = $os.TotalVirtualMemorySize;
    $free = $os.FreeVirtualMemory;
    $usedPercent = [math]::Round((($total - $free) / $total) * 100, 2);
    Write-Output "$usedPercent"
  `);
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

  // Memory compression
  const memCompressionResult = await runPowerShell(`
    $value = Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management" -Name "DisablePagingExecutive" -ErrorAction SilentlyContinue;
    if ($value) { Write-Output $value.DisablePagingExecutive } else { Write-Output "NOT_SET" }
  `);
  const memCompressionValue = memCompressionResult.stdout.trim();
  checks.push({
    id: 'memory-compression',
    name: 'Memory Compression',
    category: 'memory',
    status: memCompressionValue === '1' ? 'pass' : 'warning',
    description: memCompressionValue === '1' ? 'Memory compression is enabled' : 'Memory compression is disabled',
    recommendation: 'Enable memory compression for better performance',
    impact: 'low',
    autoFixable: true,
  });

  return checks;
}

async function runStorageChecks(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  // Disk space
  const diskResult = await runPowerShell(`
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'";
    $freePercent = [math]::Round(($disk.FreeSpace / $disk.Size) * 100, 2);
    Write-Output "$freePercent"
  `);
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

  // Temp files
  const tempResult = await runPowerShell(`
    $tempPath = $env:TEMP;
    $size = (Get-ChildItem -Path $tempPath -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum;
    $sizeMB = [math]::Round($size / 1MB, 2);
    Write-Output "$sizeMB"
  `);
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

  // Recycle bin
  const recycleResult = await runPowerShell(`
    $size = (Get-ChildItem -Path "C:\\$Recycle.Bin" -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum;
    $sizeMB = [math]::Round($size / 1MB, 2);
    Write-Output "$sizeMB"
  `);
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

  // Windows Update cache
  const wuResult = await runPowerShell(`
    $size = (Get-ChildItem -Path "C:\\Windows\\SoftwareDistribution\\Download" -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum;
    $sizeMB = [math]::Round($size / 1MB, 2);
    Write-Output "$sizeMB"
  `);
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

  // Disk fragmentation (SSD check)
  const fragResult = await runPowerShell(`
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'";
    $defrag = Get-DefragAnalysis -DriveLetter C -ErrorAction SilentlyContinue;
    if ($defrag) { Write-Output $defrag.Fragmentation } else { Write-Output "0" }
  `);
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

async function runStartupChecks(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  // Startup apps
  const startupResult = await runPowerShell(`
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
  `);
  const startupCount = startupResult.stdout ? JSON.parse(startupResult.stdout).length : 0;
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

  // Boot time
  const bootResult = await runPowerShell(`
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $lastBoot = $os.LastBootUpTime;
    $uptime = (Get-Date) - $lastBoot;
    $bootTime = $uptime.TotalSeconds;
    Write-Output "$bootTime"
  `);
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

  // Scheduled tasks
  const tasksResult = await runPowerShell(`
    $tasks = Get-ScheduledTask | Where-Object { $_.State -eq 'Ready' -and $_.Triggers -match 'AtStartup' };
    $count = ($tasks | Measure-Object).Count;
    Write-Output "$count"
  `);
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

async function runNetworkChecks(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  // DNS configuration
  const dnsResult = await runPowerShell(`
    $dns = Get-DnsClientServerAddress | Where-Object { $_.ServerAddresses };
    $result = @();
    foreach ($d in $dns) {
      $result += @{
        Interface = $d.InterfaceAlias;
        Servers = $d.ServerAddresses
      }
    };
    $result | ConvertTo-Json -Compress
  `);
  const dnsConfig = dnsResult.stdout.trim();
  checks.push({
    id: 'network-dns',
    name: 'DNS Configuration',
    category: 'network',
    status: dnsConfig && dnsConfig !== 'NOT_SET' ? 'pass' : 'warning',
    description: dnsConfig && dnsConfig !== 'NOT_SET' ? 'DNS servers are configured' : 'DNS servers are not configured',
    recommendation: 'Use reliable DNS servers like 8.8.8.8 or 1.1.1.1',
    impact: 'medium',
    autoFixable: true,
  });

  // Network adapter status
  const adapterResult = await runPowerShell(`
    $adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' };
    $count = ($adapters | Measure-Object).Count;
    Write-Output "$count"
  `);
  const adapterCount = parseInt(adapterResult.stdout.trim(), 10) || 0;
  checks.push({
    id: 'network-adapters',
    name: 'Network Adapters',
    category: 'network',
    status: adapterCount > 0 ? 'pass' : 'critical',
    description: adapterCount > 0 ? `${adapterCount} network adapter(s) active` : 'No active network adapters',
    recommendation: 'Check network adapter drivers and connections',
    impact: 'high',
    autoFixable: false,
  });

  // Firewall status
  const fwResult = await runPowerShell(`
    $fw = Get-NetFirewallProfile | Where-Object { $_.Enabled -eq 'True' };
    $count = ($fw | Measure-Object).Count;
    Write-Output "$count"
  `);
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

  // Proxy settings
  const proxyResult = await runPowerShell(`
    $proxy = Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxyEnable" -ErrorAction SilentlyContinue;
    if ($proxy) { Write-Output $proxy.ProxyEnable } else { Write-Output "NOT_SET" }
  `);
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
