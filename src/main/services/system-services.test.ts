import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSystemServices, toggleService, setServiceStartType } from './system-services';

// Mock powershell module
vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  parsePowerShellJson: vi.fn(),
  toArray: (v: unknown) => (v == null ? [] : Array.isArray(v) ? v : [v]),
}));

import { runPowerShell, parsePowerShellJson } from './powershell';

describe('system-services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSystemServices', () => {
    it('should return empty array on PowerShell failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Access denied',
        exitCode: 1,
      });

      const result = await getSystemServices();

      expect(result).toEqual([]);
    });

    it('should return empty array when parse fails', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'invalid json',
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(null);

      const result = await getSystemServices();

      expect(result).toEqual([]);
    });

    it('should return parsed services', async () => {
      const mockServices = [
        { Name: 'WSearch', DisplayName: 'Windows Search', Description: 'Search service', Status: 'Running', StartType: 'Automatic' },
        { Name: 'SysMain', DisplayName: 'SysMain', Description: 'Superfetch', Status: 'Running', StartType: 'Automatic' },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockServices),
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(mockServices);

      const result = await getSystemServices();

      expect(result.length).toBe(2);
      expect(result[0]!.name).toBe('WSearch');
      expect(result[0]!.displayName).toBe('Windows Search');
      expect(result[0]!.status).toBe('running');
      expect(result[0]!.startType).toBe('automatic');
    });

    it('should mark protected services correctly', async () => {
      const mockServices = [
        { Name: 'WinDefend', DisplayName: 'Windows Defender', Description: 'Antivirus', Status: 'Running', StartType: 'Automatic' },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockServices),
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(mockServices);

      const result = await getSystemServices();

      expect(result[0]!.protection).toBe('protected');
      expect(result[0]!.canOptimize).toBe(false);
    });

    it('should mark optimizable services correctly', async () => {
      const mockServices = [
        { Name: 'DiagTrack', DisplayName: 'Connected User Experiences', Description: 'Telemetry', Status: 'Running', StartType: 'Automatic' },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockServices),
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(mockServices);

      const result = await getSystemServices();

      expect(result[0]!.canOptimize).toBe(true);
      expect(result[0]!.recommendedAction).toBe('disable');
      expect(result[0]!.protection).toBe('caution');
    });

    it('should handle services with missing fields', async () => {
      const mockServices = [
        { Name: 'TestService', DisplayName: null, Description: null, Status: 'Stopped', StartType: 'Manual' },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockServices),
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(mockServices);

      const result = await getSystemServices();

      expect(result[0]!.displayName).toBe('TestService');
      expect(result[0]!.description).toBe('');
      expect(result[0]!.status).toBe('stopped');
    });

    // Regression guard: the script used to run `Get-CimInstance -Filter "Name='...'"` once
    // per service (~300 WMI queries in one call) — measured at 68 s on the Security page.
    it('fetches descriptions with one bulk CIM query, not one per service', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue([]);

      await getSystemServices();

      expect(vi.mocked(runPowerShell)).toHaveBeenCalledTimes(1);
      const script = vi.mocked(runPowerShell).mock.calls[0]?.[0] ?? '';
      expect(script).toMatch(/Get-CimInstance\s+-ClassName\s+Win32_Service/);
      expect(script).not.toMatch(/-Filter\s+"Name=/);
    });
  });

  describe('toggleService', () => {
    it('should start service successfully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await toggleService('WSearch', true);

      expect(result.success).toBe(true);
      expect(result.message).toContain('started');
    });

    it('should stop service successfully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await toggleService('WSearch', false);

      expect(result.success).toBe(true);
      expect(result.message).toContain('stopped');
    });

    it('should handle start failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Access denied',
        exitCode: 1,
      });

      const result = await toggleService('WSearch', true);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed');
    });

    it('should handle stop failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Service not found',
        exitCode: 1,
      });

      const result = await toggleService('NonExistent', false);

      expect(result.success).toBe(false);
    });

    it('should handle exceptions', async () => {
      vi.mocked(runPowerShell).mockRejectedValue(new Error('Unexpected error'));

      const result = await toggleService('WSearch', true);

      expect(result.success).toBe(false);
    });
  });

  describe('setServiceStartType', () => {
    it('should set start type to automatic', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await setServiceStartType('WSearch', 'automatic');

      expect(result.success).toBe(true);
      expect(result.message).toContain('automatic');
    });

    it('should set start type to manual', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await setServiceStartType('WSearch', 'manual');

      expect(result.success).toBe(true);
      expect(result.message).toContain('manual');
    });

    it('should set start type to disabled', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await setServiceStartType('WSearch', 'disabled');

      expect(result.success).toBe(true);
      expect(result.message).toContain('disabled');
    });

    it('should handle failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Access denied',
        exitCode: 1,
      });

      const result = await setServiceStartType('WSearch', 'disabled');

      expect(result.success).toBe(false);
    });

    it('should handle exceptions', async () => {
      vi.mocked(runPowerShell).mockRejectedValue(new Error('Unexpected error'));

      const result = await setServiceStartType('WSearch', 'automatic');

      expect(result.success).toBe(false);
    });
  });
});
