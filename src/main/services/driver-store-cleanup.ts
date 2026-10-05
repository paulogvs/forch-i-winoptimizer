import {
  runPowerShellScript,
  parsePowerShellJson,
  toArray,
  type PowerShellResult,
} from './powershell';
import { readBundledCatalog } from './catalog-data';
import { isElevated } from './security-fix';
import type {
  DriverStoreCandidate,
  DriverStoreCleanResult,
  DriverStorePackage,
  DriverStorePackageResult,
  DriverStorePreview,
} from '@shared/driver-store';

/**
 * Driver Store cleanup (Fase 4.1).
 *
 * Detects **superseded** driver packages (`pnputil /enum-drivers`) and removes
 * only those with `pnputil /delete-driver <oem#.inf> /uninstall`, after an
 * explicit preview. Safety rules, all data-driven where possible:
 *
 *  - identity is `original INF + provider` (Kudu's `driverIdentityKey`), so two
 *    different devices from the same vendor are never confused;
 *  - versions are compared NUMERICALLY (never lexicographically);
 *  - only strictly-older packages of the same identity are candidates;
 *  - packages currently bound to a device are never touched;
 *  - virtual/shim drivers (Tailscale/Wintun/WireGuard/Hyper-V…) are excluded;
 *  - only `oemNN.inf` names can ever be deleted.
 *
 * Nothing here runs a real deletion in the test suite: `run` is injectable.
 */

export interface DriverStoreRules {
  virtualPatterns: string[];
}

/** Fallback only used when the bundled rules file is missing/corrupt. */
const DEFAULT_VIRTUAL_PATTERNS = ['tailscale', 'wintun', 'wireguard', 'hyper-v', 'hyperv'];

let cachedRules: DriverStoreRules | null | undefined;

function parseRules(raw: unknown): DriverStoreRules | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = (raw as { virtualPatterns?: unknown }).virtualPatterns;
  const patterns = Array.isArray(value)
    ? value.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
  if (patterns.length === 0) return null;
  return { virtualPatterns: patterns };
}

/** Load the driver store safety rules from data (cached per process). */
export function loadDriverStoreRules(): DriverStoreRules {
  if (cachedRules !== undefined)
    return cachedRules ?? { virtualPatterns: DEFAULT_VIRTUAL_PATTERNS };
  const parsed = parseRules(readBundledCatalog<unknown>('driver-store-rules.json'));
  cachedRules = parsed;
  return parsed ?? { virtualPatterns: DEFAULT_VIRTUAL_PATTERNS };
}

/** Test seam: drop the cached rules so a fresh file is re-read. */
export function resetDriverStoreRulesCache(): void {
  cachedRules = undefined;
}

// ---------------------------------------------------------------------------
// pnputil parser (locale-independent)
//
// `pnputil /enum-drivers` output is LOCALIZED and its field labels change with
// the Windows display language (e.g. Spanish "Nombre publicado"). The parser
// therefore never keys on the labels for the first three fields: the block
// order is fixed (Published Name, Original Name, Provider Name, …) and only
// those three are read positionally. Remaining fields are matched by an
// ASCII anchor that survives non-UTF8 mojibake ("controlador"/"firmante"/…).
// ---------------------------------------------------------------------------

interface FieldEntry {
  label: string;
  value: string;
}

/** Extract MM/DD/YYYY from a "date version" field value. */
export function extractDriverDate(fieldValue: string): string {
  const match = /^(\d{2}\/\d{2}\/\d{4})/.exec(fieldValue.trim());
  return match?.[1] ?? '';
}

/** Extract the trailing dotted version from a "date version" field value. */
export function extractDriverVersion(fieldValue: string): string {
  const match = /(\d+(?:\.\d+){1,3})\s*$/.exec(fieldValue.trim());
  return match?.[1] ?? fieldValue.trim();
}

function parseBlockEntries(block: string): FieldEntry[] {
  const entries: FieldEntry[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue; // header / continuation line (e.g. "Attested")
    const label = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!label || !value) continue;
    entries.push({ label, value });
  }
  return entries;
}

