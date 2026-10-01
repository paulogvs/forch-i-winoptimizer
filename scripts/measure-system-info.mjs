// Real measurement harness for the P1.1 optimization.
//
// Loads the COMPILED main-process services (dist/) and runs the actual code
// paths against real PowerShell, counting processes spawned and wall-clock time.
// Usage: node scripts/measure-system-info.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist', 'main', 'services');

const ps = require(path.join(dist, 'powershell.js'));
const systemInfo = require(path.join(dist, 'system-info.js'));
const junk = require(path.join(dist, 'junk-scanner.js'));
const drivers = require(path.join(dist, 'driver-updater.js'));

// Count spawns by wrapping the single PowerShell entry point used everywhere.
let spawns = 0;
const realRun = ps.runPowerShell;
ps.runPowerShell = (script, ...rest) => {
  spawns += 1;
  return realRun(script, ...rest);
};

async function timeOnce(label, fn) {
  spawns = 0;
  const start = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - start);
  return { label, ms, spawns, ok: Boolean(result) };
}

async function average(label, fn, runs = 3) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    samples.push(await timeOnce(label, fn));
  }
  const avg = Math.round(samples.reduce((sum, s) => sum + s.ms, 0) / samples.length);
  const spawns = samples[samples.length - 1].spawns;
  return { label, avgMs: avg, spawns, samples: samples.map((s) => s.ms) };
}

const results = [];
results.push(await average('System Info (batched, 1 spawn)', () => systemInfo.getSystemInfo()));
systemInfo.setSystemInfoBatchEnabled(false);
results.push(await average('System Info (legacy, 4 spawns)', () => systemInfo.getSystemInfo()));
systemInfo.setSystemInfoBatchEnabled(true);
results.push(await average('Drivers scan', () => drivers.scanDrivers(), 2));
results.push(await average('Junk scan', () => junk.scanForJunkFiles(), 1));

console.log('\n=== WinOptimizer scan measurements (real PowerShell) ===');
console.table(results.map((r) => ({ scan: r.label, avgMs: r.avgMs, spawns: r.spawns, samples: r.samples.join(', ') })));

const batched = results.find((r) => r.label.includes('batched'));
const legacy = results.find((r) => r.label.includes('legacy'));
if (batched && legacy) {
  const saved = Math.round(((legacy.avgMs - batched.avgMs) / legacy.avgMs) * 100);
  console.log(`System Info: ${legacy.avgMs}ms -> ${batched.avgMs}ms (${saved}% faster), spawns ${legacy.spawns} -> ${batched.spawns}`);
}
