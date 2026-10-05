import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBenchmark, generateMarkdownReport, BENCHMARK_SECTIONS } from './benchmark';

vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  parsePowerShellJson: vi.fn((data: string) => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }),
  toArray: (value: unknown) => (value == null ? [] : Array.isArray(value) ? value : [value]),
}));

vi.mock('./network-adapter', () => ({
  resolveActiveAdapter: vi.fn().mockResolvedValue(null),
}));

import { runPowerShell } from './powershell';

function batchStdout(values: Record<number, string>): string {
  return BENCHMARK_SECTIONS.map((_, i) => `@@BENCH_${i}@@\n${values[i] ?? ''}`).join('\n');
}

describe('Benchmark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runBenchmark', () => {
    it('should return benchmark report with all categories', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: batchStdout({ 0: '100', 15: 'Intel Core i7-12700K', 16: '16' }),
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
        stdout: batchStdout({ 0: '100' }),
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
        stdout: batchStdout({ 0: '100' }),
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
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: batchStdout({ 15: 'Intel Core i7-12700K', 16: '16' }),
        stderr: '',
        exitCode: 0,
      });

      const result = await runBenchmark();
      expect(result.systemInfo.cpu).toBe('Intel Core i7-12700K');
      expect(result.systemInfo.memory).toBe(16);
    });

    // Fase 1.4: the 19 legacy checks share ONE spawn with identical scoring.
    it('defines exactly the 19 legacy sections', () => {
      expect(BENCHMARK_SECTIONS.length).toBe(19);
    });

    it('runs every section in a single PowerShell spawn', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: batchStdout({}),
        stderr: '',
        exitCode: 0,
      });

      const result = await runBenchmark();

      // Adapter mocked to null (no adapter spawn) + 1 batch spawn.
      expect(vi.mocked(runPowerShell)).toHaveBeenCalledTimes(1);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('produces the same scores as the legacy per-check math', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: batchStdout({
          0: '100', // cpu-single: 100 - 100/50 = 98
          12: '20', // net-latency: 100 - 20 = 80
          15: 'Intel Core i7-12700K',
          16: '16',
          17: '512 GB',
          18: 'NVIDIA RTX 3080',
        }),
        stderr: '',
        exitCode: 0,
      });

      const result = await runBenchmark();
      const byId = new Map(result.results.map((r) => [r.id, r]));

      expect(byId.get('cpu-single-core')?.score).toBe(98);
      expect(byId.get('network-latency')?.score).toBe(80);
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
