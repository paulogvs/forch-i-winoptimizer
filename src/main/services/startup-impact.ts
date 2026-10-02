/**
 * Dynamic startup-impact classifier (v0.7.0).
 *
 * Design rule: there is NO list of product, vendor or antivirus names anywhere
 * in this module. Impact is derived exclusively from OBSERVABLE signals:
 *
 *  1. Origin / persistence scope — where the entry starts from
 *     (HKCU Run, HKLM Run, Startup folder, scheduled task, auto-service).
 *  2. Target binary — does it exist on disk, is it signed (Authenticode), and
 *     does it live under a protected system location (System32/SysWOW64/Windows).
 *  3. REAL measured footprint — CPU time and working set of the process while
 *     it is actually running (read live via Get-Process). This is the signal
 *     that makes the result specific to the machine it runs on.
 *  4. Generic name GRAMMAR — tokens such as `update`, `helper`, `tray`, `sync`,
 *     `launcher`. These describe a *shape* of software (background resident),
 *     never a product. Matching is language/product-agnostic and is treated as
 *     one weak point, not as an authority.
 *
 * Everything here is pure (no I/O), so it is unit-testable with fixtures for a
 * vendor that does not exist anywhere in the source tree.
 */

export type StartupImpact = 'low' | 'medium' | 'high';

export type StartupOrigin =
  'hkcu-run' | 'hklm-run' | 'startup-folder' | 'scheduled-task' | 'service' | 'unknown';

export type SignatureStatus = 'signed' | 'unsigned' | 'not-verifiable' | 'unknown';

export interface StartupSignals {
  /** Where the entry is registered (persistence scope). */
  origin: StartupOrigin;
  /** Raw launch command as stored by Windows. */
  command: string;
  /** Absolute executable path resolved from the command, when determinable. */
  exePath: string | null;
  /** Whether `exePath` currently exists on disk. */
  binaryExists: boolean;
  /** Authenticode status of the target binary. */
  signature: SignatureStatus;
  /** CN subject of the signer, when signed. */
  signer: string | null;
  /** Whether the binary lives under a protected system location. */
  underSystemPath: boolean;
  /** Whether a process backed by `exePath` is running right now. */
  running: boolean;
  /** Total CPU seconds consumed by that process (live measurement). */
  cpuSeconds: number | null;
  /** Working set of that process in MB (live measurement). */
  memoryMb: number | null;
  /** Display name used ONLY for generic grammar tokens, never product lookup. */
  name: string;
}

export interface StartupAssessment {
  impact: StartupImpact;
  /** Transparent score; thresholds are documented and testable. */
  score: number;
  /** Human-readable list of the signals that contributed. */
  reasons: string[];
  /** Best-effort publisher from the code signature; `Unknown` when unsigned. */
  publisher: string;
}

/**
 * Product-agnostic background grammar. These are common software *shapes*
 * (updaters, helpers, tray agents, sync engines, launchers), not products.
 */
export const GENERIC_BACKGROUND_TOKENS = [
  'update',
  'updater',
  'helper',
  'tray',
  'sync',
  'launcher',
  'daemon',
  'watchdog',
  'background',
] as const;

/** Score thresholds: >=6 high, >=3 medium, else low. */
export const IMPACT_HIGH_THRESHOLD = 6;
export const IMPACT_MEDIUM_THRESHOLD = 3;

/** Map a raw `Get-AuthenticodeSignature` status to our normalized enum. */
export function normalizeSignatureStatus(raw: string | null | undefined): SignatureStatus {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'valid') return 'signed';
  if (value === 'notsigned') return 'unsigned';
  if (!value) return 'unknown';
  // UnknownError, NotTrusted, HashMismatch, NotSupported, Incompatible, ...
  return 'not-verifiable';
}

/** Derive the persistence scope from the location string reported by Windows. */
export function originFromLocation(location: string | null | undefined): StartupOrigin {
  const value = (location ?? '').toLowerCase();
  if (!value) return 'unknown';
  if (value.includes('scheduledtask')) return 'scheduled-task';
  if (value.startsWith('service') || value.includes(':service')) return 'service';
  if (value.includes('hklm')) return 'hklm-run';
  if (value.includes('hkcu')) return 'hkcu-run';
  if (value.includes('startup')) return 'startup-folder';
  return 'unknown';
}

