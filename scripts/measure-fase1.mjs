// Fase 1 measurement harness (v0.11.0).
//
// Measures the real cost of the channels touched by PLAN_MEJORAS Fase 1
// (1.1/1.3/1.4/1.6/1.7) against REAL PowerShell, counting spawns through the
// single `runPowerShell` entry point — same methodology as
// scripts/measure-system-info.mjs.
//
// Loads the COMPILED main-process services from dist/ and calls them
// directly (bypassing the `withCache` IPC wrapper), so every repetition pays
// the cold cost unless stated otherwise.
//
// Usage:
//   npm run build
//   node scripts/measure-fase1.mjs [--out docs/perf/fase1-v0.11.json] [--skip-dns]
//
// The `cleaner:delete` probe uses ONLY scratch files under %TEMP%
// (`forchi-fase1-scratch-*`) and removes them afterwards. It never touches
// real user data.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, mkdtempSync, writeFileSync as writeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const dist = resolve(ROOT, 'dist', 'main', 'services');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const OUT = arg('out', '');
const SKIP_DNS = process.argv.includes('--skip-dns');

const ps = require(resolve(dist, 'powershell.js'));
const cache = require(resolve(dist, 'cache.js'));

let spawns = 0;
const realRun = ps.runPowerShell;
ps.runPowerShell = (script, ...rest) => {
  spawns += 1;
  return realRun(script, ...rest);
};

const resetSpawns = () => {
  spawns = 0;
};
const timed = async (fn) => {
  resetSpawns();
  const start = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - start), spawns };
};

const report = { meta: { when: new Date().toISOString(), node: process.version }, items: {} };
const line = (s) => console.log(s);

// --- 1.3 apps:get-installed (expect 1 spawn after, 3 serial before) ---
{
  const apps = require(resolve(dist, 'installed-apps.js'));
  const samples = [];
  for (let i = 0; i < 2; i++) {
    const { value, ms, spawns: sp } = await timed(() => apps.getInstalledApps());
    samples.push(ms);
    line(`  apps:get-installed run ${i + 1}/2: ${ms} ms, spawns=${sp}, apps=${value.length}`);
    report.items['apps:get-installed'] = {
      spawns: sp,
      samplesMs: samples,
      count: value.length,
    };
  }
}

// --- 1.7 adapter: 3 resolves (expect 1 spawn warm after, 3 before) ---
{
  const { resolveActiveAdapter, clearActiveAdapterCache } = require(
    resolve(dist, 'network-adapter.js')
  );
  if (clearActiveAdapterCache) clearActiveAdapterCache();
  resetSpawns();
  const start = performance.now();
  const a1 = await resolveActiveAdapter();
  const a2 = await resolveActiveAdapter();
  const a3 = await resolveActiveAdapter();
  const ms = Math.round(performance.now() - start);
  line(
    `  resolveActiveAdapter x3: ${ms} ms, spawns=${spawns}, adapter=${a1 ? a1.name : 'null'} (repeated=${a2?.interfaceIndex === a1?.interfaceIndex && a3?.interfaceIndex === a1?.interfaceIndex})`
  );
  report.items['resolveActiveAdapter-x3'] = { ms, spawns, adapter: a1?.name ?? null };
}

// --- 1.1/1.7 dns:benchmark (cold; harness-bypassed cache) ---
if (!SKIP_DNS) {
  const sec = require(resolve(dist, 'security-privacy.js'));
  const { value, ms, spawns: sp } = await timed(() => sec.benchmarkDNS());
  line(
    `  dns:benchmark: ${ms} ms, spawns=${sp}, servers=${value.length} latencies=[${value.map((d) => d.avgLatency).join(', ')}]`
  );
  report.items['dns:benchmark'] = {
    ms,
    spawns: sp,
    latencies: value.map((d) => ({ name: d.name, ms: d.avgLatency })),
  };
} else {
  line('  dns:benchmark: skipped (--skip-dns)');
}

// --- 1.4 benchmark:run (cold; 1-2 spawns after, ~19-20 before) ---
{
  const bench = require(resolve(dist, 'benchmark.js'));
  const { value, ms, spawns: sp } = await timed(() => bench.runBenchmark());
  line(
    `  benchmark:run: ${ms} ms, spawns=${sp}, results=${value.results.length}, totalScore=${value.totalScore}`
  );
  report.items['benchmark:run'] = {
    ms,
    spawns: sp,
    results: value.results.length,
    totalScore: value.totalScore,
  };
}

// --- 1.6 cleaner:delete on scratch only (N files -> 1 spawn, verified) ---
{
  const junk = require(resolve(dist, 'junk-scanner.js'));
  const scratch = mkdtempSync(join(tmpdir(), 'forchi-fase1-scratch-'));
  const N = 10;
  const files = [];
  for (let i = 0; i < N; i++) {
    const f = join(scratch, `probe-${i}.tmp`);
    writeSync(f, `fase1-probe-${i}`);
    files.push(f);
  }
  const { value, ms, spawns: sp } = await timed(() => junk.deleteJunkFiles(files));
  const { existsSync } = require('node:fs');
  const remaining = files.filter((f) => existsSync(f));
  line(
    `  cleaner:delete x${N} (scratch): ${ms} ms, spawns=${sp}, deleted=${value.deleted} failed=${value.failed} remaining=${remaining.length}`
  );
  report.items['cleaner:delete-scratch'] = {
    ms,
    spawns: sp,
    files: N,
    deleted: value.deleted,
    failed: value.failed,
    remaining: remaining.length,
  };
  rmSync(scratch, { recursive: true, force: true });
}

// --- cache reuse mechanism (generic withCache, loader counted) ---
{
  cache.cache.clear();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return { ok: true };
  };
  await cache.withCache('dns', loader);
  await cache.withCache('dns', loader);
  await cache.withCache('benchmark', loader);
  await cache.withCache('benchmark', loader);
  line(`  withCache reuse: 4 reads -> ${loads} loader runs (expect 2)`);
  report.items['withCache-reuse'] = { reads: 4, loaderRuns: loads };
}

console.log('\n=== Fase 1 measurements (real PowerShell, cold service calls) ===');
console.table(
  Object.entries(report.items).map(([k, v]) => ({ item: k, ...v, latencies: undefined }))
);

if (OUT) {
  mkdirSync(dirname(resolve(OUT)), { recursive: true });
  const json = JSON.stringify(report, null, 2);
  writeFileSync(resolve(OUT), json);
  console.error(`written: ${OUT} (${json.length} bytes)`);
}
