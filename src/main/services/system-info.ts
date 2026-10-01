import os from 'node:os';
import { runPowerShell, parsePowerShellJson, type PowerShellResult } from './powershell';

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

export async function getSystemInfo(): Promise<SystemInfo> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Run all probes in parallel: previously 4 sequential calls (~7s each).
  const probe = (script: string): Promise<PowerShellResult | null> =>
    runPowerShell(script).catch(() => null);

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

  // Disk
  let diskTotal = 0;
  let diskFree = 0;
  if (diskResult?.success && diskResult.stdout) {
    const disk = parsePowerShellJson<DiskInfo>(diskResult.stdout);
    if (disk) {
      diskTotal = disk.Size ?? 0;
      diskFree = disk.FreeSpace ?? 0;
    }
  }

  // GPU
  let gpuName = 'Unknown';
  let gpuVram = 0;
  let gpuDriver = 'Unknown';
  if (gpuResult?.success && gpuResult.stdout) {
    const gpu = parsePowerShellJson<GpuInfo>(gpuResult.stdout);
    if (gpu) {
      gpuName = gpu.Name ?? 'Unknown';
      gpuVram = gpu.AdapterRAM ?? 0;
      gpuDriver = gpu.DriverVersion ?? 'Unknown';
    }
  }

  // Windows
  let windowsVersion = 'Windows';
  let windowsBuild = '';
  let lastBootTime = new Date();
  if (winResult?.success && winResult.stdout) {
    const win = parsePowerShellJson<WindowsInfo>(winResult.stdout);
    if (win) {
      windowsVersion = win.Caption ?? 'Windows';
      windowsBuild = win.BuildNumber ?? '';
      lastBootTime = win.LastBootUpTime ? new Date(win.LastBootUpTime) : new Date();
    }
  }

  // CPU usage
  let cpuUsage = 0;
  if (cpuResult?.success && cpuResult.stdout) {
    const usage = parseInt(cpuResult.stdout.trim(), 10);
    if (!isNaN(usage)) {
      cpuUsage = usage;
    }
  }

  return {
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
      name: gpuName,
      vram: gpuVram,
      driverVersion: gpuDriver,
    },
    windowsVersion,
    windowsBuild,
    lastBootTime,
  };
}
