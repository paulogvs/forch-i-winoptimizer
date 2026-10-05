import { CategoryScanCache } from './cache';
import {
  type JunkDeleteResult,
  type JunkFile,
  type JunkScanOptions,
  type JunkScanResult,
} from './junk-scanner';
import type { ScanProgressReporter } from './scan-progress';

/**
 * Junk scan session (Fase 4.3).
 *
 * Wraps `CategoryScanCache` with the cleaner's semantics: a scan populates the
 * per-category cache, a clean removes exactly the confirmed paths from the
 * cache, and a subsequent clean of the same scope is served WITHOUT re-running
 * PowerShell. Scope = category set + exclude paths, so a different scan scope
 * forces a real scan.
 *
 * Fully injectable (`scanFn`/`deleteFn`) so it is unit-testable with zero
 * PowerShell.
 */

export type JunkScanFn = (
  reporter: ScanProgressReporter | undefined,
  options: JunkScanOptions
) => Promise<JunkScanResult>;

export type JunkDeleteFn = (paths: string[]) => Promise<JunkDeleteResult>;

/** Stable identity of a scan request (categories + excludes, order-independent). */
export function scopeKey(options: JunkScanOptions = {}): string {
  const categories = [...(options.categories ?? [])].sort().join('|');
  const excludes = [...(options.excludePaths ?? [])]
    .map((p) => p.trim().toLowerCase())
    .sort()
    .join('|');
  return `${categories}::${excludes}`;
}

function emptyCategories(): JunkScanResult['categories'] {
  return {
    temp: { count: 0, size: 0 },
    cache: { count: 0, size: 0 },
    logs: { count: 0, size: 0 },
    thumbnails: { count: 0, size: 0 },
    'recycle-bin': { count: 0, size: 0 },
    'browser-cache': { count: 0, size: 0 },
    'windows-update': { count: 0, size: 0 },
  };
}

/** Recompute totals/categories after files were removed from the cached result. */
export function recomputeJunkResult(files: JunkFile[]): JunkScanResult {
  const categories = emptyCategories();
  let totalSize = 0;
  for (const file of files) {
    if (categories[file.category]) {
      categories[file.category].count++;
      categories[file.category].size += file.size;
    }
    totalSize += file.size;
  }
  return { files, totalSize, totalCount: files.length, categories };
}

export class JunkScanSession {
  private scope: string | null = null;
  private result: JunkScanResult | null = null;

  constructor(
    private readonly cache: CategoryScanCache<JunkFile> = new CategoryScanCache<JunkFile>()
  ) {}

  get lastResult(): JunkScanResult | null {
    return this.result;
  }

  get cacheSize(): number {
    return this.cache.size();
  }

  get scanCache(): CategoryScanCache<JunkFile> {
    return this.cache;
  }

  /** True when a fresh scan for the same scope is already cached. */
  isCached(options: JunkScanOptions = {}): boolean {
    return this.result !== null && this.scope === scopeKey(options) && this.cache.isFresh();
  }

  /** Adopt a freshly produced scan result, indexing it by category. */
  store(result: JunkScanResult, options: JunkScanOptions = {}): JunkScanResult {
    this.cache.clear();
    const byCategory = new Map<string, JunkFile[]>();
    for (const file of result.files) {
      const bucket = byCategory.get(file.category);
      if (bucket) bucket.push(file);
      else byCategory.set(file.category, [file]);
    }
    for (const [category, items] of byCategory) this.cache.setCategory(category, items);
    // An empty result still marks the cache fresh for this scope, so we do not
    // re-spawn PowerShell on every render of an already-clean machine.
    if (result.files.length === 0) this.cache.markScanned();
    this.scope = scopeKey(options);
    this.result = result;
    return result;
  }

  /**
   * Return the cached scan for this scope when fresh; otherwise run `scanFn`
   * once and cache it. `force` always re-scans (explicit refresh).
   */
  async scan(
    scanFn: JunkScanFn,
    reporter: ScanProgressReporter | undefined,
    options: JunkScanOptions = {},
    force = false
  ): Promise<JunkScanResult> {
    if (!force && this.isCached(options) && this.result) return this.result;
    const fresh = await scanFn(reporter, options);
    return this.store(fresh, options);
  }

  /**
   * Delete the paths and drop exactly the confirmed ones from the cache. A
   * later clean of the remaining files needs no re-scan.
   */
  async clean(deleteFn: JunkDeleteFn, paths: string[]): Promise<JunkDeleteResult> {
    const result = await deleteFn(paths);
    this.removePaths(result.removed);
    return result;
  }

  /** Remove cached entries whose path is in `paths`; returns how many dropped. */
  removePaths(paths: readonly string[]): number {
    if (!this.result || paths.length === 0) return 0;
    const pathSet = new Set(paths);
    const ids = this.result.files.filter((f) => pathSet.has(f.path)).map((f) => f.id);
    const removed = this.cache.removeCachedItems(ids);
    const remaining = this.result.files.filter((f) => !pathSet.has(f.path));
    this.result = recomputeJunkResult(remaining);
    return removed;
  }

  /** Drop specific cached items by id (e.g. a category-level invalidation). */
  invalidate(ids: readonly string[]): number {
    const removed = this.cache.removeCachedItems(ids);
    if (this.result && removed > 0) {
      const cachedIds = new Set(this.cache.allItems().map((f) => f.id));
      this.result = recomputeJunkResult(this.result.files.filter((f) => cachedIds.has(f.id)));
    }
    return removed;
  }

  clear(): void {
    this.cache.clear();
    this.result = null;
    this.scope = null;
  }
}

/** Process-wide junk scan session used by the IPC layer. */
export const junkSession = new JunkScanSession();
