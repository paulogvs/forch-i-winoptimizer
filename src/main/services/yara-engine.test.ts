import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createYaraEngine, type YaraEngineOptions } from './yara-engine';
import type { WorkerRequest, WorkerResponse } from './yara-protocol';

/**
 * YARA engine harness (Fase 4.4, TDD RED).
 *
 * The engine must NEVER load the native module itself: compilation and
 * scanning happen in `yara-worker.ts` (a `worker_thread`). These tests drive
 * the engine through a fake worker, plus real temp files for the
 * file-expansion / size-limit paths.
 */

const ENGINE_SOURCE = fs.readFileSync(path.join(__dirname, 'yara-engine.ts'), 'utf8');
const WORKER_SOURCE = fs.readFileSync(path.join(__dirname, 'yara-worker.ts'), 'utf8');
const PROTOCOL_SOURCE = fs.readFileSync(path.join(__dirname, 'yara-protocol.ts'), 'utf8');

class FakeWorker {
  posted: WorkerRequest[] = [];
  private listeners = new Map<string, Array<(arg: unknown) => void>>();
  terminated = 0;

  postMessage(message: WorkerRequest): void {
    this.posted.push(message);
  }

  on(event: string, listener: (arg: unknown) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  terminate(): Promise<number> {
    this.terminated += 1;
    return Promise.resolve(0);
  }

  emit(response: WorkerResponse): void {
    for (const listener of this.listeners.get('message') ?? []) listener(response);
  }

  lastRequest(): WorkerRequest {
    const request = this.posted[this.posted.length - 1];
    if (!request) throw new Error('FakeWorker received no messages');
    return request;
  }
}

/** Let queued microtasks (async init + pipelined sends) run before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeHarness(options?: Partial<YaraEngineOptions>): {
  workers: FakeWorker[];
  options: YaraEngineOptions;
} {
  const workers: FakeWorker[] = [];
  return {
    workers,
    options: {
      rulesDir: path.join(__dirname, '..', '..', '..', 'catalogs', 'yara-rules'),
      timeoutMsPerFile: 2000,
      ...options,
      spawnWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    },
  };
}

describe('yara thread isolation (executable grep)', () => {
  // What matters is the RUNTIME import (which would load the native binding
  // into the main thread), not doc comments that name the package.
  const NATIVE_IMPORT =
    /from\s+['"]@litko\/yara-x[^'"]*['"]|require(\.resolve)?\(\s*['"]@litko\/yara-x[^'"]*['"]/;
  it('loads the native module ONLY in the worker file', () => {
    expect(ENGINE_SOURCE).not.toMatch(NATIVE_IMPORT);
    expect(PROTOCOL_SOURCE).not.toMatch(NATIVE_IMPORT);
    expect(WORKER_SOURCE).toMatch(NATIVE_IMPORT);
  });
});

describe('yara-engine', () => {
  let scratch = '';

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'forchi-yara-test-'));
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('compiles the bundled rules exactly once per worker lifetime', async () => {
    const { workers, options } = makeHarness();
    const engine = createYaraEngine(options);
    const pending = engine.init();
    expect(workers).toHaveLength(1);
    const initRequest = workers[0]?.lastRequest();
    expect(initRequest?.kind).toBe('init');
    if (initRequest?.kind !== 'init') throw new Error('expected init request');
    expect(initRequest.rules.length).toBeGreaterThan(0);
    workers[0]?.emit({
      id: initRequest.id,
      kind: 'init',
      ok: true,
      ruleCount: 3,
      engineVersion: '0.7.5',
    });
    const info = await pending;
    expect(info.ruleCount).toBe(3);

    const second = await engine.init();
    expect(second.ruleCount).toBe(3);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.posted).toHaveLength(1);
    await engine.dispose();
  });

  it('fails honestly when the rules catalog is missing', async () => {
    const { options } = makeHarness({ rulesDir: path.join(scratch, 'no-such-dir') });
    const engine = createYaraEngine(options);
    await expect(engine.init()).rejects.toThrow(/rules catalog/i);
    await engine.dispose();
  });

  it('reports infected with rule names for a matching buffer', async () => {
    const { workers, options } = makeHarness();
    const engine = createYaraEngine(options);
    const pendingInit = engine.init();
    const initRequest = workers[0]?.lastRequest();
    if (initRequest?.kind !== 'init') throw new Error('expected init request');
    workers[0]?.emit({
      id: initRequest.id,
      kind: 'init',
      ok: true,
      ruleCount: 3,
      engineVersion: '0.7.5',
    });
    await pendingInit;

    const pending = engine.scanBuffer(Buffer.from('EICAR', 'utf8'), 'eicar.com');
    await flush();
    const scanRequest = workers[0]?.lastRequest();
    if (scanRequest?.kind !== 'scan-buffer') throw new Error('expected scan-buffer');
    workers[0]?.emit({
      id: scanRequest.id,
      kind: 'scan',
      ok: true,
      matches: [
        {
          rule: 'Forchi_Eicar_Test_File',
          namespace: 'forchi-malware-v1',
          tags: ['test'],
          description: 'EICAR test string',
        },
      ],
    });
    const result = await pending;
    expect(result.status).toBe('infected');
    expect(result.matches.map((match) => match.rule)).toEqual(['Forchi_Eicar_Test_File']);
    await engine.dispose();
  });

  it('reports clean ONLY after a real scan with zero matches', async () => {
    const { workers, options } = makeHarness();
    const engine = createYaraEngine(options);
    const pendingInit = engine.init();
    const initRequest = workers[0]?.lastRequest();
    if (initRequest?.kind !== 'init') throw new Error('expected init request');
    workers[0]?.emit({
      id: initRequest.id,
      kind: 'init',
      ok: true,
      ruleCount: 3,
      engineVersion: '0.7.5',
    });
    await pendingInit;

    const pending = engine.scanBuffer(Buffer.from('harmless', 'utf8'), 'notes.txt');
    await flush();
    const scanRequest = workers[0]?.lastRequest();
    if (scanRequest?.kind !== 'scan-buffer') throw new Error('expected scan-buffer');
    workers[0]?.emit({ id: scanRequest.id, kind: 'scan', ok: true, matches: [] });
    const result = await pending;
    expect(result.status).toBe('clean');
    expect(result.reason).toMatch(/no rule matched/i);
    await engine.dispose();
  });

  it('marks worker failures as unknown, never clean', async () => {
    const { workers, options } = makeHarness();
    const engine = createYaraEngine(options);
    const pendingInit = engine.init();
    const initRequest = workers[0]?.lastRequest();
    if (initRequest?.kind !== 'init') throw new Error('expected init request');
    workers[0]?.emit({
      id: initRequest.id,
      kind: 'init',
      ok: true,
      ruleCount: 3,
      engineVersion: '0.7.5',
    });
    await pendingInit;

    const pending = engine.scanBuffer(Buffer.from('x', 'utf8'), 'x.bin');
    await flush();
    const scanRequest = workers[0]?.lastRequest();
    if (scanRequest?.kind !== 'scan-buffer') throw new Error('expected scan-buffer');
    workers[0]?.emit({ id: scanRequest.id, kind: 'scan', ok: false, error: 'boom' });
    const result = await pending;
    expect(result.status).toBe('unknown');
    expect(result.reason).toContain('boom');
    await engine.dispose();
  });

  it('marks missing files unknown without touching the worker', async () => {
    const { workers, options } = makeHarness();
    const engine = createYaraEngine(options);
    const pendingInit = engine.init();
    const initRequest = workers[0]?.lastRequest();
    if (initRequest?.kind !== 'init') throw new Error('expected init request');
    workers[0]?.emit({
      id: initRequest.id,
      kind: 'init',
      ok: true,
      ruleCount: 3,
      engineVersion: '0.7.5',
    });
    await pendingInit;
    const postedBefore = workers[0]?.posted.length ?? 0;

    const report = await engine.scanPaths([path.join(scratch, 'ghost.bin')]);
    expect(report.summary).toEqual({ clean: 0, infected: 0, unknown: 1, total: 1 });
    expect(report.files[0]?.status).toBe('unknown');
    expect(workers[0]?.posted.length).toBe(postedBefore);
    await engine.dispose();
  });

  it('marks oversized files unknown with the real size in the reason', async () => {
    const big = path.join(scratch, 'big.bin');
    fs.writeFileSync(big, Buffer.alloc(16));
    const { workers, options } = makeHarness({ maxFileBytes: 8 });
    const engine = createYaraEngine(options);
    const pendingInit = engine.init();
    const initRequest = workers[0]?.lastRequest();
    if (initRequest?.kind !== 'init') throw new Error('expected init request');
    workers[0]?.emit({
      id: initRequest.id,
      kind: 'init',
      ok: true,
      ruleCount: 3,
      engineVersion: '0.7.5',
    });
    await pendingInit;

    const report = await engine.scanPaths([big]);
    expect(report.files[0]?.status).toBe('unknown');
    expect(report.files[0]?.reason).toMatch(/exceeds|limit|16 bytes/i);
    await engine.dispose();
  });

  it('expands directories into their files', async () => {
    const a = path.join(scratch, 'a.txt');
    const b = path.join(scratch, 'b.txt');
    fs.writeFileSync(a, 'aaa');
    fs.writeFileSync(b, 'bbb');
    const { workers, options } = makeHarness();
    const engine = createYaraEngine(options);
    const pendingInit = engine.init();
    const initRequest = workers[0]?.lastRequest();
    if (initRequest?.kind !== 'init') throw new Error('expected init request');
    workers[0]?.emit({
      id: initRequest.id,
      kind: 'init',
      ok: true,
      ruleCount: 3,
      engineVersion: '0.7.5',
    });
    await pendingInit;

    const pending = engine.scanPaths([scratch]);
    await flush();
    // Pipelined scan-file requests arrive before any answer is needed.
    const scans = (workers[0]?.posted ?? []).filter((m) => m.kind === 'scan-file');
    expect(scans).toHaveLength(2);
    for (const message of scans) {
      if (message.kind !== 'scan-file') throw new Error('expected scan-file');
      workers[0]?.emit({ id: message.id, kind: 'scan', ok: true, matches: [] });
    }
    const report = await pending;
    expect(report.summary).toEqual({ clean: 2, infected: 0, unknown: 0, total: 2 });
    await engine.dispose();
  });

  it('times out a hung file and recycles the worker', async () => {
    const target = path.join(scratch, 'hang.bin');
    fs.writeFileSync(target, 'hang');
    const { workers, options } = makeHarness({ timeoutMsPerFile: 40 });
    const engine = createYaraEngine(options);
    const pendingInit = engine.init();
    const initRequest = workers[0]?.lastRequest();
    if (initRequest?.kind !== 'init') throw new Error('expected init request');
    workers[0]?.emit({
      id: initRequest.id,
      kind: 'init',
      ok: true,
      ruleCount: 3,
      engineVersion: '0.7.5',
    });
    await pendingInit;

    const report = await engine.scanPaths([target]);
    expect(report.files[0]?.status).toBe('unknown');
    expect(report.files[0]?.reason).toMatch(/timeout/i);
    // The hung worker was terminated so the next scan starts fresh.
    expect(workers[0]?.terminated).toBe(1);

    const again = engine.scanPaths([target]);
    await flush();
    expect(workers).toHaveLength(2);
    const reinit = workers[1]?.lastRequest();
    if (reinit?.kind !== 'init') throw new Error('expected re-init');
    workers[1]?.emit({
      id: reinit.id,
      kind: 'init',
      ok: true,
      ruleCount: 3,
      engineVersion: '0.7.5',
    });
    await flush();
    const rescan = workers[1]?.posted.find((m) => m.kind === 'scan-file');
    if (!rescan || rescan.kind !== 'scan-file') throw new Error('expected rescan');
    workers[1]?.emit({ id: rescan.id, kind: 'scan', ok: true, matches: [] });
    const report2 = await again;
    expect(report2.files[0]?.status).toBe('clean');
    await engine.dispose();
  });

  it('cancels in-flight scans and terminates the worker', async () => {
    const target = path.join(scratch, 'cancel.bin');
    fs.writeFileSync(target, 'cancel');
    const { workers, options } = makeHarness({ timeoutMsPerFile: 5000 });
    const engine = createYaraEngine(options);
    const pendingInit = engine.init();
    const initRequest = workers[0]?.lastRequest();
    if (initRequest?.kind !== 'init') throw new Error('expected init request');
    workers[0]?.emit({
      id: initRequest.id,
      kind: 'init',
      ok: true,
      ruleCount: 3,
      engineVersion: '0.7.5',
    });
    await pendingInit;

    const pending = engine.scanPaths([target]);
    await flush();
    await engine.cancel();
    await expect(pending).rejects.toThrow(/cancel/i);
    expect(workers[0]?.terminated).toBe(1);
    await engine.dispose();
  });
});
