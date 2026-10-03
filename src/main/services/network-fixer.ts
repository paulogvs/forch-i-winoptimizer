import { parsePowerShellJson, runPowerShell } from './powershell';
import type { NetworkFixResult, NetworkFixReport } from '@shared/types';

interface FixStep {
  id: string;
  name: string;
  description: string;
  command: string;
  /** Optional post-condition: proves the step's effect really happened. */
  verify?: () => Promise<boolean>;
}

const LANMAN_PARAMS = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters';

/** True when SMBv1 is enabled AND the workstation service is running. */
async function verifySmb1Enabled(): Promise<boolean> {
  const result = await runPowerShell(`
    $enabled = $false;
    try {
      $c = Get-SmbServerConfiguration -ErrorAction Stop;
      $enabled = [bool]$c.EnableSMB1Protocol;
    } catch {
      $v = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters' -Name 'SMB1' -ErrorAction SilentlyContinue).SMB1;
      $enabled = ($null -ne $v) -and ([int]$v -eq 1);
    }
    $svc = Get-Service -Name LanmanWorkstation -ErrorAction SilentlyContinue;
    if ($enabled -and $svc -and $svc.Status.ToString() -eq 'Running') { Write-Output 'OK' } else { Write-Output 'FAILED' }
  `);
  return result.success && result.stdout.includes('OK');
}

/** True when at least one network adapter is up after a reset. */
async function verifyAdapterUp(): Promise<boolean> {
  const result = await runPowerShell(`
    $up = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' });
    if ($up.Count -gt 0) { Write-Output 'OK' } else { Write-Output 'FAILED' }
  `);
  return result.success && result.stdout.includes('OK');
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
      $ErrorActionPreference = 'Stop';
      try {
        Enable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart -ErrorAction Stop | Out-Null;
        Set-Service -Name LanmanWorkstation -StartupType Automatic -ErrorAction Stop;
        Start-Service -Name LanmanWorkstation -ErrorAction Stop;
        Write-Output "SMB1_FIX_COMPLETE"
      } catch {
        Write-Output ("FAILED: " + $_.Exception.Message)
      }
    `,
    verify: verifySmb1Enabled,
  },
  {
    id: 'reset-network-adapters',
    name: 'Reset Network Adapters',
    description: 'Disables and re-enables all network adapters',
    command: `
      $ErrorActionPreference = 'Stop';
      try {
        $adapters = @(Get-NetAdapter -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' });
        foreach ($adapter in $adapters) {
          Disable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop;
          Start-Sleep -Seconds 2;
          Enable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop;
        };
        Write-Output "ADAPTERS_RESET"
      } catch {
        Write-Output ("FAILED: " + $_.Exception.Message)
      }
    `,
    verify: verifyAdapterUp,
  },
];

export async function runNetworkFix(): Promise<NetworkFixReport> {
  const fixes: NetworkFixResult[] = [];

  for (const step of FIX_STEPS) {
    const startTime = Date.now();
    const result = await runPowerShell(step.command);
    const commandFailed = !result.success || /FAILED/i.test(result.stdout);

    // A clean exit is not enough: when the step declares a post-condition we
    // re-read the machine to prove the effect really happened.
    const verified = commandFailed ? false : step.verify ? await step.verify() : true;
    const duration = Date.now() - startTime;

    fixes.push({
      id: step.id,
      name: step.name,
      description: step.description,
      status: verified ? 'success' : 'failed',
      output:
        result.stdout.trim() ||
        result.stderr.trim() ||
        (verified ? '' : 'post-condition was not met'),
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
  // Every write uses -ErrorAction Stop, and the verdict is derived from the
  // state READ BACK — a non-terminating failure can no longer print SUCCESS.
  const result = await runPowerShell(`
    $ErrorActionPreference = 'Stop';
    $regPath = '${LANMAN_PARAMS}';
    $err = '';
    try {
      Enable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart -ErrorAction Stop | Out-Null;
      Set-Service -Name LanmanWorkstation -StartupType Automatic -ErrorAction Stop;
      Start-Service -Name LanmanWorkstation -ErrorAction Stop;
      if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
      Set-ItemProperty -Path $regPath -Name 'AllowInsecureGuestAuth' -Value 1 -Type DWord -ErrorAction Stop;
      Set-ItemProperty -Path $regPath -Name 'RequireSecuritySignature' -Value 0 -Type DWord -ErrorAction Stop;
    } catch { $err = $_.Exception.Message }
    $svc = Get-Service -Name LanmanWorkstation -ErrorAction SilentlyContinue;
    $guest = (Get-ItemProperty -Path $regPath -Name 'AllowInsecureGuestAuth' -ErrorAction SilentlyContinue).AllowInsecureGuestAuth;
    $sig = (Get-ItemProperty -Path $regPath -Name 'RequireSecuritySignature' -ErrorAction SilentlyContinue).RequireSecuritySignature;
    $serviceOk = ($svc -and $svc.Status.ToString() -eq 'Running');
    $verified = ($err -eq '') -and $serviceOk -and ([int]$guest -eq 1) -and ([int]$sig -eq 0);
    @{ verified = $verified; error = $err; serviceRunning = $serviceOk } | ConvertTo-Json -Compress
  `);

  const payload = result.success
    ? parsePowerShellJson<{ verified?: boolean; error?: string }>(result.stdout)
    : null;
  const verified = payload?.verified === true;

  return {
    success: verified,
    message: verified
      ? 'Error 0x00000709 fixed. SMB1 enabled and LanmanWorkstation configured.'
      : `Failed to fix error 0x00000709: ${
          payload?.error || result.stderr || 'the change was not confirmed'
        }`,
  };
}
