import * as fs from 'node:fs';
import * as path from 'node:path';
import { runPowerShell, parsePowerShellJson } from './powershell';
import {
  SECURITY_FIX_DESCRIPTIONS,
  SECURITY_FIX_TITLES,
  UAC_LEVEL_LABELS,
  UAC_LEVEL_TRIPLES,
  isSecurityFixId,
  type SecurityFixBlockedReason,
  type SecurityFixId,
  type UacFixId,
  type UacTriple,
  type SecurityFixOutcome,
  type SecurityFixPreview,
} from '@shared/security-fix';

/**
 * Reversible security auto-fix engine (v0.7.0, extended in v0.10.0).
 *
 * Scope is deliberately tiny: only `smb1`, `guest-account`, `remote-desktop`
 * and `smb-signing` — four checks whose repair is standard, admin-only and
 * fully reversible.
 *
 * Safety model
 * ------------
 *  - PREVIEW first: every change is described with the value observed on the
 *    machine right now (`current`) and the value that will be written (`target`).
 *  - CONFIRM in the renderer before apply.
 *  - CAPTURE the real previous value before the write, persist it, and restore
 *    exactly that on revert (never a hard-coded "default").
 *  - ADMIN required: when not elevated the action is reported as `blocked` with
 *    reason `requires-admin` — it never runs and never fails silently.
 *  - HONEST state: after apply/revert the value is RE-READ from the machine; the
 *    returned `after` is measured, not assumed.
 *
 * IMPORTANT: the unit tests exercise the pure planners and the preview/revert
 * round-trip with fixtures. They never execute these fixes against the host.
 */

// ---------------------------------------------------------------------------
// Observations (decoded live reads)
// ---------------------------------------------------------------------------

export interface Smb1Observation {
  checkId: 'smb1';
  available: boolean;
  enabled: boolean | null;
}
export interface GuestObservation {
  checkId: 'guest-account';
  available: boolean;
  name: string | null;
  enabled: boolean | null;
}
export interface RdpObservation {
  checkId: 'remote-desktop';
  available: boolean;
  deny: number | null;
}
export interface SmbSigningObservation {
  checkId: 'smb-signing';
  available: boolean;
  /** RequireSecuritySignature: the server refuses unsigned SMB traffic. */
  require: boolean | null;
  /** EnableSecuritySignature: the client signs when the peer asks. */
  enable: boolean | null;
}
/**
 * UAC level observation (v0.18.0). The three DWORDs fully determine the
 * level; any of them may be unreadable (null) on a locked-down machine.
 */
export interface UacObservation {
  checkId: UacFixId;
  available: boolean;
  lua: number | null;
  consent: number | null;
  secure: number | null;
}
/** Smart App Control state: 0=Off, 1=Enforce, 2=Evaluation, null=not configured. */
export interface SmartAppControlObservation {
  checkId: 'smart-app-control';
  available: boolean;
  state: number | null;
}
/** Machine execution policy (null when not configured; defaults to Restricted). */
export interface ExecPolicyObservation {
  checkId: 'powershell-exec-policy';
  available: boolean;
  policy: string | null;
}
export type FixObservation =
  | Smb1Observation
  | GuestObservation
  | RdpObservation
  | SmbSigningObservation
  | UacObservation
  | SmartAppControlObservation
  | ExecPolicyObservation;

// ---------------------------------------------------------------------------
// Live read scripts (one JSON object each)
// ---------------------------------------------------------------------------

const RDP_REG_PATH = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server';
const SMB1_REG_PATH = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters';
const SMB_SIGNING_REG_PATH = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters';
const UAC_REG_PATH = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System';
const SAC_REG_PATH = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy';
const EXECPOL_REG_PATH =
  'HKLM:\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell';

/** Shared live-read for all five UAC levels (same triple, different target). */
const UAC_READ_SCRIPT = `
    $p = '${UAC_REG_PATH}';
    $lua = (Get-ItemProperty -Path $p -Name 'EnableLUA' -ErrorAction SilentlyContinue).EnableLUA;
    $consent = (Get-ItemProperty -Path $p -Name 'ConsentPromptBehaviorAdmin' -ErrorAction SilentlyContinue).ConsentPromptBehaviorAdmin;
    $secure = (Get-ItemProperty -Path $p -Name 'PromptOnSecureDesktop' -ErrorAction SilentlyContinue).PromptOnSecureDesktop;
    $available = ($lua -ne $null);
    @{ available = $available; lua = $lua; consent = $consent; secure = $secure } | ConvertTo-Json -Compress
  `;

function uacApplyScript(triple: UacTriple): string {
  return `
    try {
      Set-ItemProperty -Path '${UAC_REG_PATH}' -Name 'EnableLUA' -Value ${triple.lua} -Type DWord -Force -ErrorAction Stop;
      Set-ItemProperty -Path '${UAC_REG_PATH}' -Name 'ConsentPromptBehaviorAdmin' -Value ${triple.consent} -Type DWord -Force -ErrorAction Stop;
      Set-ItemProperty -Path '${UAC_REG_PATH}' -Name 'PromptOnSecureDesktop' -Value ${triple.secure} -Type DWord -Force -ErrorAction Stop;
      Write-Output 'OK'
    }
    catch { Write-Output 'FAILED' }
  `;
}

