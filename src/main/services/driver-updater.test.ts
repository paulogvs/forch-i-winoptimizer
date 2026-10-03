import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanDrivers, createRestorePoint, installDriver, rollbackDriver } from './driver-updater';

// Mock the powershell module
vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  parsePowerShellJson: vi.fn((data: string) => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }),
}));

import { runPowerShell } from './powershell';

describe('Driver Updater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scanDrivers', () => {
    it('should return empty result when PowerShell fails', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Error',
        exitCode: 1,
      });

      const result = await scanDrivers();
      expect(result.drivers).toEqual([]);
      expect(result.totalDevices).toBe(0);
    });

    it('should parse drivers correctly', async () => {
      const mockDevices = [
        {
          DeviceID: 'PCI\\VEN_10DE',
          Name: 'NVIDIA GeForce RTX 3080',
          Manufacturer: 'NVIDIA',
          DriverVersion: '551.86',
          DriverDate: '2025-03-15',
          DeviceClass: 'Display',
          HardwareID: 'PCI\\VEN_10DE&DEV_2206',
        },
        {
          DeviceID: 'PCI\\VEN_8086',
          Name: 'Intel(R) UHD Graphics 630',
          Manufacturer: 'Intel',
          DriverVersion: '31.0.101.5522',
          DriverDate: '2025-02-20',
          DeviceClass: 'Display',
          HardwareID: 'PCI\\VEN_8086&DEV_3E9B',
        },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockDevices),
        stderr: '',
        exitCode: 0,
      });

      const result = await scanDrivers();
      expect(result.drivers).toHaveLength(2);
      expect(result.totalDevices).toBe(2);
      expect(result.drivers[0]?.manufacturer).toBe('NVIDIA');
      expect(result.drivers[1]?.manufacturer).toBe('Intel');
    });

    it('should detect outdated drivers', async () => {
      const mockDevices = [
        {
          DeviceID: 'PCI\\VEN_10DE',
          Name: 'NVIDIA GeForce RTX 3080',
          Manufacturer: 'NVIDIA',
          DriverVersion: '500.0.0', // Old version
          DriverDate: '2024-01-01',
          DeviceClass: 'Display',
          HardwareID: 'PCI\\VEN_10DE&DEV_2206',
        },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockDevices),
        stderr: '',
        exitCode: 0,
      });

      const result = await scanDrivers();
      expect(result.outdatedCount).toBe(1);
      expect(result.upToDateCount).toBe(0);
      expect(result.drivers[0]?.isUpToDate).toBe(false);
    });

    it('should detect up-to-date drivers', async () => {
      const mockDevices = [
        {
          DeviceID: 'PCI\\VEN_10DE',
          Name: 'NVIDIA GeForce RTX 3080',
          Manufacturer: 'NVIDIA',
          DriverVersion: '551.86', // Latest version
          DriverDate: '2025-03-15',
          DeviceClass: 'Display',
          HardwareID: 'PCI\\VEN_10DE&DEV_2206',
        },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockDevices),
        stderr: '',
        exitCode: 0,
      });

      const result = await scanDrivers();
      expect(result.outdatedCount).toBe(0);
      expect(result.upToDateCount).toBe(1);
      expect(result.drivers[0]?.isUpToDate).toBe(true);
    });
  });

  describe('createRestorePoint', () => {
    it('should create restore point successfully when a checkpoint is re-read', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ verified: true, error: '', sequence: 12 }),
        stderr: '',
        exitCode: 0,
      });

      const result = await createRestorePoint('Test restore point');
      expect(result.success).toBe(true);
      expect(result.message).toContain('successfully');
    });

    // Regression guard: Checkpoint-Computer failed non-terminatingly and the
    // script still printed SUCCESS.
    it('reports failure when no restore point is re-read', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ verified: false, error: 'System Restore is disabled' }),
        stderr: '',
        exitCode: 0,
      });

      const result = await createRestorePoint('Test restore point');
      expect(result.success).toBe(false);
      expect(result.message).toContain('disabled');
    });

    it('should handle restore point failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Access denied',
        exitCode: 1,
      });

      const result = await createRestorePoint('Test restore point');
      expect(result.success).toBe(false);
    });
  });

  describe('installDriver', () => {
    it('should open download URL for manufacturer drivers', async () => {
      const mockShell = { openExternal: vi.fn() };
      vi.doMock('electron', () => ({ shell: mockShell }));

      const result = await installDriver('PCI\\VEN_10DE', 'https://nvidia.com/download');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Opened manufacturer download page');
    });

    it('should use Windows Update for generic drivers', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SCAN_COMPLETE',
        stderr: '',
        exitCode: 0,
      });

      const result = await installDriver('PCI\\VEN_8086', '');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Windows Update');
    });
  });

  describe('rollbackDriver', () => {
    it('should rollback driver successfully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      const result = await rollbackDriver('PCI\\VEN_10DE');
      expect(result.success).toBe(true);
      expect(result.message).toContain('restarted successfully');
    });

    it('should handle rollback failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Device not found',
        exitCode: 1,
      });

      const result = await rollbackDriver('PCI\\VEN_10DE');
      expect(result.success).toBe(false);
    });
  });
});
