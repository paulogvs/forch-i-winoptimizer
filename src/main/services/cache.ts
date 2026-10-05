/**
 * In-memory TTL cache for expensive scan results (P1.2).
 *
 * Lives only in the main process (never on disk). Keys are `module + params`
 *
 * so different query shapes never collide. `force`/invalidation is explicit:
 * mutating actions (Clean, Apply, Refresh) must invalidate the affected module.
 */

import type { CacheOptions } from '@shared/electron-api';

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Deterministic stringify with sorted keys so param order never matters. */
export function stableKey(params: unknown): string {
  if (params === undefined || params === null) return '';
  try {
    return JSON.stringify(params, (_key, value: unknown) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
          sorted[k] = (value as Record<string, unknown>)[k];
        }
        return sorted;
      }
      return value;
    });
  } catch {
    return String(params);
  }
}

export class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private fullKey(module: string, params?: unknown): string {
    return `${module}:${stableKey(params)}`;
  }

  get<T>(module: string, params?: unknown): T | null {
    const key = this.fullKey(module, params);
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  has(module: string, params?: unknown): boolean {
    return this.get(module, params) !== null;
  }

  set<T>(module: string, value: T, ttlMs: number, params?: unknown): void {
    if (ttlMs <= 0) return;
    this.store.set(this.fullKey(module, params), {
      value,
      expiresAt: this.now() + ttlMs,
    });
  }

  delete(module: string, params?: unknown): void {
    this.store.delete(this.fullKey(module, params));
  }

  /** Remove every entry belonging to a module (all param variants). */
  invalidateModule(module: string): number {
    const prefix = `${module}:`;
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

// ---------------------------------------------------------------------------
// Scan cache by category (Fase 4.3, adopted from Kudu's `scan-cache.ts`).
//
// `TtlCache` above caches whole payloads; this caches the individual scanned
// ITEMS keyed by id, indexed by category. That makes it possible to drop only
// what was deleted (or only one category) while keeping the rest warm, so a
// "re-clean" after a partial delete does not re-scan the machine.
// ---------------------------------------------------------------------------

/** Minimum shape of a cached scan item: stable id + owning category. */
export interface ScannableItem {
  id: string;
  category: string;
}

export class CategoryScanCache<T extends ScannableItem> {
  private readonly items = new Map<string, T>();
  private readonly byCategory = new Map<string, Set<string>>();
  private scannedAt: number | null = null;

  constructor(
    private readonly now: () => number = () => Date.now(),
    // Mirrors CACHE_TTL.junk (declared below). Kept as a literal so the class
    // can be declared before the TTL table without a TDZ/use-before-declare.
    private readonly ttlMs: number = 30_000
  ) {}

  private index(category: string, id: string): void {
    let ids = this.byCategory.get(category);
    if (!ids) {
      ids = new Set<string>();
      this.byCategory.set(category, ids);
    }
    ids.add(id);
  }

  private unindex(category: string, id: string): void {
    const ids = this.byCategory.get(category);
    if (!ids) return;
    ids.delete(id);
    if (ids.size === 0) this.byCategory.delete(category);
  }

  /** Replace every item of a category (used right after a fresh scan). */
  setCategory(category: string, items: readonly T[]): void {
    this.clearCachedCategory(category);
    for (const item of items) {
      this.items.set(item.id, item);
      this.index(item.category, item.id);
    }
    this.scannedAt = this.now();
  }

  /** True when the cache still holds a non-expired scan. */
  isFresh(): boolean {
    return this.scannedAt !== null && this.now() - this.scannedAt < this.ttlMs;
  }

  hasCategory(category: string): boolean {
    return this.isFresh() && this.byCategory.has(category);
  }

  /** Items of one category, or `null` when the cache is cold/absent. */
  getCategory(category: string): T[] | null {
    if (!this.isFresh()) return null;
    const ids = this.byCategory.get(category);
    if (!ids) return null;
    const out: T[] = [];
    for (const id of ids) {
      const item = this.items.get(id);
      if (item) out.push(item);
    }
    return out;
  }

  /** Every cached item, across categories. */
  allItems(): T[] {
    return [...this.items.values()];
  }

  categories(): string[] {
    return [...this.byCategory.keys()];
  }

  size(): number {
    return this.items.size;
  }

  /**
   * Drop every item of a category. Returns how many items were removed.
   * Touches `scannedAt` only implicitly: a full clear resets freshness.
   */
  clearCachedCategory(category: string): number {
    const ids = this.byCategory.get(category);
    if (!ids) return 0;
    let removed = 0;
    for (const id of ids) {
      if (this.items.delete(id)) removed++;
    }
    this.byCategory.delete(category);
    if (this.items.size === 0) this.scannedAt = null;
    return removed;
  }

  /** Drop specific items by id (e.g. the paths that were just deleted). */
  removeCachedItems(ids: readonly string[]): number {
    let removed = 0;
    for (const id of ids) {
      const item = this.items.get(id);
      if (!item) continue;
      this.items.delete(id);
      this.unindex(item.category, id);
      removed++;
    }
    if (this.items.size === 0) this.scannedAt = null;
    return removed;
  }

  /** Is this id currently cached? */
  has(id: string): boolean {
    return this.items.has(id);
  }

  clear(): void {
    this.items.clear();
    this.byCategory.clear();
    this.scannedAt = null;
  }

  /** Test seam: mark the cache as just scanned without indexing items. */
  markScanned(): void {
    this.scannedAt = this.now();
  }
}

/** Per-module TTLs (ms). */
export const CACHE_TTL = {
  systemInfo: 60_000,
  drivers: 300_000,
  junk: 30_000,
  apps: 60_000,
  startup: 60_000,
  services: 60_000,
  health: 30_000,
  privacy: 30_000,
  security: 30_000,
  /** Fase 1.1: dns:benchmark is ~12s cold; reuse for 90s. */
  dns: 90_000,
  /** Fase 1.4: benchmark:run batches into 1-2 spawns; reuse for 60s. */
  benchmark: 60_000,
} as const;

export type CacheModule = keyof typeof CACHE_TTL;

/** Shared singleton used by the IPC layer. */
export const cache = new TtlCache();

export type { CacheOptions } from '@shared/electron-api';

/**
 * Read-through cache helper.
 *
 * Deliberately never caches `undefined`/`null` results and never caches while a
 * request is in flight (each call awaits its own loader; in-progress states are
 * not represented in the cache at all).
 */
export async function withCache<T>(
  module: CacheModule,
  loader: () => Promise<T>,
  options: CacheOptions = {},
  params?: unknown
): Promise<T> {
  if (options.force) {
    cache.delete(module, params);
  } else {
    const hit = cache.get<T>(module, params);
    if (hit !== null) return hit;
  }

  const value = await loader();
  cache.set(module, value, CACHE_TTL[module], params);
  return value;
}