/** Parse the raw text of `pnputil /enum-drivers` into packages. */
export function parsePnputilEnumDrivers(output: string): DriverStorePackage[] {
  const normalized = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  const packages: DriverStorePackage[] = [];

  for (const block of blocks) {
    const entries = parseBlockEntries(block);
    if (entries.length < 3) continue;

    // Fixed order: [0] published, [1] original, [2] provider.
    const published = entries[0]?.value ?? '';
    const original = entries[1]?.value ?? '';
    const provider = entries[2]?.value ?? '';
    if (!/\.inf$/i.test(published) || !/\.inf$/i.test(original)) continue;

    const driverVersionEntry = entries.find(
      (e) => /controlador/i.test(e.label) || /driver\s*version/i.test(e.label)
    );
    const classEntry = entries.find((e) => {
      const l = e.label.toLowerCase();
      return (
        (l.includes('clase') || l.includes('class')) &&
        !l.includes('guid') &&
        !/versi|version/.test(l)
      );
    });
    const signerEntry = entries.find((e) => /firmante/i.test(e.label) || /signer/i.test(e.label));

    const versionField = driverVersionEntry?.value ?? '';
    packages.push({
      publishedName: published,
      originalName: original,
      provider,
      className: classEntry?.value ?? '',
      version: extractDriverVersion(versionField),
      date: extractDriverDate(versionField),
      signer: signerEntry?.value ?? '',
      sizeBytes: null,
    });
  }
  return packages;
}

// ---------------------------------------------------------------------------
// Pure selection logic
// ---------------------------------------------------------------------------

/** Parse a dotted version into numeric parts, or null when not numeric. */
export function parseDriverVersion(version: string): number[] | null {
  const trimmed = version.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('.');
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    nums.push(Number(part));
  }
  return nums.length > 0 ? nums : null;
}