const READ_SCRIPTS: Readonly<Record<SecurityFixId, string>> = {
  smb1: `
    $available = $false; $enabled = $null;
    try {
      $c = Get-SmbServerConfiguration -ErrorAction Stop;
      $enabled = [bool]$c.EnableSMB1Protocol; $available = $true;
    } catch {
      try {
        $v = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters' -Name 'SMB1' -ErrorAction Stop).SMB1;
        $enabled = ([int]$v -eq 1); $available = $true;
      } catch { $available = $false }
    }
    @{ available = $available; enabled = $enabled } | ConvertTo-Json -Compress
  `,
  'guest-account': `
    $available = $false; $name = $null; $enabled = $null;
    try {
      $u = Get-LocalUser -ErrorAction Stop | Where-Object { $_.SID.Value -like '*-501' } | Select-Object -First 1;
      if ($u) { $available = $true; $name = [string]$u.Name; $enabled = [bool]$u.Enabled }
    } catch {
      try {
        $u = Get-CimInstance -ClassName Win32_UserAccount -Filter "LocalAccount=True" -ErrorAction Stop | Where-Object { $_.SID -like '*-501' } | Select-Object -First 1;
        if ($u) { $available = $true; $name = [string]$u.Name; $enabled = (-not [bool]$u.Disabled) }
      } catch { $available = $false }
    }
    @{ available = $available; name = $name; enabled = $enabled } | ConvertTo-Json -Compress
  `,
  'remote-desktop': `
    $available = $false; $deny = $null;
    try {
      $deny = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name 'fDenyTSConnections' -ErrorAction Stop).fDenyTSConnections;
      $available = $true;
    } catch { $available = $false }
    @{ available = $available; deny = $deny } | ConvertTo-Json -Compress
  `,
  'smb-signing': `
    $available = $false; $require = $null; $enable = $null;
    try {
      $c = Get-SmbServerConfiguration -ErrorAction Stop;
      $require = [bool]$c.RequireSecuritySignature;
      $enable = [bool]$c.EnableSecuritySignature;
      $available = $true;
    } catch {
      try {
        $base = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters';
        $r = (Get-ItemProperty -Path $base -Name 'RequireSecuritySignature' -ErrorAction Stop).RequireSecuritySignature;
        $require = ([int]$r -eq 1);
        $e = (Get-ItemProperty -Path $base -Name 'EnableSecuritySignature' -ErrorAction SilentlyContinue).EnableSecuritySignature;
        if ($e -ne $null) { $enable = ([int]$e -eq 1) }
        $available = $true;
      } catch { $available = $false }
    }
    @{ available = $available; require = $require; enable = $enable } | ConvertTo-Json -Compress
  `,
  'uac-always': UAC_READ_SCRIPT,
  'uac-credentials': UAC_READ_SCRIPT,
  'uac-default': UAC_READ_SCRIPT,
  'uac-nodim': UAC_READ_SCRIPT,
  'uac-never': UAC_READ_SCRIPT,
  'smart-app-control': `
    $available = $true; $state = $null;
    try {
      $v = (Get-ItemProperty -Path '${SAC_REG_PATH}' -Name 'VerifiedAndReputablePolicyState' -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState;
      if ($v -ne $null) { $state = [int]$v }
    } catch { $available = $false }
    @{ available = $available; state = $state } | ConvertTo-Json -Compress
  `,
  'powershell-exec-policy': `
    $available = $true; $policy = $null;
    try {
      $v = (Get-ItemProperty -Path '${EXECPOL_REG_PATH}' -Name 'ExecutionPolicy' -ErrorAction SilentlyContinue).ExecutionPolicy;
      if ($v -ne $null) { $policy = [string]$v }
    } catch { $available = $false }
    @{ available = $available; policy = $policy } | ConvertTo-Json -Compress
  `,
};

const APPLY_SCRIPTS: Readonly<Record<SecurityFixId, string>> = {
  smb1: `
    $ok = $false;
    try { Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force -ErrorAction Stop; $ok = $true } catch {
      try { Set-ItemProperty -Path '${SMB1_REG_PATH}' -Name 'SMB1' -Value 0 -Type DWord -Force -ErrorAction Stop; $ok = $true } catch {}
    }
    if ($ok) { Write-Output 'OK' } else { Write-Output 'FAILED' }
  `,
  'guest-account': `
    $ok = $false;
    try {
      $u = Get-LocalUser -ErrorAction Stop | Where-Object { $_.SID.Value -like '*-501' } | Select-Object -First 1;
      if ($u) { Disable-LocalUser -Name $u.Name -ErrorAction Stop; $ok = $true }
    } catch {
      try {
        $u = Get-CimInstance -ClassName Win32_UserAccount -Filter "LocalAccount=True" -ErrorAction Stop | Where-Object { $_.SID -like '*-501' } | Select-Object -First 1;
        if ($u) { $out = & net.exe user $u.Name /active:no 2>&1; if ($LASTEXITCODE -eq 0) { $ok = $true } }
      } catch {}
    }
    if ($ok) { Write-Output 'OK' } else { Write-Output 'FAILED' }
  `,
  'remote-desktop': `
    try { Set-ItemProperty -Path '${RDP_REG_PATH}' -Name 'fDenyTSConnections' -Value 1 -Type DWord -Force -ErrorAction Stop; Write-Output 'OK' }
    catch { Write-Output 'FAILED' }
  `,
  'smb-signing': `
    $ok = $false;
    try {
      Set-SmbServerConfiguration -RequireSecuritySignature $true -EnableSecuritySignature $true -Force -ErrorAction Stop;
      $ok = $true
    } catch {
      try {
        Set-ItemProperty -Path '${SMB_SIGNING_REG_PATH}' -Name 'RequireSecuritySignature' -Value 1 -Type DWord -Force -ErrorAction Stop;
        Set-ItemProperty -Path '${SMB_SIGNING_REG_PATH}' -Name 'EnableSecuritySignature' -Value 1 -Type DWord -Force -ErrorAction Stop;
        $ok = $true
      } catch { $ok = $false }
    }
    if ($ok) { Write-Output 'OK' } else { Write-Output 'FAILED' }
  `,
  'uac-always': uacApplyScript(UAC_LEVEL_TRIPLES['uac-always']),
  'uac-credentials': uacApplyScript(UAC_LEVEL_TRIPLES['uac-credentials']),
  'uac-default': uacApplyScript(UAC_LEVEL_TRIPLES['uac-default']),
  'uac-nodim': uacApplyScript(UAC_LEVEL_TRIPLES['uac-nodim']),
  'uac-never': uacApplyScript(UAC_LEVEL_TRIPLES['uac-never']),
  'smart-app-control': `
    try { Set-ItemProperty -Path '${SAC_REG_PATH}' -Name 'VerifiedAndReputablePolicyState' -Value 1 -Type DWord -Force -ErrorAction Stop; Write-Output 'OK' }
    catch { Write-Output 'FAILED' }
  `,
  'powershell-exec-policy': `
    try { Set-ItemProperty -Path '${EXECPOL_REG_PATH}' -Name 'ExecutionPolicy' -Value 'RemoteSigned' -Type String -Force -ErrorAction Stop; Write-Output 'OK' }
    catch { Write-Output 'FAILED' }
  `,
};

