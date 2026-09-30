import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { PendingUpdate, LastCheck } from './types';
import { loadLocalCatalog, saveLocalCatalog, mergeCatalogs } from './diff-catalogs';
import { loadLastCheck, saveLastCheck } from './check-updates';

export interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: string[];
}

export async function importUpdates(
  updates: PendingUpdate[],
  options: { autoImport?: boolean } = {}
): Promise<ImportResult> {
  const result: ImportResult = { success: true, imported: 0, failed: 0, errors: [] };

  // Group by catalog
  const byCatalog = new Map<string, PendingUpdate[]>();
  for (const u of updates) {
    if (!byCatalog.has(u.catalog)) byCatalog.set(u.catalog, []);
    byCatalog.get(u.catalog)!.push(u);
  }

  for (const [catalog, catalogUpdates] of byCatalog) {
    try {
      const local = loadLocalCatalog(catalog);
      const merged = mergeCatalogs(local, catalogUpdates);
      saveLocalCatalog(catalog, merged);

      // Mark as imported
      for (const u of catalogUpdates) {
        u.status = 'imported';
        result.imported++;
      }
    } catch (err: any) {
      result.failed += catalogUpdates.length;
      result.errors.push(`Error importando ${catalog}: ${err.message}`);
    }
  }

  // Update last-check
  const lastCheck = loadLastCheck();
  lastCheck.pendingUpdates = lastCheck.pendingUpdates.filter(
    u => !updates.find(x => x.id === u.id)
  );
  saveLastCheck(lastCheck);

  result.success = result.failed === 0;
  return result;
}

export async function importAllPending(): Promise<ImportResult> {
  const lastCheck = loadLastCheck();
  const pending = lastCheck.pendingUpdates.filter(u => u.status === 'pending');
  return importUpdates(pending, { autoImport: true });
}

export function rejectUpdate(updateId: string): void {
  const lastCheck = loadLastCheck();
  const update = lastCheck.pendingUpdates.find(u => u.id === updateId);
  if (update) {
    update.status = 'rejected';
    saveLastCheck(lastCheck);
  }
}

export function rejectAllPending(): void {
  const lastCheck = loadLastCheck();
  for (const u of lastCheck.pendingUpdates) {
    if (u.status === 'pending') u.status = 'rejected';
  }
  saveLastCheck(lastCheck);
}
