import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSystemAudit } from './system-audit';

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

describe('System Audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runSystemAudit', () => {
    it('should return audit report with all categories', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '0',
        stderr: '',
        exitCode: 0,
      });

      const result = await runSystemAudit();
      expect(result.checks.length).toBeGreaterThan(0);
      expect(result.totalChecks).toBe(result.checks.length);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should calculate correct counts', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '0',
        stderr: '',
        exitCode: 0,
      });

      const result = await runSystemAudit();
      const passed = result.checks.filter((c) => c.status === 'pass').length;
      const warnings = result.checks.filter((c) => c.status === 'warning').length;
      const criticals = result.checks.filter((c) => c.status === 'critical').length;

      expect(result.passedCount).toBe(passed);
      expect(result.warningCount).toBe(warnings);
      expect(result.criticalCount).toBe(criticals);
    });

    it('should include all 6 categories', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '0',
        stderr: '',
        exitCode: 0,
      });

      const result = await runSystemAudit();
      const categories = new Set(result.checks.map((c) => c.category));
      expect(categories.has('privacy')).toBe(true);
      expect(categories.has('performance')).toBe(true);
      expect(categories.has('memory')).toBe(true);
      expect(categories.has('storage')).toBe(true);
      expect(categories.has('startup')).toBe(true);
      expect(categories.has('network')).toBe(true);
    });

    it('should handle PowerShell errors gracefully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Error',
        exitCode: 1,
      });

      const result = await runSystemAudit();
      expect(result.checks.length).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should detect telemetry level correctly', async () => {
      vi.mocked(runPowerShell).mockImplementation((command: string) => {
        if (command.includes('AllowTelemetry')) {
          return Promise.resolve({
            success: true,
            stdout: '0', // Telemetry disabled
            stderr: '',
            exitCode: 0,
          });
        }
        return Promise.resolve({
          success: true,
          stdout: '0',
          stderr: '',
          exitCode: 0,
        });
      });

      const result = await runSystemAudit();
      const telemetryCheck = result.checks.find((c) => c.id === 'privacy-telemetry');
      expect(telemetryCheck).toBeDefined();
      expect(telemetryCheck?.status).toBe('pass');
    });

    it('should detect high memory usage', async () => {
      vi.mocked(runPowerShell).mockImplementation((command: string) => {
        if (command.includes('Win32_OperatingSystem') && command.includes('FreePhysicalMemory')) {
          return Promise.resolve({
            success: true,
            stdout: '90', // 90% memory usage
            stderr: '',
            exitCode: 0,
          });
        }
        return Promise.resolve({
          success: true,
          stdout: '0',
          stderr: '',
          exitCode: 0,
        });
      });

      const result = await runSystemAudit();
      const memoryCheck = result.checks.find((c) => c.id === 'memory-usage');
      expect(memoryCheck).toBeDefined();
      expect(memoryCheck?.status).toBe('critical');
    });
  });
});
