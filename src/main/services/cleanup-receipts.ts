import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { deleteJunkFiles, type DeleteReceipt, type JunkDeleteResult } from './junk-scanner';

/**
 * Cleanup receipts (Fase 4.6, same pattern as `driver-receipts.json`).
 *
 * Every junk cleanup is persisted with a per-file receipt (path + reason), so
 * the UI can explain WHY a delete failed and offer a retry of only the failed
 * paths. Persistence is best-effort: a failure to write never breaks a delete.
 */

export interface JunkCleanupReceipt {
  id: string;
  at: string;
  deleted: number;
  failed: number;
  freedBytes: number;
  receipts: DeleteReceipt[];
}

const STORE_FILE = 'junk-receipts.json';
const MAX_RECEIPTS = 50;

let storeDirOverride: string | null = null;

/** Test seam: override the directory that holds `junk-receipts.json`. */
export function setJunkReceiptStoreDir(dir: string | null): void {
  storeDirOverride = dir;
}

async function storeDir(): Promise<string> {
  if (storeDirOverride) return storeDirOverride;
  try {
    const { app } = await import('electron');
    return app.getPath('userData');
  } catch {
    return process.cwd();
  }
}

function isReceipt(value: unknown): value is JunkCleanupReceipt {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['id'] === 'string' && Array.isArray(v['receipts']);
}

async function readReceipts(): Promise<JunkCleanupReceipt[]> {
  try {
    const dir = await storeDir();
    const raw = fs.readFileSync(path.join(dir, STORE_FILE), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isReceipt) : [];
  } catch {
    return [];
  }
}

async function writeReceipts(receipts: JunkCleanupReceipt[]): Promise<void> {
  try {
    const dir = await storeDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, STORE_FILE),
      JSON.stringify(receipts.slice(-MAX_RECEIPTS), null, 2),
      'utf8'
    );
  } catch {
    // Persistence failure must never crash the app or block a cleanup.
  }
}

export interface RecordCleanupInput {
  deleted: number;
  failed: number;
  freedBytes?: number;
  receipts: DeleteReceipt[];
}

export async function recordCleanupReceipt(input: RecordCleanupInput): Promise<JunkCleanupReceipt> {
  const receipt: JunkCleanupReceipt = {
    id: randomUUID(),
    at: new Date().toISOString(),
    deleted: Math.max(0, Math.round(input.deleted)),
    failed: Math.max(0, Math.round(input.failed)),
    freedBytes: Math.max(0, Math.round(input.freedBytes ?? 0)),
    receipts: input.receipts,
  };
  const list = await readReceipts();
  list.push(receipt);
  await writeReceipts(list);
  return receipt;
}

export async function loadCleanupReceipts(): Promise<JunkCleanupReceipt[]> {
  return readReceipts();
}

export async function getLatestCleanupReceipt(): Promise<JunkCleanupReceipt | null> {
  const list = await readReceipts();
  return list.length > 0 ? (list[list.length - 1] ?? null) : null;
}

export async function clearCleanupReceipts(): Promise<void> {
  await writeReceipts([]);
}

export type JunkDeleteFn = (paths: string[]) => Promise<JunkDeleteResult>;

export interface RetryCleanupResult {
  attempted: number;
  deleted: number;
  failed: number;
  receipts: DeleteReceipt[];
}

/**
 * Retry only the files that failed in the most recent cleanup. Safe to call
 * repeatedly: paths already gone are reported as `not-found` no-ops.
 */
export async function retryLatestFailedDeletions(
  deleteFn: JunkDeleteFn = deleteJunkFiles
): Promise<RetryCleanupResult> {
  const latest = await getLatestCleanupReceipt();
  if (!latest) return { attempted: 0, deleted: 0, failed: 0, receipts: [] };

  const failedPaths = latest.receipts.filter((r) => !r.deleted).map((r) => r.path);
  if (failedPaths.length === 0) return { attempted: 0, deleted: 0, failed: 0, receipts: [] };

  const result = await deleteFn(failedPaths);
  await recordCleanupReceipt({
    deleted: result.deleted,
    failed: result.failed,
    receipts: result.receipts,
  });
  return {
    attempted: failedPaths.length,
    deleted: result.deleted,
    failed: result.failed,
    receipts: result.receipts,
  };
}

/** Create a unique temp store dir (test helper). */
export function makeTempReceiptDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forchi-junk-receipts-'));
}
