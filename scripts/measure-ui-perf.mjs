/**
 * UI / navigation performance harness for FORCH.iA WinOptimizer.
 *
 * Launches the REAL packaged Electron app (`dist/main/index.js`) through
 * Playwright and measures, without touching production code:
 *
 *   1. startup     launch -> window -> DOMContentLoaded -> FCP
 *   2. navigation  sidebar click -> target page title -> skeleton-free
 *   3. ipc         every ipcMain handler round-trip during a navigation
 *   4. longtasks   PerformanceObserver('longtask') from document start
 *   5. interactions (Dashboard refresh, Tweaks modal, Tools tab switch, scroll)
 *   6. retention   JS heap / DOM nodes / DOM listeners over N nav cycles
 *
 * IPC is instrumented by re-wrapping the already-registered handlers held in
 * `ipcMain._invokeHandlers` (a Map) from inside the main process. That is an
 * Electron internal used read-only for diagnostics here; production code is
 * untouched. If the shape ever changes the script degrades gracefully and
 * reports `ipcInstrumented: false`.
 *
 * Usage:  node scripts/measure-ui-perf.mjs [--out docs/perf/x.json] [--cycles 3]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PAGES = [
  { id: 'dashboard', title: 'Dashboard' },
  { id: 'cleaner', title: 'Cleaner' },
  { id: 'boost', title: 'Boost' },
  { id: 'tools', title: 'Tools' },
  { id: 'drivers', title: 'Driver Updater' },
  { id: 'network', title: 'Network Fixer' },
  { id: 'audit', title: 'System Audit' },
  { id: 'benchmark', title: 'Benchmark' },
  { id: 'bundles', title: 'App Bundles' },
  { id: 'cleaning', title: 'Scheduled Cleaning' },
  { id: 'tweaks', title: 'Tweaks' },
  { id: 'statistics', title: 'Statistics' },
  { id: 'security', title: 'Security & Privacy' },
  { id: 'settings', title: 'Settings' },
];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const OUT = arg('out', '');
const CYCLES = Number(arg('cycles', '3'));

const now = () => Date.now();
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Init script: long-task observer + DOM listener counter, installed before page scripts. */
const INIT_SCRIPT = () => {
  const w = window;
  w.__longTasks = [];
  w.__listenerNet = 0;
  w.__listenerAdds = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w.__longTasks.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* longtask unsupported */
  }
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, opts) {
    if (typeof listener === 'function') {
      w.__listenerNet += 1;
      w.__listenerAdds += 1;
    }
    return add.call(this, type, listener, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, opts) {
    if (typeof listener === 'function') w.__listenerNet -= 1;
    return remove.call(this, type, listener, opts);
  };

  // --- Navigation tracker (in-page, MutationObserver-based) ----------------
  // Playwright's waitForFunction polls on requestAnimationFrame and its
  // locator.click() waits for actionability; both are throttled when the
  // window is occluded and were the source of ~25s phantom "page load" times.
  // Timestamps here are taken by the renderer itself at mutation time, so
  // polling latency from Node only delays when we stop reading, never the
  // measurement.
  w.__navState = { title: null, skeleton: null, sig: null, modal: null };
  w.__navEvents = [];
  const readNavState = () => {
    const titles = [...document.querySelectorAll('.page-title')].map((e) => (e.textContent || '').trim());
    const title = titles.length ? titles[0] : null;
    const main = document.querySelector('.main-content');
    const skeleton = !!main && !!main.querySelector('.skeleton, [data-testid^="skeleton"]');
    // Content signature: catches "page filled in" without relying on skeletons.
    const sig = main ? `${main.childElementCount}|${main.textContent.length}` : 'none';
    return { title, skeleton, sig, modal: !!document.querySelector('.modal') };
  };
  w.__navSample = () => {
    const s = readNavState();
    const p = w.__navState;
    if (s.title !== p.title || s.skeleton !== p.skeleton || s.sig !== p.sig || s.modal !== p.modal) {
      w.__navState = s;
      w.__navEvents.push({
        t: Math.round(performance.now()),
        title: s.title,
        skeleton: s.skeleton,
        sig: s.sig,
        modal: s.modal,
      });
    }
    return s;
  };
  w.__navReset = () => {
    w.__navEvents = [];
    w.__navState = { title: null, skeleton: null, sig: null, modal: null };
    w.__navSample();
  };
  const navObserver = new MutationObserver(() => w.__navSample());
  navObserver.observe(document, { subtree: true, childList: true, characterData: true });

  // A React tree with no error boundary unmounts everything on a render throw,
  // which showed up as "sidebar button not found". Keep the reason.
  w.__pageErrors = [];
  const recordError = (source) => (event) => {
    const e = event.error || event.reason || event.message || event;
    w.__pageErrors.push({
      t: Math.round(performance.now()),
      source,
      message: String((e && e.message) || e).slice(0, 500),
      stack: String((e && e.stack) || '').slice(0, 1500),
    });
  };
  w.addEventListener('error', recordError('error'));
  w.addEventListener('unhandledrejection', recordError('unhandledrejection'));
};

