import { runPowerShell } from './powershell';
import { createProgressReporter } from './scan-progress';
import {
  SECURITY_CHECK_CATALOG,
  computeSecurityScore,
  summarizeSecurityChecks,
  type SecurityCheckResult,
  type SecurityCheckStatus,
  type SecurityMachineInfo,
  type SecurityScanReport,
} from '@shared/security-scan';

/**
 * Real security scanner (v0.6.0).
 *
 * Replaces the previous hardcoded 8-check list. Every check below is a live,
 * READ-ONLY query against the machine (CIM/WMI, registry, Get-*). No product
 * names are hardcoded: "is there an antivirus?" reads SecurityCenter2 and
 * decodes each product's live state.
 *
 * Execution model (mirrors `system-audit.ts`):
 *  - ONE PowerShell process serves all checks (each spawn costs ~1.8 s).
 *  - Each check is wrapped in try/catch and prints a marker, so one failing
 *    check degrades to `unknown`/`requires-admin` without aborting the scan.
 *  - The whole run has a global timeout (runPowerShell = 60 s). A check that
 *    never emits output is reported as `unknown` (reason: no data) rather than
 *    invented. Per-check true timeouts are not available inside a single
 *    PowerShell 5.1 process; see docs/SECURITY_CHECKS.md for this trade-off.
 */

const ENV_MARKER = '@@FENV@@';
const CHECK_MARKER = (index: number): string => `@@FSEC_${index}@@`;

/** Sanitize and emit a JSON error object from a PowerShell catch block. */
const PS_EXCEPTION =
  "$m = ('' + $_.Exception.Message).Replace('\\','/').Replace('\"',[char]39)" +
  ".Replace([char]13,' ').Replace([char]10,' '); " +
  'Write-Output (\'{"kind":"exception","message":"\' + $m + \'"}\')';

const ENV_SCRIPT = `
$os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue;
$cv = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -ErrorAction SilentlyContinue;
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
@{ caption = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber; edition = [string]$cv.EditionID; displayVersion = [string]$cv.DisplayVersion; isAdmin = [bool]$isAdmin } | ConvertTo-Json -Compress
`;

/**
 * Live query per catalog id. Each script prints exactly one JSON object. Keys
 * and semantics are documented in docs/SECURITY_CHECKS.md.
 */
