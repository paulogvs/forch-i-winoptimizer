import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface ElectronLike {
  app?: {
    getPath?: (name: string) => string;
    getAppPath?: () => string;
  };
}

/**
 * Lazily load the Electron module when running under Electron.
 *
 * The source-updater is used from two contexts:
 *   1. The packaged/desktop app (Electron) -> use `app.getPath('userData')`.
 *   2. The `winoptimizer-updates` skill / CLI (plain Node) -> fall back to the
 *      user's home directory. Requiring `electron` from plain Node returns a
 *      string path (not the API), so we deliberately guard for `app`.
 */
function loadElectron(): ElectronLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('electron') as unknown;
    if (mod && typeof mod === 'object' && 'app' in (mod as Record<string, unknown>)) {
      return mod as ElectronLike;
    }
  } catch {
    /* not running under Electron */
  }
  return null;
}

function ensureDir(dir: string): string {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Persistent storage directory that holds sources.json, last-check.json and catalogs/. */
export function getStorageDir(): string {
  const electron = loadElectron();
  const base = electron?.app?.getPath ? electron.app.getPath('userData') : os.homedir();
  return ensureDir(path.join(base, 'forch-i-winoptimizer'));
}

/** Directory that holds the importable catalogs (apps/services/tweaks/cleaners). */
export function getCatalogStorageDir(): string {
  return ensureDir(path.join(getStorageDir(), 'catalogs'));
}

/**
 * Resolve a bundled asset (e.g. `sources/sources.json`) across dev, packaged and
 * CLI contexts. Returns null when the file cannot be found in any known root.
 */
export function resolveBundledPath(...segments: string[]): string | null {
  const candidates: string[] = [];

  const electron = loadElectron();
  if (electron?.app?.getAppPath) {
    candidates.push(electron.app.getAppPath());
  }
  // CLI / dev: the project root is the current working directory.
  candidates.push(process.cwd());
  // Compiled layout: <root>/dist/main/source-updater -> <root>
  candidates.push(path.join(__dirname, '..', '..', '..'));
  candidates.push(path.join(__dirname, '..', '..'));

  for (const base of candidates) {
    const candidate = path.join(base, ...segments);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
