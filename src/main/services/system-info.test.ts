import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSystemInfo } from './system-info';

// Mock powershell module
vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  parsePowerShellJson: vi.fn(),
}));

import { runPowerShell, parsePowerShellJson } from './powershell';

describe('system-info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return system info with fallback values', async () => {
    vi.mocked(runPowerShell).mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'Access denied',
      exitCode: 1,
    });

    const result = await getSystemInfo();

    expect(result.platform).toBeDefined();
    expect(result.hostname).toBeDefined();
    expect(result.cpu).toBeDefined();
    expect(result.memory).toBeDefined();
    expect(result.disk).toBeDefined();
    expect(result.gpu).toBeDefined();
  });

  it('should parse disk info from PowerShell', async () => {
    const mockDisk = { Size: 512000000000, FreeSpace: 256000000000 };

    vi.mocked(runPowerShell).mockResolvedValue({
      success: true,
      stdout: JSON.stringify(mockDisk),
      stderr: '',
      exitCode: 0,
    });
    vi.mocked(parsePowerShellJson).mockReturnValue(mockDisk);

    const result = await getSystemInfo();

    expect(result.disk.total).toBe(512000000000);
    expect(result.disk.free).toBe(256000000000);
    expect(result.disk.used).toBe(256000000000);
  });

  it('should parse GPU info from PowerShell', async () => {
    const mockGpu = { Name: 'NVIDIA GeForce RTX 3070', AdapterRAM: 8589934592, DriverVersion: '546.17' };

    vi.mocked(runPowerShell).mockResolvedValue({
      success: true,
      stdout: JSON.stringify(mockGpu),
      stderr: '',
      exitCode: 0,
    });
    vi.mocked(parsePowerShellJson).mockReturnValue(mockGpu);

    const result = await getSystemInfo();

    expect(result.gpu.name).toBe('NVIDIA GeForce RTX 3070');
    expect(result.gpu.vram).toBe(8589934592);
    expect(result.gpu.driverVersion).toBe('546.17');
  });

  it('should parse Windows version info', async () => {
    const mockWin = { Caption: 'Windows 11 Pro', Version: '10.0.22631', BuildNumber: '22631', LastBootUpTime: '2024-01-15T10:30:00Z' };

    vi.mocked(runPowerShell).mockResolvedValue({
      success: true,
      stdout: JSON.stringify(mockWin),
      stderr: '',
      exitCode: 0,
    });
    vi.mocked(parsePowerShellJson).mockReturnValue(mockWin);

    const result = await getSystemInfo();

    expect(result.windowsVersion).toBe('Windows 11 Pro');
    expect(result.windowsBuild).toBe('22631');
  });

  it('should parse CPU usage', async () => {
    vi.mocked(runPowerShell).mockResolvedValue({
      success: true,
      stdout: '45',
      stderr: '',
      exitCode: 0,
    });

    const result = await getSystemInfo();

    expect(result.cpu.usage).toBe(45);
  });

  it('should handle invalid CPU usage', async () => {
    vi.mocked(runPowerShell).mockResolvedValue({
      success: true,
      stdout: 'invalid',
      stderr: '',
      exitCode: 0,
    });

    const result = await getSystemInfo();

    // Should fallback to calculated value
    expect(result.cpu.usage).toBeGreaterThanOrEqual(0);
  });

  it('should handle exceptions gracefully', async () => {
    vi.mocked(runPowerShell).mockRejectedValue(new Error('Unexpected error'));

    const result = await getSystemInfo();

    expect(result.platform).toBeDefined();
    expect(result.cpu).toBeDefined();
    expect(result.memory).toBeDefined();
  });

  it('should calculate memory usage correctly', async () => {
    vi.mocked(runPowerShell).mockResolvedValue({
      success: false,
      stdout: '',
      stderr: '',
      exitCode: 1,
    });

    const result = await getSystemInfo();

    expect(result.memory.total).toBeGreaterThan(0);
    expect(result.memory.used).toBeGreaterThanOrEqual(0);
    expect(result.memory.free).toBeGreaterThanOrEqual(0);
    expect(result.memory.usagePercent).toBeGreaterThanOrEqual(0);
  });
});
