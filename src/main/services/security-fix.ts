import * as fs from 'node:fs';
import * as path from 'node:path';
import { runPowerShell, parsePowerShellJson } from './powershell';
import {
  SECURITY_FIX_DESCRIPTIONS,
  SECURITY_FIX_TITLES,
  isSecurityFixId,
  type SecurityFixBlockedReason,
  type SecurityFixId,
  type SecurityFixOutcome,
  type SecurityFixPreview,
} from '@shared/security-fix';

/**
 * Reversible security auto-fix engine (v0.7.0).
 *
 * Scope is deliberately tiny: only `smb1`, `guest-account` and `remote-desktop`
 * — three checks whose repair is standard, admin-only and fully reversible.
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
export type FixObservation = Smb1Observation | GuestObservation | RdpObservation;

// ---------------------------------------------------------------------------
// Live read scripts (one JSON object each)
// ---------------------------------------------------------------------------

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
};

const RDP_REG_PATH = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server';
const SMB1_REG_PATH = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters';

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
};

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
  const ok = result.success && result.stdout.includes('OK');

  // Re-measure honestly; never claim success without reading the result back.
  const after = await readObservation(checkId);

  return {
    checkId,
    action: 'apply',
    success: ok,
    status: ok ? 'applied' : 'failed',
    message: ok
      ? `Applied: ${preview.title}.`
      : `The change was not confirmed: ${result.stderr || 'the command did not report OK.'}`,
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
  const ok = result.success && result.stdout.includes('OK');
  const after = await readObservation(checkId);

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
      : `The revert was not confirmed: ${result.stderr || 'the command did not report OK.'}`,
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
