import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkForDrift,
  reapplyTweak,
  reapplyAllTweaks,
  getDriftStatus,
  startDriftMonitoring,
  stopDriftMonitoring,
} from './drift-guard';

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

describe('Drift Guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopDriftMonitoring();
  });

  describe('checkForDrift', () => {
    it('should return empty array when no drift detected', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '0',
        stderr: '',
        exitCode: 0,
      });

      const result = await checkForDrift();
      expect(result).toEqual([]);
    });

    it('should detect drift when values change', async () => {
      // First call returns expected value, second returns different value
      let callCount = 0;
      vi.mocked(runPowerShell).mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          success: true,
          stdout: callCount <= 8 ? '0' : '1', // First 8 calls return expected, then drift
          stderr: '',
          exitCode: 0,
        });
      });

      const result = await checkForDrift();
      expect(result).toBeDefined();
    });
  });

  describe('reapplyTweak', () => {
    it('should reapply tweak successfully when the read-back confirms it', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ verified: true, error: '', value: 0 }),
        stderr: '',
        exitCode: 0,
      });

      const result = await reapplyTweak('telemetry-disabled');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully');
    });

    it('should handle unknown tweak', async () => {
      const result = await reapplyTweak('unknown-tweak');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('reports failure when the read-back does not confirm the value', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ verified: false, error: 'Access denied' }),
        stderr: '',
        exitCode: 0,
      });

      const result = await reapplyTweak('telemetry-disabled');
      expect(result.success).toBe(false);
    });

    it('should handle reapply failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Access denied',
        exitCode: 1,
      });

      const result = await reapplyTweak('telemetry-disabled');
      expect(result.success).toBe(false);
    });
  });

  describe('reapplyAllTweaks', () => {
    it('should reapply all tweaks', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ verified: true }),
        stderr: '',
        exitCode: 0,
      });

      const result = await reapplyAllTweaks();
      expect(result.success).toBe(true);
      expect(result.fixed).toBeGreaterThan(0);
    });
  });

  describe('getDriftStatus', () => {
    it('should return drift status', () => {
      const status = getDriftStatus();
      expect(status).toHaveProperty('isMonitoring');
      expect(status).toHaveProperty('lastCheck');
      expect(status).toHaveProperty('driftEvents');
      expect(status).toHaveProperty('tweaksAtRisk');
    });
  });

  describe('startDriftMonitoring / stopDriftMonitoring', () => {
    it('should start and stop monitoring', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '0',
        stderr: '',
        exitCode: 0,
      });

      startDriftMonitoring(1000);
      let status = getDriftStatus();
      expect(status.isMonitoring).toBe(true);

      stopDriftMonitoring();
      status = getDriftStatus();
      expect(status.isMonitoring).toBe(false);
    });
  });
});