/**
 * Canonical token for the SMB-signing original. Both values are stored with
 * three states so a revert can restore `absent` by REMOVING the value instead
 * of writing a made-up default: `require=<absent|0|1>;enable=<absent|0|1>`.
 */
type SmbSigningTriState = 'absent' | '0' | '1';

function parseSmbSigningToken(
  token: string
): { require: SmbSigningTriState; enable: SmbSigningTriState } | null {
  const match = /^require=(absent|0|1);enable=(absent|0|1)$/.exec(token);
  if (!match) return null;
  return { require: match[1] as SmbSigningTriState, enable: match[2] as SmbSigningTriState };
}

function restoreSmbSigningRegistryValue(name: string, value: SmbSigningTriState): string {
  return value === 'absent'
    ? `Remove-ItemProperty -Path $base -Name '${name}' -ErrorAction SilentlyContinue`
    : `Set-ItemProperty -Path $base -Name '${name}' -Value ${value} -Type DWord -Force -ErrorAction Stop`;
}

/**
 * Canonical token for the UAC original: the exact triple that was in place
 * before the change, e.g. `lua=1;consent=5;secure=1`. A part is `absent`
 * when the value was not present, and the revert restores that by REMOVING
 * the value instead of inventing a default.
 */
type UacTokenPart = 'absent' | string;

function parseUacToken(token: string): { lua: string; consent: string; secure: string } | null {
  const match = /^lua=(\d+|absent);consent=(\d+|absent);secure=(\d+|absent)$/.exec(token);
  if (!match) return null;
  return {
    lua: match[1] as UacTokenPart,
    consent: match[2] as UacTokenPart,
    secure: match[3] as UacTokenPart,
  };
}

function restoreUacRegistryValue(name: string, value: string): string {
  return value === 'absent'
    ? `Remove-ItemProperty -Path $base -Name '${name}' -ErrorAction SilentlyContinue`
    : `Set-ItemProperty -Path $base -Name '${name}' -Value ${value} -Type DWord -Force -ErrorAction Stop`;
}

/** Plain-language label for a UAC triple (used in previews and outcomes). */
export function uacLevelLabel(
  lua: number | null,
  consent: number | null,
  secure: number | null
): string {
  if (lua === 0) return 'Off (UAC disabled)';
  if (lua === 1 && consent === 2 && secure === 1) return 'Always notify';
  if (lua === 1 && consent === 1 && secure === 1) return 'Always notify + credentials';
  if (lua === 1 && consent === 5 && secure === 1) return 'Default';
  if (lua === 1 && consent === 5 && secure === 0) return 'Notify without dimming';
  if (lua === 1 && consent === 0) return 'Never notify';
  if (lua === null || consent === null) return 'unknown';
  return 'Custom';
}

/** Display label for a Smart App Control state value. */
export function smartAppControlLabel(state: number | null): string {
  if (state === 1) return 'Smart App Control enforced';
  if (state === 2) return 'Smart App Control in evaluation';
  if (state === 0) return 'Smart App Control off';
  return 'Smart App Control not configured';
}

/** Narrow any observation to the shared UAC shape (all five levels). */
function isUacObservation(observation: FixObservation): observation is UacObservation {
  return (
    observation.checkId === 'uac-always' ||
    observation.checkId === 'uac-credentials' ||
    observation.checkId === 'uac-default' ||
    observation.checkId === 'uac-nodim' ||
    observation.checkId === 'uac-never'
  );
}

/**
 * Build the revert script that restores the exact captured value. Pure: the
 * previous value is embedded verbatim so the round-trip is testable.
 */
