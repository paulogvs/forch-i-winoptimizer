import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runNetworkFix, testConnectivity, fixError0x00000709 } from './network-fixer';

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

describe('Network Fixer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runNetworkFix', () => {
    it('should run all fix steps', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      const result = await runNetworkFix();
      expect(result.fixes.length).toBeGreaterThan(0);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should handle failed fix steps', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Error',
        exitCode: 1,
      });

      const result = await runNetworkFix();
      expect(result.fixes.every((f) => f.status === 'failed')).toBe(true);
    });

    it('should include connectivity test', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '20',
        stderr: '',
        exitCode: 0,
      });

      const result = await runNetworkFix();
      expect(result.connectivityTest).toBeDefined();
      expect(result.connectivityTest.latency).toBe(20);
    });
  });

  describe('testConnectivity', () => {
    it('should return success when ping works', async () => {
      vi.mocked(runPowerShell)
        .mockResolvedValueOnce({
          success: true,
          stdout: '15',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          stdout: 'DNS_OK',
          stderr: '',
          exitCode: 0,
        });

      const result = await testConnectivity();
      expect(result.success).toBe(true);
      expect(result.latency).toBe(15);
    });

    it('should return failure when ping fails', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '0',
        stderr: '',
        exitCode: 1,
      });

      const result = await testConnectivity();
      expect(result.success).toBe(false);
    });
  });

  describe('fixError0x00000709', () => {
    it('should fix error 0x00000709 successfully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      const result = await fixError0x00000709();
      expect(result.success).toBe(true);
      expect(result.message).toContain('fixed');
    });

    it('should handle fix failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Access denied',
        exitCode: 1,
      });

      const result = await fixError0x00000709();
      expect(result.success).toBe(false);
    });
  });
});
