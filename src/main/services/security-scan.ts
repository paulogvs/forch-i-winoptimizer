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
  "Write-Output ('{\"kind\":\"exception\",\"message\":\"' + $m + '\"}')";

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
};

/** Build the single batched script (env + every catalog check, in order). */
export function buildSecurityScript(): string {
  const parts: string[] = [];
  parts.push(`Write-Output '${ENV_MARKER}'\ntry {\n& {\n${ENV_SCRIPT}\n}\n} catch { Write-Output '{"kind":"exception"}' }`);
  SECURITY_CHECK_CATALOG.forEach((definition, index) => {
    const script = SECURITY_SCRIPTS[definition.id] ?? "Write-Output '{\"kind\":\"exception\"}'";
    parts.push(`Write-Output '${CHECK_MARKER(index)}'\ntry {\n& {\n${script}\n}\n} catch { ${PS_EXCEPTION} }`);
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

const ACCESS_DENIED = /(access|denied|denegad|privileg|permission|permiso|elevat|unauthoriz|no tiene)/i;

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
  const evidence = profiles.map((profile) => `${profile.name}: ${profile.enabled ? 'on' : 'off'}`).join(', ');
  if (on.length === profiles.length) {
    return { id: 'firewall', status: 'pass', evidence, reason: 'Firewall is enabled for every profile.' };
  }
  if (on.length === 0) {
    return { id: 'firewall', status: 'fail', evidence, reason: 'Firewall is disabled for every profile.' };
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
    ? { id: 'secure-boot', status: 'pass', evidence: 'Confirm-SecureBootUEFI = True', reason: 'Secure Boot is enabled.' }
    : { id: 'secure-boot', status: 'fail', evidence: 'Confirm-SecureBootUEFI = False', reason: 'Secure Boot is disabled.' };
}

function tpm(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const enabled = asBool(p?.enabled);
  const activated = asBool(p?.activated);
  const spec = asString(p?.spec);

  if (!p || kind === 'exception') {
    return { id: 'tpm', status: 'unknown', evidence: readFailureEvidence(asString(p?.message)), reason: 'TPM state could not be read.' };
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
    return { id: 'tpm', status: readFailureStatus(message), evidence: readFailureEvidence(message), reason: 'TPM state could not be read.' };
  }
  const evidence = `TPM ${spec || '(version unknown)'}: enabled=${enabled === null ? 'unknown' : enabled}, activated=${activated === null ? 'unknown' : activated}`;
  if (enabled === true && activated === true) {
    return { id: 'tpm', status: 'pass', evidence, reason: 'TPM is present, enabled and activated.' };
  }
  return { id: 'tpm', status: 'warn', evidence, reason: 'TPM is present but not fully enabled/activated.' };
}

function bitlocker(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const edition = asString(p?.edition);
  const message = asString(p?.message);

  if (!p || kind === 'exception') {
    return { id: 'bitlocker', status: 'unknown', evidence: readFailureEvidence(message), reason: 'BitLocker state could not be read.' };
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
    return { id: 'bitlocker', status: readFailureStatus(message), evidence: readFailureEvidence(message), reason: 'BitLocker state could not be read.' };
  }

  const protection = asString(p.protection).toLowerCase();
  const percent = asNumber(p.percent);
  const evidence = `ProtectionStatus=${asString(p.protection) || 'unknown'}, encryption=${percent ?? 'unknown'}% (Edition: ${edition || 'unknown'})`;
  const on = protection === 'on' || protection === '1' || protection === 'true';
  const off = protection === 'off' || protection === '0' || protection === 'false';
  if (on) return { id: 'bitlocker', status: 'pass', evidence, reason: 'The system drive is protected by BitLocker.' };
  if (off) return { id: 'bitlocker', status: 'fail', evidence, reason: 'The system drive is not encrypted.' };
  return { id: 'bitlocker', status: 'unknown', evidence, reason: 'BitLocker protection state is indeterminate.' };
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
    return { id: 'windows-update', status: 'unknown', evidence, reason: 'The last installed update date is unavailable.' };
  }

  const ageDays = Math.floor((Date.now() - new Date(`${stamp}T00:00:00Z`).getTime()) / 86_400_000);
  const baseEvidence = `Last installed update: ${dateText} (${ageDays} days ago); reboot pending: ${pendingReboot ? 'yes' : 'no'}`;

  if (pendingReboot) {
    return { id: 'windows-update', status: 'warn', evidence: baseEvidence, reason: 'A reboot is pending to finish installing updates.' };
  }
  if (ageDays <= 60) {
    return { id: 'windows-update', status: 'pass', evidence: baseEvidence, reason: 'Security updates were installed within the last 60 days.' };
  }
  if (ageDays <= 120) {
    return { id: 'windows-update', status: 'warn', evidence: baseEvidence, reason: 'The last update is older than 60 days.' };
  }
  return { id: 'windows-update', status: 'fail', evidence: baseEvidence, reason: 'The last update is older than 120 days.' };
}

function guestAccount(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  if (!p || kind === 'exception') {
    return { id: 'guest-account', status: 'unknown', evidence: readFailureEvidence(asString(p?.message)), reason: 'Local accounts could not be read.' };
  }
  if (kind === 'error') {
    const message = asString(p.message);
    return { id: 'guest-account', status: readFailureStatus(message), evidence: readFailureEvidence(message), reason: 'Local accounts could not be read.' };
  }
  if (kind === 'absent') {
    return { id: 'guest-account', status: 'pass', evidence: 'No local account with RID 501 (built-in Guest) was found.', reason: 'The built-in Guest account is absent.' };
  }
  const enabled = asBool(p.enabled);
  if (enabled === null) {
    return { id: 'guest-account', status: 'unknown', evidence: 'Built-in Guest account state was not readable.', reason: 'Guest account state is indeterminate.' };
  }
  const evidence = `Built-in Guest (RID 501): ${enabled ? 'enabled' : 'disabled'}`;
  return enabled
    ? { id: 'guest-account', status: 'fail', evidence, reason: 'The built-in Guest account is enabled.' }
    : { id: 'guest-account', status: 'pass', evidence, reason: 'The built-in Guest account is disabled.' };
}

function remoteDesktop(p: Obj | null): SecurityCheckResult {
  const kind = asString(p?.kind);
  const deny = asNumber(p?.deny);
  if (!p || kind === 'unreadable' || kind === 'exception' || deny === null) {
    return { id: 'remote-desktop', status: 'unknown', evidence: readFailureEvidence(asString(p?.message)), reason: 'Remote Desktop configuration could not be read.' };
  }
  const evidence = `fDenyTSConnections=${deny}`;
  return deny === 1
    ? { id: 'remote-desktop', status: 'pass', evidence, reason: 'Remote Desktop is disabled.' }
    : { id: 'remote-desktop', status: 'warn', evidence, reason: 'Remote Desktop is enabled.' };
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
};

/**
 * Turn one payload per catalog check into results, in catalog order. Missing
 * builders or payloads degrade to `unknown` rather than dropping the check.
 */
export function buildSecurityCheckResults(
  payloads: readonly string[],
  machine: SecurityMachineInfo
): SecurityCheckResult[] {
  void machine;
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
    return builder(payload);
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
