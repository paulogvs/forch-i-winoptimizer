import os from 'node:os';
import { runPowerShell, parsePowerShellJson, type PowerShellResult } from './powershell';
import { createNoopReporter, type ScanProgressReporter } from './scan-progress';

export interface SystemInfo {
  platform: string;
  release: string;
  arch: string;
  hostname: string;
  username: string;
  uptime: number;
  cpu: {
    model: string;
    cores: number;
    usage: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  gpu: {
    name: string;
    vram: number;
    driverVersion: string;
  };
  windowsVersion: string;
  windowsBuild: string;
  lastBootTime: Date;
}

interface DiskInfo {
  Size: number;
  FreeSpace: number;
}

interface GpuInfo {
  Name: string;
  AdapterRAM: number;
  DriverVersion: string;
}

interface WindowsInfo {
  Caption: string;
  Version: string;
  BuildNumber: string;
  LastBootUpTime: string;
}

interface SystemInfoBatch {
  Os?: Partial<WindowsInfo> | null;
  Cpu?: { LoadPercentage?: number | null; Name?: string | null } | null;
  Disk?: Partial<DiskInfo> | null;
  Gpu?: Partial<GpuInfo> | null;
}

/**
 * One PowerShell process that gathers CPU + memory-independent info + disk +
 * GPU + OS. Replaces the previous four parallel spawns (P1.1).
 */
const SYSTEM_INFO_BATCH_SCRIPT = `
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue;
  $cpu = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1;
  $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction SilentlyContinue;
  $gpu = Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue | Select-Object -First 1;
  @{
    Os = @{
      Caption = if ($os) { $os.Caption } else { $null };
      Version = if ($os) { $os.Version } else { $null };
      BuildNumber = if ($os) { $os.BuildNumber } else { $null };
      LastBootUpTime = if ($os) { $os.LastBootUpTime.ToString("o") } else { $null }
    };
    Cpu = @{
      LoadPercentage = if ($cpu) { $cpu.LoadPercentage } else { $null };
      Name = if ($cpu) { $cpu.Name } else { $null }
    };
    Disk = @{
      Size = if ($disk) { $disk.Size } else { $null };
      FreeSpace = if ($disk) { $disk.FreeSpace } else { $null }
    };
    Gpu = @{
      Name = if ($gpu) { $gpu.Name } else { $null };
      AdapterRAM = if ($gpu) { $gpu.AdapterRAM } else { $null };
      DriverVersion = if ($gpu) { $gpu.DriverVersion } else { $null }
    }
  } | ConvertTo-Json -Depth 4 -Compress
`;

// Feature flag (P1.1): batch by default; can be disabled for rollback/debug.
let useSystemInfoBatch = process.env.FORCHI_SYSTEM_INFO_BATCH !== '0';

export function isSystemInfoBatchEnabled(): boolean {
  return useSystemInfoBatch;
}

export function setSystemInfoBatchEnabled(enabled: boolean): void {
  useSystemInfoBatch = enabled;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function gatherBatch(): Promise<SystemInfoBatch | null> {
  const result = await runPowerShell(SYSTEM_INFO_BATCH_SCRIPT).catch(() => null);
  if (!result?.success || !result.stdout) return null;
  return parsePowerShellJson<SystemInfoBatch>(result.stdout);
}

/** Legacy path kept behind the feature flag: four independent probes. */
async function gatherProbes(): Promise<{ disk?: unknown; gpu?: unknown; win?: unknown; cpu?: unknown }> {
  const probe = (script: string): Promise<PowerShellResult | null> => runPowerShell(script).catch(() => null);

  const [diskResult, gpuResult, winResult, cpuResult] = await Promise.all([
    probe(`
      $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction SilentlyContinue;
      if ($disk) {
        @{ Size = $disk.Size; FreeSpace = $disk.FreeSpace } | ConvertTo-Json -Compress
      }
    `),
    probe(`
      $gpu = Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue | Select-Object -First 1;
      if ($gpu) {
        @{ Name = $gpu.Name; AdapterRAM = $gpu.AdapterRAM; DriverVersion = $gpu.DriverVersion } | ConvertTo-Json -Compress
      }
    `),
    probe(`
      $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue;
      if ($os) {
        @{
          Caption = $os.Caption;
          Version = $os.Version;
          BuildNumber = $os.BuildNumber;
          LastBootUpTime = $os.LastBootUpTime.ToString("o")
        } | ConvertTo-Json -Compress
      }
    `),
    probe(`
      $cpu = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1;
      if ($cpu) { $cpu.LoadPercentage }
    `),
  ]);

  return {
    disk: diskResult?.success && diskResult.stdout ? parsePowerShellJson<DiskInfo>(diskResult.stdout) : undefined,
    gpu: gpuResult?.success && gpuResult.stdout ? parsePowerShellJson<GpuInfo>(gpuResult.stdout) : undefined,
    win: winResult?.success && winResult.stdout ? parsePowerShellJson<WindowsInfo>(winResult.stdout) : undefined,
    cpu:
      cpuResult?.success && cpuResult.stdout
        ? (parseInt(cpuResult.stdout.trim(), 10) as unknown)
        : undefined,
  };
}

export async function getSystemInfo(reporter?: ScanProgressReporter): Promise<SystemInfo> {
  const progress = reporter ?? createNoopReporter('system');

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  progress.report('discover', 5, 'Detecting system hardware...');

  let batch: SystemInfoBatch | null = null;
  let disk: Partial<DiskInfo> | undefined;
  let gpu: Partial<GpuInfo> | undefined;
  let win: Partial<WindowsInfo> | undefined;
  let cpuUsage = 0;

  if (useSystemInfoBatch) {
    progress.report('query', 25, 'Querying CPU, disk, GPU and OS (single batch)...');
    batch = await gatherBatch();
    progress.report('parse', 70, 'Parsing hardware response...');

    if (batch) {
      disk = batch.Disk ?? undefined;
      gpu = batch.Gpu ?? undefined;
      win = batch.Os ?? undefined;
      cpuUsage = toNumber(batch.Cpu?.LoadPercentage);
    } else {
      // Batch failed: degrade gracefully to the legacy probes.
      progress.report('query', 40, 'Batch unavailable, falling back...');
      const probes = await gatherProbes();
      disk = probes.disk as Partial<DiskInfo> | undefined;
      gpu = probes.gpu as Partial<GpuInfo> | undefined;
      win = probes.win as Partial<WindowsInfo> | undefined;
      cpuUsage = toNumber(probes.cpu);
    }
  } else {
    progress.report('query', 25, 'Querying system probes...');
    const probes = await gatherProbes();
    disk = probes.disk as Partial<DiskInfo> | undefined;
    gpu = probes.gpu as Partial<GpuInfo> | undefined;
    win = probes.win as Partial<WindowsInfo> | undefined;
    cpuUsage = toNumber(probes.cpu);
  }

  progress.report('normalize', 90, 'Normalizing system information...');

  const diskTotal = toNumber(disk?.Size);
  const diskFree = toNumber(disk?.FreeSpace);

  const windowsVersion = win?.Caption ?? 'Windows';
  const windowsBuild = win?.BuildNumber ?? '';
  const lastBootTime = win?.LastBootUpTime ? new Date(win.LastBootUpTime) : new Date();

  const result: SystemInfo = {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    username: os.userInfo().username,
    uptime: os.uptime(),
    cpu: {
      model: os.cpus()[0]?.model ?? 'Unknown',
      cores: os.cpus().length,
      usage: cpuUsage,
    },
    memory: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      usagePercent: Math.round((usedMem / totalMem) * 100),
    },
    disk: {
      total: diskTotal,
      free: diskFree,
      used: diskTotal - diskFree,
      usagePercent: diskTotal > 0 ? Math.round(((diskTotal - diskFree) / diskTotal) * 100) : 0,
    },
    gpu: {
      name: gpu?.Name ?? 'Unknown',
      vram: toNumber(gpu?.AdapterRAM),
      driverVersion: gpu?.DriverVersion ?? 'Unknown',
    },
    windowsVersion,
    windowsBuild,
    lastBootTime,
  };

  progress.done('System information ready');
  return result;
}