export const SECURITY_SCRIPTS: Readonly<Record<string, string>> = {
  antivirus: `
    $kind = 'products';
    $items = @();
    $message = '';
    try {
      $av = Get-CimInstance -Namespace 'root\\SecurityCenter2' -ClassName AntiVirusProduct -ErrorAction Stop;
      foreach ($p in $av) { $items += @{ name = [string]$p.displayName; state = [string]$p.productState } }
      if ($items.Count -eq 0) { $kind = 'empty' }
    } catch { $kind = 'unreadable'; $message = [string]$_.Exception.Message }
    @{ kind = $kind; items = $items; message = $message } | ConvertTo-Json -Compress -Depth 6
  `,

  firewall: `
    $kind = 'profiles';
    $profiles = @();
    try {
      foreach ($p in Get-NetFirewallProfile -ErrorAction Stop) { $profiles += @{ name = [string]$p.Name; enabled = [bool]$p.Enabled } }
    } catch { $profiles = @() }
    if ($profiles.Count -eq 0) {
      $kind = 'registry';
      $base = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy';
      foreach ($pair in @(@{ n = 'Domain'; k = 'DomainProfile' }, @{ n = 'Private'; k = 'StandardProfile' }, @{ n = 'Public'; k = 'PublicProfile' })) {
        $v = (Get-ItemProperty -Path ($base + '\\' + $pair.k) -Name 'EnableFirewall' -ErrorAction SilentlyContinue).EnableFirewall;
        if ($v -ne $null) { $profiles += @{ name = $pair.n; enabled = ([int]$v -eq 1) } }
      }
      if ($profiles.Count -eq 0) { $kind = 'unreadable' }
    }
    @{ kind = $kind; profiles = $profiles } | ConvertTo-Json -Compress -Depth 6
  `,

  uac: `
    $kind = 'uac';
    $p = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System';
    $enableLua = (Get-ItemProperty -Path $p -Name 'EnableLUA' -ErrorAction SilentlyContinue).EnableLUA;
    $consent = (Get-ItemProperty -Path $p -Name 'ConsentPromptBehaviorAdmin' -ErrorAction SilentlyContinue).ConsentPromptBehaviorAdmin;
    $secure = (Get-ItemProperty -Path $p -Name 'PromptOnSecureDesktop' -ErrorAction SilentlyContinue).PromptOnSecureDesktop;
    if ($enableLua -eq $null -and $consent -eq $null) { $kind = 'missing' }
    @{ kind = $kind; enableLua = $enableLua; consentPrompt = $consent; secureDesktop = $secure } | ConvertTo-Json -Compress
  `,

  smb1: `
    $kind = 'smb';
    $enabled = $null;
    try {
      $c = Get-SmbServerConfiguration -ErrorAction Stop;
      $enabled = [bool]$c.EnableSMB1Protocol
    } catch {
      $kind = 'registry';
      try {
        $v = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters' -Name 'SMB1' -ErrorAction Stop).SMB1;
        $enabled = ([int]$v -eq 1)
      } catch { $kind = 'unreadable' }
    }
    @{ kind = $kind; enabled = $enabled } | ConvertTo-Json -Compress
  `,

  'secure-boot': `
    $kind = 'ok';
    $value = $null;
    $message = '';
    try {
      $value = [bool](Confirm-SecureBootUEFI -ErrorAction Stop)
    } catch {
      $message = [string]$_.Exception.Message;
      if ($env:firmware_type -eq 'Legacy') { $kind = 'not-uefi' }
      elseif ($message -match 'not supported on this platform|Legacy|BIOS') { $kind = 'not-uefi' }
      else { $kind = 'error' }
    }
    @{ kind = $kind; value = $value; message = $message; firmware = [string]$env:firmware_type } | ConvertTo-Json -Compress
  `,

  tpm: `
    $kind = 'absent';
    $enabled = $null;
    $activated = $null;
    $spec = '';
    $message = '';
    try {
      $t = Get-CimInstance -Namespace 'root\\cimv2\\security\\microsofttpm' -ClassName Win32_Tpm -ErrorAction Stop;
      if ($t -ne $null) {
        $kind = 'tpm';
        $enabled = [bool]$t.IsEnabled_InitialValue;
        $activated = [bool]$t.IsActivated_InitialValue;
        $spec = [string]$t.SpecVersion
      }
    } catch { $kind = 'error'; $message = [string]$_.Exception.Message }
    @{ kind = $kind; enabled = $enabled; activated = $activated; spec = $spec; message = $message } | ConvertTo-Json -Compress
  `,

  bitlocker: `
    $edition = [string](Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -Name 'EditionID' -ErrorAction SilentlyContinue).EditionID;
    $kind = 'error';
    $protection = '';
    $percent = $null;
    $message = '';
    try {
      $v = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop;
      $kind = 'bl';
      $protection = [string]$v.ProtectionStatus;
      $percent = $v.EncryptionPercentage
    } catch { $kind = 'error'; $message = [string]$_.Exception.Message }
    @{ kind = $kind; protection = $protection; percent = $percent; edition = $edition; message = $message } | ConvertTo-Json -Compress
  `,

  'windows-update': `
    $kind = 'wu';
    $last = $null;
    try {
      $qfe = Get-CimInstance -ClassName Win32_QuickFixEngineering -ErrorAction Stop | Where-Object { $_.InstalledOn -ne $null } | Sort-Object InstalledOn -Descending | Select-Object -First 1;
      if ($qfe -ne $null -and $qfe.InstalledOn -ne $null) { $last = ([datetime]$qfe.InstalledOn).ToString('yyyy-MM-dd') }
    } catch { $kind = 'error' }
    $reboot = $false;
    if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { $reboot = $true }
    $pfr = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager' -Name 'PendingFileRenameOperations' -ErrorAction SilentlyContinue);
    if ($pfr -ne $null) { $reboot = $true }
    @{ kind = $kind; last = $last; pendingReboot = $reboot } | ConvertTo-Json -Compress
  `,

  'guest-account': `
    $kind = 'absent';
    $enabled = $null;
    $message = '';
    try {
      $users = Get-CimInstance -ClassName Win32_UserAccount -Filter "LocalAccount=True" -ErrorAction Stop;
      $guest = $users | Where-Object { $_.SID -like '*-501' } | Select-Object -First 1;
      if ($guest -ne $null) { $kind = 'guest'; $enabled = (-not [bool]$guest.Disabled) }
    } catch { $kind = 'error'; $message = [string]$_.Exception.Message }
    @{ kind = $kind; enabled = $enabled; message = $message } | ConvertTo-Json -Compress
  `,

  'remote-desktop': `
    $kind = 'rdp';
    $deny = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name 'fDenyTSConnections' -ErrorAction SilentlyContinue).fDenyTSConnections;
    if ($deny -eq $null) { $kind = 'unreadable' }
    @{ kind = $kind; deny = $deny } | ConvertTo-Json -Compress
  `,

  // ---- v0.8.0 additions (read-only, dynamic; no product-name lists) ----
  'password-policy': `
    $kind = 'policy';
    $p = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Netlogon\\Parameters';
    $read = { param($n) (Get-ItemProperty -Path $p -Name $n -ErrorAction SilentlyContinue).$n };
    $maxAge = & $read 'MaximumPasswordAge';
    $minLen = & $read 'MinimumPasswordLength';
    $complexity = & $read 'PasswordComplexity';
    $lockout = & $read 'LockoutBadCount';
    if ($maxAge -eq $null -and $minLen -eq $null -and $complexity -eq $null -and $lockout -eq $null) { $kind = 'unreadable' }
    @{ kind = $kind; maxAge = $maxAge; minLength = $minLen; complexity = $complexity; lockout = $lockout } | ConvertTo-Json -Compress
  `,

  autoplay: `
    $kind = 'autoplay';
    $noDrive = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer' -Name 'NoDriveTypeAutoRun' -ErrorAction SilentlyContinue).NoDriveTypeAutoRun;
    $cdrom = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Cdrom' -Name 'Autorun' -ErrorAction SilentlyContinue).Autorun;
    if ($noDrive -eq $null -and $cdrom -eq $null) { $kind = 'unreadable' }
    # 0x95 (149) = AutoRun disabled on most drive types (Windows default hardening).
    $disabled = ($noDrive -ne $null -and ([int]$noDrive -band 0x95) -eq 0x95);
    @{ kind = $kind; noDriveTypeAutoRun = $noDrive; cdromAutorun = $cdrom; disabled = $disabled } | ConvertTo-Json -Compress
  `,

  'lm-hash': `
    $kind = 'lmhash';
    $v = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name 'NoLMHash' -ErrorAction SilentlyContinue).NoLMHash;
    if ($v -eq $null) { $kind = 'absent' } else { $kind = 'value' }
    @{ kind = $kind; noLMHash = $v } | ConvertTo-Json -Compress
  `,

  'smb-signing': `
    $kind = 'smb';
    $require = $null; $enable = $null;
    try {
      $c = Get-SmbServerConfiguration -ErrorAction Stop;
      $require = [bool]$c.RequireSecuritySignature;
      $enable = [bool]$c.EnableSecuritySignature;
    } catch {
      $kind = 'registry';
      try {
        $base = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters';
        $r = (Get-ItemProperty -Path $base -Name 'RequireSecuritySignature' -ErrorAction Stop).RequireSecuritySignature;
        $e = (Get-ItemProperty -Path $base -Name 'EnableSecuritySignature' -ErrorAction SilentlyContinue).EnableSecuritySignature;
        $require = ([int]$r -eq 1); if ($e -ne $null) { $enable = ([int]$e -eq 1) }
      } catch { $kind = 'unreadable' }
    }
    @{ kind = $kind; require = $require; enable = $enable } | ConvertTo-Json -Compress
  `,

  'listening-ports': `
    $kind = 'ports';
    $ports = @();
    try {
      $conns = Get-NetTCPConnection -State Listen -ErrorAction Stop | Select-Object -ExpandProperty LocalPort -Unique;
      $ports = @($conns | Sort-Object);
    } catch { $kind = 'unreadable' }
    @{ kind = $kind; count = $ports.Count; ports = $ports } | ConvertTo-Json -Compress -Depth 4
  `,

  'windows-update-service': `
    $kind = 'service';
    $status = ''; $startType = ''; $found = $false;
    try {
      $s = Get-Service -Name 'wuauserv' -ErrorAction Stop;
      $found = $true;
      $status = [string]$s.Status;
      $startType = [string]$s.StartType;
    } catch { $found = $false }
    @{ kind = $kind; found = $found; status = $status; startType = $startType } | ConvertTo-Json -Compress
  `,

  // ---- v0.9.0 additions (admin-gated, read-only; no product-name lists) ----
  'lsass-protection': `
    $kind = 'lsass';
    $path = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa';
    $runAsPpl = (Get-ItemProperty -Path $path -Name 'RunAsPPL' -ErrorAction SilentlyContinue).RunAsPPL;
    $cfg = (Get-ItemProperty -Path $path -Name 'LsaCfgFlags' -ErrorAction SilentlyContinue).LsaCfgFlags;
    @{ kind = $kind; runAsPpl = $runAsPpl; lsaCfgFlags = $cfg } | ConvertTo-Json -Compress
  `,

  'credential-guard': `
    $kind = 'dg';
    $configured = @(); $running = @(); $vbs = $null; $message = '';
    try {
      $dg = Get-CimInstance -Namespace 'root\\Microsoft\\Windows\\DeviceGuard' -ClassName Win32_DeviceGuard -ErrorAction Stop;
      if ($dg -ne $null) {
        $configured = @($dg.SecurityServicesConfigured);
        $running = @($dg.SecurityServicesRunning);
        $vbs = $dg.VirtualizationBasedSecurityStatus
      }
    } catch { $kind = 'unreadable'; $message = [string]$_.Exception.Message }
    @{ kind = $kind; configured = $configured; running = $running; vbs = $vbs; message = $message } | ConvertTo-Json -Compress -Depth 4
  `,

  'bitlocker-protectors': `
    $edition = [string](Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -Name 'EditionID' -ErrorAction SilentlyContinue).EditionID;
    $kind = 'blp'; $count = $null; $types = @(); $message = '';
    try {
      $v = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop;
      $prot = @($v.KeyProtector);
      $count = $prot.Count;
      foreach ($p in $prot) { if ($p -ne $null) { $types += [string]$p.KeyProtectorType } }
    } catch { $kind = 'unreadable'; $message = [string]$_.Exception.Message }
    @{ kind = $kind; count = $count; types = @($types); edition = $edition; message = $message } | ConvertTo-Json -Compress -Depth 4
  `,

  'admin-accounts': `
    $kind = 'admins';
    $total = $null; $neverExpire = $null; $adminCount = $null; $message = '';
    try {
      $users = @(Get-CimInstance -ClassName Win32_UserAccount -Filter "LocalAccount=True" -ErrorAction Stop);
      $total = $users.Count;
      $neverExpire = @($users | Where-Object { $_.PasswordExpires -eq $false }).Count;
    } catch { $kind = 'unreadable'; $message = [string]$_.Exception.Message }
    try {
      $grp = Get-LocalGroup -SID 'S-1-5-32-544' -ErrorAction Stop;
      $adminCount = @(Get-LocalGroupMember -Group $grp -ErrorAction Stop).Count;
    } catch {
      try {
        $g = Get-CimInstance -ClassName Win32_Group -Filter "LocalAccount=True AND SID='S-1-5-32-544'" -ErrorAction Stop | Select-Object -First 1;
        if ($g -ne $null) {
          $adminCount = @(Get-CimInstance -ClassName Win32_GroupUser -ErrorAction Stop | Where-Object { [string]$_.GroupComponent -like ('*Name="' + $g.Name + '"*') }).Count
        }
      } catch {}
    }
    @{ kind = $kind; adminCount = $adminCount; total = $total; neverExpire = $neverExpire; message = $message } | ConvertTo-Json -Compress
  `,

  'firewall-inbound-rules': `
    $kind = 'fwrules'; $count = $null; $sample = @(); $message = '';
    try {
      $rules = @(Get-NetFirewallRule -Enabled True -Direction Inbound -ErrorAction Stop);
      $count = $rules.Count;
      $sample = @($rules | Where-Object { [string]$_.Action -ne 'Block' } | Select-Object -First 10 -ExpandProperty DisplayName);
    } catch { $kind = 'unreadable'; $message = [string]$_.Exception.Message }
    @{ kind = $kind; count = $count; sample = @($sample); message = $message } | ConvertTo-Json -Compress -Depth 4
  `,

  'winrm-exposure': `
    $kind = 'winrm'; $service = ''; $startType = ''; $listeners = $null; $message = '';
    try {
      $s = Get-Service -Name 'WinRM' -ErrorAction Stop;
      $service = [string]$s.Status; $startType = [string]$s.StartType;
    } catch { $service = '' }
    try {
      $listeners = @(Get-ChildItem -Path 'WSMan:\\localhost\\Listener' -ErrorAction Stop).Count;
    } catch { $listeners = $null }
    @{ kind = $kind; service = $service; startType = $startType; listeners = $listeners; message = $message } | ConvertTo-Json -Compress
  `,

  // ---- v0.18.0 additions (Lote 2 / A4: OS hardening toggles, read-only) ----
  'smart-app-control': `
    $kind = 'sac'; $state = $null; $message = '';
    try {
      $v = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy' -Name 'VerifiedAndReputablePolicyState' -ErrorAction Stop).VerifiedAndReputablePolicyState;
      $state = [int]$v;
    } catch { $kind = 'unreadable'; $message = [string]$_.Exception.Message }
    @{ kind = $kind; state = $state; message = $message } | ConvertTo-Json -Compress
  `,

  'powershell-exec-policy': `
    $kind = 'exec'; $policy = ''; $message = '';
    try {
      $v = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell' -Name 'ExecutionPolicy' -ErrorAction SilentlyContinue).ExecutionPolicy;
      if ($v -ne $null) { $policy = [string]$v }
    } catch { $kind = 'unreadable'; $message = [string]$_.Exception.Message }
    @{ kind = $kind; policy = $policy; message = $message } | ConvertTo-Json -Compress
  `,

  'bitlocker-guard': `
    $kind = 'blg'; $protection = ''; $message = '';
    try {
      $v = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop;
      $protection = [string]$v.ProtectionStatus;
    } catch { $kind = 'unreadable'; $message = [string]$_.Exception.Message }
    @{ kind = $kind; protection = $protection; message = $message } | ConvertTo-Json -Compress
  `,
};

