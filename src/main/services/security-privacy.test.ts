import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPrivacySettings,
  applyPrivacySetting,
  applyAllPrivacySettings,
  runSecurityAction,
  getSecurityActions,
  benchmarkDNS,
  setDNS,
} from './security-privacy';

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

import { runPowerShell } from './powershell';

describe('Security & Privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPrivacySettings', () => {
    const telemetryRow = (value: number): string =>
      JSON.stringify([
        {
          Path: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection',
          ValueName: 'AllowTelemetry',
          Value: value,
        },
      ]);

    it('should return privacy settings', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: telemetryRow(0),
        stderr: '',
        exitCode: 0,
      });

      const result = await getPrivacySettings();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('isApplied');
    });

    it('should detect applied settings', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: telemetryRow(0), // Telemetry disabled (recommended value)
        stderr: '',
        exitCode: 0,
      });

      const result = await getPrivacySettings();
      const telemetry = result.find((s) => s.id === 'telemetry-level');
      expect(telemetry?.currentValue).toBe(0);
      expect(telemetry?.isApplied).toBe(true);
    });

    it('should detect non-applied settings', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: telemetryRow(1), // Telemetry enabled (not recommended)
        stderr: '',
        exitCode: 0,
      });

      const result = await getPrivacySettings();
      const telemetry = result.find((s) => s.id === 'telemetry-level');
      expect(telemetry?.currentValue).toBe(1);
      expect(telemetry?.isApplied).toBe(false);
    });

    // Regression guard: used to spawn one PowerShell process per setting (17 in a
    // row) — `privacy:get-settings` was still pending after 30 s on the Security page.
    it('reads every registry value in a single PowerShell call', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const result = await getPrivacySettings();

      expect(vi.mocked(runPowerShell)).toHaveBeenCalledTimes(1);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('applyPrivacySetting', () => {
    it('should apply privacy setting successfully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      const result = await applyPrivacySetting('telemetry-level');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully');
    });

    it('should handle unknown setting', async () => {
      const result = await applyPrivacySetting('unknown-setting');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should handle apply failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Access denied',
        exitCode: 1,
      });

      const result = await applyPrivacySetting('telemetry-level');
      expect(result.success).toBe(false);
    });
  });

  describe('applyAllPrivacySettings', () => {
    it('should apply all privacy settings', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      const result = await applyAllPrivacySettings();
      expect(result.success).toBe(true);
      expect(result.applied).toBeGreaterThan(0);
    });
  });

  describe('runSecurityAction', () => {
    it('should run security action successfully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'DEFENDER_DISABLED',
        stderr: '',
        exitCode: 0,
      });

      const result = await runSecurityAction('disable-defender');
      expect(result.success).toBe(true);
    });

    it('should handle unknown action', async () => {
      const result = await runSecurityAction('unknown-action');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('getSecurityActions', () => {
    it('should return security actions', () => {
      const actions = getSecurityActions();
      expect(actions.length).toBeGreaterThan(0);
      expect(actions[0]).toHaveProperty('id');
      expect(actions[0]).toHaveProperty('name');
      expect(actions[0]).toHaveProperty('warning');
    });
  });

  describe('benchmarkDNS', () => {
    it('should benchmark DNS servers', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '20',
        stderr: '',
        exitCode: 0,
      });

      const result = await benchmarkDNS();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('avgLatency');
    });

    it('should sort by latency', async () => {
      let callCount = 0;
      vi.mocked(runPowerShell).mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          success: true,
          stdout: String(50 - callCount * 5), // Decreasing latency
          stderr: '',
          exitCode: 0,
        });
      });

      const result = await benchmarkDNS();
      for (let i = 1; i < result.length; i++) {
        expect(result[i]?.avgLatency).toBeGreaterThanOrEqual(result[i - 1]?.avgLatency ?? 0);
      }
    });

    // Regression guard: pings ran in a serial `for ... of await` loop, so an
    // unreachable server cost its full timeout for every server in the list —
    // `dns:benchmark` was measured at 35 s on the Security page.
    it('pings every server concurrently instead of waiting in sequence', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      vi.mocked(runPowerShell).mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { success: true, stdout: '20', stderr: '', exitCode: 0 };
      });

      const result = await benchmarkDNS();

      expect(result.length).toBeGreaterThan(1);
      expect(maxInFlight).toBeGreaterThan(1);
    });
  });

  describe('setDNS', () => {
    it('should set DNS successfully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      const result = await setDNS('8.8.8.8', '8.8.4.4');
      expect(result.success).toBe(true);
      expect(result.message).toContain('8.8.8.8');
    });

    it('should handle set DNS failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'No adapter found',
        exitCode: 1,
      });

      const result = await setDNS('8.8.8.8', '8.8.4.4');
      expect(result.success).toBe(false);
    });
  });
});
