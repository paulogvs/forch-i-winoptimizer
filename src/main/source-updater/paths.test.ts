import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveBundledPath } from './paths';

/**
 * Bundled-catalog path resolution (Phase A).
 *
 * The curated catalogs (`catalogs/*.json`) are read through
 * `resolveBundledPath`. Two facts must hold:
 *
 *  1. DEV — from the source tree, every catalog resolves and exists.
 *  2. PACKAGED — the resolver loads `catalogs/` from `app.getAppPath()` (the
 *     asar root). `paths.ts` loads Electron via a CommonJS `require('electron')`
 *     so that the CLI build (plain Node) does not choke; vitest cannot intercept
 *     a CJS `require` with `vi.doMock`. Therefore the packaged case is exercised
 *     for real in a CHILD PROCESS with an `electron` stub plantable on Node's
 *     module path — this proves the code path end to end.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CATALOGS = [
  'apps-catalog.json',
  'services-catalog.json',
  'tweaks-catalog.json',
  'cleaners-rules.json',
  'app-bundles-catalog.json',
];

const ts = Date.now();

function makeTempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-${ts}-`));
}

/** Write an `electron` stub module exposing `app.getAppPath()`. */
function writeElectronStub(dir: string, appPath: string): void {
  fs.mkdirSync(path.join(dir, 'node_modules', 'electron'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'node_modules', 'electron', 'package.json'),
    JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' })
  );
  fs.writeFileSync(
    path.join(dir, 'node_modules', 'electron', 'index.js'),
    `module.exports = { app: { getAppPath: () => ${JSON.stringify(appPath)}, getPath: () => ${JSON.stringify(appPath)} } };\n`
  );
}

describe('resolveBundledPath', () => {
  const cleanups: string[] = [];

  afterEach(() => {
    for (const dir of cleanups.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves every bundled catalog in the dev tree', () => {
    for (const catalog of CATALOGS) {
      const resolved = resolveBundledPath('catalogs', catalog);
      expect(resolved, `catalogs/${catalog} must resolve`).not.toBeNull();
      expect(fs.existsSync(resolved as string)).toBe(true);
      expect(path.basename(resolved as string)).toBe(catalog);
    }
  });

  it('returns null for a path that exists nowhere', () => {
    expect(resolveBundledPath('catalogs', 'does-not-exist-xyz.json')).toBeNull();
    expect(resolveBundledPath('nope', 'nope.json')).toBeNull();
  });

  it('PACKAGED: loads catalogs/ through app.getAppPath() (child process)', () => {
    // An installation root that is NOT this checkout; holds a catalogs/ fixture
    // and a plantable `electron` stub.
    const appRoot = makeTempRoot('forchi-approot');
    cleanups.push(appRoot);
    fs.mkdirSync(path.join(appRoot, 'catalogs'), { recursive: true });
    fs.writeFileSync(
      path.join(appRoot, 'catalogs', 'tweaks-catalog.json'),
      JSON.stringify({ tweaks: [{ id: 'packaged-fixture' }] })
    );

    const runnerDir = makeTempRoot('forchi-runner');
    cleanups.push(runnerDir);
    writeElectronStub(runnerDir, appRoot);

    // A throwaway CJS module that requires `paths.ts` compiled on the fly via
    // the project's esbuild. Inlining it in the child keeps the test hermetic.
    const driver = path.join(runnerDir, 'driver.cjs');
    fs.writeFileSync(
      driver,
      `
      const esbuild = require(${JSON.stringify(path.join(REPO_ROOT, 'node_modules', 'esbuild'))});
      const path = require('node:path');
      const os = require('node:os');
      const fs = require('node:fs');
      const out = path.join(os.tmpdir(), 'forchi-paths-run-${ts}.cjs');
      esbuild.buildSync({
        entryPoints: [${JSON.stringify(path.join(REPO_ROOT, 'src', 'main', 'source-updater', 'paths.ts'))}],
        bundle: true, platform: 'node', format: 'cjs', target: 'node20',
        external: ['electron'], logLevel: 'silent', outfile: out,
      });
      const { resolveBundledPath } = require(out);
      process.stdout.write(String(resolveBundledPath('catalogs', 'tweaks-catalog.json')));
      `
    );

    const result = spawnSync(process.execPath, [driver], {
      cwd: runnerDir,
      env: { ...process.env, NODE_PATH: path.join(runnerDir, 'node_modules') },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(path.join(appRoot, 'catalogs', 'tweaks-catalog.json'));
    const parsed = JSON.parse(fs.readFileSync(result.stdout, 'utf8')) as {
      tweaks: { id: string }[];
    };
    expect(parsed.tweaks[0]?.id).toBe('packaged-fixture');
  });
});
