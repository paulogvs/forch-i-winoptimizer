import * as fs from 'fs';
import { runPowerShellScript, parsePowerShellJsonArray } from './powershell';
import { resolveBundledPath } from '../source-updater/paths';

/**
 * Bloatware removal (P1.4).
 *
 * The curated catalog (`catalogs/apps-catalog.json`) is the ONLY source of
 * removable packages: the renderer sends catalog ids, never package names, and
 * every id / package name is validated against a strict grammar before it can
 * reach a PowerShell command line. Protected entries are refused server-side
 * even if the UI guard is bypassed.
 */

export interface BloatwareApp {
  id: string;
  name: string;
  publisher: string;
  category: string;
  protection: 'safe' | 'caution' | 'protected';
  description: string;
  /** UWP package base name, e.g. `Microsoft.BingNews`. */
  uninstallString: string;
  size: string;
  source: string;
}

export interface DebloatCandidate extends BloatwareApp {
  installed: boolean;
}

export interface DebloatItemResult {
  id: string;
  name: string;
  status: 'removed' | 'skipped' | 'failed' | 'protected';
  error?: string;
}

export interface DebloatResult {
  success: boolean;
  removed: number;
  skipped: number;
  failed: number;
  /** Protected entries refused by the server-side guard. */
  refused: number;
  message: string;
  results: DebloatItemResult[];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PROTECTIONS = new Set(['safe', 'caution', 'protected']);

export function isValidCatalogId(id: string): boolean {
  return ID_PATTERN.test(id);
}

function isValidEntry(entry: unknown): entry is BloatwareApp {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    isValidCatalogId(e.id) &&
    typeof e.name === 'string' &&
    e.name.length > 0 &&
    typeof e.description === 'string' &&
    e.description.length > 0 &&
    typeof e.uninstallString === 'string' &&
    ID_PATTERN.test(e.uninstallString) &&
    typeof e.protection === 'string' &&
    PROTECTIONS.has(e.protection)
  );
}

/**
 * Read and validate the bundled bloatware catalog. Invalid entries are
 * dropped (never interpolated) and a missing/corrupt file yields [].
 */
export async function loadBloatwareCatalog(): Promise<BloatwareApp[]> {
  const file = resolveBundledPath('catalogs', 'apps-catalog.json');
  if (!file) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { apps?: unknown };
    if (!Array.isArray(parsed.apps)) return [];
    return parsed.apps.filter(isValidEntry);
  } catch {
    return [];
  }
}

/**
 * Catalog entries enriched with an `installed` flag from a single
 * `Get-AppxPackage` query. On PowerShell failure everything reports as not
 * installed; removal re-checks per package anyway, so this stays safe.
 */
export async function getDebloatCandidates(): Promise<DebloatCandidate[]> {
  const catalog = await loadBloatwareCatalog();
  const run = await runPowerShellScript(
    'Get-AppxPackage | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'
  );
  const names = new Set(
    run.success
      ? parsePowerShellJsonArray<string>(run.stdout).map((n) => String(n).toLowerCase())
      : []
  );
  return catalog.map((entry) => ({
    ...entry,
    installed: names.has(entry.uninstallString.toLowerCase()),
  }));
}

/**
 * Build the removal script. `packages` are pre-validated catalog names only:
 * the pattern excludes quotes, `$`, backticks and separators, so the
 * single-quoted interpolation cannot be broken out of.
 */
function buildRemovalScript(packages: string[]): string {
  const list = packages.map((p) => `'${p}'`).join(',');
  return `
    $targets = @(${list});
    $result = @();
    foreach ($t in $targets) {
      $before = @(Get-AppxPackage -Name $t -ErrorAction SilentlyContinue);
      if ($before.Count -eq 0) {
        $result += @{ Name = $t; Status = 'skipped' };
        continue;
      }
      $removeError = '';
      foreach ($pkg in $before) {
        try {
          Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop;
        } catch {
          $removeError = $_.Exception.Message;
        }
      }
      $after = @(Get-AppxPackage -Name $t -ErrorAction SilentlyContinue);
      if ($after.Count -eq 0) {
        $result += @{ Name = $t; Status = 'removed' };
      } elseif ($removeError -ne '') {
        $result += @{ Name = $t; Status = 'failed'; Error = $removeError };
      } else {
        $result += @{ Name = $t; Status = 'failed' };
      }
    }
    $result | ConvertTo-Json -Compress;
  `;
}

/**
 * Remove catalog-listed UWP packages for the current user.
 *
 * Guards (server-side, in order):
 *  1. Every id must exist in the bundled catalog (unknown/injected -> failed,
 *     no PowerShell).
 *  2. `protected` entries are refused outright.
 *  3. Package names are re-validated against the grammar before interpolation.
 *  4. Duplicate ids are collapsed to a single removal.
 */
export async function removeBloatware(ids: string[]): Promise<DebloatResult> {
  const catalog = await loadBloatwareCatalog();
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const results: DebloatItemResult[] = [];
  const targets: BloatwareApp[] = [];
  const seen = new Set<string>();

  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw : '';
    const entry = id && isValidCatalogId(id) ? byId.get(id) : undefined;

    if (!entry) {
      results.push({
        id: id || '(empty)',
        name: id || '(empty)',
        status: 'failed',
        error: 'Unknown bloatware id',
      });
      continue;
    }
    if (entry.protection === 'protected') {
      results.push({ id: entry.id, name: entry.name, status: 'protected', error: 'Protected app' });
      continue;
    }
    if (!ID_PATTERN.test(entry.uninstallString)) {
      results.push({
        id: entry.id,
        name: entry.name,
        status: 'failed',
        error: 'Invalid package name',
      });
      continue;
    }
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    targets.push(entry);
  }

  if (targets.length > 0) {
    const run = await runPowerShellScript(
      buildRemovalScript(targets.map((t) => t.uninstallString))
    );
    const parsed = run.success
      ? parsePowerShellJsonArray<{ Name?: string; Status?: string; Error?: string }>(run.stdout)
      : [];
    const byName = new Map(parsed.map((r) => [String(r.Name ?? '').toLowerCase(), r] as const));

    for (const target of targets) {
      const entry = byName.get(target.uninstallString.toLowerCase());
      if (!entry) {
        results.push({
          id: target.id,
          name: target.name,
          status: 'failed',
          error: run.success ? 'No result reported' : 'PowerShell failed',
        });
        continue;
      }
      const status: DebloatItemResult['status'] =
        entry.Status === 'removed' ? 'removed' : entry.Status === 'skipped' ? 'skipped' : 'failed';
      results.push({
        id: target.id,
        name: target.name,
        status,
        ...(entry.Error ? { error: entry.Error } : {}),
      });
    }
  }

  const removed = results.filter((r) => r.status === 'removed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const refused = results.filter((r) => r.status === 'protected').length;

  let message: string;
  if (targets.length === 0) {
    message =
      refused > 0
        ? `Nothing to remove: ${refused} protected app(s) refused.`
        : 'No removable apps selected.';
  } else {
    const parts = [`Removed ${removed} app(s)`];
    if (skipped > 0) parts.push(`${skipped} not installed`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (refused > 0) parts.push(`${refused} protected refused`);
    message = parts.join(', ') + '.';
  }

  return {
    success: removed > 0,
    removed,
    skipped,
    failed,
    refused,
    message,
    results,
  };
}
