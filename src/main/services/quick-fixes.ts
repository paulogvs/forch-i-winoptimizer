import { scanForJunkFiles, deleteJunkFiles, type JunkCategory } from './junk-scanner';
import { parsePowerShellJson, runPowerShell } from './powershell';
import { createNoopReporter, type ScanProgressReporter } from './scan-progress';

/**
 * Quick fixes (Fase 3): the 1-click utilities behind the dashboard/tools bar.
 *
 * Golden rule (unchanged): no operation reports success without verifying the
 * real effect. Clean Temp re-reads which paths are gone and only counts those
 * as freed; Flush DNS re-reads the resolver cache and reports the measured
 * delta instead of trusting the command's exit code alone.
 */

/**
 * Categories whose entries are always flagged `safeToDelete` in the scanner.
 * A quick clean never touches Windows Update downloads or the Recycle Bin —
 * both are excluded from the scan scope AND filtered again per file below.
 */
export const SAFE_CLEAN_CATEGORIES: readonly JunkCategory[] = [
  'temp',
  'cache',
  'logs',
  'thumbnails',
  'browser-cache',
];

export interface QuickCleanResult {
  success: boolean;
  /** Safe files that were candidates (after the safeToDelete filter). */
  scanned: number;
  /** Bytes of those candidates before deletion. */
  scannedBytes: number;
  /** Paths the OS confirmed removed. */
  deleted: number;
  /** Bytes actually freed (sum only of confirmed-removed paths). */
  freedBytes: number;
  failed: number;
  errors: string[];
  message: string;
}

function mb(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} MB`;
}

/**
 * One-click "Clean Temp": scans ONLY the safe categories, deletes ONLY files
 * the scanner flagged `safeToDelete`, and reports the real outcome — including
 * failures (never hidden). Files outside the safe set are structurally unable
 * to reach `deleteJunkFiles`.
 */
export async function cleanTempQuick(reporter?: ScanProgressReporter): Promise<QuickCleanResult> {
  const progress = reporter ?? createNoopReporter('junk');

  const scan = await scanForJunkFiles(progress, { categories: SAFE_CLEAN_CATEGORIES });

  // Two independent guards: the scan is scoped to safe categories, and each
  // file must additionally carry `safeToDelete` (defence in depth: even if the
  // scanner later adds an unsafe category, nothing unsafe can be deleted here).
  const eligible = scan.files.filter(
    (file) => file.safeToDelete === true && SAFE_CLEAN_CATEGORIES.includes(file.category)
  );

  if (eligible.length === 0) {
    progress.done('Nothing safe to clean');
    return {
      success: true,
      scanned: 0,
      scannedBytes: 0,
      deleted: 0,
      freedBytes: 0,
      failed: 0,
      errors: [],
      message: 'No safe temporary files found.',
    };
  }

  const sizeByPath = new Map(eligible.map((file) => [file.path, file.size]));
  const scannedBytes = eligible.reduce((sum, file) => sum + file.size, 0);

  const result = await deleteJunkFiles(eligible.map((file) => file.path));
  const removed = result.removed ?? [];
  const freedBytes = removed.reduce((sum, path) => sum + (sizeByPath.get(path) ?? 0), 0);
  const deleted = removed.length;
  const success = result.failed === 0;

  progress.report(success ? 'done' : 'error', 100, 'Clean complete');

  const message = success
    ? deleted === 0
      ? 'Nothing to delete (the files were already gone).'
      : `Cleaned ${deleted} file(s), freed ${mb(freedBytes)}.`
    : `Cleaned ${deleted} file(s), freed ${mb(freedBytes)} — ${result.failed} could not be deleted.`;

  return {
    success,
    scanned: eligible.length,
    scannedBytes,
    deleted,
    freedBytes,
    failed: result.failed,
    errors: result.errors,
    message,
  };
}

export interface FlushDnsResult {
  success: boolean;
  /** Resolver cache entries measured BEFORE the flush. */
  entriesBefore: number;
  /** Resolver cache entries re-read AFTER the flush. */
  entriesAfter: number;
  message: string;
}

interface FlushDnsPayload {
  exitCode?: number;
  before?: number;
  after?: number;
  verified?: boolean;
  output?: string;
}

/**
 * One-click "Flush DNS": runs `ipconfig /flushdns` and VERIFIES the real
 * effect by measuring the resolver cache before and after. Success requires
 * the command's exit code to be 0 AND the cache not to have grown.
 */
export async function flushDns(): Promise<FlushDnsResult> {
  const script = `
    $before = @(Get-DnsClientCache -ErrorAction SilentlyContinue | Measure-Object).Count;
    $out = (& ipconfig /flushdns 2>&1 | Out-String).Trim();
    $code = $LASTEXITCODE;
    $after = @(Get-DnsClientCache -ErrorAction SilentlyContinue | Measure-Object).Count;
    $verified = ($code -eq 0) -and (($after -le $before) -or ($before -eq 0));
    @{ exitCode = [int]$code; before = [int]$before; after = [int]$after; verified = [bool]$verified; output = $out } | ConvertTo-Json -Compress
  `;

  const result = await runPowerShell(script).catch(() => null);
  const payload = result?.success ? parsePowerShellJson<FlushDnsPayload>(result.stdout) : null;

  const entriesBefore = Number(payload?.before ?? 0);
  const entriesAfter = Number(payload?.after ?? 0);
  const verified = payload?.verified === true;

  if (!result?.success || !payload || !verified) {
    return {
      success: false,
      entriesBefore,
      entriesAfter,
      message: `Failed to flush the DNS cache: ${
        payload?.output || result?.stderr?.trim() || 'the flush was not confirmed'
      }`,
    };
  }

  return {
    success: true,
    entriesBefore,
    entriesAfter,
    message: `DNS cache flushed (${entriesBefore} → ${entriesAfter} entries).`,
  };
}
