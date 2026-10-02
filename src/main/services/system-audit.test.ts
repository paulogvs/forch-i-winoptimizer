import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSystemAudit, splitAuditOutput } from './system-audit';

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

const marker = (index: number): string => `@@FCHK_${index}@@`;

/**
 * Build the stdout a batched audit run would produce: one payload per marker,
 * with `overrides` substituted into the block whose script contains `needle`.
 * Everything else defaults to NOT_SET so a mis-routed payload fails assertions.
 */
function auditStdout(
  command: string,
  overrides: Array<{ needle: string; value: string }> = []
): string {
  const count = (command.match(/@@FCHK_\d+@@/g) ?? []).length;
  const blocks = command.split(/@@FCHK_\d+@@/);
  const values: string[] = Array.from({ length: count }, () => 'NOT_SET');
  for (const { needle, value } of overrides) {
    const index = blocks.slice(1).findIndex((block) => block.includes(needle));
    if (index >= 0 && index < values.length) values[index] = value;
  }
  return values.map((value, i) => `${marker(i)}\n${value}`).join('\n');
}

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
      vi.mocked(runPowerShell).mockImplementation(async (command: string) => ({
        success: true,
        stdout: auditStdout(command, [{ needle: 'AllowTelemetry', value: '0' }]),
        stderr: '',
        exitCode: 0,
      }));

      const result = await runSystemAudit();
      const telemetryCheck = result.checks.find((c) => c.id === 'privacy-telemetry');
      expect(telemetryCheck).toBeDefined();
      expect(telemetryCheck?.status).toBe('pass');
    });

    it('should detect high memory usage', async () => {
      vi.mocked(runPowerShell).mockImplementation(async (command: string) => ({
        success: true,
        stdout: auditStdout(command, [{ needle: 'FreePhysicalMemory', value: '90' }]),
        stderr: '',
        exitCode: 0,
      }));

      const result = await runSystemAudit();
      const memoryCheck = result.checks.find((c) => c.id === 'memory-usage');
      expect(memoryCheck).toBeDefined();
      expect(memoryCheck?.status).toBe('critical');
    });

    // Regression guard: the audit used to pay one PowerShell process per check —
    // 31 spawns at ~1.8 s each (~56 s of pure process startup, 73 s measured end
    // to end). Every check now runs inside a single process, delimited by markers.
    it('runs every check in a single PowerShell process', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await runSystemAudit();

      expect(runPowerShell).toHaveBeenCalledTimes(1);
      const command: string = vi.mocked(runPowerShell).mock.calls[0]?.[0] ?? '';
      const markers = command.match(/@@FCHK_\d+@@/g) ?? [];
      expect(result.totalChecks).toBe(31);
      expect(markers).toHaveLength(result.totalChecks);
      // The command must stay well under CreateProcess' 32 767-char limit
      // (UTF-16 script is base64-encoded for -EncodedCommand).
      expect(command.length).toBeLessThan(12_000);
    });
  });

  describe('splitAuditOutput', () => {
    it('routes each marker block to its own payload', () => {
      const stdout = `${marker(0)}\nfirst\n${marker(1)}\nsecond`;
      expect(splitAuditOutput(stdout, 2)).toEqual(['first', 'second']);
    });

    it('keeps multi-line payloads intact', () => {
      const stdout = `${marker(0)}\nline1\nline2\n${marker(1)}\nvalue`;
      expect(splitAuditOutput(stdout, 2)).toEqual(['line1\nline2', 'value']);
    });

    it('returns one empty payload per check when markers are missing', () => {
      expect(splitAuditOutput('', 3)).toEqual(['', '', '']);
      expect(splitAuditOutput('something went wrong', 3)).toEqual(['', '', '']);
    });
  });
});