/** Build the single batched script (env + every catalog check, in order). */
export function buildSecurityScript(): string {
  const parts: string[] = [];
  parts.push(
    `Write-Output '${ENV_MARKER}'\ntry {\n& {\n${ENV_SCRIPT}\n}\n} catch { Write-Output '{"kind":"exception"}' }`
  );
  SECURITY_CHECK_CATALOG.forEach((definition, index) => {
    const script = SECURITY_SCRIPTS[definition.id] ?? 'Write-Output \'{"kind":"exception"}\'';
    parts.push(
      `Write-Output '${CHECK_MARKER(index)}'\ntry {\n& {\n${script}\n}\n} catch { ${PS_EXCEPTION} }`
    );
  });
  return parts.join('\n');
}

/** Split combined stdout back into the env payload and one payload per check. */
export function splitSecurityStdout(
  stdout: string,
  count: number
): { env: string; payloads: string[] } {
  const payloads: string[] = Array.from({ length: count }, () => '');
  let env = '';
  let current: 'env' | number | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (current === 'env') env = buffer.join('\n').trim();
    else if (typeof current === 'number' && current >= 0 && current < count) {
      payloads[current] = buffer.join('\n').trim();
    }
    buffer = [];
  };

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === ENV_MARKER) {
      flush();
      current = 'env';
      continue;
    }
    const match = /^@@FSEC_(\d+)@@$/.exec(trimmed);
    if (match) {
      flush();
      current = Number(match[1]);
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();
  return { env, payloads };
}

// ---------------------------------------------------------------------------
// Pure parsing helpers (exported for unit tests with fixtures)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function parseObject(text: string): Obj | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Obj)
      : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

function asBool(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 'True') return true;
  if (value === false || value === 'false' || value === 'False') return false;
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function objectsOf(value: unknown): Obj[] {
  return toArray(value).filter(
    (item): item is Obj => item !== null && typeof item === 'object' && !Array.isArray(item)
  );
}

const ACCESS_DENIED =
  /(access|denied|denegad|privileg|permission|permiso|elevat|unauthoriz|no tiene)/i;

/**
 * Map an unreadable datum to an honest status. We only claim `requires-admin`
 * when the observable error says so; otherwise the truth is `unknown`.
 */