export function buildRevertCommand(checkId: SecurityFixId, previous: string): string {
  switch (checkId) {
    case 'smb1': {
      const target = previous === 'enabled';
      const regValue = target ? '1' : '0';
      return `
        $target = $${target ? 'true' : 'false'};
        $ok = $false;
        try { Set-SmbServerConfiguration -EnableSMB1Protocol $target -Force -ErrorAction Stop; $ok = $true } catch {
          try { Set-ItemProperty -Path '${SMB1_REG_PATH}' -Name 'SMB1' -Value ${regValue} -Type DWord -Force -ErrorAction Stop; $ok = $true } catch {}
        }
        if ($ok) { Write-Output 'OK' } else { Write-Output 'FAILED' }
      `;
    }
    case 'guest-account': {
      if (previous === 'enabled') {
        return `
          $ok = $false;
          try {
            $u = Get-LocalUser -ErrorAction Stop | Where-Object { $_.SID.Value -like '*-501' } | Select-Object -First 1;
            if ($u) { Enable-LocalUser -Name $u.Name -ErrorAction Stop; $ok = $true }
          } catch {
            try {
              $u = Get-CimInstance -ClassName Win32_UserAccount -Filter "LocalAccount=True" -ErrorAction Stop | Where-Object { $_.SID -like '*-501' } | Select-Object -First 1;
              if ($u) { $out = & net.exe user $u.Name /active:yes 2>&1; if ($LASTEXITCODE -eq 0) { $ok = $true } }
            } catch {}
          }
          if ($ok) { Write-Output 'OK' } else { Write-Output 'FAILED' }
        `;
      }
      // The account was already disabled: nothing to restore.
      return "Write-Output 'OK'";
    }
    case 'remote-desktop': {
      const value = Number.isFinite(Number(previous)) ? String(Number(previous)) : '1';
      return `
        try { Set-ItemProperty -Path '${RDP_REG_PATH}' -Name 'fDenyTSConnections' -Value ${value} -Type DWord -Force -ErrorAction Stop; Write-Output 'OK' }
        catch { Write-Output 'FAILED' }
      `;
    }
    case 'smb-signing': {
      const parsed = parseSmbSigningToken(previous) ?? { require: '0', enable: '0' };
      const requireBool = parsed.require === '1' ? '$true' : '$false';
      const enableBool = parsed.enable === '1' ? '$true' : '$false';
      const restoreRequire = restoreSmbSigningRegistryValue(
        'RequireSecuritySignature',
        parsed.require
      );
      const restoreEnable = restoreSmbSigningRegistryValue(
        'EnableSecuritySignature',
        parsed.enable
      );
      return `
        $base = '${SMB_SIGNING_REG_PATH}';
        $ok = $false;
        $r = '${parsed.require}'; $e = '${parsed.enable}';
        if ($r -ne 'absent' -and $e -ne 'absent') {
          try {
            Set-SmbServerConfiguration -RequireSecuritySignature ${requireBool} -EnableSecuritySignature ${enableBool} -Force -ErrorAction Stop;
            $ok = $true
          } catch { $ok = $false }
        }
        if (-not $ok) {
          try { ${restoreRequire}; $ok = $true } catch { $ok = $false }
          if ($ok) { try { ${restoreEnable} } catch { $ok = $false } }
        }
        if ($ok) { Write-Output 'OK' } else { Write-Output 'FAILED' }
      `;
    }
    case 'uac-always':
    case 'uac-credentials':
    case 'uac-default':
    case 'uac-nodim':
    case 'uac-never': {
      const parsed = parseUacToken(previous) ?? { lua: '1', consent: '5', secure: '1' };
      const restoreLua = restoreUacRegistryValue('EnableLUA', parsed.lua);
      const restoreConsent = restoreUacRegistryValue('ConsentPromptBehaviorAdmin', parsed.consent);
      const restoreSecure = restoreUacRegistryValue('PromptOnSecureDesktop', parsed.secure);
      return `
        $base = '${UAC_REG_PATH}';
        try { ${restoreLua}; ${restoreConsent}; ${restoreSecure}; Write-Output 'OK' }
        catch { Write-Output 'FAILED' }
      `;
    }
    case 'smart-app-control': {
      const restore =
        previous === 'absent'
          ? `Remove-ItemProperty -Path '${SAC_REG_PATH}' -Name 'VerifiedAndReputablePolicyState' -ErrorAction SilentlyContinue`
          : `Set-ItemProperty -Path '${SAC_REG_PATH}' -Name 'VerifiedAndReputablePolicyState' -Value ${previous} -Type DWord -Force -ErrorAction Stop`;
      return `
        try { ${restore}; Write-Output 'OK' }
        catch { Write-Output 'FAILED' }
      `;
    }
    case 'powershell-exec-policy': {
      const restore =
        previous === 'absent'
          ? `Remove-ItemProperty -Path '${EXECPOL_REG_PATH}' -Name 'ExecutionPolicy' -ErrorAction SilentlyContinue`
          : `Set-ItemProperty -Path '${EXECPOL_REG_PATH}' -Name 'ExecutionPolicy' -Value '${previous.replace(/'/g, "''")}' -Type String -Force -ErrorAction Stop`;
      return `
        try { ${restore}; Write-Output 'OK' }
        catch { Write-Output 'FAILED' }
      `;
    }
  }
}

export function buildApplyCommand(checkId: SecurityFixId): string {
  return APPLY_SCRIPTS[checkId];
}

