import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import type { CpuInfo } from 'node:os';
import {
  getSystemInfo,
  setSystemInfoBatchEnabled,
  isSystemInfoBatchEnabled,
  computeCpuUsage,
  SYSTEM_INFO_BATCH_SCRIPT,
  setCpuSampleWindowMs,
  CPU_SAMPLE_WINDOW_DEFAULT_MS,
} from './system-info';
import { ScanProgressReporter } from './scan-progress';
import type { ScanProgressEvent } from '@shared/scan-progress';
import type * as PowerShell from './powershell';

// Keep the real parser; only stub the process runner.
vi.mock('./powershell', async (importOriginal) => {
  const actual = await importOriginal<typeof PowerShell>();
  return { ...actual, runPowerShell: vi.fn() };
});

import { runPowerShell } from './powershell';

const ok = (stdout: string) => ({ success: true, stdout, stderr: '', exitCode: 0 });
const fail = () => ({ success: false, stdout: '', stderr: 'Access denied', exitCode: 1 });

const BATCH = {
  Os: {
    Caption: 'Windows 11 Pro',
    Version: '10.0.22631',
    BuildNumber: '22631',
    LastBootUpTime: '2024-01-15T10:30:00Z',
  },
  Disk: { Size: 512000000000, FreeSpace: 256000000000 },
  Gpu: { Name: 'NVIDIA GeForce RTX 3070', AdapterRAM: 8589934592, DriverVersion: '546.17' },
};

/** Fake os.cpus() payload with full control over the times delta. */
const cpuSet = (times: { user: number; sys: number; idle: number }, count = 4): CpuInfo[] =>
  Array.from({ length: count }, (_, i) => ({
    model: `Cpu ${i}`,
    speed: 3200,
    times: { user: times.user, nice: 0, sys: times.sys, idle: times.idle, irq: 0 },
  }));

