/**
 * Security scanner contract (v0.6.0).
 *
 * This module is the SINGLE SOURCE OF TRUTH for the security check catalog.
 * Both the main-process engine (which runs the live queries) and the renderer
 * (which renders them) import from here, so there is no second parallel list.
 *
 * Design rules (v0.6.0):
 *  - Every check is a READ-ONLY query against the real machine. Nothing here
 *    mutates the system.
 *  - No hardcoded software lists: e.g. "is there an antivirus?" is answered by
 *    reading `SecurityCenter2 => AntiVirusProduct`, never by matching a list of
 *    product names.
 *  - Honest states: when a datum cannot be read we return `unknown` or
 *    `requires-admin` (with the real reason), never `fail`.
 *  - Each result carries `evidence` (the value actually observed).
 */

export type SecurityCheckStatus =
  | 'pass'
  | 'warn'
  | 'fail'
  | 'unknown'
  | 'not-applicable'
  | 'requires-admin';

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low';

export type SecurityCategory =
  | 'antivirus'
  | 'firewall'
  | 'access'
  | 'network'
  | 'encryption'
  | 'platform'
  | 'updates';

export interface SecurityCheckDefinition {
  id: string;
  title: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  /** The live query this check performs (auditable description). */
  reads: string;
  /** Every status this check can legitimately return. */
  possibleStatuses: readonly SecurityCheckStatus[];
  /**
   * Whether the app can repair this check itself with a mandatory preview,
   * explicit confirmation and a revert that restores the exact previous value.
   *
   * v0.7.0 ships auto-fix for exactly three checks — `smb1`, `guest-account`
   * and `remote-desktop` — because each has a standard, admin-only, reversible
   * remediation. Every other check remains read-only and offers guidance, since
   * its candidate repair (BitLocker, Secure Boot, ...) can lock a user out or
   * is not reversible through a single value.
   */
  autoFixable: boolean;
  /** Concrete guidance shown when the check is not passing. */
  guidance: string;
}