/** Human-readable rendering of an observation, used for previews/outcomes. */
export function formatObservation(observation: FixObservation): string {
  switch (observation.checkId) {
    case 'smb1':
      if (!observation.available || observation.enabled === null) return 'unknown';
      return observation.enabled ? 'SMBv1 enabled' : 'SMBv1 disabled';
    case 'guest-account':
      if (!observation.available || observation.enabled === null) return 'unknown';
      return `Guest account${observation.name ? ` (${observation.name})` : ''} ${
        observation.enabled ? 'enabled' : 'disabled'
      }`;
    case 'remote-desktop':
      if (!observation.available || observation.deny === null) return 'unknown';
      return `fDenyTSConnections=${observation.deny}`;
    case 'smb-signing': {
      if (!observation.available || observation.require === null) return 'unknown';
      const require = observation.require ? 'True' : 'False';
      const enable =
        observation.enable === null ? 'unknown' : observation.enable ? 'True' : 'False';
      return `RequireSecuritySignature=${require}, EnableSecuritySignature=${enable}`;
    }
    case 'uac-always':
    case 'uac-credentials':
    case 'uac-default':
    case 'uac-nodim':
    case 'uac-never': {
      if (!observation.available || observation.lua === null) return 'unknown';
      const level = uacLevelLabel(observation.lua, observation.consent, observation.secure);
      return (
        `UAC level: ${level} (EnableLUA=${observation.lua}, ` +
        `ConsentPromptBehaviorAdmin=${observation.consent ?? 'not set'}, ` +
        `PromptOnSecureDesktop=${observation.secure ?? 'not set'})`
      );
    }
    case 'smart-app-control':
      if (!observation.available) return 'unknown';
      return smartAppControlLabel(observation.state);
    case 'powershell-exec-policy':
      if (!observation.available) return 'unknown';
      return observation.policy === null
        ? 'ExecutionPolicy not configured (defaults to Restricted)'
        : `ExecutionPolicy=${observation.policy}`;
  }
}

/**
 * Canonical, machine-independent token stored before a change and consumed by
 * `buildRevertCommand`. This is what makes the revert restore the REAL previous
 * value instead of a hard-coded default.
 */
export function encodeOriginal(observation: FixObservation): string {
  switch (observation.checkId) {
    case 'smb1':
      return observation.enabled ? 'enabled' : 'disabled';
    case 'guest-account':
      return observation.enabled ? 'enabled' : 'disabled';
    case 'remote-desktop':
      return String(observation.deny);
    case 'smb-signing': {
      const tri = (value: boolean | null): SmbSigningTriState =>
        value === null ? 'absent' : value ? '1' : '0';
      return `require=${tri(observation.require)};enable=${tri(observation.enable)}`;
    }
    case 'uac-always':
    case 'uac-credentials':
    case 'uac-default':
    case 'uac-nodim':
    case 'uac-never': {
      const part = (value: number | null): string => (value === null ? 'absent' : String(value));
      return `lua=${part(observation.lua)};consent=${part(observation.consent)};secure=${part(observation.secure)}`;
    }
    case 'smart-app-control':
      return observation.state === null ? 'absent' : String(observation.state);
    case 'powershell-exec-policy':
      return observation.policy ?? 'absent';
  }
}

/** Display label for a stored canonical original token. */
export function formatOriginal(checkId: SecurityFixId, token: string | null): string | null {
  if (token === null) return null;
  switch (checkId) {
    case 'smb1':
      return token === 'enabled' ? 'SMBv1 enabled' : 'SMBv1 disabled';
    case 'guest-account':
      return token === 'enabled' ? 'Guest account enabled' : 'Guest account disabled';
    case 'remote-desktop':
      return `fDenyTSConnections=${token}`;
    case 'smb-signing': {
      const parsed = parseSmbSigningToken(token);
      if (!parsed) return token;
      const label = (value: SmbSigningTriState): string =>
        value === 'absent' ? 'absent' : value === '1' ? 'True' : 'False';
      return `RequireSecuritySignature=${label(parsed.require)}, EnableSecuritySignature=${label(
        parsed.enable
      )}`;
    }
    case 'uac-always':
    case 'uac-credentials':
    case 'uac-default':
    case 'uac-nodim':
    case 'uac-never': {
      const parsed = parseUacToken(token);
      if (!parsed) return token;
      const num = (value: string): number | null => (value === 'absent' ? null : Number(value));
      return `UAC level: ${uacLevelLabel(num(parsed.lua), num(parsed.consent), num(parsed.secure))}`;
    }
    case 'smart-app-control':
      if (token === 'absent') return 'Smart App Control not configured';
      return smartAppControlLabel(Number(token));
    case 'powershell-exec-policy':
      return token === 'absent'
        ? 'ExecutionPolicy not configured (defaults to Restricted)'
        : `ExecutionPolicy=${token}`;
  }
}

/** Decode a parsed read payload into a typed observation. Pure. */
export function decodeFixObservation(
  checkId: SecurityFixId,
  payload: Record<string, unknown> | null
): FixObservation {
  const available = payload?.available === true;
  const asBool = (value: unknown): boolean | null =>
    typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : null;
  const asNum = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  switch (checkId) {
    case 'smb1':
      return { checkId, available, enabled: asBool(payload?.enabled) };
    case 'guest-account':
      return {
        checkId,
        available,
        name: typeof payload?.name === 'string' ? payload.name : null,
        enabled: asBool(payload?.enabled),
      };
    case 'remote-desktop':
      return { checkId, available, deny: asNum(payload?.deny) };
    case 'smb-signing':
      return {
        checkId,
        available,
        require: asBool(payload?.require),
        enable: asBool(payload?.enable),
      };
    case 'uac-always':
    case 'uac-credentials':
    case 'uac-default':
    case 'uac-nodim':
    case 'uac-never':
      return {
        checkId,
        available,
        lua: asNum(payload?.lua),
        consent: asNum(payload?.consent),
        secure: asNum(payload?.secure),
      };
    case 'smart-app-control':
      return { checkId, available, state: asNum(payload?.state) };
    case 'powershell-exec-policy':
      return {
        checkId,
        available,
        policy: typeof payload?.policy === 'string' ? payload.policy : null,
      };
  }
}

