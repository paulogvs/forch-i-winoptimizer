import { runPowerShell } from './powershell';
import type { BenchmarkResult, BenchmarkReport } from '@shared/types';

export async function runBenchmark(): Promise<BenchmarkReport> {
  const results: BenchmarkResult[] = [];

  // CPU Benchmark
  results.push(...(await benchmarkCPU()));

  // Memory Benchmark
  results.push(...(await benchmarkMemory()));

  // Disk Benchmark
  results.push(...(await benchmarkDisk()));

  // GPU Benchmark
  results.push(...(await benchmarkGPU()));

  // Network Benchmark
  results.push(...(await benchmarkNetwork()));

  const totalScore = results.reduce((sum, r) => sum + r.score, 0);

  // Get system info
  const sysInfo = await getSystemInfo();

  return {
    results,
    totalScore,
    systemInfo: sysInfo,
    timestamp: new Date(),
  };
}

async function benchmarkCPU(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // CPU Single-Core Performance
  const singleCoreResult = await runPowerShell(`
    $sw = [System.Diagnostics.Stopwatch]::StartNew();
    $sum = 0;
    for ($i = 0; $i -lt 1000000; $i++) {
      $sum += [math]::Sqrt($i);
    };
    $sw.Stop();
    $ms = $sw.ElapsedMilliseconds;
    Write-Output "$ms"
  `);
  const singleCoreTime = parseInt(singleCoreResult.stdout.trim(), 10) || 0;
  const singleCoreScore = Math.max(0, Math.min(100, Math.round(100 - singleCoreTime / 50)));

  results.push({
    id: 'cpu-single-core',
    name: 'CPU Single-Core',
    category: 'cpu',
    score: singleCoreScore,
    unit: 'ms',
    details: `Single-core test completed in ${singleCoreTime}ms`,
    timestamp: new Date(),
  });

  // CPU Multi-Core Performance
  const multiCoreResult = await runPowerShell(`
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
  `);
  const multiCoreTime = parseInt(multiCoreResult.stdout.trim(), 10) || 0;
  const multiCoreScore = Math.max(0, Math.min(100, Math.round(100 - multiCoreTime / 100)));

  results.push({
    id: 'cpu-multi-core',
    name: 'CPU Multi-Core',
    category: 'cpu',
    score: multiCoreScore,
    unit: 'ms',
    details: `Multi-core test completed in ${multiCoreTime}ms`,
    timestamp: new Date(),
  });

  // CPU Usage
  const usageResult = await runPowerShell(`
    $cpu = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1;
    $usage = $cpu.LoadPercentage;
    Write-Output "$usage"
  `);
  const cpuUsage = parseInt(usageResult.stdout.trim(), 10) || 0;

  results.push({
    id: 'cpu-usage',
    name: 'CPU Usage',
    category: 'cpu',
    score: Math.max(0, 100 - cpuUsage),
    unit: '%',
    details: `Current CPU usage: ${cpuUsage}%`,
    timestamp: new Date(),
  });

  return results;
}

async function benchmarkMemory(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // Memory Speed
  const memSpeedResult = await runPowerShell(`
    $sw = [System.Diagnostics.Stopwatch]::StartNew();
    $data = New-Object byte[] 100MB;
    for ($i = 0; $i -lt $data.Length; $i++) {
      $data[$i] = $i % 256;
    };
    $sw.Stop();
    $ms = $sw.ElapsedMilliseconds;
    Write-Output "$ms"
  `);
  const memSpeedTime = parseInt(memSpeedResult.stdout.trim(), 10) || 0;
  const memSpeedScore = Math.max(0, Math.min(100, Math.round(100 - memSpeedTime / 10)));

  results.push({
    id: 'memory-speed',
    name: 'Memory Speed',
    category: 'memory',
    score: memSpeedScore,
    unit: 'ms',
    details: `Memory write test completed in ${memSpeedTime}ms`,
    timestamp: new Date(),
  });

  // Memory Usage
  const memUsageResult = await runPowerShell(`
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $total = $os.TotalVisibleMemorySize;
    $free = $os.FreePhysicalMemory;
    $usedPercent = [math]::Round((($total - $free) / $total) * 100, 2);
    Write-Output "$usedPercent"
  `);
  const memUsage = parseFloat(memUsageResult.stdout.trim()) || 0;

  results.push({
    id: 'memory-usage',
    name: 'Memory Usage',
    category: 'memory',
    score: Math.max(0, 100 - Math.round(memUsage)),
    unit: '%',
    details: `Memory usage: ${memUsage}%`,
    timestamp: new Date(),
  });

  // Memory Available
  const memAvailResult = await runPowerShell(`
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $free = $os.FreePhysicalMemory;
    $freeGB = [math]::Round($free / 1MB, 2);
    Write-Output "$freeGB"
  `);
  const memAvail = parseFloat(memAvailResult.stdout.trim()) || 0;

  results.push({
    id: 'memory-available',
    name: 'Memory Available',
    category: 'memory',
    score: Math.min(100, Math.round(memAvail * 10)),
    unit: 'GB',
    details: `${memAvail} GB available`,
    timestamp: new Date(),
  });

  return results;
}

