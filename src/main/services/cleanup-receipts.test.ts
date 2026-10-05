import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  setJunkReceiptStoreDir,
  recordCleanupReceipt,
  loadCleanupReceipts,
  getLatestCleanupReceipt,
  retryLatestFailedDeletions,
  clearCleanupReceipts,
  makeTempReceiptDir,
  type JunkCleanupReceipt,
} from './cleanup-receipts';
import type { DeleteReceipt, JunkDeleteResult } from './junk-scanner';

const receipt = (
  path: string,
  deleted: boolean,
  reason: DeleteReceipt['reason']
): DeleteReceipt => ({
  path,
  deleted,
  reason,
  message: 'msg',
  at: '2024-01-01T00:00:00.000Z',
});

describe('cleanup-receipts (Fase 4.6)', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempReceiptDir();
    setJunkReceiptStoreDir(dir);
  });

  afterEach(() => {
    setJunkReceiptStoreDir(null);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('persists a cleanup receipt with per-file reasons', async () => {
    const recorded = await recordCleanupReceipt({
      deleted: 1,
      failed: 1,
      freedBytes: 2048,
      receipts: [
        receipt('C:\\Temp\\a.tmp', true, null),
        receipt('C:\\Temp\\b.tmp', false, 'in-use'),
      ],
    });

    expect(recorded.id).toBeTruthy();
    const all = await loadCleanupReceipts();
    expect(all).toHaveLength(1);
    expect(all[0]?.receipts.find((r) => !r.deleted)?.reason).toBe('in-use');
    // Really on disk.
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'junk-receipts.json'), 'utf8'));
    expect(raw).toHaveLength(1);
  });

  it('returns the latest receipt', async () => {
    await recordCleanupReceipt({ deleted: 1, failed: 0, receipts: [] });
    await recordCleanupReceipt({ deleted: 2, failed: 0, receipts: [] });
    const latest = await getLatestCleanupReceipt();
    expect(latest?.deleted).toBe(2);
  });

  it('clear empties the store', async () => {
    await recordCleanupReceipt({ deleted: 1, failed: 0, receipts: [] });
    await clearCleanupReceipts();
    expect(await loadCleanupReceipts()).toHaveLength(0);
  });

  it('retries only the failed paths and records the retry', async () => {
    await recordCleanupReceipt({
      deleted: 1,
      failed: 2,
      receipts: [
        receipt('C:\\Temp\\ok.tmp', true, null),
        receipt('C:\\Temp\\busy.tmp', false, 'in-use'),
        receipt('C:\\Temp\\denied.tmp', false, 'permissions'),
      ],
    });

    const deleteFn = vi.fn().mockResolvedValue({
      success: true,
      deleted: 1,
      failed: 1,
      errors: [],
      removed: ['C:\\Temp\\busy.tmp'],
      receipts: [
        receipt('C:\\Temp\\busy.tmp', true, null),
        receipt('C:\\Temp\\denied.tmp', false, 'permissions'),
      ],
    } satisfies JunkDeleteResult);

    const result = await retryLatestFailedDeletions(deleteFn);

    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(deleteFn.mock.calls[0]?.[0]).toEqual(['C:\\Temp\\busy.tmp', 'C:\\Temp\\denied.tmp']);
    expect(result.attempted).toBe(2);
    expect(result.deleted).toBe(1);
    // The retry is itself recorded (2 receipts total).
    expect(await loadCleanupReceipts()).toHaveLength(2);
  });

  it('does nothing when there is no receipt', async () => {
    const deleteFn = vi.fn();
    const result = await retryLatestFailedDeletions(deleteFn);
    expect(deleteFn).not.toHaveBeenCalled();
    expect(result.attempted).toBe(0);
  });

  it('does nothing when everything succeeded', async () => {
    await recordCleanupReceipt({
      deleted: 3,
      failed: 0,
      receipts: [receipt('C:\\Temp\\a.tmp', true, null)],
    });
    const deleteFn = vi.fn();
    const result = await retryLatestFailedDeletions(deleteFn);
    expect(deleteFn).not.toHaveBeenCalled();
    expect(result.attempted).toBe(0);
  });
});

// Ensure the module exports the type used above (compile-time check).
export type { JunkCleanupReceipt };