/**
 * True when the live observation already matches the hardened target. This is
 * the ground-truth success signal: a stdout marker alone is not trusted.
 */
export function isTargetObservation(checkId: SecurityFixId, observation: FixObservation): boolean {
  switch (checkId) {
    case 'smb1':
      return (
        observation.checkId === 'smb1' && observation.available && observation.enabled === false
      );
    case 'guest-account':
      return (
        observation.checkId === 'guest-account' &&
        observation.available &&
        observation.enabled === false
      );
    case 'remote-desktop':
      return (
        observation.checkId === 'remote-desktop' && observation.available && observation.deny === 1
      );
    case 'smb-signing':
      return (
        observation.checkId === 'smb-signing' &&
        observation.available &&
        observation.require === true
      );
    case 'uac-always':
    case 'uac-credentials':
    case 'uac-default':
    case 'uac-nodim':
    case 'uac-never': {
      if (!isUacObservation(observation) || !observation.available) return false;
      const triple = UAC_LEVEL_TRIPLES[checkId];
      return (
        observation.lua === triple.lua &&
        observation.consent === triple.consent &&
        observation.secure === triple.secure
      );
    }
    case 'smart-app-control':
      return (
        observation.checkId === 'smart-app-control' &&
        observation.available &&
        observation.state === 1
      );
    case 'powershell-exec-policy':
      return (
        observation.checkId === 'powershell-exec-policy' &&
        observation.available &&
        observation.policy === 'RemoteSigned'
      );
  }
}

/** True when the live observation matches the previously captured original. */
export function isOriginalObservation(
  checkId: SecurityFixId,
  observation: FixObservation,
  token: string
): boolean {
  switch (checkId) {
    case 'smb1':
      return (
        observation.checkId === 'smb1' &&
        observation.available &&
        (observation.enabled === true) === (token === 'enabled')
      );
    case 'guest-account':
      return (
        observation.checkId === 'guest-account' &&
        observation.available &&
        (observation.enabled === true) === (token === 'enabled')
      );
    case 'remote-desktop':
      return (
        observation.checkId === 'remote-desktop' &&
        observation.available &&
        String(observation.deny) === token
      );
    case 'smb-signing': {
      if (observation.checkId !== 'smb-signing' || !observation.available) return false;
      const parsed = parseSmbSigningToken(token);
      if (!parsed) return false;
      const matches = (stored: SmbSigningTriState, actual: boolean | null): boolean =>
        stored === 'absent' ? actual === null : actual === (stored === '1');
      return (
        matches(parsed.require, observation.require) && matches(parsed.enable, observation.enable)
      );
    }
    case 'uac-always':
    case 'uac-credentials':
    case 'uac-default':
    case 'uac-nodim':
    case 'uac-never': {
      if (!isUacObservation(observation) || !observation.available) return false;
      return encodeOriginal(observation) === token;
    }
    case 'smart-app-control':
      return (
        observation.checkId === 'smart-app-control' &&
        observation.available &&
        encodeOriginal(observation) === token
      );
    case 'powershell-exec-policy':
      return (
        observation.checkId === 'powershell-exec-policy' &&
        observation.available &&
        encodeOriginal(observation) === token
      );
  }
}

function blockMessage(reason: SecurityFixBlockedReason): string {
  switch (reason) {
    case 'requires-admin':
      return 'This change requires administrator rights. Restart the app as administrator to apply it.';
    case 'already-applied':
      return 'The recommended value is already in place; nothing to change.';
    case 'not-applicable':
      return 'This fix does not apply to the current system state.';
    case 'unavailable':
      return 'The current value could not be read on this system.';
  }
}

/**
 * Build the preview. Pure and fully unit-tested; it decides whether the action
 * is allowed and why, and never invents the current value.
 */