const runtime = () => ({
  longTasks: window.__longTasks ?? [],
  listenerNet: window.__listenerNet ?? 0,
  listenerAdds: window.__listenerAdds ?? 0,
  heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null,
  domNodes: document.querySelectorAll('*').length,
});

async function instrumentIpc(app) {
  return app.evaluate(({ ipcMain }) => {
    const h = ipcMain && ipcMain._invokeHandlers;
    if (!h || !(h instanceof Map) || h.size === 0) return { ok: false, reason: 'no map' };
    if (globalThis.__ipcInstrumented) return { ok: true, count: h.size, already: true };
    let n = 0;
    for (const [channel, fn] of [...h]) {
      h.delete(channel);
      ipcMain.handle(channel, async (event, ...args) => {
        const seq = (globalThis.__ipcSeq = (globalThis.__ipcSeq ?? 0) + 1);
        const t0 = performance.now();
        // Log the START too: a handler that never completes stays visible as a
        // pending entry instead of silently disappearing from the totals.
        (globalThis.__ipcLog ??= []).push({ channel, phase: 's', seq, at: Math.round(t0) });
        try {
          return await fn(event, ...args);
        } finally {
          const ms = performance.now() - t0;
          globalThis.__ipcLog.push({ channel, phase: 'e', seq, at: Math.round(t0), ms: Math.round(ms * 10) / 10 });
        }
      });
      n += 1;
    }
    globalThis.__ipcInstrumented = true;
    globalThis.__ipcLog = [];
    globalThis.__ipcReset = () => {
      globalThis.__ipcLog = [];
    };
    return { ok: true, count: n };
  });
}

const ipcReset = (app) => app.evaluate(() => globalThis.__ipcReset && globalThis.__ipcReset());
const ipcLog = (app) => app.evaluate(() => globalThis.__ipcLog ?? []);

/**
 * Split the log into completed round-trips and handlers that STARTED but never
 * finished (still blocked at read time). `started` counts both so a page whose
 * handler is stuck is not reported as "0 IPC".
 */
async function readIpc(app) {
  const raw = await ipcLog(app);
  const open = new Map();
  const done = [];
  for (const e of raw) {
    if (e.phase === 's') open.set(e.seq, e);
    else if (e.phase === 'e') {
      open.delete(e.seq);
      done.push({ ch: e.channel, ms: e.ms });
    }
  }
  return {
    started: raw.filter((e) => e.phase === 's').length,
    completed: done,
    pending: [...open.values()].map((e) => ({ ch: e.channel, startedAt: e.at })),
    totalMs: Math.round(done.reduce((s, e) => s + e.ms, 0) * 10) / 10,
    maxMs: done.length ? Math.max(...done.map((e) => e.ms)) : 0,
  };
}

/**
 * Wait until the in-page nav tracker has recorded a title change to `title`.
 * Returns the recorded event (renderer `performance.now()` timestamps).
 * Poll rate only affects when we stop; the event time is exact.
 */
async function waitTitleEvent(page, title, timeoutMs = 30000) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const hit = await page.evaluate(
      (t) => (window.__navEvents ?? []).find((e) => e.title && e.title.includes(t)) ?? null,
      title
    );
    if (hit) return hit;
    if (now() > deadline) throw new Error(`no title event for "${title}" in ${timeoutMs}ms`);
    await page.waitForTimeout(50);
  }
}

