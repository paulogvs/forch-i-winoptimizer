import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBenchmark, generateMarkdownReport } from './benchmark';

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

describe('Benchmark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runBenchmark', () => {
    it('should return benchmark report with all categories', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '100',
        stderr: '',
        exitCode: 0,
      });

      const result = await runBenchmark();
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.totalScore).toBeGreaterThan(0);
      expect(result.systemInfo).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should include all 5 categories', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '100',
        stderr: '',
        exitCode: 0,
      });

      const result = await runBenchmark();
      const categories = new Set(result.results.map((r) => r.category));
      expect(categories.has('cpu')).toBe(true);
      expect(categories.has('memory')).toBe(true);
      expect(categories.has('disk')).toBe(true);
      expect(categories.has('gpu')).toBe(true);
      expect(categories.has('network')).toBe(true);
    });

    it('should calculate total score correctly', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '100',
        stderr: '',
        exitCode: 0,
      });

      const result = await runBenchmark();
      const expectedTotal = result.results.reduce((sum, r) => sum + r.score, 0);
      expect(result.totalScore).toBe(expectedTotal);
    });

    it('should handle PowerShell errors gracefully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Error',
        exitCode: 1,
      });

      const result = await runBenchmark();
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.totalScore).toBeGreaterThanOrEqual(0);
    });

    it('should include system info', async () => {
      vi.mocked(runPowerShell).mockImplementation((command: string) => {
        if (command.includes('Win32_Processor')) {
          return Promise.resolve({
            success: true,
            stdout: 'Intel Core i7-12700K',
            stderr: '',
            exitCode: 0,
          });
        }
        if (command.includes('Win32_OperatingSystem')) {
          return Promise.resolve({
            success: true,
            stdout: '16',
            stderr: '',
            exitCode: 0,
          });
        }
        return Promise.resolve({
          success: true,
          stdout: '100',
          stderr: '',
          exitCode: 0,
        });
      });

      const result = await runBenchmark();
      expect(result.systemInfo.cpu).toBe('Intel Core i7-12700K');
      expect(result.systemInfo.memory).toBe(16);
    });
  });

  describe('generateMarkdownReport', () => {
    it('should generate markdown report', () => {
      const mockReport = {
        results: [
          {
            id: 'cpu-single-core',
            name: 'CPU Single-Core',
            category: 'cpu' as const,
            score: 85,
            unit: 'ms',
            details: 'Test completed in 100ms',
            timestamp: new Date(),
          },
        ],
        totalScore: 85,
        systemInfo: {
          cpu: 'Intel Core i7',
          memory: 16,
          disk: '512 GB',
          gpu: 'NVIDIA RTX 3080',
        },
        timestamp: new Date('2025-01-01'),
      };

      const markdown = generateMarkdownReport(mockReport);
      expect(markdown).toContain('# FORCH.iA WinOptimizer - Benchmark Report');
      expect(markdown).toContain('Intel Core i7');
      expect(markdown).toContain('CPU Single-Core');
      expect(markdown).toContain('85');
    });
  });
});