/**
 * Resolve the executable path from a raw Windows launch command. Handles the
 * three shapes Windows actually stores: quoted paths, bare paths, and bare
 * paths followed by arguments. Returns null when no `.exe`/binary can be found.
 */
export function decodeExecutablePath(command: string | null | undefined): string | null {
  const raw = (command ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('"')) {
    const end = raw.indexOf('"', 1);
    if (end > 1) return raw.slice(1, end);
  }
  const first = raw.split(/\s+/)[0]?.replace(/^"|"$/g, '');
  if (first && /\.(exe|com|bat|cmd|ps1)$/i.test(first)) return first;
  const match = /([a-z]:\\[^"]+?\.(?:exe|com|bat|cmd|ps1))/i.exec(raw);
  return match?.[1] ?? null;
}

function footprintScore(signals: StartupSignals, reasons: string[]): number {
  let score = 0;
  if (!signals.running) return score;

  score += 1;
  reasons.push('process is running right now');

  const cpu = signals.cpuSeconds;
  if (cpu !== null && Number.isFinite(cpu)) {
    if (cpu >= 300) {
      score += 3;
      reasons.push(`measured CPU time ${Math.round(cpu)} s`);
    } else if (cpu >= 60) {
      score += 2;
      reasons.push(`measured CPU time ${Math.round(cpu)} s`);
    } else if (cpu >= 5) {
      score += 1;
      reasons.push(`measured CPU time ${Math.round(cpu)} s`);
    }
  }

  const mem = signals.memoryMb;
  if (mem !== null && Number.isFinite(mem)) {
    if (mem >= 300) {
      score += 2;
      reasons.push(`measured working set ${Math.round(mem)} MB`);
    } else if (mem >= 100) {
      score += 1;
      reasons.push(`measured working set ${Math.round(mem)} MB`);
    }
  }

  return score;
}

/**
 * Classify a startup entry from its observable signals. Pure and deterministic:
 * identical signals always yield the same assessment, regardless of the name.
 */
export function classifyStartupImpact(signals: StartupSignals): StartupAssessment {
  const reasons: string[] = [];
  let score = 0;

  // 1. Persistence scope.
  switch (signals.origin) {
    case 'hklm-run':
      score += 1;
      reasons.push('starts for every user (HKLM Run)');
      break;
    case 'scheduled-task':
      score += 2;
      reasons.push('registered as a scheduled task');
      break;
    case 'service':
      score += 3;
      reasons.push('runs as a background service');
      break;
    default:
      break;
  }

  // 2. Protected system location.
  if (signals.underSystemPath) {
    score += 1;
    reasons.push('lives under a protected system location');
  }

  // 3. Code signature (only meaningful when the binary exists).
  if (signals.binaryExists) {
    if (signals.signature === 'unsigned') {
      score += 3;
      reasons.push('target binary is unsigned');
    } else if (signals.signature === 'not-verifiable') {
      score += 1;
      reasons.push('target signature could not be verified');
    }
  } else if (signals.exePath) {
    reasons.push('target binary was not found on disk');
  }

  // 4. Live, measured footprint (the machine-specific signal).
  score += footprintScore(signals, reasons);

  // 5. Generic background grammar (weak, product-agnostic).
  const lowerName = signals.name.toLowerCase();
  const token = GENERIC_BACKGROUND_TOKENS.find((candidate) => lowerName.includes(candidate));
  if (token) {
    score += 1;
    reasons.push(`name matches the generic "${token}" background pattern`);
  }

  const impact: StartupImpact =
    score >= IMPACT_HIGH_THRESHOLD ? 'high' : score >= IMPACT_MEDIUM_THRESHOLD ? 'medium' : 'low';

  if (reasons.length === 0) reasons.push('no impacting signals were observed');

  const publisher = signals.signer && signals.signer.trim() ? signals.signer.trim() : 'Unknown';

  return { impact, score, reasons, publisher };
}