/** Wait until the tracker records the target title with no skeleton showing. */
async function waitReadyEvent(page, title, timeoutMs = 30000) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const hit = await page.evaluate(
      (t) => (window.__navEvents ?? []).find((e) => e.title && e.title.includes(t) && !e.skeleton) ?? null,
      title
    );
    if (hit) return hit;
    if (now() > deadline) return null; // skeleton never cleared within timeout
    await page.waitForTimeout(50);
  }
}

/**
 * Wait until the tracked DOM state stops changing for `quietMs`, i.e. the
 * page has settled after an interaction. Returns `{ settledAt, events }` where
 * `settledAt` is the renderer timestamp of the last observed change (relative
 * to the most recent `__navReset()` baseline event), or `null` on timeout.
 */
async function waitQuiet(page, { quietMs = 250, maxMs = 8000, minEvents = 2 } = {}) {
  const deadline = now() + maxMs;
  let lastCount = -1;
  let lastChangeAt = now();
  for (;;) {
    const s = await page.evaluate(() => ({
      n: (window.__navEvents ?? []).length,
      t: (window.__navEvents ?? []).length ? window.__navEvents[window.__navEvents.length - 1].t : null,
    }));
    if (s.n !== lastCount) {
      lastCount = s.n;
      lastChangeAt = now();
    }
    // Event 0 is always the baseline snapshot taken by __navReset(); requiring
    // a second event stops an interaction that changes nothing from being
    // reported as ~0ms.
    const quietFor = now() - lastChangeAt;
    if (s.n >= minEvents && quietFor >= quietMs) {
      return { settledAt: s.t, events: await page.evaluate(() => window.__navEvents ?? []) };
    }
    if (now() > deadline) {
      return { settledAt: null, events: await page.evaluate(() => window.__navEvents ?? []) };
    }
    await page.waitForTimeout(50);
  }
}

/**
 * Reset the tracker + IPC log, dispatch a click (or key) from inside the page
 * and wait for the DOM to settle — all so interaction latency is measured on
 * the renderer clock with no Playwright round trip between the reset and the
 * event.
 *
 * `action` is plain data: `{ kind: 'selector'|'buttonText'|'key', value }`.
 */
async function measureAction(app, page, action, { quietMs = 250, maxMs = 8000 } = {}) {
  await ipcReset(app);
  const started = await page.evaluate((a) => {
    window.__navReset();
    const t = Math.round(performance.now());
    let el = null;
    if (a.kind === 'selector') el = document.querySelector(a.value);
    else if (a.kind === 'buttonText') el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === a.value);
    if (a.kind === 'key') document.dispatchEvent(new KeyboardEvent('keydown', { key: a.value, bubbles: true }));
    else if (el) el.click();
    return { t, found: a.kind === 'key' ? true : !!el };
  }, action);

  const { settledAt, events } = await waitQuiet(page, { quietMs, maxMs });
  const ipc = await readIpc(app);
  const rt = await page.evaluate(runtime);
  return {
    found: started.found,
    ms: settledAt != null ? settledAt - started.t : null,
    events,
    ipc: ipc.completed,
    ipcStarted: ipc.started,
    ipcPending: ipc.pending,
    ipcCount: ipc.completed.length,
    ipcTotalMs: ipc.totalMs,
    heapMb: rt.heapMb,
    domNodes: rt.domNodes,
    listenerNet: rt.listenerNet,
  };
}

/**
 * Navigate by dispatching a real `click()` from inside the page.
 *
 * We deliberately do NOT use Playwright's locator.click() here: it waits for
 * actionability (stable box, hit-test, pointer events), which this harness
 * cannot separate from application latency. The dispatch is synchronous, so
 * `tClick` is the exact renderer clock at which the app received the event.
 */