function readFailureStatus(message: string): SecurityCheckStatus {
  return ACCESS_DENIED.test(message) ? 'requires-admin' : 'unknown';
}

function readFailureEvidence(message: string): string {
  return message ? `Read failed: ${message}` : 'The live query returned no data.';
}

export function buildMachineInfo(envText: string): SecurityMachineInfo {
  const env = parseObject(envText);
  return {
    osCaption: asString(env?.caption),
    osVersion: asString(env?.version),
    osBuild: asString(env?.build),
    edition: asString(env?.edition),
    displayVersion: asString(env?.displayVersion),
    isAdmin: asBool(env?.isAdmin) ?? false,
    collectedAt: new Date().toISOString(),
  };
}

function joined(names: readonly string[]): string {
  return names.join(', ');
}

function antivirus(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  if (!p || kind === 'unreadable' || kind === 'exception') {
    const message = asString(p?.message);
    return {
      id: 'antivirus',
      status: readFailureStatus(message),
      evidence: readFailureEvidence(message),
      reason: 'Security Center antivirus products could not be read.',
    };
  }
  if (kind === 'empty') {
    return {
      id: 'antivirus',
      status: 'fail',
      evidence: 'SecurityCenter2 returned 0 registered antivirus products.',
      reason: 'No antivirus is registered with Windows Security Center.',
    };
  }

  const decoded = objectsOf(p.items).map((item) => {
    // WMI reports productState as a decimal UInt32; decode it live.
    const state = parseInt(asString(item.state), 10);
    const known = Number.isFinite(state);
    return {
      name: asString(item.name) || 'Unnamed product',
      on: known ? ((state >> 12) & 0xf) !== 0 : null,
      upToDate: known ? ((state >> 4) & 0xf) === 0 : null,
    };
  });

  if (decoded.length === 0) {
    return {
      id: 'antivirus',
      status: 'unknown',
      evidence: 'SecurityCenter2 returned no readable product entries.',
      reason: 'Antivirus products were reported but their state could not be decoded.',
    };
  }

  const evidence = decoded
    .map(
      (d) =>
        `${d.name}: real-time ${d.on === null ? 'unknown' : d.on ? 'on' : 'off'}, ` +
        `signatures ${d.upToDate === null ? 'unknown' : d.upToDate ? 'up to date' : 'out of date'}`
    )
    .join('; ');

  const protectedProducts = decoded.filter((d) => d.on === true);
  if (protectedProducts.length === 0) {
    return {
      id: 'antivirus',
      status: 'fail',
      evidence,
      reason: 'An antivirus is installed but none has real-time protection enabled.',
    };
  }

  const allUpToDate = protectedProducts.every((d) => d.upToDate !== false);
  if (!allUpToDate) {
    return {
      id: 'antivirus',
      status: 'warn',
      evidence,
      reason: 'Real-time protection is on but at least one product is out of date.',
    };
  }

  return {
    id: 'antivirus',
    status: 'pass',
    evidence,
    reason: `Real-time protection is active (${joined(protectedProducts.map((d) => d.name))}).`,
  };
}

function firewall(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const profiles = objectsOf(p?.profiles).map((item) => ({
    name: asString(item.name) || 'Profile',
    enabled: asBool(item.enabled) ?? false,
  }));

  if (!p || profiles.length === 0 || kind === 'unreadable' || kind === 'exception') {
    const message = asString(p?.message);
    return {
      id: 'firewall',
      status: readFailureStatus(message),
      evidence: readFailureEvidence(message),
      reason: 'Firewall profile state could not be read.',
    };
  }

  const on = profiles.filter((profile) => profile.enabled);
  const evidence = profiles
    .map((profile) => `${profile.name}: ${profile.enabled ? 'on' : 'off'}`)
    .join(', ');
  if (on.length === profiles.length) {
    return {
      id: 'firewall',
      status: 'pass',
      evidence,
      reason: 'Firewall is enabled for every profile.',
    };
  }
  if (on.length === 0) {
    return {
      id: 'firewall',
      status: 'fail',
      evidence,
      reason: 'Firewall is disabled for every profile.',
    };
  }
  return {
    id: 'firewall',
    status: 'warn',
    evidence,
    reason: `Firewall is disabled for ${profiles.length - on.length} of ${profiles.length} profiles.`,
  };
}

function uac(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const enableLua = asNumber(p?.enableLua);
  const consent = asNumber(p?.consentPrompt);
  const secure = asNumber(p?.secureDesktop);
  const evidence =
    `EnableLUA=${enableLua ?? 'not set'}, ConsentPromptBehaviorAdmin=${consent ?? 'not set'}, ` +
    `PromptOnSecureDesktop=${secure ?? 'not set'}`;

  if (!p || kind === 'missing' || kind === 'exception' || enableLua === null) {
    return {
      id: 'uac',
      status: 'unknown',
      evidence,
      reason: 'UAC policy values could not be read.',
    };
  }
  if (enableLua === 0) {
    return { id: 'uac', status: 'fail', evidence, reason: 'UAC is disabled (EnableLUA=0).' };
  }
  if (consent !== null && consent < 2) {
    return {
      id: 'uac',
      status: 'warn',
      evidence,
      reason: 'UAC is enabled but the admin prompt is set below the recommended level.',
    };
  }
  return { id: 'uac', status: 'pass', evidence, reason: 'UAC is enabled at a recommended level.' };
}

function smb1(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const enabled = asBool(p?.enabled);
  if (!p || enabled === null || kind === 'unreadable' || kind === 'exception') {
    const message = asString(p?.message);
    return {
      id: 'smb1',
      status: readFailureStatus(message),
      evidence: readFailureEvidence(message),
      reason: 'SMBv1 state could not be read.',
    };
  }
  const evidence = `EnableSMB1Protocol=${enabled ? 'True' : 'False'}`;
  return enabled
    ? { id: 'smb1', status: 'fail', evidence, reason: 'SMBv1 is enabled.' }
    : { id: 'smb1', status: 'pass', evidence, reason: 'SMBv1 is disabled.' };
}

function secureBoot(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const value = asBool(p?.value);
  const message = asString(p?.message);
  const firmware = asString(p?.firmware) || 'unknown';

  if (!p || kind === 'exception') {
    return {
      id: 'secure-boot',
      status: 'unknown',
      evidence: readFailureEvidence(message),
      reason: 'Secure Boot state could not be read.',
    };
  }
  if (kind === 'not-uefi') {
    return {
      id: 'secure-boot',
      status: 'not-applicable',
      evidence: `Firmware: ${firmware} (legacy BIOS/CSM).`,
      reason: 'Secure Boot only applies to UEFI firmware.',
    };
  }
  if (kind === 'error' || value === null) {
    return {
      id: 'secure-boot',
      status: readFailureStatus(message),
      evidence: readFailureEvidence(message),
      reason: 'Secure Boot could not be confirmed.',
    };
  }
  return value
    ? {
        id: 'secure-boot',
        status: 'pass',
        evidence: 'Confirm-SecureBootUEFI = True',
        reason: 'Secure Boot is enabled.',
      }
    : {
        id: 'secure-boot',
        status: 'fail',
        evidence: 'Confirm-SecureBootUEFI = False',
        reason: 'Secure Boot is disabled.',
      };
}

