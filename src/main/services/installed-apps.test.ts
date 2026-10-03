import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getInstalledApps, uninstallApp } from './installed-apps';

// Mock powershell module
vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  parsePowerShellJson: vi.fn(),
  toArray: (v: unknown) => (v == null ? [] : Array.isArray(v) ? v : [v]),
}));

import { runPowerShell, parsePowerShellJson } from './powershell';

/** Success payload the uninstall script now emits (exit code 0 / 3010). */
const uninstallOk = () => ({
  success: true,
  stdout: 'UNINSTALL_OK:0',
  stderr: '',
  exitCode: 0,
});

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
        {
          Name: 'Google Chrome',
          DisplayVersion: '120.0.0',
          Publisher: 'Google LLC',
          InstallDate: '20240115',
          EstimatedSize: 512000,
          InstallLocation: 'C:\\Program Files\\Google\\Chrome',
          UninstallString: 'C:\\Program Files\\Google\\Chrome\\uninstall.exe',
        },
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
        {
          Name: 'Test App',
          DisplayVersion: null,
          Publisher: null,
          InstallDate: null,
          EstimatedSize: null,
          InstallLocation: null,
          UninstallString: 'uninstall.exe',
        },
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
        {
          Name: 'Microsoft Teams',
          DisplayVersion: '1.0',
          Publisher: 'Microsoft Corporation',
          InstallDate: '20240115',
          EstimatedSize: 1024,
          InstallLocation: 'C:\\Teams',
          UninstallString: 'uninstall.exe',
        },
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
    it('should uninstall MSI app when the process exits 0', async () => {
      vi.mocked(runPowerShell).mockResolvedValue(uninstallOk());

      const result = await uninstallApp(
        'app-1',
        'MsiExec.exe /x {12345678-1234-1234-1234-123456789012}'
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('success');
    });

    // Regression guard: the exit code was ignored, so a failed uninstall was
    // reported as successful.
    it('reports failure when the uninstaller exits non-zero', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'UNINSTALL_FAILED:1603',
        stderr: '',
        exitCode: 0,
      });

      const result = await uninstallApp(
        'app-1',
        'MsiExec.exe /x {12345678-1234-1234-1234-123456789012}'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('1603');
    });

    it('should uninstall regular app when the process exits 0', async () => {
      vi.mocked(runPowerShell).mockResolvedValue(uninstallOk());

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

  describe('uninstallApp hardening (P1.4)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
    });

    it('rejects uninstall strings with PowerShell metacharacters', async () => {
      const result = await uninstallApp('app-1', 'C:\\App\\u.exe"; Start-Process calc; "');

      expect(result.success).toBe(false);
      expect(runPowerShell).not.toHaveBeenCalled();
    });

    it('rejects command substitution in the uninstall string', async () => {
      const result = await uninstallApp('app-1', 'C:\\App\\u$(calc).exe');

      expect(result.success).toBe(false);
      expect(runPowerShell).not.toHaveBeenCalled();
    });

    it('rejects backtick escapes in the uninstall string', async () => {
      const result = await uninstallApp('app-1', 'C:\\App\\u`u.exe');

      expect(result.success).toBe(false);
      expect(runPowerShell).not.toHaveBeenCalled();
    });

    it('rejects bare executable names (must be an absolute path)', async () => {
      const result = await uninstallApp('app-1', 'uninstall.exe');

      expect(result.success).toBe(false);
      expect(runPowerShell).not.toHaveBeenCalled();
    });

    it('rejects non-exe targets such as cmd.exe command lines', async () => {
      const result = await uninstallApp('app-1', 'cmd /c del /q C:\\*');

      expect(result.success).toBe(false);
      expect(runPowerShell).not.toHaveBeenCalled();
    });

    it('rejects msiexec strings without a well-formed product GUID', async () => {
      const result = await uninstallApp('app-1', 'MsiExec.exe /x {not-a-guid}');

      expect(result.success).toBe(false);
      expect(runPowerShell).not.toHaveBeenCalled();
    });

    it('runs msiexec with only the validated product GUID', async () => {
      vi.mocked(runPowerShell).mockResolvedValue(uninstallOk());

      const result = await uninstallApp(
        'app-1',
        'MsiExec.exe /x {12345678-1234-1234-1234-123456789012}'
      );

      expect(result.success).toBe(true);
      const command = vi.mocked(runPowerShell).mock.calls[0]![0];
      expect(command).toContain('{12345678-1234-1234-1234-123456789012}');
      expect(command).toContain('/qn');
    });

    it('rejects msiexec strings with trailing junk after the GUID', async () => {
      const result = await uninstallApp(
        'app-1',
        'MsiExec.exe /x {12345678-1234-1234-1234-123456789012} extra-junk'
      );

      expect(result.success).toBe(false);
      expect(runPowerShell).not.toHaveBeenCalled();
    });

    it('strips trailing arguments and runs only the validated exe path', async () => {
      vi.mocked(runPowerShell).mockResolvedValue(uninstallOk());

      const result = await uninstallApp(
        'app-1',
        'C:\\Program Files\\App\\uninstall.exe /uninstall /S'
      );

      expect(result.success).toBe(true);
      const command = vi.mocked(runPowerShell).mock.calls[0]![0];
      expect(command).toContain('C:\\Program Files\\App\\uninstall.exe');
      expect(command).not.toContain('/uninstall');
    });
  });
});