async function navigate(app, page, index) {
  const target = PAGES[index];
  await ipcReset(app);
  const before = await page.evaluate(() => ({ longTasks: (window.__longTasks ?? []).length }));

  const started = await page.evaluate((idx) => {
    window.__navReset();
    const btn = document.querySelectorAll('.sidebar .nav-item')[idx];
    if (!btn) return null;
    const tClick = Math.round(performance.now());
    const beforeTitle = window.__navState.title;
    btn.click();
    return { tClick, beforeTitle, label: (btn.textContent || '').trim() };
  }, index);
  if (!started) {
    // The sidebar never unmounts in Layout, so an empty match means the React
    // tree is gone (uncaught render error with no error boundary). Snapshot
    // enough to prove it instead of silently reporting a timing.
    const diag = await page
      .evaluate(() => ({
        rootChildren: document.getElementById('root')?.childElementCount ?? -1,
        bodyTextLen: (document.body.textContent || '').length,
        navItems: document.querySelectorAll('.sidebar .nav-item').length,
        pageErrors: window.__pageErrors ?? [],
        url: location.href,
      }))
      .catch((e) => ({ evaluateFailed: String(e) }));
    return { id: target.id, error: 'sidebar button not found', diag };
  }

  // Clicking the page we are already on produces no DOM change to timestamp.
  if (started.beforeTitle && started.beforeTitle.includes(target.title)) {
    return { id: target.id, selfNav: true, titleMs: null, readyMs: null, ipcCount: 0, ipcTotalMs: 0 };
  }

  let titleEv = null;
  try {
    titleEv = await waitTitleEvent(page, target.title);
  } catch (err) {
    return { id: target.id, error: String(err.message || err) };
  }
  // Skeleton cleared == the page stopped showing placeholders.
  const readyEv = await waitReadyEvent(page, target.title, 15000);
  // Content settled == no tracked DOM change for 300ms (title, skeleton, DOM
  // size/text, modal). This is the honest "page is usable" number and is also
  // when we read IPC, so handlers that finish after the skeleton clears are
  // not missed.
  const settle = await waitQuiet(page, { quietMs: 300, maxMs: 20000, minEvents: 2 });

  const ipc = await readIpc(app);
  const rt = await page.evaluate(runtime);
  const newTasks = rt.longTasks.slice(before.longTasks);
  const navEvents = await page.evaluate(() => window.__navEvents ?? []);

  return {
    id: target.id,
    titleMs: titleEv.t - started.tClick,
    readyMs: readyEv ? readyEv.t - started.tClick : null,
    settledMs: settle.settledAt != null ? settle.settledAt - started.tClick : null,
    // Full in-page event trace: how the page filled in after the title hit.
    navEvents,
    ipc: ipc.completed,
    ipcStarted: ipc.started,
    ipcPending: ipc.pending,
    ipcCount: ipc.completed.length,
    ipcTotalMs: ipc.totalMs,
    ipcMaxMs: ipc.maxMs,
    longTasks: newTasks,
    heapMb: rt.heapMb,
    domNodes: rt.domNodes,
    listenerNet: rt.listenerNet,
  };
}

async function measureStartup() {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const t0 = now();
    const app = await electron.launch({ args: ['.'], cwd: ROOT });
    const page = await app.firstWindow();
    const tWindow = now() - t0;
    await page.waitForLoadState('load');
    const tLoad = now() - t0;
    const nav = await page.evaluate(() => {
      const e = performance.getEntriesByType('navigation')[0];
      const paints = performance.getEntriesByType('paint');
      const fcp = paints.find((p) => p.name === 'first-contentful-paint');
      return {
        dclMs: e ? Math.round(e.domContentLoadedEventEnd) : null,
        loadMs: e ? Math.round(e.loadEventEnd) : null,
        fcpMs: fcp ? Math.round(fcp.startTime) : null,
        domNodes: document.querySelectorAll('*').length,
      };
    });
    runs.push({ windowMs: tWindow, loadMs: tLoad, ...nav });
    await app.close();
    await new Promise((r) => setTimeout(r, 1200));
  }
  return runs;
}

/** Renderer-startup work: reload with the init script installed, collect long tasks. */
async function measureColdRender(app, page) {
  await page.evaluate(() => {
    window.__longTasks = [];
  });
  const t0 = now();
  await page.reload({ waitUntil: 'load' });
  const reloadMs = now() - t0;
  await page.waitForTimeout(600);
  const rt = await page.evaluate(runtime);
  return { reloadMs, longTasks: rt.longTasks, heapMb: rt.heapMb, domNodes: rt.domNodes };
}

