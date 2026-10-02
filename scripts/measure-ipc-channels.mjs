// Focused IPC-channel measurement harness.
//
// Re-measures the three channels that the UI harness left "no concluyente"
// (`drivers:scan`, `bundles:check-installed`, `system:get-info`) with a fixed
// number of repetitions so a median + min/max can be reported instead of a
// single number.
//
// Methodology mirrors scripts/measure-system-info.mjs: it loads the COMPILED
// main-process services from dist/ and runs the real code paths against real
// PowerShell, one channel per invocation, no navigation in parallel. Calls go
// straight to the service functions, so the `withCache` wrapper registered at
// the ipcMain layer is bypassed and every repetition pays the cold cost.
//
// Usage: node scripts/measure-ipc-channels.mjs [--runs 5] [--out docs/perf/x.json]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const dist = resolve(here, '..', 'dist', 'main', 'services');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const RUNS = Math.max(1, Number(arg('runs', '5')));
const OUT = arg('out', '');

const ps = require(resolve(dist, 'powershell.js'));
const systemInfo = require(resolve(dist, 'system-info.js'));
const drivers = require(resolve(dist, 'driver-updater.js'));
const bundles = require(resolve(dist, 'app-bundles.js'));

// Count process spawns through the single PowerShell entry point used everywhere.
let spawns = 0;
const realRun = ps.runPowerShell;
ps.runPowerShell = (script, ...rest) => {
  spawns += 1;
  return realRun(script, ...rest);
};

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const round1 = (x) => Math.round(x * 10) / 10;

// Each entry: the real channel, the service call it maps to, and a sanity probe
// so a suspiciously fast run can be proven to have done real work.
const CHANNELS = [
  {
    channel: 'system:get-info',
    call: () => systemInfo.getSystemInfo(),
    sanity: (r) =>
      r && r.cpu
        ? `cpu=${r.cpu.model ? 'ok' : 'missing'} mem=${r.memory?.total ? 'ok' : 'missing'}`
        : 'EMPTY',
  },
  {
    channel: 'drivers:scan',
    call: () => drivers.scanDrivers(),
    sanity: (r) =>
      r && typeof r.totalDevices === 'number'
        ? `devices=${r.totalDevices} outdated=${r.outdatedCount}`
        : 'EMPTY',
  },
  {
    channel: 'bundles:check-installed',
    call: () => bundles.checkInstalledApps(),
    sanity: (r) =>
      r instanceof Map
        ? `apps=${r.size} installed=${[...r.values()].filter(Boolean).length}`
        : 'EMPTY',
  },
];

async function timeOnce(entry) {
  spawns = 0;
  const start = performance.now();
  let ok = true;
  let detail = '';
  try {
    const result = await entry.call();
    detail = entry.sanity(result);
    if (detail === 'EMPTY') ok = false;
  } catch (err) {
    ok = false;
    detail = `ERROR ${String(err?.message || err).slice(0, 120)}`;
  }
  const ms = Math.round(performance.now() - start);
  return { ms, spawns, ok, detail };
}

async function measure(entry) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await timeOnce(entry);
    samples.push(r);
    console.error(
      `  ${entry.channel} run ${i + 1}/${RUNS}: ${r.ms} ms, spawns=${r.spawns}, ${r.ok ? 'ok' : 'FAIL'} (${r.detail})`
    );
  }
  const ms = samples.map((s) => s.ms);
  const okCount = samples.filter((s) => s.ok).length;
  return {
    channel: entry.channel,
    runs: RUNS,
    okRuns: okCount,
    min: Math.min(...ms),
    max: Math.max(...ms),
    median: median(ms),
    samples: ms,
    spawns: samples[samples.length - 1].spawns,
    details: samples.map((s) => s.detail),
  };
}

const results = [];
for (const entry of CHANNELS) {
  console.error(`[channel] ${entry.channel} (${RUNS} runs)...`);
  results.push(await measure(entry));
}

const report = {
  meta: {
    when: new Date().toISOString(),
    runs: RUNS,
    methodology:
      'compiled dist/main/services called directly against real PowerShell, one channel per invocation, sequential (no parallel navigation); withCache bypassed -> cold-cache cost',
    node: process.version,
  },
  results,
};

console.log('\n=== IPC channel measurements (real PowerShell, cold cache) ===');
console.table(
  results.map((r) => ({
    channel: r.channel,
    runs: `${r.okRuns}/${r.runs} ok`,
    medianMs: r.median,
    minMs: r.min,
    maxMs: r.max,
    spawns: r.spawns,
    samples: r.samples.join(', '),
  }))
);

if (OUT) {
  mkdirSync(dirname(resolve(OUT)), { recursive: true });
  const json = JSON.stringify(report, null, 2);
  writeFileSync(resolve(OUT), json);
  console.error(`written: ${OUT} (${json.length} bytes)`);
}

// Human-readable digest for the doc.
for (const r of results) {
  console.log(
    `${r.channel}: mediana ${r.median} ms (min ${r.min} / max ${r.max}), ${r.okRuns}/${r.runs} ok, ${r.spawns} spawn(s), muestras [${r.samples.join(', ')}]`
  );
}