/** Numeric version comparison. Returns >0 when a is newer, <0 when older, 0 equal. */
export function compareDriverVersions(a: string, b: string): number {
  const va = parseDriverVersion(a);
  const vb = parseDriverVersion(b);
  if (!va && !vb) return 0;
  if (!va) return -1;
  if (!vb) return 1;
  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i++) {
    const na = va[i] ?? 0;
    const nb = vb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** Identity of a driver package: original INF + provider (case-insensitive). */
export function driverIdentityKey(
  pkg: Pick<DriverStorePackage, 'originalName' | 'provider'>
): string {
  const original = pkg.originalName.trim().toLowerCase();
  const provider = pkg.provider.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${original}|${provider}`;
}

/** True when the package is a virtual/shim driver that must never be removed. */
export function isVirtualDriver(
  pkg: Pick<DriverStorePackage, 'provider' | 'originalName' | 'className'>,
  patterns: readonly string[] = loadDriverStoreRules().virtualPatterns
): boolean {
  const haystack = `${pkg.provider} ${pkg.originalName} ${pkg.className}`.toLowerCase();
  return patterns.some((p) => p.length > 0 && haystack.includes(p.toLowerCase()));
}

/** True only for a deletable published name (`oemNN.inf`). */
export function isOemInfName(name: string): boolean {
  return /^oem\d+\.inf$/i.test(name.trim());
}

export interface RepositoryEntry {
  name: string;
  size: number;
}

/** Sum the real FileRepository folder sizes matching an original INF name. */
export function sumPackageSize(originalName: string, entries: readonly RepositoryEntry[]): number {
  const base = originalName.trim().toLowerCase();
  if (!base) return 0;
  let total = 0;
  for (const entry of entries) {
    if (entry.name.toLowerCase().startsWith(base) && Number.isFinite(entry.size)) {
      total += Math.max(0, entry.size);
    }
  }
  return total;
}

export interface SelectOptions {
  virtualPatterns?: readonly string[];
  repositoryEntries?: readonly RepositoryEntry[];
}

/**
 * Select the packages that may be removed: strictly-superseded, not currently
 * bound to a device, not virtual. Pure and deterministic.
 */
export function selectSupersededPackages(
  packages: readonly DriverStorePackage[],
  boundInfNames: readonly string[],
  options: SelectOptions = {}
): DriverStoreCandidate[] {
  const patterns = options.virtualPatterns ?? loadDriverStoreRules().virtualPatterns;
  const bound = new Set(boundInfNames.map((n) => n.trim().toLowerCase()));
  const entries = options.repositoryEntries;

  const sized = packages.map((pkg) => ({
    ...pkg,
    sizeBytes: entries ? sumPackageSize(pkg.originalName, entries) : pkg.sizeBytes,
  }));

  const groups = new Map<string, DriverStorePackage[]>();
  for (const pkg of sized) {
    if (isVirtualDriver(pkg, patterns)) continue;
    const key = driverIdentityKey(pkg);
    const list = groups.get(key);
    if (list) list.push(pkg);
    else groups.set(key, [pkg]);
  }

  const candidates: DriverStoreCandidate[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const newest = [...group].sort((a, b) => compareDriverVersions(b.version, a.version))[0]!;
    for (const pkg of group) {
      if (pkg === newest) continue;
      if (compareDriverVersions(pkg.version, newest.version) >= 0) continue; // not strictly older
      if (bound.has(pkg.publishedName.trim().toLowerCase())) continue; // in use
      candidates.push({
        ...pkg,
        identityKey: key,
        supersededBy: { publishedName: newest.publishedName, version: newest.version },
        reason: 'superseded',
      });
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Live scan (read-only)
// ---------------------------------------------------------------------------

interface RawStoreScan {
  pnputil?: string;
  repository?: { name?: string; size?: number }[];
  boundInfs?: string[];
}

/** PowerShell: enumerate driver packages, repository sizes and bound INFs (READ-ONLY). */
export function buildDriverStoreScanScript(): string {
  return `
    $pnputil = '';
    try { $pnputil = (& pnputil.exe /enum-drivers 2>&1 | Out-String) } catch { $pnputil = '' }
    $repo = 'C:\\Windows\\System32\\DriverStore\\FileRepository';
    $repository = @();
    if (Test-Path -LiteralPath $repo) {
      foreach ($dir in (Get-ChildItem -LiteralPath $repo -Directory -ErrorAction SilentlyContinue)) {
        $size = 0;
        try {
          $sum = (Get-ChildItem -LiteralPath $dir.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum;
          if ($null -ne $sum) { $size = [long]$sum }
        } catch { $size = 0 }
        $repository += @{ name = $dir.Name; size = $size }
      }
    }
    $boundInfs = @();
    try {
      $boundInfs = @(Get-CimInstance -ClassName Win32_PnPSignedDriver -ErrorAction SilentlyContinue | ForEach-Object { $_.InfName } | Where-Object { $_ })
    } catch { $boundInfs = @() }
    @{
      pnputil = $pnputil
      repository = @($repository)
      boundInfs = @($boundInfs)
    } | ConvertTo-Json -Depth 4 -Compress
  `;
}

export interface DriverStoreDeps {
  /** Test seam: PowerShell runner. Defaults to `runPowerShellScript` (120s). */
  run?: (script: string) => Promise<PowerShellResult>;
  /** Test seam: elevation check. Defaults to the live `isElevated()`. */
  isAdmin?: () => Promise<boolean>;
  now?: () => number;
  loadRules?: () => DriverStoreRules;
}

function emptyPreview(
  status: DriverStorePreview['status'],
  isAdmin: boolean,
  message: string,
  scannedAt: string
): DriverStorePreview {
  return {
    success: false,
    status,
    isAdmin,
    canApply: false,
    packages: [],
    candidates: [],
    totalPackages: 0,
    reclaimableCount: 0,
    reclaimableBytes: 0,
    message,
    scannedAt,
  };
}

/**
 * Read-only preview of what the Driver Store cleanup WOULD remove. Runs a real
 * `pnputil /enum-drivers` (never a deletion).
 */
export async function previewDriverStoreCleanup(
  deps: DriverStoreDeps = {}
): Promise<DriverStorePreview> {
  const run = deps.run ?? runPowerShellScript;
  const now = new Date(deps.now ? deps.now() : Date.now());
  const scannedAt = now.toISOString();

  const checkAdmin = deps.isAdmin ?? isElevated;
  let admin = false;
  try {
    admin = await checkAdmin();
  } catch {
    admin = false;
  }

  const result = await run(buildDriverStoreScanScript());
  if (!result.success || !result.stdout) {
    return emptyPreview(
      admin ? 'unavailable' : 'requires-admin',
      admin,
      admin
        ? `Could not enumerate the Driver Store: ${result.stderr || 'the scan did not run'}.`
        : 'Administrator rights are required to inspect and clean the Driver Store. Restart the app as administrator.',
      scannedAt
    );
  }

  const raw = parsePowerShellJson<RawStoreScan>(result.stdout);
  if (!raw) {
    return emptyPreview(
      'unavailable',
      admin,
      'Could not parse the Driver Store enumeration output.',
      scannedAt
    );
  }

  const packages = parsePnputilEnumDrivers(raw.pnputil ?? '');
  const repository: RepositoryEntry[] = toArray(raw.repository)
    .filter((e): e is { name: string; size: number } => typeof e?.name === 'string')
    .map((e) => ({ name: e.name, size: typeof e.size === 'number' ? e.size : 0 }));
  const boundInfs = toArray(raw.boundInfs).filter((n): n is string => typeof n === 'string');

  const rules = (deps.loadRules ?? loadDriverStoreRules)();
  const candidates = selectSupersededPackages(packages, boundInfs, {
    virtualPatterns: rules.virtualPatterns,
    repositoryEntries: repository,
  });
  const reclaimableBytes = candidates.reduce((sum, c) => sum + (c.sizeBytes ?? 0), 0);

  const status: DriverStorePreview['status'] = admin ? 'ok' : 'requires-admin';
  const message =
    candidates.length > 0
      ? `${candidates.length} superseded driver package(s) can be removed (${formatBytes(
          reclaimableBytes
        )}).`
      : 'No superseded driver packages were found.';

  return {
    success: true,
    status,
    isAdmin: admin,
    canApply: admin && candidates.length > 0,
    packages,
    candidates,
    totalPackages: packages.length,
    reclaimableCount: candidates.length,
    reclaimableBytes,
    message,
    scannedAt,
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

interface DeletionResult {
  ok: boolean;
  message: string;
}

function parseDeleteOutput(text: string): DeletionResult {
  const trimmed = text.trim();
  if (/error|no se pudo|failed|denied|access is denied/i.test(trimmed)) {
    return { ok: false, message: trimmed || 'Deletion failed.' };
  }
  if (/deleted|removed|eliminado|correctamente|successfully/i.test(trimmed)) {
    return { ok: true, message: trimmed };
  }
  return { ok: false, message: trimmed || 'Unknown deletion result.' };
}

/**
 * Delete the selected superseded packages with `pnputil /delete-driver`, then
 * RE-SCAN to verify each one is actually gone. Success is only reported for
 * packages confirmed absent after the operation.
 */
export async function applyDriverStoreCleanup(
  candidates: readonly DriverStoreCandidate[],
  deps: DriverStoreDeps = {}
): Promise<DriverStoreCleanResult> {
  const run = deps.run ?? runPowerShellScript;
  const cleanedAt = new Date(deps.now ? deps.now() : Date.now()).toISOString();
  const list = Array.isArray(candidates) ? candidates : [];

  const checkAdmin = deps.isAdmin ?? isElevated;
  let admin = false;
  try {
    admin = await checkAdmin();
  } catch {
    admin = false;
  }
  if (!admin) {
    return {
      success: false,
      status: 'requires-admin',
      requested: list.length,
      removed: 0,
      failed: 0,
      message:
        'Administrator rights are required to remove driver packages. Restart the app as administrator.',
      results: [],
      cleanedAt,
    };
  }
  if (list.length === 0) {
    return {
      success: true,
      status: 'nothing-to-do',
      requested: 0,
      removed: 0,
      failed: 0,
      message: 'No superseded driver packages were selected.',
      results: [],
      cleanedAt,
    };
  }

  const results: DriverStorePackageResult[] = [];
  for (const candidate of list) {
    if (!isOemInfName(candidate.publishedName)) {
      results.push({
        publishedName: candidate.publishedName,
        originalName: candidate.originalName,
        status: 'skipped',
        verified: false,
        message: 'Refused: only oemNN.inf published names can be removed.',
      });
      continue;
    }
    const del = await run(`& pnputil.exe /delete-driver '${candidate.publishedName}' /uninstall`);
    const parsed = parseDeleteOutput(`${del.stdout}\n${del.stderr}`);
    results.push({
      publishedName: candidate.publishedName,
      originalName: candidate.originalName,
      status: parsed.ok ? 'removed' : 'failed',
      verified: false,
      message: parsed.message,
    });
  }

  // Post-clean re-scan: a removal is only "removed" when the package is gone.
  // Skip it entirely when nothing was actually attempted (all skipped).
  const attempted = results.some((r) => r.status === 'removed' || r.status === 'failed');
  if (attempted) {
    const verify = await run(buildDriverStoreScanScript());
    const verifyRaw = parsePowerShellJson<RawStoreScan>(verify.stdout);
    const remaining = new Set(
      (verifyRaw?.pnputil ? parsePnputilEnumDrivers(verifyRaw.pnputil) : []).map((p) =>
        p.publishedName.toLowerCase()
      )
    );
    for (const r of results) {
      if (r.status === 'removed') {
        r.verified = !remaining.has(r.publishedName.toLowerCase());
        if (!r.verified) {
          r.status = 'failed';
          r.message = `${r.message} (still present after cleanup)`;
        }
      }
    }
  }

  const removed = results.filter((r) => r.status === 'removed' && r.verified).length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const success = failed === 0 && removed === list.length - skipped;

  return {
    success,
    status: success ? 'completed' : 'failed',
    requested: list.length,
    removed,
    failed,
    message: success
      ? `Removed and verified ${removed} driver package(s).`
      : `Removed ${removed} of ${list.length}; ${failed} failed.`,
    results,
    cleanedAt,
  };
}
