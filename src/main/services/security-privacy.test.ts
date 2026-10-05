import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPrivacySettings,
  applyPrivacySetting,
  applyAllPrivacySettings,
  runSecurityAction,
  getSecurityActions,
  benchmarkDNS,
  setDNS,
  isValidIPv4,
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
import { clearActiveAdapterCache } from './network-adapter';

describe('Security & Privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearActiveAdapterCache();
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
    it('should apply privacy setting when the value is read back', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ status: 'SUCCESS', before: 1, after: 0 }),
        stderr: '',
        exitCode: 0,
      });

      const result = await applyPrivacySetting('telemetry-level');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Applied');
      expect(result.after).toBe(0);
    });

    // Regression guard: the old script printed SUCCESS unconditionally because
    // a non-terminating CimException was never caught.
    it('reports a real failure when the read-back does not match the target', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ status: 'VERIFY_FAILED', before: 1, after: 1 }),
        stderr: '',
        exitCode: 0,
      });

      const result = await applyPrivacySetting('telemetry-level');
      expect(result.success).toBe(false);
      expect(result.after).toBe(1);
    });

    it('should handle unknown setting', async () => {
      const result = await applyPrivacySetting('unknown-setting');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should handle apply failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ status: 'FAILED', error: 'Access denied' }),
        stderr: '',
        exitCode: 0,
      });

      const result = await applyPrivacySetting('telemetry-level');
      expect(result.success).toBe(false);
    });
  });

  describe('applyAllPrivacySettings', () => {
    it('should apply all privacy settings', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ status: 'SUCCESS', before: 1, after: 0 }),
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

    // Fase 1.7: no server may hang the benchmark. A ping that never resolves
    // degrades to latency 0 for that server instead of blocking Promise.all.
    it('times out a hanging server instead of blocking the benchmark', async () => {
      vi.mocked(runPowerShell).mockImplementation((script: string) => {
        if (String(script).includes('1.1.1.1')) {
          return new Promise(() => undefined) as unknown as Promise<{
            success: boolean;
            stdout: string;
            stderr: string;
            exitCode: number;
          }>;
        }
        return Promise.resolve({ success: true, stdout: '20', stderr: '', exitCode: 0 });
      });

      const start = Date.now();
      const result = await benchmarkDNS(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(5000);
      expect(result.length).toBe(5);
      const hung = result.find((r) => r.primaryDNS === '1.1.1.1');
      expect(hung?.avgLatency).toBe(0);
      expect(hung?.reliability).toBe(0);
    }, 10000);
  });

  describe('setDNS', () => {
    const adapterPayload = JSON.stringify({
      Name: 'Ethernet',
      InterfaceDescription: 'Realtek PCIe GbE',
      InterfaceIndex: 3,
      Status: 'Up',
      HasGateway: true,
    });

    it('resolves the correct adapter, applies DNS and confirms it by re-reading', async () => {
      vi.mocked(runPowerShell)
        .mockResolvedValueOnce({ success: true, stdout: adapterPayload, stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({
          success: true,
          stdout: JSON.stringify({
            status: 'SUCCESS',
            before: ['192.168.1.1'],
            after: ['8.8.8.8', '8.8.4.4'],
          }),
          stderr: '',
          exitCode: 0,
        });

      const result = await setDNS('8.8.8.8', '8.8.4.4');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Ethernet');
      expect(result.after).toEqual(['8.8.8.8', '8.8.4.4']);

      const applyScript = vi.mocked(runPowerShell).mock.calls[1]?.[0] ?? '';
      expect(applyScript).toContain('$ifIndex = 3');
      expect(applyScript).not.toContain('Select-Object -First 1');
    });

    // Regression guard: the old script printed SUCCESS unconditionally even
    // when the non-terminating CimException changed nothing.
    it('reports failure (after reverting) when the change cannot be confirmed', async () => {
      vi.mocked(runPowerShell)
        .mockResolvedValueOnce({ success: true, stdout: adapterPayload, stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({
          success: true,
          stdout: JSON.stringify({
            status: 'VERIFY_FAILED',
            before: ['192.168.1.1'],
            after: ['192.168.1.1'],
          }),
          stderr: '',
          exitCode: 0,
        });

      const result = await setDNS('8.8.8.8', '8.8.4.4');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not confirmed');
    });

    it('reports a real failure when the apply throws', async () => {
      vi.mocked(runPowerShell)
        .mockResolvedValueOnce({ success: true, stdout: adapterPayload, stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({
          success: true,
          stdout: JSON.stringify({ status: 'FAILED', error: 'Access is denied' }),
          stderr: '',
          exitCode: 0,
        });

      const result = await setDNS('8.8.8.8', '8.8.4.4');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Access is denied');
    });

    it('fails fast when no active adapter can be resolved', async () => {
      vi.mocked(runPowerShell).mockResolvedValueOnce({
        success: true,
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const result = await setDNS('8.8.8.8', '8.8.4.4');
      expect(result.success).toBe(false);
      expect(result.message).toContain('No active network adapter');
      expect(vi.mocked(runPowerShell)).toHaveBeenCalledTimes(1);
    });

    it('refuses invalid addresses before touching PowerShell', async () => {
      const result = await setDNS('not-an-ip', '8.8.4.4');
      expect(result.success).toBe(false);
      expect(vi.mocked(runPowerShell)).not.toHaveBeenCalled();
    });
  });

  describe('isValidIPv4', () => {
    it('accepts valid addresses and rejects injection attempts', () => {
      expect(isValidIPv4('8.8.8.8')).toBe(true);
      expect(isValidIPv4('255.255.255.255')).toBe(true);
      expect(isValidIPv4('999.1.1.1')).toBe(false);
      expect(isValidIPv4("1.1.1.1'; Remove-Item C:\\ -Recurse")).toBe(false);
    });
  });
});