function tpm(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const enabled = asBool(p?.enabled);
  const activated = asBool(p?.activated);
  const spec = asString(p?.spec);

  if (!p || kind === 'exception') {
    return {
      id: 'tpm',
      status: 'unknown',
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'TPM state could not be read.',
    };
  }
  if (kind === 'absent') {
    return {
      id: 'tpm',
      status: 'not-applicable',
      evidence: 'No TPM device was reported by the platform (Win32_Tpm is absent).',
      reason: 'This machine has no TPM (common on VMs and older hardware).',
    };
  }
  if (kind === 'error') {
    const message = asString(p.message);
    return {
      id: 'tpm',
      status: readFailureStatus(message),
      evidence: readFailureEvidence(message),
      reason: 'TPM state could not be read.',
    };
  }
  const evidence = `TPM ${spec || '(version unknown)'}: enabled=${enabled === null ? 'unknown' : enabled}, activated=${activated === null ? 'unknown' : activated}`;
  if (enabled === true && activated === true) {
    return {
      id: 'tpm',
      status: 'pass',
      evidence,
      reason: 'TPM is present, enabled and activated.',
    };
  }
  return {
    id: 'tpm',
    status: 'warn',
    evidence,
    reason: 'TPM is present but not fully enabled/activated.',
  };
}

function bitlocker(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const edition = asString(p?.edition);
  const message = asString(p?.message);

  if (!p || kind === 'exception') {
    return {
      id: 'bitlocker',
      status: 'unknown',
      evidence: readFailureEvidence(message),
      reason: 'BitLocker state could not be read.',
    };
  }
  if (kind === 'error') {
    if (/CommandNotFound|not recognized|no se reconoce/i.test(message)) {
      const homeEdition = /home|core/i.test(edition);
      return {
        id: 'bitlocker',
        status: homeEdition ? 'not-applicable' : 'unknown',
        evidence: `Get-BitLockerVolume unavailable (Edition: ${edition || 'unknown'}).`,
        reason: homeEdition
          ? 'BitLocker is not available on this Windows edition.'
          : 'The BitLocker module is not available on this system.',
      };
    }
    return {
      id: 'bitlocker',
      status: readFailureStatus(message),
      evidence: readFailureEvidence(message),
      reason: 'BitLocker state could not be read.',
    };
  }

  const protection = asString(p.protection).toLowerCase();
  const percent = asNumber(p.percent);
  const evidence = `ProtectionStatus=${asString(p.protection) || 'unknown'}, encryption=${percent ?? 'unknown'}% (Edition: ${edition || 'unknown'})`;
  const on = protection === 'on' || protection === '1' || protection === 'true';
  const off = protection === 'off' || protection === '0' || protection === 'false';
  if (on)
    return {
      id: 'bitlocker',
      status: 'pass',
      evidence,
      reason: 'The system drive is protected by BitLocker.',
    };
  if (off)
    return {
      id: 'bitlocker',
      status: 'fail',
      evidence,
      reason: 'The system drive is not encrypted.',
    };
  return {
    id: 'bitlocker',
    status: 'unknown',
    evidence,
    reason: 'BitLocker protection state is indeterminate.',
  };
}

function windowsUpdate(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const last = asString(p?.last);
  const pendingReboot = asBool(p?.pendingReboot) ?? false;

  if (!p || kind === 'error' || kind === 'exception') {
    return {
      id: 'windows-update',
      status: 'unknown',
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'Windows patch history could not be read.',
    };
  }

  const stamp = /^\d{4}-\d{2}-\d{2}$/.test(last) ? last : '';
  const dateText = stamp ? stamp : 'unavailable';
  const evidence = `Last installed update: ${dateText}; reboot pending: ${pendingReboot ? 'yes' : 'no'}`;

  if (!stamp) {
    return {
      id: 'windows-update',
      status: 'unknown',
      evidence,
      reason: 'The last installed update date is unavailable.',
    };
  }

  const ageDays = Math.floor((Date.now() - new Date(`${stamp}T00:00:00Z`).getTime()) / 86_400_000);
  const baseEvidence = `Last installed update: ${dateText} (${ageDays} days ago); reboot pending: ${pendingReboot ? 'yes' : 'no'}`;

  if (pendingReboot) {
    return {
      id: 'windows-update',
      status: 'warn',
      evidence: baseEvidence,
      reason: 'A reboot is pending to finish installing updates.',
    };
  }
  if (ageDays <= 60) {
    return {
      id: 'windows-update',
      status: 'pass',
      evidence: baseEvidence,
      reason: 'Security updates were installed within the last 60 days.',
    };
  }
  if (ageDays <= 120) {
    return {
      id: 'windows-update',
      status: 'warn',
      evidence: baseEvidence,
      reason: 'The last update is older than 60 days.',
    };
  }
  return {
    id: 'windows-update',
    status: 'fail',
    evidence: baseEvidence,
    reason: 'The last update is older than 120 days.',
  };
}

function guestAccount(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  if (!p || kind === 'exception') {
    return {
      id: 'guest-account',
      status: 'unknown',
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'Local accounts could not be read.',
    };
  }
  if (kind === 'error') {
    const message = asString(p.message);
    return {
      id: 'guest-account',
      status: readFailureStatus(message),
      evidence: readFailureEvidence(message),
      reason: 'Local accounts could not be read.',
    };
  }
  if (kind === 'absent') {
    return {
      id: 'guest-account',
      status: 'pass',
      evidence: 'No local account with RID 501 (built-in Guest) was found.',
      reason: 'The built-in Guest account is absent.',
    };
  }
  const enabled = asBool(p.enabled);
  if (enabled === null) {
    return {
      id: 'guest-account',
      status: 'unknown',
      evidence: 'Built-in Guest account state was not readable.',
      reason: 'Guest account state is indeterminate.',
    };
  }
  const evidence = `Built-in Guest (RID 501): ${enabled ? 'enabled' : 'disabled'}`;
  return enabled
    ? {
        id: 'guest-account',
        status: 'fail',
        evidence,
        reason: 'The built-in Guest account is enabled.',
      }
    : {
        id: 'guest-account',
        status: 'pass',
        evidence,
        reason: 'The built-in Guest account is disabled.',
      };
}

function remoteDesktop(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const deny = asNumber(p?.deny);
  if (!p || kind === 'unreadable' || kind === 'exception' || deny === null) {
    return {
      id: 'remote-desktop',
      status: 'unknown',
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'Remote Desktop configuration could not be read.',
    };
  }
  const evidence = `fDenyTSConnections=${deny}`;
  return deny === 1
    ? { id: 'remote-desktop', status: 'pass', evidence, reason: 'Remote Desktop is disabled.' }
    : { id: 'remote-desktop', status: 'warn', evidence, reason: 'Remote Desktop is enabled.' };
}

// ---- v0.8.0 builders ----

