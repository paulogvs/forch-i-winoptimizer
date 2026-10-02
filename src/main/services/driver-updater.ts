import { runPowerShell, parsePowerShellJson } from './powershell';
import { createNoopReporter, type ScanProgressReporter } from './scan-progress';
import type { DriverInfo, DriverScanResult } from '@shared/types';

interface PnPDevice {
  DeviceID: string;
  Name: string;
  Manufacturer: string;
  DriverVersion: string;
  DriverDate: string;
  DeviceClass: string;
  HardwareID: string;
}

function detectManufacturer(name: string, manufacturer: string): DriverInfo['manufacturer'] {
  const combined = `${name} ${manufacturer}`.toLowerCase();
  if (combined.includes('nvidia') || combined.includes('geforce') || combined.includes('quadro'))
    return 'NVIDIA';
  if (combined.includes('amd') || combined.includes('radeon') || combined.includes('ati '))
    return 'AMD';
  if (combined.includes('intel') || combined.includes('iris') || combined.includes('hd graphics'))
    return 'Intel';
  return 'Generic';
}

function compareVersions(current: string, latest: string): boolean {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const cur = parse(current);
  const lat = parse(latest);
  for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
    const a = cur[i] ?? 0;
    const b = lat[i] ?? 0;
    if (b > a) return true;
    if (a > b) return false;
  }
  return false;
}

