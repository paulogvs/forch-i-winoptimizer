import { runPowerShell } from './powershell';
import { resolveActiveAdapter } from './network-adapter';
import type { BenchmarkResult, BenchmarkReport } from '@shared/types';

/**
 * Fase 1.4: the 19 legacy checks (CPU/mem/disk/gpu/net + getSystemInfo) share
 * ONE PowerShell process instead of ~19 serial spawns (system-audit.ts
 * marker pattern). Each section prints `@@BENCH_<index>@@` then its raw
 * value; a failing section prints nothing and degrades to the same zero-value
 * its old `runPowerShell` failure produced. Scoring math is untouched, so
 * numbers stay comparable with pre-1.4 reports.
 */
export const BENCHMARK_SECTIONS = [
  'cpu-single',
  'cpu-multi',
  'cpu-usage',
  'mem-speed',
  'mem-usage',
  'mem-avail',
  'disk-read',
  'disk-write',
  'disk-free',
  'disk-type',
  'gpu-info',
  'gpu-driver',
  'net-latency',
  'net-speed',
  'net-dns',
  'sys-cpu',
  'sys-mem',
  'sys-disk',
  'sys-gpu',
] as const;

const marker = (index: number): string => `@@BENCH_${index}@@`;

/**
 * Split combined batch stdout back into one payload per section, in order.
 * Missing markers (aborted run) yield empty payloads — the same degradation
 * a single failed `runPowerShell` call used to produce.
 */
