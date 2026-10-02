import * as fs from 'fs';
import * as path from 'path';
import type { Source, SourcesConfig, LastCheck, UpdateReport, GitHubRepoInfo } from './types';
import { getCatalogStorageDir, getStorageDir, resolveBundledPath } from './paths';

const GITHUB_API = 'https://api.github.com';

export function loadSources(): SourcesConfig {
  const sourcesPath = path.join(getStorageDir(), 'sources.json');
  if (fs.existsSync(sourcesPath)) {
    return JSON.parse(fs.readFileSync(sourcesPath, 'utf-8')) as SourcesConfig;
  }
  const bundled = resolveBundledPath('sources', 'sources.json');
  if (!bundled) {
    throw new Error('sources.json not found (neither in userData nor bundled).');
  }
  return JSON.parse(fs.readFileSync(bundled, 'utf-8')) as SourcesConfig;
}

export function loadLastCheck(): LastCheck {
  const checkPath = path.join(getStorageDir(), 'last-check.json');
  if (fs.existsSync(checkPath)) {
    return JSON.parse(fs.readFileSync(checkPath, 'utf-8')) as LastCheck;
  }
  const bundled = resolveBundledPath('sources', 'last-check.json');
  if (bundled) {
    return JSON.parse(fs.readFileSync(bundled, 'utf-8')) as LastCheck;
  }
  return { lastCheck: null, sources: {}, pendingUpdates: [] };
}

export function saveLastCheck(data: LastCheck): void {
  const checkPath = path.join(getStorageDir(), 'last-check.json');
  fs.writeFileSync(checkPath, JSON.stringify(data, null, 2), 'utf-8');
}

async function fetchRepoInfo(source: Source): Promise<GitHubRepoInfo | null> {
  try {
    const repoPath = source.url.replace('https://github.com/', '');
    const res = await fetch(`${GITHUB_API}/repos/${repoPath}`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as GitHubRepoInfo;
  } catch {
    return null;
  }
}

async function fetchCatalogFromRepo(source: Source, catalog: string): Promise<unknown[] | null> {
  try {
    const repoPath = source.url.replace('https://github.com/', '');
    const branch = 'main';
    // Try common paths
    const possiblePaths = [
      `catalogs/${catalog}.json`,
      `data/${catalog}.json`,
      `${catalog}.json`,
      `src/data/${catalog}.json`,
    ];

    for (const p of possiblePaths) {
      const url = `${GITHUB_API}/repos/${repoPath}/contents/${p}?ref=${branch}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/vnd.github.v3.raw' },
      });
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text) as unknown;
          // Extract array from common catalog formats
          if (Array.isArray(data)) return data as unknown[];
          if (data && typeof data === 'object') {
            const record = data as Record<string, unknown>;
            const key = Object.keys(record).find((k) => Array.isArray(record[k]));
            if (key) return record[key] as unknown[];
          }
        } catch {
          continue;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function checkAllSources(): Promise<UpdateReport> {
  const report: UpdateReport = {
    timestamp: new Date().toISOString(),
    sourcesChecked: 0,
    newItems: [],
    modifiedItems: [],
    removedItems: [],
    errors: [],
  };

  const sources = loadSources();
  const lastCheck = loadLastCheck();

  for (const source of sources.sources.filter((s) => s.enabled)) {
    try {
      const repoInfo = await fetchRepoInfo(source);
      if (!repoInfo) {
        report.errors.push(`No se pudo acceder a ${source.name} (${source.url})`);
        continue;
      }

      report.sourcesChecked++;

      // Check if repo has new commits since last check
      const prevCommit = lastCheck.sources[source.id]?.lastCommit;
      const hasNewCommits = !prevCommit || repoInfo.pushed_at > (prevCommit ?? '');

      if (hasNewCommits) {
        // Fetch catalogs from repo
        for (const catalog of source.catalogs) {
          const remoteItems = await fetchCatalogFromRepo(source, catalog);
          if (!remoteItems) continue;

          // Load local catalog
          const localCatalogPath = path.join(getCatalogStorageDir(), `${catalog}.json`);
          let localItems: unknown[] = [];
          if (fs.existsSync(localCatalogPath)) {
            const localData = JSON.parse(fs.readFileSync(localCatalogPath, 'utf-8')) as Record<
              string,
              unknown
            >;
            const key = Object.keys(localData).find((k) => Array.isArray(localData[k]));
            if (key) localItems = localData[key] as unknown[];
          }

          // Diff
          const localIds = new Set(localItems.map((i) => (i as { id: string }).id));
          const remoteIds = new Set(remoteItems.map((i) => (i as { id: string }).id));

          // New items
          for (const item of remoteItems) {
            const itemAny = item as { id: string; name: string };
            if (!localIds.has(itemAny.id)) {
              report.newItems.push({
                id: `${source.id}-${catalog}-${itemAny.id}`,
                sourceId: source.id,
                sourceName: source.name,
                catalog,
                type: 'new',
                item: itemAny,
                detectedAt: new Date().toISOString(),
                status: 'pending',
              });
            }
          }

          // Removed items
          for (const item of localItems) {
            const itemAny = item as { id: string; name: string };
            if (!remoteIds.has(itemAny.id)) {
              report.removedItems.push({
                id: `${source.id}-${catalog}-${itemAny.id}`,
                sourceId: source.id,
                sourceName: source.name,
                catalog,
                type: 'removed',
                item: itemAny,
                detectedAt: new Date().toISOString(),
                status: 'pending',
              });
            }
          }
        }

        // Update last check
        lastCheck.sources[source.id] = {
          lastCommit: repoInfo.pushed_at,
          lastCheck: new Date().toISOString(),
        };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push(`Error en ${source.name}: ${message}`);
    }
  }

  lastCheck.lastCheck = new Date().toISOString();
  lastCheck.pendingUpdates = [...report.newItems, ...report.modifiedItems, ...report.removedItems];
  saveLastCheck(lastCheck);

  return report;
}
