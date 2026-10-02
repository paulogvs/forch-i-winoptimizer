// Real measurement harness for the P1.1 "Free RAM" action.
//
// Loads the COMPILED main-process service (dist/) and runs the actual
// freeMemory() path against real PowerShell, reporting RSS before/after.
// Usage: node scripts/measure-free-memory.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist', 'main', 'services');

const { freeMemory } = require(path.join(dist, 'memory-free.js'));

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

// Fatten this process so EmptyWorkingSet has a real working set to trim.
const fat = [];
for (let i = 0; i < 40; i += 1) fat.push(Buffer.alloc(5 * 1024 * 1024, 0xa5));
fat.forEach((b) => {
  b[0] = 1;
  b[b.length - 1] = 1;
});

const rssBefore = process.memoryUsage().rss;
const started = Date.now();
const result = await freeMemory();
const elapsed = Date.now() - started;
const rssAfter = process.memoryUsage().rss;

console.log(
  JSON.stringify(
    {
      rssBeforeMb: Number(mb(rssBefore)),
      rssAfterMb: Number(mb(rssAfter)),
      freedMbReported: result.freedMb,
      success: result.success,
      error: result.error ?? null,
      wallMs: elapsed,
      fatBuffersRetained: fat.length,
    },
    null,
    2
  )
);

// Keep the buffers alive until after the measurement is printed.
if (fat.length === 0) console.log('unreachable');