export function splitBenchmarkOutput(stdout: string, count: number): string[] {
  const payloads: string[] = Array.from({ length: count }, () => '');
  let current = -1;
  let buffer: string[] = [];

  const flush = (): void => {
    if (current >= 0 && current < count) payloads[current] = buffer.join('\n').trim();
    buffer = [];
  };

  for (const line of stdout.split(/\r?\n/)) {
    const match = /^@@BENCH_(\d+)@@$/.exec(line.trim());
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

function section(scripts: string, index: number): string {
  return `Write-Output '${marker(index)}'\ntry {\n& {\n${scripts}\n}\n} catch { Write-Output '' }`;
}

/**
 * Build the single batch script. `adapterIndex` is resolved (and cached) in
 * Node before the spawn; when null the link-speed section reports '0'
 * without querying, so the batch never depends on a second spawn.
 */
export function buildBenchmarkScript(adapterIndex: number | null): string {
  const bodies: string[] = [
    // 0 cpu-single
    `
    $sw = [System.Diagnostics.Stopwatch]::StartNew();
    $sum = 0;
    for ($i = 0; $i -lt 1000000; $i++) {
      $sum += [math]::Sqrt($i);
    };
    $sw.Stop();
    $ms = $sw.ElapsedMilliseconds;
    Write-Output "$ms"
    `,
    // 1 cpu-multi
    `
    $sw = [System.Diagnostics.Stopwatch]::StartNew();
    $jobs = 1..4 | ForEach-Object {
      Start-Job -ScriptBlock {
        $sum = 0;
        for ($i = 0; $i -lt 500000; $i++) {
          $sum += [math]::Sqrt($i);
        }
      }
    };
    $jobs | Wait-Job | Out-Null;
    $sw.Stop();
    $ms = $sw.ElapsedMilliseconds;
    Write-Output "$ms"
    `,
    // 2 cpu-usage
    `
    $cpu = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1;
    $usage = $cpu.LoadPercentage;
    Write-Output "$usage"
    `,
    // 3 mem-speed
    `
    $sw = [System.Diagnostics.Stopwatch]::StartNew();
    $data = New-Object byte[] 100MB;
    for ($i = 0; $i -lt $data.Length; $i++) {
      $data[$i] = $i % 256;
    };
    $sw.Stop();
    $ms = $sw.ElapsedMilliseconds;
    Write-Output "$ms"
    `,
    // 4 mem-usage
    `
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $total = $os.TotalVisibleMemorySize;
    $free = $os.FreePhysicalMemory;
    $usedPercent = [math]::Round((($total - $free) / $total) * 100, 2);
    Write-Output "$usedPercent"
    `,
    // 5 mem-avail
    `
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $free = $os.FreePhysicalMemory;
    $freeGB = [math]::Round($free / 1MB, 2);
    Write-Output "$freeGB"
    `,
    // 6 disk-read
    `
    $sw = [System.Diagnostics.Stopwatch]::StartNew();
    $file = "C:\\Windows\\System32\\notepad.exe";
    $stream = [System.IO.File]::OpenRead($file);
    $buffer = New-Object byte[] 1MB;
    while ($stream.Read($buffer, 0, $buffer.Length) -gt 0) {};
    $stream.Close();
    $sw.Stop();
    $ms = $sw.ElapsedMilliseconds;
    Write-Output "$ms"
    `,
    // 7 disk-write
    `
    $sw = [System.Diagnostics.Stopwatch]::StartNew();
    $tempFile = [System.IO.Path]::GetTempFileName();
    $data = New-Object byte[] 10MB;
    $stream = [System.IO.File]::OpenWrite($tempFile);
    $stream.Write($data, 0, $data.Length);
    $stream.Close();
    Remove-Item $tempFile;
    $sw.Stop();
    $ms = $sw.ElapsedMilliseconds;
    Write-Output "$ms"
    `,
    // 8 disk-free
    `
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'";
    $freePercent = [math]::Round(($disk.FreeSpace / $disk.Size) * 100, 2);
    Write-Output "$freePercent"
    `,
    // 9 disk-type
    `
    $disk = Get-PhysicalDisk | Select-Object -First 1;
    if ($disk) {
      Write-Output $disk.MediaType
    } else {
      Write-Output "Unknown"
    }
    `,
    // 10 gpu-info
    `
    $gpu = Get-CimInstance -ClassName Win32_VideoController | Select-Object -First 1;
    if ($gpu) {
      @{
        Name = $gpu.Name;
        AdapterRAM = $gpu.AdapterRAM;
        DriverVersion = $gpu.DriverVersion
      } | ConvertTo-Json -Compress
    }
    `,
    // 11 gpu-driver
    `
    $gpu = Get-CimInstance -ClassName Win32_VideoController | Select-Object -First 1;
    if ($gpu) { Write-Output $gpu.DriverVersion } else { Write-Output "Unknown" }
    `,
    // 12 net-latency (`-Count 2`: same honest average, half the worst case)
    `
    $ping = Test-Connection -ComputerName 8.8.8.8 -Count 2 -ErrorAction SilentlyContinue;
    if ($ping) {
      $avgLatency = ($ping | Measure-Object -Property ResponseTime -Average).Average;
      Write-Output "$avgLatency"
    } else {
      Write-Output "0"
    }
    `,
    // 13 net-speed (adapter index interpolated; no second spawn needed)
    adapterIndex === null
      ? `Write-Output "0"`
      : `
    $a = Get-NetAdapter -InterfaceIndex ${adapterIndex} -ErrorAction SilentlyContinue;
    if ($a) { Write-Output $a.LinkSpeed } else { Write-Output "0" }
    `,
    // 14 net-dns
    `
    $sw = [System.Diagnostics.Stopwatch]::StartNew();
    try {
      Resolve-DnsName -Name google.com -ErrorAction Stop | Out-Null;
      $sw.Stop();
      $ms = $sw.ElapsedMilliseconds;
      Write-Output "$ms"
    } catch {
      Write-Output "0"
    }
    `,
    // 15 sys-cpu
    `
    $cpu = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1;
    if ($cpu) { Write-Output $cpu.Name } else { Write-Output "Unknown" }
    `,
    // 16 sys-mem
    `
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $totalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2);
    Write-Output "$totalGB"
    `,
    // 17 sys-disk
    `
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'";
    $totalGB = [math]::Round($disk.Size / 1GB, 2);
    Write-Output "$totalGB GB"
    `,
    // 18 sys-gpu
    `
    $gpu = Get-CimInstance -ClassName Win32_VideoController | Select-Object -First 1;
    if ($gpu) { Write-Output $gpu.Name } else { Write-Output "Unknown" }
    `,
  ];

  if (bodies.length !== BENCHMARK_SECTIONS.length) {
    throw new Error(
      `Benchmark batch out of sync: ${bodies.length} bodies vs ${BENCHMARK_SECTIONS.length} sections`
    );
  }
  return bodies.map((body, index) => section(body, index)).join('\n');
}

function num(text: string): number {
  return parseInt(text.trim(), 10) || 0;
}

function float(text: string): number {
  return parseFloat(text.trim()) || 0;
}

function stamp(): Date {
  return new Date();
}

export async function runBenchmark(): Promise<BenchmarkReport> {
  // The shared cached resolver (Fase 1.7): usually 0 spawns, 1 when cold.
  // Either way the whole `benchmark:run` costs 1-2 spawns, never ~19.
  const activeAdapter = await resolveActiveAdapter().catch(() => null);
  const script = buildBenchmarkScript(activeAdapter?.interfaceIndex ?? null);

  const batch = await runPowerShell(script);
  const s = splitBenchmarkOutput(batch.success ? batch.stdout : '', BENCHMARK_SECTIONS.length);
  const at = (i: number): string => s[i] ?? '';

  const results: BenchmarkResult[] = [];

  // CPU
  const singleCoreTime = num(at(0));
  results.push({
    id: 'cpu-single-core',
    name: 'CPU Single-Core',
    category: 'cpu',
    score: Math.max(0, Math.min(100, Math.round(100 - singleCoreTime / 50))),
    unit: 'ms',
    details: `Single-core test completed in ${singleCoreTime}ms`,
    timestamp: stamp(),
  });

  const multiCoreTime = num(at(1));
  results.push({
    id: 'cpu-multi-core',
    name: 'CPU Multi-Core',
    category: 'cpu',
    score: Math.max(0, Math.min(100, Math.round(100 - multiCoreTime / 100))),
    unit: 'ms',
    details: `Multi-core test completed in ${multiCoreTime}ms`,
    timestamp: stamp(),
  });

  const cpuUsage = num(at(2));
  results.push({
    id: 'cpu-usage',
    name: 'CPU Usage',
    category: 'cpu',
    score: Math.max(0, 100 - cpuUsage),
    unit: '%',
    details: `Current CPU usage: ${cpuUsage}%`,
    timestamp: stamp(),
  });

  // Memory
  const memSpeedTime = num(at(3));
  results.push({
    id: 'memory-speed',
    name: 'Memory Speed',
    category: 'memory',
    score: Math.max(0, Math.min(100, Math.round(100 - memSpeedTime / 10))),
    unit: 'ms',
    details: `Memory write test completed in ${memSpeedTime}ms`,
    timestamp: stamp(),
  });

  const memUsage = float(at(4));
  results.push({
    id: 'memory-usage',
    name: 'Memory Usage',
    category: 'memory',
    score: Math.max(0, 100 - Math.round(memUsage)),
    unit: '%',
    details: `Memory usage: ${memUsage}%`,
    timestamp: stamp(),
  });

  const memAvail = float(at(5));
  results.push({
    id: 'memory-available',
    name: 'Memory Available',
    category: 'memory',
    score: Math.min(100, Math.round(memAvail * 10)),
    unit: 'GB',
    details: `${memAvail} GB available`,
    timestamp: stamp(),
  });

  // Disk
  const readTime = num(at(6));
  results.push({
    id: 'disk-read',
    name: 'Disk Read Speed',
    category: 'disk',
    score: Math.max(0, Math.min(100, Math.round(100 - readTime / 5))),
    unit: 'ms',
    details: `Read test completed in ${readTime}ms`,
    timestamp: stamp(),
  });

  const writeTime = num(at(7));
  results.push({
    id: 'disk-write',
    name: 'Disk Write Speed',
    category: 'disk',
    score: Math.max(0, Math.min(100, Math.round(100 - writeTime / 5))),
    unit: 'ms',
    details: `Write test completed in ${writeTime}ms`,
    timestamp: stamp(),
  });

  const freePercent = float(at(8));
  results.push({
    id: 'disk-free-space',
    name: 'Disk Free Space',
    category: 'disk',
    score: Math.min(100, Math.round(freePercent)),
    unit: '%',
    details: `${freePercent}% free space`,
    timestamp: stamp(),
  });

  const diskType = at(9);
  const isSSD = diskType.includes('SSD');
  results.push({
    id: 'disk-type',
    name: 'Disk Type',
    category: 'disk',
    score: isSSD ? 100 : 50,
    unit: diskType,
    details: isSSD ? 'SSD detected (optimal)' : 'HDD detected (consider upgrading to SSD)',
    timestamp: stamp(),
  });

  // GPU
  let gpuName = 'Unknown';
  let gpuVram = 0;
  if (at(10)) {
    try {
      const gpu = JSON.parse(at(10)) as { Name?: string; AdapterRAM?: number };
      gpuName = gpu.Name || 'Unknown';
      gpuVram = gpu.AdapterRAM || 0;
    } catch {
      /* ignore */
    }
  }
  results.push({
    id: 'gpu-info',
    name: 'GPU Information',
    category: 'gpu',
    score: gpuVram > 4_000_000_000 ? 100 : gpuVram > 2_000_000_000 ? 75 : 50,
    unit: 'MB',
    details: `${gpuName} (${Math.round(gpuVram / 1_000_000)} MB VRAM)`,
    timestamp: stamp(),
  });

  const driverVersion = at(11) || 'Unknown';
  results.push({
    id: 'gpu-driver',
    name: 'GPU Driver Version',
    category: 'gpu',
    score: driverVersion !== 'Unknown' ? 100 : 0,
    unit: driverVersion,
    details: `Driver version: ${driverVersion}`,
    timestamp: stamp(),
  });

  // Network
  const latency = num(at(12));
  results.push({
    id: 'network-latency',
    name: 'Network Latency',
    category: 'network',
    score: latency > 0 ? Math.max(0, Math.min(100, Math.round(100 - latency))) : 0,
    unit: 'ms',
    details: `Average latency: ${latency}ms`,
    timestamp: stamp(),
  });

  // Network link speed — measured on the REAL active adapter (Tailscale/VPN
  // tunnels no longer hijack the reading). Falls back to '0' without adapter.
  const linkSpeed = at(13) || '0';
  const speedMbps = linkSpeed.includes('Gbps')
    ? 1000
    : linkSpeed.includes('Mbps')
      ? parseInt(linkSpeed, 10)
      : 0;
  results.push({
    id: 'network-speed',
    name: 'Network Link Speed',
    category: 'network',
    score: speedMbps >= 1000 ? 100 : speedMbps >= 100 ? 75 : speedMbps >= 10 ? 50 : 25,
    unit: 'Mbps',
    details: `Link speed: ${linkSpeed}`,
    timestamp: stamp(),
  });

  const dnsTime = num(at(14));
  results.push({
    id: 'network-dns-speed',
    name: 'DNS Resolution',
    category: 'network',
    score: dnsTime > 0 ? Math.max(0, Math.min(100, Math.round(100 - dnsTime))) : 0,
    unit: 'ms',
    details: `DNS resolution took ${dnsTime}ms`,
    timestamp: stamp(),
  });

  const totalScore = results.reduce((sum, r) => sum + r.score, 0);

  return {
    results,
    totalScore,
    systemInfo: {
      cpu: at(15) || 'Unknown',
      memory: float(at(16)),
      disk: at(17) || 'Unknown',
      gpu: at(18) || 'Unknown',
    },
    timestamp: new Date(),
  };
}

export function generateMarkdownReport(report: BenchmarkReport): string {
  const lines: string[] = [
    '# FORCH.iA WinOptimizer - Benchmark Report',
    '',
    `**Date:** ${report.timestamp.toLocaleString()}`,
    `**Total Score:** ${report.totalScore}`,
    '',
    '## System Information',
    '',
    `- **CPU:** ${report.systemInfo.cpu}`,
    `- **Memory:** ${report.systemInfo.memory} GB`,
    `- **Disk:** ${report.systemInfo.disk}`,
    `- **GPU:** ${report.systemInfo.gpu}`,
    '',
    '## Results',
    '',
  ];

  const categories = ['cpu', 'memory', 'disk', 'gpu', 'network'] as const;
  for (const cat of categories) {
    const catResults = report.results.filter((r) => r.category === cat);
    if (catResults.length === 0) continue;

    lines.push(`### ${cat.toUpperCase()}`);
    lines.push('');
    for (const r of catResults) {
      lines.push(`- **${r.name}:** ${r.score} ${r.unit} - ${r.details}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