async function benchmarkDisk(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // Disk Read Speed
  const readResult = await runPowerShell(`
    $sw = [System.Diagnostics.Stopwatch]::StartNew();
    $file = "C:\\Windows\\System32\\notepad.exe";
    $stream = [System.IO.File]::OpenRead($file);
    $buffer = New-Object byte[] 1MB;
    while ($stream.Read($buffer, 0, $buffer.Length) -gt 0) {};
    $stream.Close();
    $sw.Stop();
    $ms = $sw.ElapsedMilliseconds;
    Write-Output "$ms"
  `);
  const readTime = parseInt(readResult.stdout.trim(), 10) || 0;
  const readScore = Math.max(0, Math.min(100, Math.round(100 - readTime / 5)));

  results.push({
    id: 'disk-read',
    name: 'Disk Read Speed',
    category: 'disk',
    score: readScore,
    unit: 'ms',
    details: `Read test completed in ${readTime}ms`,
    timestamp: new Date(),
  });

  // Disk Write Speed
  const writeResult = await runPowerShell(`
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
  `);
  const writeTime = parseInt(writeResult.stdout.trim(), 10) || 0;
  const writeScore = Math.max(0, Math.min(100, Math.round(100 - writeTime / 5)));

  results.push({
    id: 'disk-write',
    name: 'Disk Write Speed',
    category: 'disk',
    score: writeScore,
    unit: 'ms',
    details: `Write test completed in ${writeTime}ms`,
    timestamp: new Date(),
  });

  // Disk Free Space
  const freeResult = await runPowerShell(`
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'";
    $freePercent = [math]::Round(($disk.FreeSpace / $disk.Size) * 100, 2);
    Write-Output "$freePercent"
  `);
  const freePercent = parseFloat(freeResult.stdout.trim()) || 0;

  results.push({
    id: 'disk-free-space',
    name: 'Disk Free Space',
    category: 'disk',
    score: Math.min(100, Math.round(freePercent)),
    unit: '%',
    details: `${freePercent}% free space`,
    timestamp: new Date(),
  });

  // Disk Health (SSD vs HDD)
  const healthResult = await runPowerShell(`
    $disk = Get-PhysicalDisk | Select-Object -First 1;
    if ($disk) {
      Write-Output $disk.MediaType
    } else {
      Write-Output "Unknown"
    }
  `);
  const diskType = healthResult.stdout.trim();
  const isSSD = diskType.includes('SSD');

  results.push({
    id: 'disk-type',
    name: 'Disk Type',
    category: 'disk',
    score: isSSD ? 100 : 50,
    unit: diskType,
    details: isSSD ? 'SSD detected (optimal)' : 'HDD detected (consider upgrading to SSD)',
    timestamp: new Date(),
  });

  return results;
}

