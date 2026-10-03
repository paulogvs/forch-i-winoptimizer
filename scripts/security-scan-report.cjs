#!/usr/bin/env node
'use strict';

/**
 * security-scan-report.cjs — headless runner for the REAL security scanner.
 *
 * The scanner lives in `src/main/services/security-scan.ts` and is Electron-free,
 * so it can be executed from plain Node against the compiled `dist/`. This keeps
 * the elevated verification kit honest: it reuses the exact same 22 checks,
 * decode logic and scoring as the app, instead of a drifting copy.
 *
 * Preconditions:
 *   - `npm run build` has produced `dist/main/services/security-scan.js`.
 *     (scripts/verify-elevated.ps1 runs the build automatically when missing.)
 *
 * Usage:
 *   node scripts/security-scan-report.cjs                 # JSON to stdout
 *   node scripts/security-scan-report.cjs --out <file>    # JSON to <file>
 *
 * Exit codes: 0 ok · 1 scan failed · 2 dist/ not built.
 *
 * This is a repo tool; it is NOT part of the packaged product (build.files only
 * ships dist/, assets/, catalogs/ and sources/).
 */

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const scannerPath = path.join(repoRoot, 'dist', 'main', 'services', 'security-scan.js');

function parseArgs(argv) {
  const out = { out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') out.out = argv[++i];
    else if (arg.startsWith('--out=')) out.out = arg.slice('--out='.length);
  }
  return out;
}

/**
 * `tsc` does not rewrite the `@shared/*` path alias, so the compiled scanner
 * emits `require("@shared/security-scan")`. The app patches Node's resolver at
 * runtime (src/main/register-shared-alias.ts); we reproduce that mapping here,
 * pointing at `dist/shared/*`.
 */
function installSharedAlias() {
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (typeof request === 'string' && request.startsWith('@shared/')) {
      const target = path.join(repoRoot, 'dist', 'shared', request.slice('@shared/'.length));
      return originalResolveFilename.call(this, target, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(scannerPath)) {
    console.error(`[security-scan-report] Missing ${scannerPath}. Run "npm run build" first.`);
    process.exit(2);
  }

  installSharedAlias();
  const { runSecurityScan } = require(scannerPath);
  const report = await runSecurityScan();
  const json = JSON.stringify(report, null, 2);

  if (args.out) {
    const target = path.resolve(args.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json, 'utf8');
    console.error(
      `[security-scan-report] wrote ${target} (${report.checks.length} checks, score ${report.score})`
    );
  } else {
    process.stdout.write(`${json}\n`);
  }
}

main().catch((error) => {
  console.error(
    '[security-scan-report] failed:',
    error && error.stack ? error.stack : String(error)
  );
  process.exit(1);
});
