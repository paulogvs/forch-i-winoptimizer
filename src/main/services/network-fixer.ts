import { runPowerShell } from './powershell';
import type { NetworkFixResult, NetworkFixReport } from '@shared/types';

interface FixStep {
  id: string;
  name: string;
  description: string;
  command: string;
}

const FIX_STEPS: FixStep[] = [
  {
    id: 'flush-dns',
    name: 'Flush DNS Cache',
    description: 'Clears the DNS resolver cache',
    command: 'ipconfig /flushdns',
  },
  {
    id: 'release-ip',
    name: 'Release IP Address',
    description: 'Releases the current IP address',
    command: 'ipconfig /release',
  },
  {
    id: 'renew-ip',
    name: 'Renew IP Address',
    description: 'Obtains a new IP address from DHCP',
    command: 'ipconfig /renew',
  },
  {
    id: 'reset-winsock',
    name: 'Reset Winsock',
    description: 'Resets the Winsock catalog to default',
    command: 'netsh winsock reset',
  },
  {
    id: 'reset-tcpip',
    name: 'Reset TCP/IP Stack',
    description: 'Resets the TCP/IP stack to default',
    command: 'netsh int ip reset',
  },
  {
    id: 'reset-firewall',
    name: 'Reset Firewall Rules',
    description: 'Resets Windows Firewall to default',
    command: 'netsh advfirewall reset',
  },
  {
    id: 'fix-smb1',
    name: 'Fix SMBv1 / Error 0x00000709',
    description: 'Enables SMBv1 and fixes LanmanWorkstation for printer sharing',
    command: `
      Enable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart -ErrorAction SilentlyContinue;
      Set-Service -Name LanmanWorkstation -StartupType Automatic -ErrorAction SilentlyContinue;
      Start-Service -Name LanmanWorkstation -ErrorAction SilentlyContinue;
      Write-Output "SMB1_FIX_COMPLETE"
    `,
  },
  {
    id: 'reset-network-adapters',
    name: 'Reset Network Adapters',
    description: 'Disables and re-enables all network adapters',
    command: `
      $adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' };
      foreach ($adapter in $adapters) {
        Disable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction SilentlyContinue;
        Start-Sleep -Seconds 2;
        Enable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction SilentlyContinue;
      };
      Write-Output "ADAPTERS_RESET"
    `,
  },
];

export async function runNetworkFix(): Promise<NetworkFixReport> {
  const fixes: NetworkFixResult[] = [];

  for (const step of FIX_STEPS) {
    const startTime = Date.now();
    const result = await runPowerShell(step.command);
    const duration = Date.now() - startTime;

    fixes.push({
      id: step.id,
      name: step.name,
      description: step.description,
      status: result.success ? 'success' : 'failed',
      output: result.stdout || result.stderr,
      duration,
    });
  }

  // Post-fix connectivity test
  const connectivityTest = await testConnectivity();

  return {
    fixes,
    connectivityTest,
    timestamp: new Date(),
  };
}

export async function testConnectivity(): Promise<{
  success: boolean;
  latency: number;
  downloadSpeed: number;
}> {
  // Test latency with ping
  const pingResult = await runPowerShell(`
    $ping = Test-Connection -ComputerName 8.8.8.8 -Count 2 -ErrorAction SilentlyContinue;
    if ($ping) {
      $avgLatency = ($ping | Measure-Object -Property ResponseTime -Average).Average;
      Write-Output "$avgLatency"
    } else {
      Write-Output "0"
    }
  `);

  const latency = pingResult.success ? parseInt(pingResult.stdout.trim(), 10) || 0 : 0;

  // Test DNS resolution
  const dnsResult = await runPowerShell(`
    try {
      $result = Resolve-DnsName -Name google.com -QuickTimeout -ErrorAction Stop;
      Write-Output "DNS_OK"
    } catch {
      Write-Output "DNS_FAIL"
    }
  `);

  const success = latency > 0 && dnsResult.stdout.includes('DNS_OK');

  return {
    success,
    latency,
    downloadSpeed: 0, // Would require actual download test
  };
}

export async function fixError0x00000709(): Promise<{
  success: boolean;
  message: string;
}> {
  const result = await runPowerShell(`
    try {
      # Enable SMB1
      Enable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart -ErrorAction SilentlyContinue;

      # Fix LanmanWorkstation service
      Set-Service -Name LanmanWorkstation -StartupType Automatic -ErrorAction SilentlyContinue;
      Start-Service -Name LanmanWorkstation -ErrorAction SilentlyContinue;

      # Fix registry for printer sharing
      $regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters";
      if (!(Test-Path $regPath)) {
        New-Item -Path $regPath -Force | Out-Null;
      }
      Set-ItemProperty -Path $regPath -Name "AllowInsecureGuestAuth" -Value 1 -Type DWord -ErrorAction SilentlyContinue;
      Set-ItemProperty -Path $regPath -Name "RequireSecuritySignature" -Value 0 -Type DWord -ErrorAction SilentlyContinue;

      Write-Output "SUCCESS"
    } catch {
      Write-Output "FAILED: $_"
    }
  `);

  return {
    success: result.success && result.stdout.includes('SUCCESS'),
    message:
      result.success && result.stdout.includes('SUCCESS')
        ? 'Error 0x00000709 fixed. SMB1 enabled and LanmanWorkstation configured.'
        : `Failed to fix error 0x00000709: ${result.stderr}`,
  };
}
