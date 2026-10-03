#!/usr/bin/env node
/**
 * heartbeat-client.mjs — FORCH.iA portable heartbeat client (0 LLM tokens).
 *
 * Drop this file into any app (`<app>/scripts/heartbeat-client.mjs`) and call it
 * from the start/dev script. It resolves the FORCH.iA ecosystem root on its own,
 * then appends a REAL liveness beat through the single producer
 * (`scripts/harness-heartbeat.js` → `core/harness/state/heartbeats/<app>.ndjson`)
 * which `scripts/heartbeat-watchdog.mjs` consumes.
 *
 * It NEVER fabricates periodic beats: one invocation = one real event (app start,
 * a completed job, a probe). A failed beat must not break the app: by default the
 * client exits 0 with a warning (use `--strict` to exit 1 instead).
 *
 * Root resolution (first hit wins):
 *   1. $FORCHI_PATH  (must contain scripts/harness-heartbeat.js)
 *   2. walk up from cwd and from this file, looking for
 *      <dir>/core/harness/harness-config.json  OR  <dir>/FORCH-IA-ECOSYSTEM/core/...
 *   3. sibling guess: ../../FORCH-IA-ECOSYSTEM and ../FORCH-IA-ECOSYSTEM
 *
 * Usage:
 *   node scripts/heartbeat-client.mjs --app gph --step "npm run dev"
 *   node scripts/heartbeat-client.mjs --app gph --json
 *
 * Flags:
 *   --app <name>   Registry app name (default: package.json "name", lowercased).
 *   --step <msg>   Human step (default: "start").
 *   --strict       Exit 1 when the beat cannot be written (default: warn + exit 0).
 *   --json         Emit one JSON result object.
 *   --root <path>  Force the ecosystem root (skips resolution).
 *   --help, -h     Show help.
 *
 * Built with FORCH.i by Paulo Velasco.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCER_REL = path.join('scripts', 'harness-heartbeat.js');
const CONFIG_REL = path.join('core', 'harness', 'harness-config.json');

function parseArgs(argv) {
  const out = { app: null, step: 'start', strict: false, json: false, root: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--app') out.app = next();
    else if (a.startsWith('--app=')) out.app = a.slice(6);
    else if (a === '--step') out.step = next();
    else if (a.startsWith('--step=')) out.step = a.slice(7);
    else if (a === '--strict') out.strict = true;
    else if (a === '--json') out.json = true;
    else if (a === '--root') out.root = next();
    else if (a.startsWith('--root=')) out.root = a.slice(7);
  }
  return out;
}

function printHelp() {
  console.log(`
heartbeat-client — portable FORCH.iA liveness beat for any app.

Usage: node scripts/heartbeat-client.mjs --app <name> [--step "<msg>"] [--json] [--strict]
Exit:  0 (beat written, or best-effort warning) | 1 only with --strict on failure.
`.trim());
}

function isEcosystemRoot(dir) {
  try {
    return fs.existsSync(path.join(dir, PRODUCER_REL)) && fs.existsSync(path.join(dir, CONFIG_REL));
  } catch { return false; }
}

function ancestors(start) {
  const out = [];
  let cur = path.resolve(start);
  for (let i = 0; i < 10; i++) {
    out.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}

function resolveRoot(explicit) {
  if (explicit) {
    const abs = path.resolve(explicit);
    return isEcosystemRoot(abs) ? abs : null;
  }
  const env = process.env.FORCHI_PATH;
  if (env && isEcosystemRoot(env)) return path.resolve(env);

  const starts = [process.cwd(), __dirname];
  for (const start of starts) {
    for (const anc of ancestors(start)) {
      if (isEcosystemRoot(anc)) return anc;
      const sibling = path.join(anc, 'FORCH-IA-ECOSYSTEM');
      if (isEcosystemRoot(sibling)) return sibling;
    }
  }
  // last resort: explicit relative guesses from cwd
  for (const rel of [path.join('..', 'FORCH-IA-ECOSYSTEM'), path.join('..', '..', 'FORCH-IA-ECOSYSTEM')]) {
    const guess = path.resolve(process.cwd(), rel);
    if (isEcosystemRoot(guess)) return guess;
  }
  return null;
}

function inferApp() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    if (pkg && typeof pkg.name === 'string' && pkg.name.trim()) return pkg.name.trim().toLowerCase();
  } catch { /* ignore */ }
  return path.basename(process.cwd()).toLowerCase();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

  const app = args.app || inferApp();
  const result = { client: 'heartbeat-client', app, step: args.step, root: null, ok: false, error: null };

  const root = resolveRoot(args.root);
  result.root = root;
  if (!root) {
    result.error = 'ecosystem root not found (set FORCHI_PATH or run from inside/next to the ecosystem)';
    return finish(result, args);
  }

  const producer = path.join(root, PRODUCER_REL);
  const r = spawnSync(process.execPath, [producer, '--app', app, '--step', args.step], {
    encoding: 'utf8', windowsHide: true,
  });
  if (r.status === 0) {
    result.ok = true;
    result.stdout = (r.stdout || '').trim();
  } else {
    result.error = `producer exited ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`;
  }
  return finish(result, args);
}

function finish(result, args) {
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`✅ heartbeat-client: ${result.app} → ${result.stdout || 'beat written'}`);
  else console.log(`⚠ heartbeat-client: ${result.app} — ${result.error}`);
  // A heartbeat must never break the app start. --strict opts into failure.
  process.exit(result.ok ? 0 : (args.strict ? 1 : 0));
}

main();