async function measureInteractions(app, page) {
  const out = {};

  // --- Dashboard refresh (force=true bypasses the 60s System Info cache) ---
  await navigate(app, page, 0);
  out.dashboardRefresh = await measureAction(
    app,
    page,
    { kind: 'buttonText', value: 'Refresh' },
    { quietMs: 400, maxMs: 25000 } // force=true bypasses the 60s cache -> real PowerShell
  );

  // --- Tweaks modal open + close ---
  await navigate(app, page, 10);
  out.modalOpen = await measureAction(app, page, { kind: 'buttonText', value: 'Preview' }, { maxMs: 4000 });
  out.modalClose = await measureAction(app, page, { kind: 'key', value: 'Escape' }, { maxMs: 4000 });

  // --- Tools tab switches (each tab fires its own IPC on mount) ---
  await navigate(app, page, 3);
  out.toolsTabs = {};
  for (const tab of ['Startup', 'Debloat', 'Utilities', 'Apps']) {
    out.toolsTabs[tab] = await measureAction(app, page, { kind: 'buttonText', value: tab });
  }

  // --- Scroll frame timing on the longest list (Tools -> Apps, 153 rows) ---
  out.scroll = await page.evaluate(async () => {
    // The Apps list is `max-h-96 overflow-y-auto`, so the page-level scroller
    // is NOT the container under test. Find the deepest element that actually
    // scrolls; fall back to the document.
    const candidates = [...document.querySelectorAll('*')].filter((el) => {
      const oy = getComputedStyle(el).overflowY;
      return el.scrollHeight > el.clientHeight + 60 && (oy === 'auto' || oy === 'scroll');
    });
    const scroller = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] ?? document.scrollingElement;
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 40) return { skipped: 'no scrollable area' };
    const label = scroller === document.scrollingElement ? 'document' : scroller.className;
    const deltas = [];
    let last = performance.now();
    let running = true;
    const tick = (t) => {
      deltas.push(Math.round(t - last));
      last = t;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const start = scroller.scrollTop;
    for (let i = 0; i < 60; i++) {
      scroller.scrollTop = start + i * 40;
      await new Promise((r) => requestAnimationFrame(r));
    }
    running = false;
    scroller.scrollTop = start;
    const sorted = [...deltas].sort((a, b) => a - b);
    return {
      target: label,
      scrollableHeight: scroller.scrollHeight,
      rows: document.querySelectorAll('.flex.items-center.justify-between').length,
      frames: deltas.length,
      p50: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted[sorted.length - 1],
      over34ms: deltas.filter((d) => d > 34).length,
    };
  });

  return out;
}

/**
 * Split one real sidebar navigation into its two parts:
 *   - actionability: Playwright's locator.click() waiting for a stable box /
 *     hit test / pointer events (plus any main-thread stall it blocks on)
 *   - app: renderer clock from the actual click event to the target title
 * If `actionability` dwarfs `appTitle`, the harness itself was the bottleneck
 * and earlier wall-clock numbers were an artifact, not a product regression.
 */
async function measureClickOverhead(app, page) {
  await ipcReset(app);
  const t = await page.evaluate(() => {
    window.__navReset();
    window.__clickAt = null;
    document.addEventListener(
      'click',
      (e) => {
        const nav = e.target && e.target.closest && e.target.closest('.sidebar .nav-item');
        if (nav && window.__clickAt == null) window.__clickAt = Math.round(performance.now());
      },
      { once: false, capture: true }
    );
    return Math.round(performance.now());
  });
  const t0 = now();
  await page.locator('.sidebar .nav-item').nth(1).click(); // Tools -> Tweaks
  const wall = now() - t0;
  const clickAt = await page.evaluate(() => window.__clickAt);
  const titleEv = await waitTitleEvent(page, 'Tweaks').catch(() => null);
  return {
    playwrightClickWallMs: wall,
    actionabilityMs: clickAt != null ? clickAt - t : null, // includes 1 RPC gap
    appTitleMs: titleEv && clickAt != null ? titleEv.t - clickAt : null,
    windowOccludedLikely: clickAt != null && clickAt - t > 2000,
  };
}

