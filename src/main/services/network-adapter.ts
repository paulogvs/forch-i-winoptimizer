import { parsePowerShellJson, runPowerShell, toArray } from './powershell';

/**
 * Single source of truth for "which network adapter is really active".
 *
 * Both `dns:set` and the network benchmark used to take the FIRST adapter whose
 * `Status -eq 'Up'`. On a machine with a tunnel (Tailscale, VPN, Hyper-V, WSL…)
 * that is very often the virtual adapter, not the one that carries real traffic,
 * so the app measured — or configured — the wrong NIC.
 *
 * The resolver prefers the adapter that owns the default route (`0.0.0.0/0`)
 * and, among those, a physical one. Virtual/tunnel adapters are only used as a
 * last resort.
 */

export interface NetworkAdapterInfo {
  Name: string;
  InterfaceDescription: string;
  InterfaceIndex: number;
  Status: string;
  HasGateway: boolean;
  LinkSpeed?: string;
}

export interface ActiveAdapter {
  name: string;
  interfaceIndex: number;
  description: string;
  hasGateway: boolean;
  linkSpeed: string;
}

/** Names/descriptions that identify a virtual, tunnel or switch adapter. */
const VIRTUAL_ADAPTER_PATTERN =
  /tailscale|wireguard|openvpn|nordlynx|proton|hamachi|radmin|zerotier|wintun|tap-?windows|\btun\b|\bvpn\b|hyper-?v|vethernet|wsl|loopback|bluetooth|npcap|virtualbox|vmware|docker|veth|virtual ethernet/i;

export function isVirtualAdapter(name: string, description: string): boolean {
  return VIRTUAL_ADAPTER_PATTERN.test(name) || VIRTUAL_ADAPTER_PATTERN.test(description);
}

/**
 * Pure resolver. Given every enumerated adapter (any status), choose the one
 * that most likely carries real traffic:
 *   1. up + gateway + physical
 *   2. up + gateway (virtual allowed)
 *   3. up + physical
 *   4. any up
 * Returns null when nothing is up.
 */
export function selectActiveAdapter(
  adapters: readonly NetworkAdapterInfo[]
): NetworkAdapterInfo | null {
  const up = adapters.filter((a) => String(a.Status).toLowerCase() === 'up');
  if (up.length === 0) return null;

  const physical = (a: NetworkAdapterInfo): boolean =>
    !isVirtualAdapter(a.Name, a.InterfaceDescription);

  return (
    up.find((a) => a.HasGateway && physical(a)) ??
    up.find((a) => a.HasGateway) ??
    up.find((a) => physical(a)) ??
    up[0] ??
    null
  );
}

/**
 * PowerShell that enumerates every adapter plus whether it owns a default route.
 * Default routes with `NextHop = 0.0.0.0` (on-link) are ignored.
 */
const ENUMERATE_SCRIPT = `
  $routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Where-Object { $_.NextHop -and ([string]$_.NextHop) -ne '0.0.0.0' });
  $gatewayIndexes = @($routes | Select-Object -ExpandProperty InterfaceIndex -Unique);
  $rows = @();
  foreach ($a in (Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })) {
    $rows += @{
      Name = [string]$a.Name;
      InterfaceDescription = [string]$a.InterfaceDescription;
      InterfaceIndex = [int]$a.ifIndex;
      Status = [string]$a.Status;
      HasGateway = ($gatewayIndexes -contains [int]$a.ifIndex);
      LinkSpeed = [string]$a.LinkSpeed;
    }
  }
  $rows | ConvertTo-Json -Compress
`;

/** Enumerate adapters and resolve the active one. Never throws. */
export async function resolveActiveAdapter(): Promise<ActiveAdapter | null> {
  const result = await runPowerShell(ENUMERATE_SCRIPT);
  if (!result.success || !result.stdout) return null;

  const parsed = toArray(
    parsePowerShellJson<NetworkAdapterInfo | NetworkAdapterInfo[]>(result.stdout)
  );
  const chosen = selectActiveAdapter(parsed);
  if (!chosen) return null;

  return {
    name: chosen.Name,
    interfaceIndex: chosen.InterfaceIndex,
    description: chosen.InterfaceDescription,
    hasGateway: Boolean(chosen.HasGateway),
    linkSpeed: chosen.LinkSpeed ?? '',
  };
}
