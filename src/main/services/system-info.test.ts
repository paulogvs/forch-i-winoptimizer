import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSystemInfo,
  setSystemInfoBatchEnabled,
  isSystemInfoBatchEnabled,
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
  Os: { Caption: 'Windows 11 Pro', Version: '10.0.22631', BuildNumber: '22631', LastBootUpTime: '2024-01-15T10:30:00Z' },
  Cpu: { LoadPercentage: 45, Name: 'Intel' },
  Disk: { Size: 512000000000, FreeSpace: 256000000000 },
  Gpu: { Name: 'NVIDIA GeForce RTX 3070', AdapterRAM: 8589934592, DriverVersion: '546.17' },
};

describe('system-info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSystemInfoBatchEnabled(true);
  });

  afterEach(() => {
    setSystemInfoBatchEnabled(true);
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
    expect(result.cpu.usage).toBe(45);
  });

  it('falls back to the legacy probes when the batch fails', async () => {
    // First call (batch) fails; the four fallback probes then succeed.
    vi.mocked(runPowerShell)
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(ok(JSON.stringify({ Size: 1000, FreeSpace: 400 })))
      .mockResolvedValueOnce(ok(JSON.stringify({ Name: 'Generic GPU', AdapterRAM: 100, DriverVersion: '1.0' })))
      .mockResolvedValueOnce(ok(JSON.stringify({ Caption: 'Windows 10', BuildNumber: '19045' })))
      .mockResolvedValueOnce(ok('12'));

    const result = await getSystemInfo();

    expect(runPowerShell).toHaveBeenCalledTimes(5);
    expect(result.disk.total).toBe(1000);
    expect(result.gpu.name).toBe('Generic GPU');
    expect(result.windowsVersion).toBe('Windows 10');
    expect(result.cpu.usage).toBe(12);
  });

  it('runs the four legacy probes when the batch flag is disabled', async () => {
    setSystemInfoBatchEnabled(false);
    vi.mocked(runPowerShell).mockResolvedValue(fail());

    await getSystemInfo();

    expect(runPowerShell).toHaveBeenCalledTimes(4);
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
});
