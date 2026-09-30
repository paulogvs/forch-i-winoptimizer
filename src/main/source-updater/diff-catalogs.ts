import * as fs from 'fs';
import * as path from 'path';
import { CatalogItem, PendingUpdate } from './types';
import { getCatalogStorageDir, resolveBundledPath } from './paths';

export function loadLocalCatalog(catalogName: string): CatalogItem[] {
  const catalogPath = path.join(getCatalogStorageDir(), `${catalogName}.json`);
  if (!fs.existsSync(catalogPath)) {
    // Seed from the bundled copy shipped with the app.
    const bundled = resolveBundledPath('catalogs', `${catalogName}.json`);
    if (bundled) {
      fs.copyFileSync(bundled, catalogPath);
    } else {
      return [];
    }
  }
  const data = JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as Record<string, unknown>;
  const key = Object.keys(data).find((k) => Array.isArray(data[k]));
  return key ? (data[key] as CatalogItem[]) : [];
}

export function saveLocalCatalog(catalogName: string, items: CatalogItem[]): void {
  const catalogPath = path.join(getCatalogStorageDir(), `${catalogName}.json`);
  const existing: Record<string, unknown> = fs.existsSync(catalogPath)
    ? (JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as Record<string, unknown>)
    : { version: '0.1.0', lastUpdated: new Date().toISOString() };

  const key = Object.keys(existing).find((k) => Array.isArray(existing[k])) || catalogName;
  existing[key] = items;
  existing.lastUpdated = new Date().toISOString();

  fs.writeFileSync(catalogPath, JSON.stringify(existing, null, 2), 'utf-8');
}

export function diffCatalogs(
  local: CatalogItem[],
  remote: CatalogItem[]
): { newItems: CatalogItem[]; modifiedItems: CatalogItem[]; removedItems: CatalogItem[] } {
  const localMap = new Map(local.map((i) => [i.id, i]));
  const remoteMap = new Map(remote.map((i) => [i.id, i]));

  const newItems: CatalogItem[] = [];
  const modifiedItems: CatalogItem[] = [];
  const removedItems: CatalogItem[] = [];

  // New and modified
  for (const [id, remoteItem] of remoteMap) {
    const localItem = localMap.get(id);
    if (!localItem) {
      newItems.push(remoteItem);
    } else if (JSON.stringify(localItem) !== JSON.stringify(remoteItem)) {
      modifiedItems.push(remoteItem);
    }
  }

  // Removed
  for (const [id, localItem] of localMap) {
    if (!remoteMap.has(id)) {
      removedItems.push(localItem);
    }
  }

  return { newItems, modifiedItems, removedItems };
}

export function mergeCatalogs(local: CatalogItem[], updates: PendingUpdate[]): CatalogItem[] {
  const merged = [...local];
  const idSet = new Set(local.map((i) => i.id));

  for (const update of updates) {
    if (update.status !== 'imported') continue;

    if (update.type === 'new' && !idSet.has(update.item.id)) {
      merged.push(update.item);
      idSet.add(update.item.id);
    } else if (update.type === 'modified') {
      const idx = merged.findIndex((i) => i.id === update.item.id);
      if (idx >= 0) merged[idx] = update.item;
    } else if (update.type === 'removed') {
      const idx = merged.findIndex((i) => i.id === update.item.id);
      if (idx >= 0) merged.splice(idx, 1);
    }
  }

  return merged;
}