function passwordPolicy(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  if (!p || kind === 'unreadable' || kind === 'exception') {
    return {
      id: 'password-policy',
      status: 'unknown',
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'Account password policy could not be read.',
    };
  }

  // Windows defaults when the key is absent: 42-day expiry, no minimum length,
  // complexity off. 0 or 0xFFFFFFFF for MaximumPasswordAge means "never expires".
  const maxAge = asNumber(p.maxAge);
  const minLength = asNumber(p.minLength);
  const complexity = asNumber(p.complexity);
  const lockout = asNumber(p.lockout);

  const neverExpires = maxAge === null || maxAge === 0 || maxAge === -1 || maxAge === 4294967295;
  const evidence =
    `MaximumPasswordAge=${maxAge === null ? 'default (42)' : maxAge}, ` +
    `MinimumPasswordLength=${minLength === null ? 'default (0)' : minLength}, ` +
    `PasswordComplexity=${complexity === null ? 'default (off)' : complexity}, ` +
    `LockoutBadCount=${lockout === null ? 'default (0 = no lockout)' : lockout}`;

  const weakLength = minLength !== null && minLength < 8;
  const noComplexity = complexity === null || complexity === 0;
  const noLockout = lockout === null || lockout === 0;

  if (neverExpires && weakLength) {
    return {
      id: 'password-policy',
      status: 'fail',
      evidence,
      reason: 'Passwords never expire and there is no minimum length.',
    };
  }
  if (neverExpires || weakLength || (noComplexity && noLockout)) {
    return {
      id: 'password-policy',
      status: 'warn',
      evidence,
      reason: 'The password policy is weaker than the recommended baseline.',
    };
  }
  return {
    id: 'password-policy',
    status: 'pass',
    evidence,
    reason: 'The password policy meets the recommended baseline.',
  };
}

function autoplay(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  if (!p || kind === 'unreadable' || kind === 'exception') {
    return {
      id: 'autoplay',
      status: 'unknown',
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'Autorun/Autoplay policy could not be read.',
    };
  }
  const noDrive = asNumber(p.noDriveTypeAutoRun);
  const cdrom = asNumber(p.cdromAutorun);
  const disabled = asBool(p.disabled) ?? false;
  const evidence =
    `NoDriveTypeAutoRun=${noDrive === null ? 'not set' : `0x${(noDrive >>> 0).toString(16)}`}, ` +
    `Cdrom.Autorun=${cdrom === null ? 'not set' : cdrom}`;

  if (disabled) {
    return {
      id: 'autoplay',
      status: 'pass',
      evidence,
      reason: 'AutoRun is disabled for the common drive types.',
    };
  }
  if (cdrom !== null && cdrom !== 0) {
    return {
      id: 'autoplay',
      status: 'warn',
      evidence,
      reason: 'AutoRun is still enabled for the CD/DVD drive.',
    };
  }
  return {
    id: 'autoplay',
    status: 'warn',
    evidence,
    reason: 'AutoRun/AutoPlay is not fully disabled for removable media.',
  };
}

function lmHash(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  if (!p || kind === 'exception') {
    return {
      id: 'lm-hash',
      status: 'unknown',
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'The NoLMHash policy could not be read.',
    };
  }
  if (kind === 'absent') {
    return {
      id: 'lm-hash',
      status: 'warn',
      evidence: 'NoLMHash is not set (LM hash may still be stored).',
      reason: 'LAN Manager hashes are still stored on password change.',
    };
  }
  const value = asNumber(p.noLMHash);
  const evidence = `NoLMHash=${value ?? 'unknown'}`;
  if (value === 1) {
    return { id: 'lm-hash', status: 'pass', evidence, reason: 'LM hash storage is disabled.' };
  }
  if (value === 0) {
    return {
      id: 'lm-hash',
      status: 'fail',
      evidence,
      reason: 'LM hash storage is explicitly enabled.',
    };
  }
  return {
    id: 'lm-hash',
    status: 'warn',
    evidence,
    reason: 'LM hash storage could not be confirmed as disabled.',
  };
}

function smbSigning(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const require = asBool(p?.require);
  const enable = asBool(p?.enable);
  if (!p || kind === 'unreadable' || kind === 'exception' || require === null) {
    return {
      id: 'smb-signing',
      status: readFailureStatus(asString(p?.message)),
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'SMB signing state could not be read.',
    };
  }
  const evidence = `RequireSecuritySignature=${require ? 'True' : 'False'}, EnableSecuritySignature=${enable === null ? 'unknown' : enable ? 'True' : 'False'}`;
  if (require) {
    return { id: 'smb-signing', status: 'pass', evidence, reason: 'SMB signing is required.' };
  }
  if (enable === true) {
    return {
      id: 'smb-signing',
      status: 'warn',
      evidence,
      reason: 'SMB signing is enabled but not required.',
    };
  }
  return { id: 'smb-signing', status: 'fail', evidence, reason: 'SMB signing is not required.' };
}

function listeningPorts(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  if (!p || kind === 'unreadable' || kind === 'exception') {
    return {
      id: 'listening-ports',
      status: readFailureStatus(asString(p?.message)),
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'Listening TCP ports could not be read.',
    };
  }
  const ports = toArray(p.ports)
    .map((v) => asNumber(v))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const count = ports.length;
  const preview = ports.slice(0, 40).join(', ');
  const evidence = `${count} listening TCP port(s)${count ? `: ${preview}${count > 40 ? ', ...' : ''}` : ''}`;
  // Expose everything but flag when a notably large surface is listening.
  return count > 40
    ? {
        id: 'listening-ports',
        status: 'warn',
        evidence,
        reason: 'A large number of TCP ports are listening; review them.',
      }
    : {
        id: 'listening-ports',
        status: 'pass',
        evidence,
        reason: 'Listening TCP ports were enumerated for review.',
      };
}

function windowsUpdateService(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  if (!p || kind === 'exception') {
    return {
      id: 'windows-update-service',
      status: 'unknown',
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'The Windows Update service could not be read.',
    };
  }
  const found = asBool(p?.found) ?? false;
  if (!found) {
    return {
      id: 'windows-update-service',
      status: 'fail',
      evidence: 'wuauserv was not found.',
      reason: 'The Windows Update service is missing.',
    };
  }
  const status = asString(p?.status);
  const startType = asString(p?.startType);
  const evidence = `wuauserv: status=${status || 'unknown'}, startType=${startType || 'unknown'}`;
  const disabled = /disabled/i.test(startType);
  const stopped = /stopped/i.test(status);
  if (disabled) {
    return {
      id: 'windows-update-service',
      status: 'fail',
      evidence,
      reason: 'The Windows Update service is disabled.',
    };
  }
  if (stopped) {
    return {
      id: 'windows-update-service',
      status: 'warn',
      evidence,
      reason: 'The Windows Update service is not running.',
    };
  }
  return {
    id: 'windows-update-service',
    status: 'pass',
    evidence,
    reason: 'The Windows Update service is available.',
  };
}

// ---- v0.9.0 builders (admin-gated controls) ----

