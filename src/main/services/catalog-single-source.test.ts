import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadTweakCatalog } from './tweak-catalog';
import { loadAppBundleCatalog } from './app-bundles';
import { TWEAKS, getTweaks } from './tweaks';

/**
 * Single-source-of-truth guard (Phase A).
 *
 * Regression: `TWEAKS` was hardcoded in TypeScript (19 entries) while
 * `catalogs/tweaks-catalog.json` carried a stale, disjoint list (10 entries).
 * Two sources of truth that silently diverged. These tests fail if product
 * lists ever move back into code, or if the data stops matching the contract.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVICES_DIR = path.join(REPO_ROOT, 'src', 'main', 'services');

const CODE_FILES = ['app-bundles.ts', 'tweaks.ts'];

function readServiceFile(name: string): string {
  return fs.readFileSync(path.join(SERVICES_DIR, name), 'utf8');
}

describe('curated catalogs live in DATA, not code', () => {
  it('the tweak catalog is loaded from the bundled JSON', () => {
    const raw = fs.readFileSync(path.join(REPO_ROOT, 'catalogs', 'tweaks-catalog.json'), 'utf8');
    const fromData = JSON.parse(raw).tweaks as unknown[];
    expect(fromData.length).toBeGreaterThan(0);

    const loaded = loadTweakCatalog();
    expect(loaded).toHaveLength(fromData.length);
    expect(TWEAKS).toHaveLength(loaded.length);
  });

  it('the app bundles are loaded from the bundled JSON', () => {
    const raw = fs.readFileSync(
      path.join(REPO_ROOT, 'catalogs', 'app-bundles-catalog.json'),
      'utf8'
    );
    const fromData = JSON.parse(raw).bundles as unknown[];
    expect(fromData.length).toBeGreaterThan(0);

    const loaded = loadAppBundleCatalog();
    expect(loaded).toHaveLength(fromData.length);
    expect(loaded.reduce((n, b) => n + b.apps.length, 0)).toBeGreaterThan(0);
  });

  it.each(CODE_FILES)('%s contains no product lists (no data literals)', (file) => {
    const source = readServiceFile(file);

    // No inline bundle apps with a literal winget id (data object literal).
    // Type-level code such as `op: Extract<..., { kind: 'registry' }>` and
    // parameter names like `wingetId: string` are fine; a quoted package id is
    // not.
    expect(/wingetId:\s*'/.test(source), `${file} must not hardcode a winget id`).toBe(false);
    // No inline registry-tweak data (`{ kind: 'registry', hive: HKLM, ... }`).
    expect(
      /kind:\s*'registry'\s*,\s*hive:/.test(source),
      `${file} must not inline registry operations`
    ).toBe(false);
    // No inline tweak definition ids.
    expect(
      /id:\s*'(sysmain-toggle|show-file-extensions|snappier-animations)'/.test(source),
      `${file} must not inline tweak ids`
    ).toBe(false);
  });

  it('has exactly one tweak-catalog file in the repo (no shadow copy)', () => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist')
          continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'tweaks-catalog.json') found.push(path.relative(REPO_ROOT, full));
      }
    };
    walk(REPO_ROOT);
    expect(found).toEqual([path.join('catalogs', 'tweaks-catalog.json')]);
  });

  it('keeps every data tweak reversible and well formed', () => {
    const tweaks = loadTweakCatalog();
    expect(tweaks.length).toBeGreaterThanOrEqual(19);
    const ids = tweaks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tweak of tweaks) {
      expect(['safe', 'advanced']).toContain(tweak.safety);
      expect(tweak.reversible).toBe(true);
      expect(tweak.apply.length).toBeGreaterThan(0);
      expect(tweak.revert.length).toBeGreaterThan(0);
    }
  });

  it('serves the same data tweaks through the public engine API', async () => {
    const listed = await getTweaks();
    expect(listed).toHaveLength(TWEAKS.length);
    expect(listed.every((t) => t.applied === false)).toBe(true);
  });
});