async function benchmarkGPU(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // GPU Info
  const gpuResult = await runPowerShell(`
    $gpu = Get-CimInstance -ClassName Win32_VideoController | Select-Object -First 1;
    if ($gpu) {
      @{
        Name = $gpu.Name;
        AdapterRAM = $gpu.AdapterRAM;
        DriverVersion = $gpu.DriverVersion
      } | ConvertTo-Json -Compress
    }
  `);

  let gpuName = 'Unknown';
  let gpuVram = 0;
  if (gpuResult.success && gpuResult.stdout) {
    try {
      const gpu = JSON.parse(gpuResult.stdout);
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
    timestamp: new Date(),
  });

  // GPU Driver Version
  const driverResult = await runPowerShell(`
    $gpu = Get-CimInstance -ClassName Win32_VideoController | Select-Object -First 1;
    if ($gpu) { Write-Output $gpu.DriverVersion } else { Write-Output "Unknown" }
  `);
  const driverVersion = driverResult.stdout.trim();

  results.push({
    id: 'gpu-driver',
    name: 'GPU Driver Version',
    category: 'gpu',
    score: driverVersion !== 'Unknown' ? 100 : 0,
    unit: driverVersion,
    details: `Driver version: ${driverVersion}`,
    timestamp: new Date(),
  });

  return results;
}

async function benchmarkNetwork(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // Network Latency
  const pingResult = await runPowerShell(`
    $ping = Test-Connection -ComputerName 8.8.8.8 -Count 4 -ErrorAction SilentlyContinue;
    if ($ping) {
      $avgLatency = ($ping | Measure-Object -Property ResponseTime -Average).Average;
      Write-Output "$avgLatency"
    } else {
      Write-Output "0"
    }
  `);
  const latency = parseInt(pingResult.stdout.trim(), 10) || 0;
  const latencyScore = latency > 0 ? Math.max(0, Math.min(100, Math.round(100 - latency))) : 0;

  results.push({
    id: 'network-latency',
    name: 'Network Latency',
    category: 'network',
    score: latencyScore,
    unit: 'ms',
    details: `Average latency: ${latency}ms`,
    timestamp: new Date(),
  });

  // Network Speed (simulated)
  const speedResult = await runPowerShell(`
    $adapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1;
    if ($adapter) {
      $speed = $adapter.LinkSpeed;
      Write-Output $speed
    } else {
      Write-Output "0"
    }
  `);
  const linkSpeed = speedResult.stdout.trim();
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
    timestamp: new Date(),
  });

  // DNS Resolution Time
  const dnsTimeResult = await runPowerShell(`
    $sw = [System.Diagnostics.Stopwatch]::StartNew();
    try {
      Resolve-DnsName -Name google.com -ErrorAction Stop | Out-Null;
      $sw.Stop();
      $ms = $sw.ElapsedMilliseconds;
      Write-Output "$ms"
    } catch {
      Write-Output "0"
    }
  `);
  const dnsTime = parseInt(dnsTimeResult.stdout.trim(), 10) || 0;
  const dnsScore = dnsTime > 0 ? Math.max(0, Math.min(100, Math.round(100 - dnsTime))) : 0;

  results.push({
    id: 'network-dns-speed',
    name: 'DNS Resolution',
    category: 'network',
    score: dnsScore,
    unit: 'ms',
    details: `DNS resolution took ${dnsTime}ms`,
    timestamp: new Date(),
  });

  return results;
}

async function getSystemInfo(): Promise<{
  cpu: string;
  memory: number;
  disk: string;
  gpu: string;
}> {
  const cpuResult = await runPowerShell(`
    $cpu = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1;
    if ($cpu) { Write-Output $cpu.Name } else { Write-Output "Unknown" }
  `);

  const memResult = await runPowerShell(`
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $totalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2);
    Write-Output "$totalGB"
  `);

  const diskResult = await runPowerShell(`
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'";
    $totalGB = [math]::Round($disk.Size / 1GB, 2);
    Write-Output "$totalGB GB"
  `);

  const gpuResult = await runPowerShell(`
    $gpu = Get-CimInstance -ClassName Win32_VideoController | Select-Object -First 1;
    if ($gpu) { Write-Output $gpu.Name } else { Write-Output "Unknown" }
  `);

  return {
    cpu: cpuResult.stdout.trim() || 'Unknown',
    memory: parseFloat(memResult.stdout.trim()) || 0,
    disk: diskResult.stdout.trim() || 'Unknown',
    gpu: gpuResult.stdout.trim() || 'Unknown',
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