function lsassProtection(p: Obj | null): SecurityCheckResult {
  if (!p || asString(p.kind) === 'exception') {
    return {
      id: 'lsass-protection',
      status: 'unknown',
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'LSASS protection state could not be read.',
    };
  }
  const runAsPpl = asNumber(p.runAsPpl);
  const cfg = asNumber(p.lsaCfgFlags);
  const evidence = `RunAsPPL=${runAsPpl === null ? 'not set' : runAsPpl}, LsaCfgFlags=${cfg === null ? 'not set' : cfg}`;
  // RunAsPPL: 0 = disabled, 1 = enabled with UEFI lock, 2 = enabled without lock.
  if (runAsPpl !== null && runAsPpl >= 1) {
    return {
      id: 'lsass-protection',
      status: 'pass',
      evidence,
      reason: 'LSASS runs as a protected process (RunAsPPL enabled).',
    };
  }
  return {
    id: 'lsass-protection',
    status: 'fail',
    evidence,
    reason: 'LSASS protection (RunAsPPL) is not enabled.',
  };
}

function credentialGuard(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  if (!p || kind === 'unreadable' || kind === 'exception') {
    return {
      id: 'credential-guard',
      status: readFailureStatus(asString(p?.message)),
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'Credential Guard state could not be read.',
    };
  }
  const configured = toArray(p.configured)
    .map((v) => asNumber(v))
    .filter((v): v is number => v !== null);
  const running = toArray(p.running)
    .map((v) => asNumber(v))
    .filter((v): v is number => v !== null);
  const vbs = asNumber(p.vbs);
  const evidence =
    `SecurityServicesConfigured=[${configured.join(', ')}], ` +
    `SecurityServicesRunning=[${running.join(', ')}], VBS=${vbs === null ? 'unknown' : vbs}`;
  // Security service id 1 = Credential Guard.
  const CREDENTIAL_GUARD = 1;
  if (running.includes(CREDENTIAL_GUARD)) {
    return {
      id: 'credential-guard',
      status: 'pass',
      evidence,
      reason: 'Credential Guard is running.',
    };
  }
  if (configured.includes(CREDENTIAL_GUARD) || vbs === 2) {
    return {
      id: 'credential-guard',
      status: 'warn',
      evidence,
      reason:
        'Credential Guard is configured or VBS is enabled, but Credential Guard is not running.',
    };
  }
  return {
    id: 'credential-guard',
    status: 'fail',
    evidence,
    reason: 'Credential Guard is not enabled.',
  };
}

function bitlockerProtectors(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const edition = asString(p?.edition);
  const message = asString(p?.message);
  if (!p || kind === 'exception') {
    return {
      id: 'bitlocker-protectors',
      status: 'unknown',
      evidence: readFailureEvidence(message),
      reason: 'BitLocker key protectors could not be read.',
    };
  }
  if (kind === 'unreadable') {
    if (/CommandNotFound|not recognized|no se reconoce/i.test(message)) {
      const homeEdition = /home|core/i.test(edition);
      return {
        id: 'bitlocker-protectors',
        status: homeEdition ? 'not-applicable' : 'unknown',
        evidence: `Get-BitLockerVolume unavailable (Edition: ${edition || 'unknown'}).`,
        reason: homeEdition
          ? 'BitLocker is not available on this Windows edition.'
          : 'The BitLocker module is not available on this system.',
      };
    }
    return {
      id: 'bitlocker-protectors',
      status: readFailureStatus(message),
      evidence: readFailureEvidence(message),
      reason: 'BitLocker key protectors could not be read.',
    };
  }
  const count = asNumber(p.count);
  const types = toArray(p.types)
    .map((v) => asString(v))
    .filter((v) => v.length > 0);
  const evidence = `KeyProtector count=${count === null ? 'unknown' : count}${
    types.length ? ` [${types.join(', ')}]` : ''
  } (Edition: ${edition || 'unknown'})`;
  if (count === null) {
    return {
      id: 'bitlocker-protectors',
      status: 'unknown',
      evidence,
      reason: 'The key protector count could not be determined.',
    };
  }
  if (count >= 1) {
    return {
      id: 'bitlocker-protectors',
      status: 'pass',
      evidence,
      reason: `The system drive has ${count} key protector(s).`,
    };
  }
  return {
    id: 'bitlocker-protectors',
    status: 'fail',
    evidence,
    reason: 'The system drive has no BitLocker key protectors, so it is not truly protected.',
  };
}

function adminAccounts(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  if (!p || kind === 'unreadable' || kind === 'exception') {
    return {
      id: 'admin-accounts',
      status: readFailureStatus(asString(p?.message)),
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'Local administrator accounts could not be read.',
    };
  }
  const adminCount = asNumber(p.adminCount);
  const total = asNumber(p.total);
  const neverExpire = asNumber(p.neverExpire);
  const evidence =
    `Local administrators=${adminCount === null ? 'unknown' : adminCount} of ` +
    `${total === null ? 'unknown' : total} local accounts; ` +
    `passwords never expire=${neverExpire === null ? 'unknown' : neverExpire}`;
  if (adminCount === null) {
    return {
      id: 'admin-accounts',
      status: 'unknown',
      evidence,
      reason: 'Administrator group membership could not be determined.',
    };
  }
  if (adminCount > 3) {
    return {
      id: 'admin-accounts',
      status: 'fail',
      evidence,
      reason: 'There are too many local administrator accounts.',
    };
  }
  if (adminCount > 2 || (neverExpire !== null && neverExpire > 0)) {
    return {
      id: 'admin-accounts',
      status: 'warn',
      evidence,
      reason: 'The local administrator setup is broader than the recommended baseline.',
    };
  }
  return {
    id: 'admin-accounts',
    status: 'pass',
    evidence,
    reason: 'The number of local administrators is within the recommended baseline.',
  };
}

function firewallInboundRules(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  if (!p || kind === 'unreadable' || kind === 'exception') {
    return {
      id: 'firewall-inbound-rules',
      status: readFailureStatus(asString(p?.message)),
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'Inbound firewall rules could not be read.',
    };
  }
  const count = asNumber(p.count);
  const sample = toArray(p.sample)
    .map((v) => asString(v))
    .filter((v) => v.length > 0);
  const evidence = `${count === null ? 'unknown' : count} enabled inbound rule(s)${
    sample.length ? `; e.g. ${sample.slice(0, 5).join(', ')}` : ''
  }`;
  if (count === null) {
    return {
      id: 'firewall-inbound-rules',
      status: 'unknown',
      evidence,
      reason: 'The enabled inbound rule count could not be determined.',
    };
  }
  if (count > 250) {
    return {
      id: 'firewall-inbound-rules',
      status: 'warn',
      evidence,
      reason: 'A very large number of inbound rules are enabled; review the attack surface.',
    };
  }
  return {
    id: 'firewall-inbound-rules',
    status: 'pass',
    evidence,
    reason: 'The enabled inbound rule surface is within a normal range.',
  };
}