export function buildFixPreview(
  checkId: SecurityFixId,
  observation: FixObservation,
  options: { isAdmin: boolean; storedOriginal: string | null }
): SecurityFixPreview {
  const base = {
    checkId,
    title: SECURITY_FIX_TITLES[checkId],
    description: SECURITY_FIX_DESCRIPTIONS[checkId],
    reversible: true as const,
    requiresAdmin: true,
    original: formatOriginal(checkId, options.storedOriginal),
    canRevert: options.storedOriginal !== null && options.isAdmin,
  };

  const blocked = (
    reason: SecurityFixBlockedReason,
    current: string,
    target: string
  ): SecurityFixPreview => ({
    ...base,
    current,
    target,
    canApply: false,
    blockedReason: reason,
    blockedMessage: blockMessage(reason),
  });

  const allowed = (current: string, target: string): SecurityFixPreview => ({
    ...base,
    current,
    target,
    canApply: true,
    blockedReason: null,
    blockedMessage: null,
  });

  switch (observation.checkId) {
    case 'smb1': {
      const current = formatObservation(observation);
      if (!observation.available || observation.enabled === null) {
        return blocked('unavailable', current, 'SMBv1 disabled');
      }
      if (observation.enabled === false)
        return blocked('already-applied', current, 'SMBv1 disabled');
      if (!options.isAdmin) return blocked('requires-admin', current, 'SMBv1 disabled');
      return allowed(current, 'SMBv1 disabled');
    }
    case 'guest-account': {
      const current = formatObservation(observation);
      if (!observation.available || observation.enabled === null) {
        return blocked('unavailable', current, 'Guest account disabled');
      }
      if (observation.enabled === false) {
        return blocked('already-applied', current, 'Guest account disabled');
      }
      if (!options.isAdmin) return blocked('requires-admin', current, 'Guest account disabled');
      return allowed(current, 'Guest account disabled');
    }
    case 'remote-desktop': {
      const current = formatObservation(observation);
      if (!observation.available || observation.deny === null) {
        return blocked('unavailable', current, 'fDenyTSConnections=1');
      }
      if (observation.deny === 1) {
        return blocked('already-applied', current, 'fDenyTSConnections=1');
      }
      if (!options.isAdmin) return blocked('requires-admin', current, 'fDenyTSConnections=1');
      return allowed(current, 'fDenyTSConnections=1');
    }
    case 'smb-signing': {
      const current = formatObservation(observation);
      const target = 'RequireSecuritySignature=True, EnableSecuritySignature=True';
      if (!observation.available || observation.require === null) {
        return blocked('unavailable', current, target);
      }
      if (observation.require === true) {
        return blocked('already-applied', current, target);
      }
      if (!options.isAdmin) return blocked('requires-admin', current, target);
      return allowed(current, target);
    }
    case 'uac-always':
    case 'uac-credentials':
    case 'uac-default':
    case 'uac-nodim':
    case 'uac-never': {
      const triple = UAC_LEVEL_TRIPLES[observation.checkId];
      const current = formatObservation(observation);
      const target =
        `UAC ${UAC_LEVEL_LABELS[observation.checkId]} ` +
        `(EnableLUA=${triple.lua}, ConsentPromptBehaviorAdmin=${triple.consent}, ` +
        `PromptOnSecureDesktop=${triple.secure})`;
      if (!observation.available || observation.lua === null) {
        return blocked('unavailable', current, target);
      }
      if (
        observation.lua === triple.lua &&
        observation.consent === triple.consent &&
        observation.secure === triple.secure
      ) {
        return blocked('already-applied', current, target);
      }
      if (!options.isAdmin) return blocked('requires-admin', current, target);
      return allowed(current, target);
    }
    case 'smart-app-control': {
      const current = formatObservation(observation);
      const target = 'Smart App Control enforced';
      if (!observation.available) {
        return blocked('unavailable', current, target);
      }
      if (observation.state === 1) {
        return blocked('already-applied', current, target);
      }
      if (!options.isAdmin) return blocked('requires-admin', current, target);
      return allowed(current, target);
    }
    case 'powershell-exec-policy': {
      const current = formatObservation(observation);
      const target = 'ExecutionPolicy=RemoteSigned';
      if (!observation.available) {
        return blocked('unavailable', current, target);
      }
      // AllSigned is stricter than the target: never offer a downgrade.
      if (observation.policy === 'RemoteSigned' || observation.policy === 'AllSigned') {
        return blocked('already-applied', current, target);
      }
      if (!options.isAdmin) return blocked('requires-admin', current, target);
      return allowed(current, target);
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence of the captured original value
// ---------------------------------------------------------------------------

interface StoredRecord {
  checkId: SecurityFixId;
  original: string;
  appliedAt: string;
}

const STORE_FILE = 'security-fix-state.json';
let storeDirOverride: string | null = null;

/** Test seam: override the directory that holds `security-fix-state.json`. */
export function setSecurityFixStoreDir(dir: string | null): void {
  storeDirOverride = dir;
}

async function storeDir(): Promise<string> {
  if (storeDirOverride) return storeDirOverride;
  try {
    const { app } = await import('electron');
    return app.getPath('userData');
  } catch {
    return process.cwd();
  }
}

function loadStore(raw: string): Partial<Record<SecurityFixId, StoredRecord>> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Partial<Record<SecurityFixId, StoredRecord>>;
    }
  } catch {
    // Corrupt or missing store: treat as empty. Never throw.
  }
  return {};
}

async function readStore(): Promise<Partial<Record<SecurityFixId, StoredRecord>>> {
  try {
    const dir = await storeDir();
    return loadStore(fs.readFileSync(path.join(dir, STORE_FILE), 'utf8'));
  } catch {
    return {};
  }
}

async function writeStore(store: Partial<Record<SecurityFixId, StoredRecord>>): Promise<void> {
  try {
    const dir = await storeDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, STORE_FILE), JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // Persistence failure must never crash the app or block the action.
  }
}

export async function getStoredOriginal(checkId: SecurityFixId): Promise<string | null> {
  const store = await readStore();
  return store[checkId]?.original ?? null;
}

// ---------------------------------------------------------------------------
// Live elevation check (cached per process)
// ---------------------------------------------------------------------------

let cachedElevated: boolean | null = null;

export async function isElevated(): Promise<boolean> {
  if (cachedElevated !== null) return cachedElevated;
  const result = await runPowerShell(
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
  );
  cachedElevated = /true/i.test(result.stdout);
  return cachedElevated;
}