describe('system-info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSystemInfoBatchEnabled(true);
    setCpuSampleWindowMs(0);
  });

  afterEach(() => {
    setSystemInfoBatchEnabled(true);
    setCpuSampleWindowMs(CPU_SAMPLE_WINDOW_DEFAULT_MS);
  });

  it('defaults to the batched strategy', () => {
    expect(isSystemInfoBatchEnabled()).toBe(true);
  });

  it('uses a SINGLE PowerShell process for the batch', async () => {
    vi.mocked(runPowerShell).mockResolvedValue(ok(JSON.stringify(BATCH)));

    const result = await getSystemInfo();

    expect(runPowerShell).toHaveBeenCalledTimes(1);
    expect(result.disk.total).toBe(512000000000);
    expect(result.disk.free).toBe(256000000000);
    expect(result.disk.used).toBe(256000000000);
    expect(result.gpu.name).toBe('NVIDIA GeForce RTX 3070');
    expect(result.gpu.vram).toBe(8589934592);
    expect(result.windowsVersion).toBe('Windows 11 Pro');
    expect(result.windowsBuild).toBe('22631');
    // CPU usage no longer comes from the batch (no Win32_Processor): it is
    // sampled from os.cpus(). Covered by the dedicated sampling test below.
    expect(result.cpu.usage).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.cpu.usage)).toBe(true);
  });

  it('falls back to the legacy probes when the batch fails', async () => {
    // First call (batch) fails; the three fallback probes then succeed.
    vi.mocked(runPowerShell)
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(ok(JSON.stringify({ Size: 1000, FreeSpace: 400 })))
      .mockResolvedValueOnce(
        ok(JSON.stringify({ Name: 'Generic GPU', AdapterRAM: 100, DriverVersion: '1.0' }))
      )
      .mockResolvedValueOnce(ok(JSON.stringify({ Caption: 'Windows 10', BuildNumber: '19045' })));

    const result = await getSystemInfo();

    expect(runPowerShell).toHaveBeenCalledTimes(4);
    expect(result.disk.total).toBe(1000);
    expect(result.gpu.name).toBe('Generic GPU');
    expect(result.windowsVersion).toBe('Windows 10');
    expect(result.cpu.usage).toBeGreaterThanOrEqual(0);
  });

  it('runs the three legacy probes when the batch flag is disabled', async () => {
    setSystemInfoBatchEnabled(false);
    vi.mocked(runPowerShell).mockResolvedValue(fail());

    await getSystemInfo();

    expect(runPowerShell).toHaveBeenCalledTimes(3);
  });

  it('calculates memory usage correctly', async () => {
    vi.mocked(runPowerShell).mockResolvedValue(fail());

    const result = await getSystemInfo();

    expect(result.memory.total).toBeGreaterThan(0);
    expect(result.memory.used).toBeGreaterThanOrEqual(0);
    expect(result.memory.usagePercent).toBeGreaterThanOrEqual(0);
  });

  it('emits discover/query/parse/normalize/done progress stages', async () => {
    vi.mocked(runPowerShell).mockResolvedValue(ok(JSON.stringify(BATCH)));
    const events: ScanProgressEvent[] = [];
    const reporter = new ScanProgressReporter('system', (event) => events.push(event));

    await getSystemInfo(reporter);

    const stages = events.map((event) => event.stage);
    expect(stages).toContain('discover');
    expect(stages).toContain('query');
    expect(stages).toContain('parse');
    expect(stages).toContain('normalize');
    expect(stages.at(-1)).toBe('done');
  });

  it('handles runner exceptions gracefully', async () => {
    vi.mocked(runPowerShell).mockRejectedValue(new Error('Unexpected'));

    const result = await getSystemInfo();

    expect(result.platform).toBeDefined();
    expect(result.cpu).toBeDefined();
    expect(result.memory).toBeDefined();
  });

  // --- P0.4: CPU usage without Win32_Processor (the 1.1s CIM bottleneck) ---

  it('batch script does not query Win32_Processor', () => {
    expect(SYSTEM_INFO_BATCH_SCRIPT).not.toContain('Win32_Processor');
    expect(SYSTEM_INFO_BATCH_SCRIPT).not.toContain('LoadPercentage');
    expect(SYSTEM_INFO_BATCH_SCRIPT).toContain('Win32_OperatingSystem');
    expect(SYSTEM_INFO_BATCH_SCRIPT).toContain('Win32_LogicalDisk');
    expect(SYSTEM_INFO_BATCH_SCRIPT).toContain('Win32_VideoController');
  });

  it('computeCpuUsage reports 0 when every core stays idle', () => {
    const before = cpuSet({ user: 1000, sys: 1000, idle: 8000 });
    const after = cpuSet({ user: 1000, sys: 1000, idle: 8500 });
    expect(computeCpuUsage(before, after)).toBe(0);
  });

  it('computeCpuUsage derives the busy percentage over the window', () => {
    // busy +100, idle +300 => total +400 => 25% usage
    const before = cpuSet({ user: 1000, sys: 1000, idle: 8000 });
    const after = cpuSet({ user: 1050, sys: 1050, idle: 8300 });
    expect(computeCpuUsage(before, after)).toBe(25);
  });

  it('computeCpuUsage returns 0 for no delta or mismatched samples', () => {
    const snapshot = cpuSet({ user: 1000, sys: 1000, idle: 8000 });
    expect(computeCpuUsage(snapshot, cpuSet({ user: 1000, sys: 1000, idle: 8000 }))).toBe(0);
    expect(computeCpuUsage([], [])).toBe(0);
    expect(
      computeCpuUsage(
        cpuSet({ user: 1, sys: 1, idle: 1 }, 4),
        cpuSet({ user: 2, sys: 2, idle: 2 }, 8)
      )
    ).toBe(0);
  });

  it('derives cpu.usage from an os.cpus() sample window, not PowerShell', async () => {
    const before = cpuSet({ user: 1000, sys: 1000, idle: 8000 });
    const after = cpuSet({ user: 1050, sys: 1050, idle: 8300 });
    // Call order: sample(first), sample(second), then model + cores reads.
    const spy = vi
      .spyOn(os, 'cpus')
      .mockReturnValueOnce(before)
      .mockReturnValueOnce(after)
      .mockReturnValue(after);
    vi.mocked(runPowerShell).mockResolvedValue(ok(JSON.stringify(BATCH)));

    try {
      const result = await getSystemInfo();

      expect(result.cpu.usage).toBe(25);
      expect(result.cpu.model).toBe('Cpu 0');
      expect(result.cpu.cores).toBe(4);
      expect(runPowerShell).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