async function main() {
  const result = {
    meta: {      when: new Date().toISOString(),
      cycles: CYCLES,
      // Methodology note: page-load and interaction latencies are timestamped
      // INSIDE the renderer by a MutationObserver installed before page
      // scripts, and clicks are dispatched from in-page. This excludes
      // Playwright's actionability waits and rAF-throttled polling, which
      // produced phantom 25-40s "page loads" on the first (occluded window)
      // pass. IPC timings come from main-process wrappers around the 69
      // registered ipcMain handlers.
      clock: 'renderer performance.now() via MutationObserver',
      click: 'in-page HTMLElement.click() (no Playwright actionability wait)',
    },
  };
  // Kept at module scope so a fatal error still dumps what was measured.
  RESULT = result;

  console.error('[1/4] startup (3 launches)...');
  result.startup = await measureStartup();

  console.error('[2/4] launching instrumented app...');
  const app = await electron.launch({ args: ['.'], cwd: ROOT });
  const page = await app.firstWindow();
  await page.context().addInitScript(INIT_SCRIPT);
  await page.bringToFront();
  await page.waitForLoadState('load');
  result.ipcInstrumented = await instrumentIpc(app);

  // Page-level diagnostics: an uncaught exception here is the most likely
  // explanation for a navigation that suddenly cannot find the sidebar.
  const pageIssues = [];
  result.pageIssues = pageIssues;
  page.on('pageerror', (err) => pageIssues.push({ kind: 'pageerror', message: String(err?.message || err).slice(0, 800) }));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      pageIssues.push({ kind: `console.${msg.type()}`, text: msg.text().slice(0, 800) });
    }
  });

  console.error('[3/4] cold renderer pass...');
  result.coldRender = await measureColdRender(app, page);

  // Leave the current page so cycle 0 starts from a real transition rather
  // than a self-navigation (which produces no DOM change to timestamp).
  console.error('[prime] navigating away from the landing page...');
  await navigate(app, page, 13);

  console.error(`[4/4] navigation cycles (${CYCLES} x ${PAGES.length} pages)...`);
  const navs = [];
  for (let c = 0; c < CYCLES; c++) {
    for (let i = 0; i < PAGES.length; i++) {
      const r = await navigate(app, page, i);
      r.cycle = c;
      navs.push(r);
      if (r.error) console.error(`  cycle ${c} ${String(r.id).padEnd(11)} ERROR ${r.error}`);
      else
        console.error(
          `  cycle ${c} ${r.id.padEnd(11)} title=${String(r.titleMs).padStart(5)}ms ready=${String(r.readyMs).padStart(5)}ms settled=${String(r.settledMs).padStart(6)}ms ipc=${r.ipcCount}/${r.ipcStarted} pend=${(r.ipcPending ?? []).length} (${r.ipcTotalMs}ms${r.ipcMaxMs ? ` max ${r.ipcMaxMs}` : ''})`
        );
    }
  }
  result.navigation = navs;

  // Optional diagnostics must never abort the run: losing the JSON because a
  // convenience measurement failed costs the whole baseline.
  console.error('[extra] interactions...');
  try {
    result.interactions = await measureInteractions(app, page);
  } catch (err) {
    result.interactions = { error: String(err?.message || err) };
    console.error(`  interactions ERROR ${result.interactions.error}`);
  }

  console.error('[extra] playwright click overhead...');
  try {
    result.clickOverhead = await measureClickOverhead(app, page);
  } catch (err) {
    result.clickOverhead = { error: String(err?.message || err) };
    console.error(`  clickOverhead ERROR ${result.clickOverhead.error}`);
  }

  // Retention: compare heap / DOM / listeners between cycle 0 and the last.
  const first = navs.filter((n) => n.cycle === 0);
  const last = navs.filter((n) => n.cycle === CYCLES - 1);
  const agg = (rows, key) => median(rows.map((r) => r[key]).filter((v) => v != null));
  result.retention = {
    heapMbCycle0: agg(first, 'heapMb'),
    heapMbLastCycle: agg(last, 'heapMb'),
    domNodesCycle0: agg(first, 'domNodes'),
    domNodesLastCycle: agg(last, 'domNodes'),
    listenerNetCycle0: agg(first, 'listenerNet'),
    listenerNetLastCycle: agg(last, 'listenerNet'),
    ...(await page
      .evaluate(() => ({
        listenerAddsTotal: window.__listenerAdds ?? 0,
        longTasksTotal: (window.__longTasks ?? []).length,
        longTasksByDuration: (window.__longTasks ?? [])
          .map((t) => t.duration)
          .sort((a, b) => b - a)
          .slice(0, 15),
        pageErrors: window.__pageErrors ?? [],
      }))
      .catch((err) => ({ evaluateFailed: String(err?.message || err) }))),
  };

  // Per-page medians across cycles + worst offenders, so the report can cite
  // a single before/after number per page.
  const byPage = {};
  for (const r of navs) {
    if (r.error || r.selfNav) continue;
    (byPage[r.id] ??= []).push(r);
  }
  result.summary = {
    pages: Object.fromEntries(
      Object.entries(byPage).map(([id, rows]) => [
        id,
        {
          titleMedian: median(rows.map((r) => r.titleMs).filter((v) => v != null)),
          readyMedian: median(rows.map((r) => r.readyMs).filter((v) => v != null)),
          settledMedian: median(rows.map((r) => r.settledMs).filter((v) => v != null)),
          ipcCountMax: Math.max(...rows.map((r) => r.ipcCount ?? 0)),
          ipcStartedMax: Math.max(...rows.map((r) => r.ipcStarted ?? 0)),
          ipcTotalMsMedian: median(rows.map((r) => r.ipcTotalMs).filter((v) => v != null)),
          ipcMaxMs: Math.max(...rows.map((r) => r.ipcMaxMs ?? 0)),
          pendingIpcRows: rows.filter((r) => (r.ipcPending ?? []).length > 0).length,
          domNodesMedian: median(rows.map((r) => r.domNodes).filter((v) => v != null)),
        },
      ])
    ),
    slowestTitle: [...navs]
      .filter((r) => r.titleMs != null)
      .sort((a, b) => b.titleMs - a.titleMs)
      .slice(0, 8)
      .map((r) => ({ cycle: r.cycle, id: r.id, titleMs: r.titleMs, readyMs: r.readyMs, ipc: r.ipcCount })),
    navErrors: navs.filter((r) => r.error).map((r) => ({ cycle: r.cycle, id: r.id, error: r.error, diag: r.diag })),
    pendingIpc: navs
      .flatMap((r) => (r.ipcPending ?? []).map((p) => ({ cycle: r.cycle, id: r.id, ...p })))
      .slice(0, 40),
    longTasksOver50: navs
      .flatMap((r) => (r.longTasks ?? []).map((t) => ({ cycle: r.cycle, id: r.id, ...t })))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 20),
    worstIpc: navs
      .flatMap((r) => (r.ipc ?? []).map((e) => ({ cycle: r.cycle, id: r.id, ...e })))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 20),
  };

  await app.close();

  writeResult(result);
  console.error(`navErrors: ${result.summary.navErrors.length}, pageIssues: ${pageIssues.length}`);
  if (pageIssues.length) console.error(JSON.stringify(pageIssues.slice(0, 10), null, 2));
  // Full detail goes to the file; stdout carries the digest so a failed run is
  // still readable in the terminal.
  console.log(JSON.stringify({ meta: result.meta, summary: result.summary }, null, 2));
}

let RESULT = null;
function writeResult(result) {
  if (!OUT) return;
  const json = JSON.stringify(result, null, 2);
  mkdirSync(dirname(resolve(OUT)), { recursive: true });
  writeFileSync(resolve(OUT), json);
  console.error(`written: ${OUT} (${json.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  if (RESULT) {
    RESULT.aborted = String(err?.message || err);
    try {
      writeResult(RESULT);
    } catch (e) {
      console.error('could not write partial result:', e);
    }
  }
  process.exit(1);
});
