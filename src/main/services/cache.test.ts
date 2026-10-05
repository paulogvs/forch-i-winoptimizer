import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TtlCache, withCache, stableKey, cache } from './cache';

describe('stableKey', () => {
  it('is order-independent for object params', () => {
    expect(stableKey({ a: 1, b: 2 })).toBe(stableKey({ b: 2, a: 1 }));
  });

  it('is empty for null/undefined', () => {
    expect(stableKey(undefined)).toBe('');
    expect(stableKey(null)).toBe('');
  });
});

describe('TtlCache', () => {
  let now = 1_000;
  let ttl: TtlCache;

  beforeEach(() => {
    now = 1_000;
    ttl = new TtlCache(() => now);
  });

  it('misses on an empty cache', () => {
    expect(ttl.get('systemInfo')).toBeNull();
  });

  it('hits before expiry', () => {
    ttl.set('systemInfo', { value: 42 }, 60_000);
    now += 59_999;
    expect(ttl.get<{ value: number }>('systemInfo')?.value).toBe(42);
  });

  it('expires after the ttl', () => {
    ttl.set('systemInfo', { value: 42 }, 60_000);
    now += 60_001;
    expect(ttl.get('systemInfo')).toBeNull();
  });

  it('keys by params', () => {
    ttl.set('apps', ['a'], 60_000, { filter: 'safe' });
    ttl.set('apps', ['b'], 60_000, { filter: 'all' });
    expect(ttl.get<string[]>('apps', { filter: 'safe' })).toEqual(['a']);
    expect(ttl.get<string[]>('apps', { filter: 'all' })).toEqual(['b']);
  });

  it('invalidates an entire module across params', () => {
    ttl.set('apps', ['a'], 60_000, { p: 1 });
    ttl.set('apps', ['b'], 60_000, { p: 2 });
    ttl.set('drivers', ['c'], 60_000);
    expect(ttl.invalidateModule('apps')).toBe(2);
    expect(ttl.get('apps', { p: 1 })).toBeNull();
    expect(ttl.get('drivers')).toEqual(['c']);
  });

  it('does not store when ttl <= 0', () => {
    ttl.set('junk', ['x'], 0);
    expect(ttl.get('junk')).toBeNull();
  });
});

describe('CACHE_TTL (Fase 1)', () => {
  it('defines a 60-120s TTL for dns:benchmark', async () => {
    const { CACHE_TTL } = await import('./cache');
    expect(CACHE_TTL.dns).toBeGreaterThanOrEqual(60_000);
    expect(CACHE_TTL.dns).toBeLessThanOrEqual(120_000);
  });

  it('defines a 60s TTL for benchmark:run', async () => {
    const { CACHE_TTL } = await import('./cache');
    expect(CACHE_TTL.benchmark).toBe(60_000);
  });
});

describe('withCache', () => {
  beforeEach(() => {
    cache.clear();
  });

  it('loads once and then serves from cache', async () => {
    const loader = vi.fn().mockResolvedValue({ ok: true });
    const first = await withCache('systemInfo', loader);
    const second = await withCache('systemInfo', loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
  });

  it('force bypasses the cache', async () => {
    const loader = vi.fn().mockResolvedValue({ n: 1 });
    await withCache('systemInfo', loader);
    await withCache('systemInfo', loader, { force: true });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not poison the cache on loader rejection', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ok: 1 });
    await expect(withCache('drivers', loader)).rejects.toThrow('boom');
    await expect(withCache('drivers', loader)).resolves.toEqual({ ok: 1 });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