/** Convert a .NET JSON date ("/Date(ms)/") or ISO string to YYYY-MM-DD. */
function formatDriverDate(value: string | null | undefined): string {
  if (!value) return '';
  const match = /\/Date\((\d+)/.exec(value);
  if (match && match[1]) {
    return new Date(parseInt(match[1], 10)).toISOString().slice(0, 10);
  }
  return value;
}

// Simulated latest version database (in production, this would query manufacturer APIs)
const LATEST_DRIVERS: Record<string, { version: string; date: string; url: string; size: number }> =
  {
    NVIDIA: {
      version: '551.86',
      date: '2025-03-15',
      url: 'https://www.nvidia.com/download/index.aspx',
      size: 650_000_000,
    },
    AMD: {
      version: '25.3.1',
      date: '2025-03-01',
      url: 'https://www.amd.com/support',
      size: 450_000_000,
    },
    Intel: {
      version: '31.0.101.5522',
      date: '2025-02-20',
      url: 'https://www.intel.com/content/www/us/en/download-center',
      size: 1_200_000_000,
    },
    Generic: { version: '', date: '', url: '', size: 0 },
  };

export async function scanDrivers(reporter?: ScanProgressReporter): Promise<DriverScanResult> {
  const progress = reporter ?? createNoopReporter('drivers');
  progress.report('query', 20, 'Enumerating devices and signed drivers...');
  const result = await runPowerShell(`
    $drivers = @{};
    Get-CimInstance -ClassName Win32_PnPSignedDriver -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.DeviceID) { $drivers[$_.DeviceID] = $_ }
    };
    $devices = Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction SilentlyContinue |
      Where-Object { $_.PNPClass -in @('Display', 'Net', 'Media', 'HIDClass', 'USB', 'SCSIAdapter', 'System') };
    $out = foreach ($d in $devices) {
      $drv = $drivers[$d.DeviceID];
      [pscustomobject]@{
        DeviceID = $d.DeviceID;
        Name = $d.Name;
        Manufacturer = $d.Manufacturer;
        DriverVersion = if ($drv) { $drv.DriverVersion } else { $null };
        DriverDate = if ($drv) { $drv.DriverDate } else { $null };
        DeviceClass = $d.PNPClass;
        HardwareID = @($d.HardwareID) | Select-Object -First 1
      }
    };
    @($out) | ConvertTo-Json -Depth 4 -Compress
  `);

  if (!result.success || !result.stdout) {
    progress.fail('Driver scan failed');
    return {
      drivers: [],
      totalDevices: 0,
      outdatedCount: 0,
      upToDateCount: 0,
      scanDate: new Date(),
    };
  }

  progress.report('parse', 65, 'Parsing device list...');
  const parsed = parsePowerShellJson<PnPDevice[] | PnPDevice>(result.stdout);
  const devices: PnPDevice[] = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  if (devices.length === 0) {
    progress.done('No devices found');
    return {
      drivers: [],
      totalDevices: 0,
      outdatedCount: 0,
      upToDateCount: 0,
      scanDate: new Date(),
    };
  }

  progress.report('normalize', 85, 'Comparing driver versions...');
  const drivers: DriverInfo[] = [];
  let outdatedCount = 0;
  let upToDateCount = 0;

  for (const device of devices) {
    if (!device.Name || !device.DriverVersion) continue;

    const manufacturer = detectManufacturer(device.Name, device.Manufacturer ?? '');
    const latest = LATEST_DRIVERS[manufacturer];
    const latestVersion = latest?.version ?? device.DriverVersion;
    const isUpToDate = latest?.version
      ? !compareVersions(device.DriverVersion, latest.version)
      : true;

    if (!isUpToDate) outdatedCount++;
    else upToDateCount++;

    drivers.push({
      id: device.DeviceID,
      name: device.Name,
      manufacturer,
      currentVersion: device.DriverVersion,
      latestVersion,
      isUpToDate,
      deviceClass: device.DeviceClass,
      hardwareId: device.HardwareID ?? '',
      releaseDate: latest?.date || formatDriverDate(device.DriverDate),
      downloadUrl: latest?.url || '',
      size: latest?.size || 0,
    });
  }

  progress.done('Driver scan complete');

  return {
    drivers,
    totalDevices: drivers.length,
    outdatedCount,
    upToDateCount,
    scanDate: new Date(),
  };
}

export async function createRestorePoint(
  description: string
): Promise<{ success: boolean; message: string }> {
  const result = await runPowerShell(`
    try {
      Enable-ComputerRestore -Drive "C:\\";
      Checkpoint-Computer -Description "${description}" -RestorePointType "MODIFY_SETTINGS";
      Write-Output "SUCCESS"
    } catch {
      Write-Output "FAILED: $_"
    }
  `);

  return {
    success: result.success && result.stdout.includes('SUCCESS'),
    message:
      result.success && result.stdout.includes('SUCCESS')
        ? 'Restore point created successfully'
        : `Failed to create restore point: ${result.stderr}`,
  };
}

export async function installDriver(
  driverId: string,
  downloadUrl: string
): Promise<{
  success: boolean;
  message: string;
}> {
  // For NVIDIA/AMD/Intel, open the download page
  // For Generic, use Windows Update / SDIO
  if (downloadUrl) {
    const { shell } = await import('electron');
    shell.openExternal(downloadUrl);
    return {
      success: true,
      message:
        'Opened manufacturer download page. Please download and install the driver manually.',
    };
  }

  // Fallback: use Windows Update to find driver
  const result = await runPowerShell(`
    try {
      $device = Get-CimInstance -ClassName Win32_PnPEntity -Filter "DeviceID='${driverId}'";
      if ($device) {
        pnputil /scan-devices;
        Write-Output "SCAN_COMPLETE"
      }
    } catch {
      Write-Output "FAILED: $_"
    }
  `);

  return {
    success: result.success,
    message: result.success
      ? 'Driver scan completed. Windows Update will attempt to install the best driver.'
      : `Failed to install driver: ${result.stderr}`,
  };
}

export async function rollbackDriver(driverId: string): Promise<{
  success: boolean;
  message: string;
}> {
  const result = await runPowerShell(`
    try {
      $device = Get-CimInstance -ClassName Win32_PnPEntity -Filter "DeviceID='${driverId}'";
      if ($device) {
        pnputil /restart-device "${driverId}";
        Write-Output "SUCCESS"
      } else {
        Write-Output "DEVICE_NOT_FOUND"
      }
    } catch {
      Write-Output "FAILED: $_"
    }
  `);

  return {
    success: result.success && result.stdout.includes('SUCCESS'),
    message:
      result.success && result.stdout.includes('SUCCESS')
        ? 'Device restarted successfully'
        : `Failed to rollback driver: ${result.stderr}`,
  };
}
