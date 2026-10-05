import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CategoryScanCache } from './cache';
import { JunkScanSession, scopeKey } from './junk-cache';
import type { JunkFile, JunkScanResult } from './junk-scanner';

const file = (id: string, name: string, category: JunkFile['category'], size = 10): JunkFile => ({
  id,
  path: `C:\\Temp\\${name}`,
  name,
  size,
  category,
  lastModified: new Date('2024-01-01T00:00:00Z'),
  safeToDelete: true,
});

const result = (files: JunkFile[]): JunkScanResult => ({
  files,
  totalSize: files.reduce((s, f) => s + f.size, 0),
  totalCount: files.length,
  categories: {
    temp: { count: files.filter((f) => f.category === 'temp').length, size: 0 },
    cache: { count: 0, size: 0 },
    logs: { count: 0, size: 0 },
    thumbnails: { count: 0, size: 0 },
    'recycle-bin': { count: 0, size: 0 },
    'browser-cache': { count: 0, size: 0 },
    'windows-update': { count: 0, size: 0 },
  },
});

describe('JunkScanSession (Fase 4.3)', () => {
  let now = 1_000;
  let cache: CategoryScanCache<JunkFile>;
  let session: JunkScanSession;

  beforeEach(() => {
    now = 1_000;
    cache = new CategoryScanCache<JunkFile>(() => now, 30_000);
    session = new JunkScanSession(cache);
  });

  it('scans once and serves the same scope from cache', async () => {
    const scanFn = vi.fn().mockResolvedValue(result([file('a', 'a.tmp', 'temp')]));

    await session.scan(scanFn, undefined, { categories: ['temp'] });
    const second = await session.scan(scanFn, undefined, { categories: ['temp'] });

    expect(scanFn).toHaveBeenCalledTimes(1);
    expect(second.files).toHaveLength(1);
    expect(session.isCached({ categories: ['temp'] })).toBe(true);
  });

  it('re-cleans without re-scanning after a partial delete', async () => {
    const files = [
      file('a', 'a.tmp', 'temp'),
      file('b', 'b.tmp', 'temp'),
      file('c', 'c.tmp', 'temp'),
    ];
    const scanFn = vi.fn().mockResolvedValue(result(files));
    const deleteFn = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        deleted: 1,
        failed: 0,
        errors: [],
        removed: ['C:\\Temp\\a.tmp'],
        receipts: [],
      })
      .mockResolvedValueOnce({
        success: true,
        deleted: 2,
        failed: 0,
        errors: [],
        removed: ['C:\\Temp\\b.tmp', 'C:\\Temp\\c.tmp'],
        receipts: [],
      });

    const first = await session.scan(scanFn, undefined, { categories: ['temp'] });
    expect(first.files).toHaveLength(3);
    expect(scanFn).toHaveBeenCalledTimes(1);

    await session.clean(deleteFn, ['C:\\Temp\\a.tmp']);
    expect(session.lastResult?.files.map((f) => f.name)).toEqual(['b.tmp', 'c.tmp']);
    expect(session.cacheSize).toBe(2);

    await session.clean(deleteFn, ['C:\\Temp\\b.tmp', 'C:\\Temp\\c.tmp']);
    expect(session.lastResult?.files).toHaveLength(0);

    // The re-clean never re-scanned.
    expect(scanFn).toHaveBeenCalledTimes(1);
    expect(deleteFn).toHaveBeenCalledTimes(2);
  });

  it('recomputes totals after removal', async () => {
    const scanFn = vi
      .fn()
      .mockResolvedValue(result([file('a', 'a.tmp', 'temp', 100), file('b', 'b.tmp', 'temp', 50)]));
    await session.scan(scanFn, undefined, { categories: ['temp'] });
    expect(session.lastResult?.totalSize).toBe(150);

    session.removePaths(['C:\\Temp\\a.tmp']);
    expect(session.lastResult?.totalSize).toBe(50);
    expect(session.lastResult?.totalCount).toBe(1);
    expect(session.lastResult?.categories.temp.count).toBe(1);
  });

  it('re-scans when the scope changes', async () => {
    const scanFn = vi.fn().mockResolvedValue(result([file('a', 'a.tmp', 'temp')]));
    await session.scan(scanFn, undefined, { categories: ['temp'] });
    await session.scan(scanFn, undefined, { categories: ['logs'] });
    expect(scanFn).toHaveBeenCalledTimes(2);
  });

  it('force re-scans even when fresh', async () => {
    const scanFn = vi.fn().mockResolvedValue(result([]));
    await session.scan(scanFn, undefined, {});
    await session.scan(scanFn, undefined, {}, true);
    expect(scanFn).toHaveBeenCalledTimes(2);
  });

  it('expires and re-scans after the ttl', async () => {
    const scanFn = vi.fn().mockResolvedValue(result([file('a', 'a.tmp', 'temp')]));
    await session.scan(scanFn, undefined, { categories: ['temp'] });
    now += 30_001;
    await session.scan(scanFn, undefined, { categories: ['temp'] });
    expect(scanFn).toHaveBeenCalledTimes(2);
  });

  it('invalidate drops specific ids from the cache', async () => {
    const scanFn = vi
      .fn()
      .mockResolvedValue(result([file('a', 'a.tmp', 'temp'), file('b', 'b.tmp', 'temp')]));
    await session.scan(scanFn, undefined, { categories: ['temp'] });
    expect(session.invalidate(['a'])).toBe(1);
    expect(session.cacheSize).toBe(1);
    expect(session.lastResult?.files.map((f) => f.id)).toEqual(['b']);
  });

  it('scopeKey is order-independent', () => {
    expect(scopeKey({ categories: ['temp', 'logs'] })).toBe(
      scopeKey({ categories: ['logs', 'temp'] })
    );
  });
});
