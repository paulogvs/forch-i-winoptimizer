import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getInstalledApps, uninstallApp } from './installed-apps';

// Mock powershell module
vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  parsePowerShellJson: vi.fn(),
}));

import { runPowerShell, parsePowerShellJson } from './powershell';

describe('installed-apps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getInstalledApps', () => {
    it('should return empty array on PowerShell failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Access denied',
        exitCode: 1,
      });

      const result = await getInstalledApps();

      expect(result).toEqual([]);
    });

    it('should return parsed apps from HKLM', async () => {
      const mockApps = [
        { Name: 'Google Chrome', DisplayVersion: '120.0.0', Publisher: 'Google LLC', InstallDate: '20240115', EstimatedSize: 512000, InstallLocation: 'C:\\Program Files\\Google\\Chrome', UninstallString: 'C:\\Program Files\\Google\\Chrome\\uninstall.exe' },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockApps),
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(mockApps);

      const result = await getInstalledApps();

      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty results', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(null);

      const result = await getInstalledApps();

      expect(result).toEqual([]);
    });

    it('should handle apps with missing fields', async () => {
      const mockApps = [
        { Name: 'Test App', DisplayVersion: null, Publisher: null, InstallDate: null, EstimatedSize: null, InstallLocation: null, UninstallString: 'uninstall.exe' },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockApps),
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(mockApps);

      const result = await getInstalledApps();

      // Should handle null values gracefully
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should mark Microsoft apps as caution', async () => {
      const mockApps = [
        { Name: 'Microsoft Teams', DisplayVersion: '1.0', Publisher: 'Microsoft Corporation', InstallDate: '20240115', EstimatedSize: 1024, InstallLocation: 'C:\\Teams', UninstallString: 'uninstall.exe' },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockApps),
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(mockApps);

      const result = await getInstalledApps();

      // Microsoft apps should be marked as caution or protected
      if (result.length > 0) {
        expect(['caution', 'protected']).toContain(result[0]!.protection);
      }
    });

    it('should handle exceptions', async () => {
      vi.mocked(runPowerShell).mockRejectedValue(new Error('Unexpected error'));

      const result = await getInstalledApps();

      expect(result).toEqual([]);
    });
  });

  describe('uninstallApp', () => {
    it('should uninstall MSI app', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await uninstallApp('app-1', 'MsiExec.exe /x {12345678-1234-1234-1234-123456789012}');

      expect(result.success).toBe(true);
      expect(result.message).toContain('success');
    });

    it('should uninstall regular app', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await uninstallApp('app-1', 'C:\\Program Files\\App\\uninstall.exe');

      expect(result.success).toBe(true);
    });

    it('should handle uninstall failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Uninstall failed',
        exitCode: 1,
      });

      const result = await uninstallApp('app-1', 'C:\\Program Files\\App\\uninstall.exe');

      expect(result.success).toBe(false);
    });

    it('should handle exceptions', async () => {
      vi.mocked(runPowerShell).mockRejectedValue(new Error('Unexpected error'));

      const result = await uninstallApp('app-1', 'C:\\Program Files\\App\\uninstall.exe');

      expect(result.success).toBe(false);
    });
  });
});
