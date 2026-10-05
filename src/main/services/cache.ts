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