export const SECURITY_CHECK_CATALOG: readonly SecurityCheckDefinition[] = [
  {
    id: 'antivirus',
    title: 'Antivirus protection',
    category: 'antivirus',
    severity: 'critical',
    reads:
      'SecurityCenter2 => AntiVirusProduct (displayName + productState decoded live; no product-name list)',
    possibleStatuses: ['pass', 'warn', 'fail', 'unknown', 'requires-admin'],
    autoFixable: false,
    guidance:
      'Install or enable an antivirus with real-time protection and let its signatures update. Windows Security is enough on Home/Pro.',
  },
  {
    id: 'firewall',
    title: 'Windows Firewall',
    category: 'firewall',
    severity: 'critical',
    reads:
      'Get-NetFirewallProfile => Enabled (Domain/Private/Public), with a registry fallback when the cmdlet is unavailable',
    possibleStatuses: ['pass', 'warn', 'fail', 'requires-admin', 'unknown'],
    autoFixable: false,
    guidance:
      'Open Windows Security => Firewall & network protection and turn the firewall on for every profile.',
  },
  {
    id: 'uac',
    title: 'User Account Control (UAC)',
    category: 'platform',
    severity: 'high',
    reads:
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System => EnableLUA, ConsentPromptBehaviorAdmin, PromptOnSecureDesktop',
    possibleStatuses: ['pass', 'warn', 'fail', 'unknown'],
    autoFixable: false,
    guidance:
      'Set UAC to at least the default level (Control Panel => User Accounts => Change UAC settings).',
  },
  {
    id: 'smb1',
    title: 'SMBv1 protocol',
    category: 'network',
    severity: 'high',
    reads:
      'Get-SmbServerConfiguration => EnableSMB1Protocol, with registry fallback (LanmanServer\\Parameters\\SMB1)',
    possibleStatuses: ['pass', 'fail', 'requires-admin', 'unknown'],
    autoFixable: true,
    guidance:
      'Disable SMBv1 (Windows Features => SMB 1.0/CIFS File Sharing Support => uncheck) and reboot.',
  },
  {
    id: 'secure-boot',
    title: 'Secure Boot',
    category: 'platform',
    severity: 'medium',
    reads:
      'Confirm-SecureBootUEFI + firmware type ($env:firmware_type). Legacy/BIOS is reported as not-applicable',
    possibleStatuses: ['pass', 'fail', 'not-applicable', 'requires-admin', 'unknown'],
    autoFixable: false,
    guidance:
      'Enable Secure Boot in the firmware (UEFI) settings. Not available on legacy BIOS or VMs without UEFI.',
  },
  {
    id: 'tpm',
    title: 'TPM (Trusted Platform Module)',
    category: 'platform',
    severity: 'medium',
    reads:
      'root\\cimv2\\security\\microsofttpm => Win32_Tpm (IsEnabled_InitialValue, IsActivated_InitialValue, SpecVersion)',
    possibleStatuses: ['pass', 'warn', 'not-applicable', 'requires-admin', 'unknown'],
    autoFixable: false,
    guidance:
      'Enable the TPM (fTPM / PTT) in the firmware settings. VMs need a virtual TPM.',
  },
  {
    id: 'bitlocker',
    title: 'System drive encryption (BitLocker)',
    category: 'encryption',
    severity: 'high',
    reads:
      'Get-BitLockerVolume -MountPoint %SystemDrive% => ProtectionStatus + EncryptionPercentage, with edition detection',
    possibleStatuses: ['pass', 'fail', 'not-applicable', 'requires-admin', 'unknown'],
    autoFixable: false,
    guidance:
      'Turn on BitLocker / Device encryption for the system drive (Settings => Privacy & security => Device encryption).',
  },
  {
    id: 'windows-update',
    title: 'Windows updates',
    category: 'updates',
    severity: 'high',
    reads:
      'Win32_QuickFixEngineering (latest InstalledOn) + pending-reboot registry flags',
    possibleStatuses: ['pass', 'warn', 'fail', 'unknown'],
    autoFixable: false,
    guidance:
      'Install pending updates and reboot (Settings => Windows Update).',
  },
  {
    id: 'guest-account',
    title: 'Built-in Guest account',
    category: 'access',
    severity: 'medium',
    reads:
      'Win32_UserAccount where LocalAccount=True and SID ends in -501 (matched by RID, not by name)',
    possibleStatuses: ['pass', 'fail', 'requires-admin', 'unknown'],
    autoFixable: true,
    guidance:
      'Disable the built-in Guest account (Local Users and Groups => Users => Guest => Disable).',
  },
  {
    id: 'remote-desktop',
    title: 'Remote Desktop (RDP)',
    category: 'network',
    severity: 'medium',
    reads:
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server => fDenyTSConnections',
    possibleStatuses: ['pass', 'warn', 'unknown'],
    autoFixable: true,
    guidance:
      'If you do not use Remote Desktop, turn it off (Settings => System => Remote Desktop).',
  },
  // ===================== v0.8.0 additions (read-only, dynamic) =====================
  {
    id: 'password-policy',
    title: 'Account password policy',
    category: 'access',
    severity: 'high',
    reads:
      'Get-ItemProperty HKLM\\SYSTEM\\CurrentControlSet\\Services\\Netlogon\\Parameters (MaximumPasswordAge, MinimumPasswordLength, PasswordComplexity, LockoutBadCount); defaults assumed when absent',
    possibleStatuses: ['pass', 'warn', 'fail', 'unknown'],
    autoFixable: false,
    guidance:
      'Set a password expiry (<= 365 days), a minimum length (>= 8) and a lockout threshold (e.g. 10) via secpol.msc or `net accounts`.',
  },
  {
    id: 'autoplay',
    title: 'Autorun / Autoplay for removable drives',
    category: 'network',
    severity: 'medium',
    reads:
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer => NoDriveTypeAutoRun and HKLM ...\\Services\\Cdrom\\Autorun decoded live',
    possibleStatuses: ['pass', 'warn', 'unknown'],
    autoFixable: false,
    guidance:
      'Disable AutoPlay/AutoRun for removable media (Settings => Bluetooth & devices => AutoPlay, or Group Policy `NoDriveTypeAutoRun`).',
  },
  {
    id: 'lm-hash',
    title: 'LM hash storage (NoLMHash)',
    category: 'encryption',
    severity: 'medium',
    reads:
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa => NoLMHash (absent means the legacy LM hash is still stored for compatibility)',
    possibleStatuses: ['pass', 'warn', 'unknown'],
    autoFixable: false,
    guidance:
      'Enable "Do not store LAN Manager hash value on next password change" (secpol.msc => Local Policies => Security Options), then change passwords.',
  },
  {
    id: 'smb-signing',
    title: 'SMB signing',
    category: 'network',
    severity: 'medium',
    reads:
      'Get-SmbServerConfiguration => RequireSecuritySignature / EnableSecuritySignature, with registry fallback (LanmanServer\\Parameters)',
    possibleStatuses: ['pass', 'warn', 'fail', 'requires-admin', 'unknown'],
    autoFixable: false,
    guidance:
      'Require SMB signing for the server (`Set-SmbServerConfiguration -RequireSecuritySignature $true`).',
  },
  {
    id: 'listening-ports',
    title: 'Inbound listening ports',
    category: 'network',
    severity: 'medium',
    reads:
      'Get-NetTCPConnection -State Listen => LocalPort/Address, summarized and deduplicated (never a fixed port list)',
    possibleStatuses: ['pass', 'warn', 'unknown'],
    autoFixable: false,
    guidance:
      'Review unexpected listeners and close the service or block the port with the firewall. Some ports are normal (RPC 135, SMB 445 on a file server).',
  },
  {
    id: 'windows-update-service',
    title: 'Windows Update service',
    category: 'updates',
    severity: 'medium',
    reads:
      'Get-Service wuauserv (StartType + Status), reporting disabled/stopped honestly instead of guessing',
    possibleStatuses: ['pass', 'warn', 'fail', 'unknown'],
    autoFixable: false,
    guidance:
      'Keep the Windows Update service (wuauserv) available so security patches can install.',
  },
];

