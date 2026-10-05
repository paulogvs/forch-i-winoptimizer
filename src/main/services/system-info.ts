import os from 'node:os';
import type { CpuInfo } from 'node:os';
import { runPowerShell, parsePowerShellJson, type PowerShellResult } from './powershell';
import { createNoopReporter, type ScanProgressReporter } from './scan-progress';
import { ThrottledSampler } from './perf-monitor';

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
  Disk?: Partial<DiskInfo> | null;
  Gpu?: Partial<GpuInfo> | null;
}

/**
 * One PowerShell process that gathers memory-independent info + disk +
 * GPU + OS. Replaces the previous four parallel spawns (P1.1).
 *
 * P0.4: no longer queries Win32_Processor — that CIM call alone took
 * ~1.1s (measured) and only provided LoadPercentage, which is now sampled
 * in Node from os.cpus() while PowerShell runs.
 */
export const SYSTEM_INFO_BATCH_SCRIPT = `
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue;
  $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction SilentlyContinue;
  $gpu = Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue | Select-Object -First 1;
  @{
    Os = @{
      Caption = if ($os) { $os.Caption } else { $null };
      Version = if ($os) { $os.Version } else { $null };
      BuildNumber = if ($os) { $os.BuildNumber } else { $null };
      LastBootUpTime = if ($os) { $os.LastBootUpTime.ToString("o") } else { $null }
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

// --- CPU usage via os.cpus() sampling (P0.4) -------------------------------

export const CPU_SAMPLE_WINDOW_DEFAULT_MS = 200;
let cpuSampleWindowMs = CPU_SAMPLE_WINDOW_DEFAULT_MS;

/** Test hook: window between the two os.cpus() snapshots (0 = no wait). */
export function setCpuSampleWindowMs(ms: number): void {
  cpuSampleWindowMs = ms;
}

/**
 * Busy percentage over a window of os.cpus() snapshots.
 * Pure and deterministic: total delta <= 0 or mismatched samples => 0.
 */
export function computeCpuUsage(prev: CpuInfo[], curr: CpuInfo[]): number {
  if (prev.length === 0 || curr.length !== prev.length) return 0;

  let prevIdle = 0;
  let prevTotal = 0;
  let idle = 0;
  let total = 0;

  for (let i = 0; i < curr.length; i++) {
    const p = prev[i]?.times;
    const c = curr[i]?.times;
    if (!p || !c) return 0;
    prevIdle += p.idle;
    prevTotal += p.user + p.nice + p.sys + p.idle + p.irq;
    idle += c.idle;
    total += c.user + c.nice + c.sys + c.idle + c.irq;
  }

  const totalDiff = total - prevTotal;
  if (totalDiff <= 0) return 0;

  const usage = ((totalDiff - (idle - prevIdle)) / totalDiff) * 100;
  return Math.min(100, Math.max(0, Math.round(usage)));
}

async function sampleCpuUsage(): Promise<number> {
  try {
    const first = os.cpus();
    if (cpuSampleWindowMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, cpuSampleWindowMs));
    }
    const second = os.cpus();
    return computeCpuUsage(first, second);
  } catch {
    return 0;
  }
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

/** Legacy path kept behind the feature flag: three independent probes (P0.4: no CPU probe). */
async function gatherProbes(): Promise<{ disk?: unknown; gpu?: unknown; win?: unknown }> {
  const probe = (script: string): Promise<PowerShellResult | null> =>
    runPowerShell(script).catch(() => null);

  const [diskResult, gpuResult, winResult] = await Promise.all([
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
  ]);

  return {
    disk:
      diskResult?.success && diskResult.stdout
        ? parsePowerShellJson<DiskInfo>(diskResult.stdout)
        : undefined,
    gpu:
      gpuResult?.success && gpuResult.stdout
        ? parsePowerShellJson<GpuInfo>(gpuResult.stdout)
        : undefined,
    win:
      winResult?.success && winResult.stdout
        ? parsePowerShellJson<WindowsInfo>(winResult.stdout)
        : undefined,
  };
}

// --- Throttled telemetry read (Fase 4.5) ----------------------------------
//
// The Dashboard/Boost pages poll system info (SWR cache-first, then a silent
// `force` revalidation). Without a guard each force call spawns PowerShell for
// disk/GPU/OS. `cachedSystemInfo` holds the last REAL read, the sampler throttles
// the network/Process spawn to ~5 s and coalesces concurrent callers, so the
// telemetry never spams PowerShell.

export const SYSTEM_INFO_THROTTLE_MS = 5_000;
const systemInfoSampler = new ThrottledSampler<SystemInfo>(SYSTEM_INFO_THROTTLE_MS);

/** Last system info actually read (never synthesized). */
export function getCachedSystemInfo(): SystemInfo | null {
  return systemInfoSampler.last;
}

/** Test seam: drop the cached/throttled system info. */
export function resetSystemInfoThrottle(): void {
  systemInfoSampler.reset();
}

/**
 * Throttled, single-flight system-info read. Repeated calls inside the window
 * (or while a read is already in flight) reuse one PowerShell query; `force`
 * is honored only after the window elapsed (a manual refresh is not lost, it
 * just cannot outrun the throttle faster than every 5 s).
 */
export async function getSystemInfoThrottled(
  reporter?: ScanProgressReporter,
  options: { force?: boolean } = {}
): Promise<SystemInfo> {
  return systemInfoSampler.sample(() => getSystemInfo(reporter), options);
}

export async function getSystemInfo(reporter?: ScanProgressReporter): Promise<SystemInfo> {
  const progress = reporter ?? createNoopReporter('system');

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  progress.report('discover', 5, 'Detecting system hardware...');

  // P0.4: sample CPU usage in Node concurrently with the PowerShell query, so
  // the sampling window adds no latency to the caller.
  const cpuUsagePromise = sampleCpuUsage();

  let batch: SystemInfoBatch | null = null;
  let disk: Partial<DiskInfo> | undefined;
  let gpu: Partial<GpuInfo> | undefined;
  let win: Partial<WindowsInfo> | undefined;

  if (useSystemInfoBatch) {
    progress.report('query', 25, 'Querying disk, GPU and OS (single batch)...');
    batch = await gatherBatch();
    progress.report('parse', 70, 'Parsing hardware response...');

    if (batch) {
      disk = batch.Disk ?? undefined;
      gpu = batch.Gpu ?? undefined;
      win = batch.Os ?? undefined;
    } else {
      // Batch failed: degrade gracefully to the legacy probes.
      progress.report('query', 40, 'Batch unavailable, falling back...');
      const probes = await gatherProbes();
      disk = probes.disk as Partial<DiskInfo> | undefined;
      gpu = probes.gpu as Partial<GpuInfo> | undefined;
      win = probes.win as Partial<WindowsInfo> | undefined;
    }
  } else {
    progress.report('query', 25, 'Querying system probes...');
    const probes = await gatherProbes();
    disk = probes.disk as Partial<DiskInfo> | undefined;
    gpu = probes.gpu as Partial<GpuInfo> | undefined;
    win = probes.win as Partial<WindowsInfo> | undefined;
  }

  progress.report('normalize', 90, 'Normalizing system information...');
  const cpuUsage = await cpuUsagePromise;

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