function winrmExposure(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  if (!p || kind === 'exception') {
    return {
      id: 'winrm-exposure',
      status: 'unknown',
      evidence: readFailureEvidence(asString(p?.message)),
      reason: 'WinRM state could not be read.',
    };
  }
  const service = asString(p.service);
  const startType = asString(p.startType);
  const listeners = asNumber(p.listeners);
  const running = /running/i.test(service);
  const evidence = `WinRM service=${service || 'not found'} (${
    startType || 'unknown'
  }), listeners=${listeners === null ? 'unknown' : listeners}`;
  if (running && (listeners === null || listeners > 0)) {
    return {
      id: 'winrm-exposure',
      status: 'fail',
      evidence,
      reason: 'WinRM is running with active listeners, exposing remote management.',
    };
  }
  if (running || (listeners !== null && listeners > 0)) {
    return {
      id: 'winrm-exposure',
      status: 'warn',
      evidence,
      reason: 'WinRM is partially exposed; review whether remote management is needed.',
    };
  }
  return {
    id: 'winrm-exposure',
    status: 'pass',
    evidence,
    reason: 'WinRM is not exposing remote management.',
  };
}

// ---- v0.18.0 builders (Lote 2 / A4: OS hardening toggles, read-only) ----

function smartAppControl(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const state = asNumber(p?.state);
  if (!p || kind === 'exception' || kind === 'unreadable' || state === null) {
    return {
      id: 'smart-app-control',
      status: 'unknown',
      evidence: 'VerifiedAndReputablePolicyState=unreadable',
      reason: 'Smart App Control state could not be read.',
    };
  }
  const evidence = `VerifiedAndReputablePolicyState=${state}`;
  if (state === 1) {
    return {
      id: 'smart-app-control',
      status: 'pass',
      evidence,
      reason: 'Smart App Control is enforced: only signed or reputable apps run.',
    };
  }
  if (state === 2) {
    return {
      id: 'smart-app-control',
      status: 'warn',
      evidence,
      reason: 'Smart App Control is in evaluation mode; enforce it for full protection.',
    };
  }
  return {
    id: 'smart-app-control',
    status: 'fail',
    evidence,
    reason: 'Smart App Control is off: unsigned apps run without reputation checks.',
  };
}

function powershellExecPolicy(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const policy = asString(p?.policy);
  if (!p || kind === 'exception' || kind === 'unreadable') {
    return {
      id: 'powershell-exec-policy',
      status: 'unknown',
      evidence: 'ExecutionPolicy=unreadable',
      reason: 'The machine execution policy could not be read.',
    };
  }
  const evidence = `ExecutionPolicy=${policy || 'not configured (defaults to Restricted)'}`;
  if (policy === 'RemoteSigned' || policy === 'AllSigned') {
    return {
      id: 'powershell-exec-policy',
      status: 'pass',
      evidence,
      reason: `The machine execution policy is ${policy}.`,
    };
  }
  if (policy === 'Unrestricted' || policy === 'Bypass' || policy === 'Undefined') {
    return {
      id: 'powershell-exec-policy',
      status: 'fail',
      evidence,
      reason: `The machine execution policy is ${policy || 'not configured'}: scripts run without the recommended signature check.`,
    };
  }
  return {
    id: 'powershell-exec-policy',
    status: 'warn',
    evidence,
    reason: `The machine execution policy is ${policy || 'not configured'}; RemoteSigned is recommended.`,
  };
}

function bitlockerGuard(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const protection = asString(p?.protection);
  if (!p || kind === 'exception' || kind === 'unreadable') {
    return {
      id: 'bitlocker-guard',
      status: 'unknown',
      evidence: 'ProtectionStatus=unreadable',
      reason: 'BitLocker protection state could not be read.',
    };
  }
  const evidence = `ProtectionStatus=${protection || 'unknown'}`;
  if (/on/i.test(protection)) {
    return {
      id: 'bitlocker-guard',
      status: 'pass',
      evidence,
      reason: 'The system drive reports BitLocker protection on.',
    };
  }
  // Advisory only: warn at worst, never fail, and never offer to encrypt.
  return {
    id: 'bitlocker-guard',
    status: 'warn',
    evidence,
    reason:
      'The system drive is not reporting BitLocker protection. This app will never encrypt it automatically: turn BitLocker on yourself in Settings if you want it.',
  };
}

const BUILDERS: Readonly<Record<string, (payload: Obj | null) => SecurityCheckResult>> = {
  antivirus,
  firewall,
  uac,
  smb1,
  'secure-boot': secureBoot,
  tpm,
  bitlocker,
  'windows-update': windowsUpdate,
  'guest-account': guestAccount,
  'remote-desktop': remoteDesktop,
  'password-policy': passwordPolicy,
  autoplay,
  'lm-hash': lmHash,
  'smb-signing': smbSigning,
  'listening-ports': listeningPorts,
  'windows-update-service': windowsUpdateService,
  'lsass-protection': lsassProtection,
  'credential-guard': credentialGuard,
  'bitlocker-protectors': bitlockerProtectors,
  'admin-accounts': adminAccounts,
  'firewall-inbound-rules': firewallInboundRules,
  'winrm-exposure': winrmExposure,
  'smart-app-control': smartAppControl,
  'powershell-exec-policy': powershellExecPolicy,
  'bitlocker-guard': bitlockerGuard,
};

/**
 * Turn one payload per catalog check into results, in catalog order. Missing
 * builders or payloads degrade to `unknown` rather than dropping the check.
 */
export function buildSecurityCheckResults(
  payloads: readonly string[],
  machine: SecurityMachineInfo
): SecurityCheckResult[] {
  return SECURITY_CHECK_CATALOG.map((definition, index) => {
    const payload = parseObject(payloads[index] ?? '');
    const builder = BUILDERS[definition.id];
    if (!builder) {
      return {
        id: definition.id,
        status: 'unknown' as const,
        evidence: 'No live query is wired for this check.',
        reason: 'Scanner misconfiguration.',
      };
    }
    const observed = builder(payload);
    // Admin-gated controls: without elevation we report `requires-admin` (with
    // the value observed so far) — never `fail` or `unknown`. Scoring excludes
    // this status from the denominator, so it never penalises the user.
    if (definition.requiresAdmin && !machine.isAdmin) {
      return {
        id: definition.id,
        status: 'requires-admin' as const,
        evidence: observed.evidence,
        reason:
          'Administrator rights are required to assess this control. ' +
          'Restart the app as administrator to measure it.',
      };
    }
    return observed;
  });
}

export async function runSecurityScan(): Promise<SecurityScanReport> {
  const reporter = createProgressReporter('security');
  reporter.report('query', 10, 'Reading live security state...');
  const result = await runPowerShell(buildSecurityScript());
  reporter.report('parse', 80, 'Interpreting security checks...');
  const { env, payloads } = splitSecurityStdout(result.stdout, SECURITY_CHECK_CATALOG.length);
  const machine = buildMachineInfo(env);
  const checks = buildSecurityCheckResults(payloads, machine);
  const summary = summarizeSecurityChecks(checks);
  const { score, scoredChecks, excludedChecks } = computeSecurityScore(checks);
  reporter.done('Security scan complete');

  return {
    checks,
    summary,
    score,
    scoredChecks,
    excludedChecks,
    totalChecks: checks.length,
    machine,
    timestamp: new Date().toISOString(),
  };
}