/** Fast lookup by id. */
export const SECURITY_CHECK_BY_ID: ReadonlyMap<string, SecurityCheckDefinition> = new Map(
  SECURITY_CHECK_CATALOG.map((definition) => [definition.id, definition])
);

export interface SecurityCheckResult {
  id: string;
  status: SecurityCheckStatus;
  /** The value(s) actually read from the machine (makes results credible). */
  evidence: string;
  /** Short, honest reason for the status. */
  reason: string;
}

export interface SecurityMachineInfo {
  /** e.g. "Microsoft Windows 11 Pro". */
  osCaption: string;
  /** e.g. "10.0.22631". */
  osVersion: string;
  /** e.g. "22631". */
  osBuild: string;
  /** e.g. "Professional" | "Core". */
  edition: string;
  /** e.g. "23H2" when Windows exposes it. */
  displayVersion: string;
  /** Whether the scanner process runs elevated. */
  isAdmin: boolean;
  /** ISO timestamp of the environment read. */
  collectedAt: string;
}

export interface SecurityScanReport {
  checks: SecurityCheckResult[];
  summary: Record<SecurityCheckStatus, number>;
  /** 0-100, or null when nothing could be scored. Never a magic number. */
  score: number | null;
  /** Number of checks that contributed to the score. */
  scoredChecks: number;
  /** Number of checks excluded from the score (unknown / n-a / requires-admin). */
  excludedChecks: number;
  totalChecks: number;
  machine: SecurityMachineInfo;
  /** ISO timestamp of the scan. */
  timestamp: string;
}

export const SEVERITY_WEIGHT: Record<SecuritySeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Partial credit per status. Only scorable statuses appear here. */
export const STATUS_SCORE: Partial<Record<SecurityCheckStatus, number>> = {
  pass: 1,
  warn: 0.5,
  fail: 0,
};

/**
 * Transparent scoring formula (mirrored verbatim in the UI tooltip and in
 * docs/SECURITY_CHECKS.md):
 *
 *   score = round(100 × Σ(weight(check) × statusScore) / Σ(weight(check)))
 *
 * summed over checks whose status is pass/warn/fail. Checks with status
 * unknown / not-applicable / requires-admin are excluded from BOTH the
 * numerator and the denominator: we do not penalise what does not apply or
 * what could not be measured. Returns null ("not scored") when the denominator
 * is zero.
 *
 * severity weights: critical=4, high=3, medium=2, low=1.
 * statusScore: pass=1.0, warn=0.5, fail=0.
 */
export const SECURITY_SCORE_FORMULA =
  'score = round(100 × Σ(weight × statusScore) / Σ(weight)) over pass/warn/fail checks; ' +
  'unknown, not-applicable and requires-admin are excluded from the denominator. ' +
  'Weights: critical=4, high=3, medium=2, low=1. statusScore: pass=1, warn=0.5, fail=0. ' +
  'Shows "not scored" when no check is scorable.';

function severityOf(id: string): number {
  return SEVERITY_WEIGHT[SECURITY_CHECK_BY_ID.get(id)?.severity ?? 'low'];
}

export function computeSecurityScore(checks: readonly SecurityCheckResult[]): {
  score: number | null;
  scoredChecks: number;
  excludedChecks: number;
} {
  let weighted = 0;
  let weightTotal = 0;
  let scoredChecks = 0;
  let excludedChecks = 0;

  for (const check of checks) {
    const statusScore = STATUS_SCORE[check.status];
    if (statusScore === undefined) {
      excludedChecks++;
      continue;
    }
    const weight = severityOf(check.id);
    weighted += weight * statusScore;
    weightTotal += weight;
    scoredChecks++;
  }

  const score = weightTotal > 0 ? Math.round((100 * weighted) / weightTotal) : null;
  return { score, scoredChecks, excludedChecks };
}

export const SECURITY_STATUSES: readonly SecurityCheckStatus[] = [
  'pass',
  'warn',
  'fail',
  'unknown',
  'not-applicable',
  'requires-admin',
];

export function emptySecuritySummary(): Record<SecurityCheckStatus, number> {
  return {
    pass: 0,
    warn: 0,
    fail: 0,
    unknown: 0,
    'not-applicable': 0,
    'requires-admin': 0,
  };
}

export function summarizeSecurityChecks(
  checks: readonly SecurityCheckResult[]
): Record<SecurityCheckStatus, number> {
  const summary = emptySecuritySummary();
  for (const check of checks) summary[check.status]++;
  return summary;
}
