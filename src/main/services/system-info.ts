import os from 'node:os';
import { runPowerShell, parsePowerShellJson } from './powershell';

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

export async function getSystemInfo(): Promise<SystemInfo> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Get disk info
  let diskTotal = 0;
  let diskFree = 0;
  try {
    const diskResult = await runPowerShell(`
      $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction SilentlyContinue;
      if ($disk) {
        @{
          Size = $disk.Size;
          FreeSpace = $disk.FreeSpace
        } | ConvertTo-Json -Compress
      }
    `);
    if (diskResult.success && diskResult.stdout) {
      const disk = parsePowerShellJson<DiskInfo>(diskResult.stdout);
      if (disk) {
        diskTotal = disk.Size ?? 0;
        diskFree = disk.FreeSpace ?? 0;
      }
    }
  } catch {
    // Fallback to os
  }

  // Get GPU info
  let gpuName = 'Unknown';
  let gpuVram = 0;
  let gpuDriver = 'Unknown';
  try {
    const gpuResult = await runPowerShell(`
      $gpu = Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue | Select-Object -First 1;
      if ($gpu) {
        @{
          Name = $gpu.Name;
          AdapterRAM = $gpu.AdapterRAM;
          DriverVersion = $gpu.DriverVersion
        } | ConvertTo-Json -Compress
      }
    `);
    if (gpuResult.success && gpuResult.stdout) {
      const gpu = parsePowerShellJson<GpuInfo>(gpuResult.stdout);
      if (gpu) {
        gpuName = gpu.Name ?? 'Unknown';
        gpuVram = gpu.AdapterRAM ?? 0;
        gpuDriver = gpu.DriverVersion ?? 'Unknown';
      }
    }
  } catch {
    // Fallback
  }

  // Get Windows version info
  let windowsVersion = 'Windows';
  let windowsBuild = '';
  let lastBootTime = new Date();
  try {
    const winResult = await runPowerShell(`
      $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue;
      if ($os) {
        @{
          Caption = $os.Caption;
          Version = $os.Version;
          BuildNumber = $os.BuildNumber;
          LastBootUpTime = $os.LastBootUpTime.ToString("o")
        } | ConvertTo-Json -Compress
      }
    `);
    if (winResult.success && winResult.stdout) {
      const win = parsePowerShellJson<{
        Caption: string;
        Version: string;
        BuildNumber: string;
        LastBootUpTime: string;
      }>(winResult.stdout);
      if (win) {
        windowsVersion = win.Caption ?? 'Windows';
        windowsBuild = win.BuildNumber ?? '';
        lastBootTime = win.LastBootUpTime ? new Date(win.LastBootUpTime) : new Date();
      }
    }
  } catch {
    // Fallback
  }

  // Get CPU usage
  let cpuUsage = 0;
  try {
    const cpuResult = await runPowerShell(`
      $cpu = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1;
      if ($cpu) {
        $cpu.LoadPercentage
      }
    `);
    if (cpuResult.success && cpuResult.stdout) {
      const usage = parseInt(cpuResult.stdout.trim(), 10);
      if (!isNaN(usage)) {
        cpuUsage = usage;
      }
    }
  } catch {
    cpuUsage = Math.round((1 - freeMem / totalMem) * 100);
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
