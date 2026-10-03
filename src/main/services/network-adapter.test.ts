import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isVirtualAdapter,
  selectActiveAdapter,
  resolveActiveAdapter,
  type NetworkAdapterInfo,
} from './network-adapter';

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

const adapter = (over: Partial<NetworkAdapterInfo>): NetworkAdapterInfo => ({
  Name: 'Ethernet',
  InterfaceDescription: 'Intel(R) Ethernet Connection',
  InterfaceIndex: 3,
  Status: 'Up',
  HasGateway: true,
  LinkSpeed: '1 Gbps',
  ...over,
});

describe('network-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isVirtualAdapter', () => {
    it('flags tunnels and virtual switches by name', () => {
      expect(isVirtualAdapter('Tailscale', 'Tailscale Tunnel')).toBe(true);
      expect(
        isVirtualAdapter('vEthernet (Default Switch)', 'Hyper-V Virtual Ethernet Adapter')
      ).toBe(true);
      expect(isVirtualAdapter('Ethernet', 'Intel(R) Ethernet Connection I219-V')).toBe(false);
      expect(isVirtualAdapter('Wi-Fi', 'Intel(R) Wi-Fi 6 AX201 160MHz')).toBe(false);
    });
  });

  describe('selectActiveAdapter', () => {
    it('prefers a physical adapter with a default gateway over a virtual one', () => {
      const chosen = selectActiveAdapter([
        adapter({
          Name: 'Tailscale',
          InterfaceDescription: 'Tailscale Tunnel',
          InterfaceIndex: 24,
          HasGateway: true,
        }),
        adapter({ Name: 'Ethernet', InterfaceDescription: 'Realtek PCIe GbE', InterfaceIndex: 3 }),
      ]);
      expect(chosen?.InterfaceIndex).toBe(3);
    });

    it('falls back to a virtual adapter when it is the only one with a gateway', () => {
      const chosen = selectActiveAdapter([
        adapter({
          Name: 'Ethernet',
          InterfaceDescription: 'Realtek PCIe GbE',
          InterfaceIndex: 3,
          Status: 'Disconnected',
          HasGateway: false,
        }),
        adapter({
          Name: 'Tailscale',
          InterfaceDescription: 'Tailscale Tunnel',
          InterfaceIndex: 24,
          HasGateway: true,
        }),
      ]);
      expect(chosen?.InterfaceIndex).toBe(24);
    });

    it('falls back to any up adapter when no gateway is reported', () => {
      const chosen = selectActiveAdapter([
        adapter({ Name: 'Ethernet', InterfaceIndex: 3, HasGateway: false }),
        adapter({ Name: 'Wi-Fi', InterfaceIndex: 5, HasGateway: false }),
      ]);
      expect(chosen?.InterfaceIndex).toBe(3);
    });

    it('returns null when no adapter is up', () => {
      expect(selectActiveAdapter([adapter({ Status: 'Disconnected' })])).toBeNull();
      expect(selectActiveAdapter([])).toBeNull();
    });
  });

  describe('resolveActiveAdapter', () => {
    it('parses enumerated adapters and picks the right one', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify([
          {
            Name: 'Tailscale',
            InterfaceDescription: 'Tailscale Tunnel',
            InterfaceIndex: 24,
            Status: 'Up',
            HasGateway: true,
            LinkSpeed: '100 Mbps',
          },
          {
            Name: 'Ethernet',
            InterfaceDescription: 'Realtek PCIe GbE',
            InterfaceIndex: 3,
            Status: 'Up',
            HasGateway: true,
            LinkSpeed: '1 Gbps',
          },
        ]),
        stderr: '',
        exitCode: 0,
      });

      const chosen = await resolveActiveAdapter();
      expect(chosen).toMatchObject({ interfaceIndex: 3, name: 'Ethernet', hasGateway: true });
    });

    it('handles a bare object (single adapter) instead of an array', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify({
          Name: 'Ethernet',
          InterfaceDescription: 'Realtek',
          InterfaceIndex: 3,
          Status: 'Up',
          HasGateway: true,
        }),
        stderr: '',
        exitCode: 0,
      });

      const chosen = await resolveActiveAdapter();
      expect(chosen?.interfaceIndex).toBe(3);
    });

    it('returns null when PowerShell fails', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'boom',
        exitCode: 1,
      });
      expect(await resolveActiveAdapter()).toBeNull();
    });
  });
});