/** Test seam: reset the cached elevation result. */
export function resetElevationCache(): void {
  cachedElevated = null;
}

async function readObservation(checkId: SecurityFixId): Promise<FixObservation> {
  const result = await runPowerShell(READ_SCRIPTS[checkId]);
  const payload = result.success
    ? parsePowerShellJson<Record<string, unknown>>(result.stdout)
    : null;
  return decodeFixObservation(checkId, payload);
}

// ---------------------------------------------------------------------------
// Public service API
// ---------------------------------------------------------------------------

export async function previewSecurityFix(checkId: string): Promise<SecurityFixPreview | null> {
  if (!isSecurityFixId(checkId)) return null;
  const [observation, isAdmin, storedOriginal] = await Promise.all([
    readObservation(checkId),
    isElevated(),
    getStoredOriginal(checkId),
  ]);
  return buildFixPreview(checkId, observation, { isAdmin, storedOriginal });
}

export async function applySecurityFix(checkId: string): Promise<SecurityFixOutcome> {
  if (!isSecurityFixId(checkId)) {
    return {
      checkId: 'smb1',
      action: 'apply',
      success: false,
      status: 'blocked',
      message: `Unknown security check: ${checkId}`,
      before: 'unknown',
      after: 'unknown',
    };
  }

  const before = await readObservation(checkId);
  const isAdmin = await isElevated();
  const storedOriginal = await getStoredOriginal(checkId);
  const preview = buildFixPreview(checkId, before, { isAdmin, storedOriginal });

  if (!preview.canApply) {
    return {
      checkId,
      action: 'apply',
      success: false,
      status: 'blocked',
      message: preview.blockedMessage ?? 'This fix cannot be applied right now.',
      before: formatObservation(before),
      after: formatObservation(before),
    };
  }

  // Capture the REAL previous value before touching anything.
  const store = await readStore();
  store[checkId] = {
    checkId,
    original: encodeOriginal(before),
    appliedAt: new Date().toISOString(),
  };
  await writeStore(store);

  const result = await runPowerShell(buildApplyCommand(checkId));

  // Re-measure honestly; never claim success without reading the result back.
  const after = await readObservation(checkId);
  const ok = isTargetObservation(checkId, after);

  // The captured original is only meaningful while the change is actually in
  // place; drop it if the re-read did not confirm the target.
  if (!ok) {
    const store = await readStore();
    delete store[checkId];
    await writeStore(store);
  }

  return {
    checkId,
    action: 'apply',
    success: ok,
    status: ok ? 'applied' : 'failed',
    message: ok
      ? `Applied: ${preview.title}.`
      : `The change was not confirmed: ${
          result.stderr ||
          (result.success ? 'the re-read value had not changed.' : 'the command did not report OK.')
        }`,
    before: formatObservation(before),
    after: formatObservation(after),
  };
}

export async function revertSecurityFix(checkId: string): Promise<SecurityFixOutcome> {
  if (!isSecurityFixId(checkId)) {
    return {
      checkId: 'smb1',
      action: 'revert',
      success: false,
      status: 'blocked',
      message: `Unknown security check: ${checkId}`,
      before: 'unknown',
      after: 'unknown',
    };
  }

  const before = await readObservation(checkId);
  const isAdmin = await isElevated();
  const storedOriginal = await getStoredOriginal(checkId);

  if (storedOriginal === null) {
    return {
      checkId,
      action: 'revert',
      success: false,
      status: 'blocked',
      message: 'No captured previous value is stored, so an exact revert is not possible.',
      before: formatObservation(before),
      after: formatObservation(before),
    };
  }

  if (!isAdmin) {
    return {
      checkId,
      action: 'revert',
      success: false,
      status: 'blocked',
      message: 'Reverting requires administrator rights.',
      before: formatObservation(before),
      after: formatObservation(before),
    };
  }

  const result = await runPowerShell(buildRevertCommand(checkId, storedOriginal));
  const after = await readObservation(checkId);
  const ok = isOriginalObservation(checkId, after, storedOriginal);

  if (ok) {
    const store = await readStore();
    delete store[checkId];
    await writeStore(store);
  }

  return {
    checkId,
    action: 'revert',
    success: ok,
    status: ok ? 'reverted' : 'failed',
    message: ok
      ? `Reverted to the previous value: ${formatOriginal(checkId, storedOriginal) ?? storedOriginal}.`
      : `The revert was not confirmed: ${
          result.stderr ||
          (result.success ? 'the re-read value had not changed.' : 'the command did not report OK.')
        }`,
    before: formatObservation(before),
    after: formatObservation(after),
  };
}

/**
 * Best-effort relaunch of the app with elevation. Used when a fix is blocked by
 * `requires-admin`. The elevated instance is a separate process; this one is
 * left untouched so the user can close it.
 */
export async function relaunchElevated(): Promise<{ success: boolean; message: string }> {
  const exe = process.execPath.replace(/'/g, "''");
  const args = process.argv
    .slice(1)
    .map((arg) => `'${arg.replace(/'/g, "''")}'`)
    .join(',');
  const result = await runPowerShell(
    `Start-Process -FilePath '${exe}' -ArgumentList @(${args}) -Verb RunAs`
  );
  return result.success
    ? { success: true, message: 'A new elevated instance was requested.' }
    : { success: false, message: `Could not relaunch elevated: ${result.stderr}` };
}
