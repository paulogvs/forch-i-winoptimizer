import { Worker } from 'node:worker_threads';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveBundledPath } from '../source-updater/paths';
import {
  MALWARE_LIMITS,
  summarizeMalwareFiles,
  type MalwareFileResult,
  type MalwareRuleMatch,
  type MalwareScanReport,
  type MalwareScanScope,
} from '@shared/malware-scan';
import type {
  WorkerRequest,
  WorkerResponse,
  YaraProtocolRuleMatch,
  YaraRuleSource,
} from './yara-protocol';

/**
 * YARA engine facade (Fase 4.4, main thread side).
 *
 * HARD RULE: this module NEVER imports `@litko/yara-x`. Compiling rules and
 * scanning bytes happen exclusively in `yara-worker.ts`, which runs in a
 * `worker_thread`. The executable thread-isolation test in
 * `yara-engine.test.ts` fails the build if the native import leaks here.
 *
 * Responsibilities kept here (cheap, non-blocking):
 *  - Loading the versioned rule sources from `catalogs/yara-rules/` (via
 *    `resolveBundledPath`, the single bundled-asset resolver) and compiling
 *    them ONCE per worker lifetime.
 *  - Expanding files/directories, enforcing the size cap (`unknown`, never
 *    read past the limit), and mapping worker answers to honest per-file
 *    statuses (`clean` only after a real scan with zero matches).
 *  - One timeout per file: a hung scan recycles the worker (terminate +
 *    lazy re-init) so a stuck file can never wedge later scans. In-flight
 *    siblings of a recycled worker report `unknown`.
 *  - Cancellation: `cancel()` terminates the worker and rejects in-flight
 *    scans, so the UI Cancel button always preempts — even while the
 *    operation lock serializes scan starts.
 */

export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  on(event: 'message' | 'error', listener: (payload: unknown) => void): void;
  terminate(): Promise<number>;
}

export interface YaraRulesInfo {
  version: string;
  files: string[];
  ruleCount: number;
  engineVersion: string;
}

export interface YaraEngineOptions {
  /** Defaults to the bundled `catalogs/yara-rules` directory. */
  rulesDir?: string;
  timeoutMsPerFile?: number;
  maxFileBytes?: number;
  maxFilesPerScan?: number;
  /** Test seam + worker bootstrap override. */
  spawnWorker?: (scriptPath: string) => WorkerLike;
  /** Test seam: bypass the packaged worker-path resolution. */
  workerScriptPath?: string;
}

interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const INIT_TIMEOUT_MS = 60_000;

function defaultWorkerScript(): string {
  // tsc emits `yara-worker.js` next to this file (`dist/main/services/`).
  const compiled = path.join(__dirname, 'yara-worker.js');
  // electron-builder unpacks the worker (see `build.asarUnpack`): Node
  // worker_threads cannot boot a script from inside `app.asar`.
  return compiled.includes('app.asar')
    ? compiled.replace('app.asar', 'app.asar.unpacked')
    : compiled;
}

function defaultSpawn(scriptPath: string): WorkerLike {
  return new Worker(scriptPath) as unknown as WorkerLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class YaraEngine {
  private readonly timeoutMsPerFile: number;
  private readonly maxFileBytes: number;
  private readonly maxFilesPerScan: number;
  private readonly spawnWorker: (scriptPath: string) => WorkerLike;
  private readonly explicitRulesDir: string | null;
  private readonly explicitScriptPath: string | null;

  private worker: WorkerLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private rulesInfo: YaraRulesInfo | null = null;
  private disposed = false;

  constructor(options: YaraEngineOptions = {}) {
    this.timeoutMsPerFile = options.timeoutMsPerFile ?? MALWARE_LIMITS.TIMEOUT_MS_PER_FILE;
    this.maxFileBytes = options.maxFileBytes ?? MALWARE_LIMITS.MAX_FILE_BYTES;
    this.maxFilesPerScan = options.maxFilesPerScan ?? MALWARE_LIMITS.MAX_FILES_PER_SCAN;
    this.spawnWorker = options.spawnWorker ?? defaultSpawn;
    this.explicitRulesDir = options.rulesDir ?? null;
    this.explicitScriptPath = options.workerScriptPath ?? null;
  }

  getRulesInfo(): YaraRulesInfo | null {
    return this.rulesInfo;
  }

  isReady(): boolean {
    return this.worker !== null && this.rulesInfo !== null;
  }

  /** Compile the bundled rules once; reuses the live worker when healthy. */
  async init(): Promise<YaraRulesInfo> {
    this.throwIfDisposed();
    if (this.isReady() && this.rulesInfo) return this.rulesInfo;

    const { version, files, sources } = this.loadRuleSources();
    const worker = this.spawnWorker(this.explicitScriptPath ?? defaultWorkerScript());
    this.worker = worker;
    worker.on('message', (payload: unknown) => this.onMessage(payload));
    worker.on('error', (payload: unknown) => this.onWorkerError(payload));

    const response = await this.send(
      { kind: 'init', rules: sources } as WorkerRequest,
      INIT_TIMEOUT_MS
    );
    if (response.kind !== 'init' || !response.ok) {
      const reason =
        response.kind === 'init' && !response.ok ? response.error : 'unexpected worker answer';
      await this.recycleWorker();
      throw new Error(`YARA rules failed to compile: ${reason}`);
    }
    this.rulesInfo = {
      version,
      files,
      ruleCount: response.ruleCount,
      engineVersion: response.engineVersion,
    };
    return this.rulesInfo;
  }

  /** Scan an in-memory buffer (no disk involved). Never throws per-file outcomes. */
  async scanBuffer(data: Buffer, filename: string): Promise<MalwareFileResult> {
    try {
      const info = await this.init();
      void info;
      const response = await this.send(
        {
          kind: 'scan-buffer',
          dataBase64: data.toString('base64'),
          filename,
        } as WorkerRequest,
        this.timeoutMsPerFile
      );
      return this.toFileResult(filename, filename, data.byteLength, response);
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) throw error;
      return this.unknownResult(filename, filename, null, String(error));
    }
  }

  /** Scan files and/or directories (recursive, capped, read-only). */
  async scanPaths(
    paths: string[],
    overrides?: { timeoutMsPerFile?: number }
  ): Promise<MalwareScanReport> {
    const started = Date.now();
    const info = await this.init();
    const timeoutMs = overrides?.timeoutMsPerFile ?? this.timeoutMsPerFile;
    const { targets, truncated } = this.expandScope(paths);

    const results = await Promise.all(targets.map((target) => this.scanOneFile(target, timeoutMs)));

    return {
      scope: [...paths],
      files: results,
      summary: summarizeMalwareFiles(results),
      rulesVersion: info.version,
      engine: `yara-x ${info.engineVersion} (worker_thread)`,
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      note: truncated,
    };
  }

  /** Preempt in-flight scans; the engine re-inits lazily on next use. */
  async cancel(): Promise<void> {
    this.failPending(new Error('Malware scan cancelled.'));
    await this.recycleWorker();
  }

  /** Permanently shut the engine down (no further use). */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.failPending(new Error('Malware scan cancelled.'));
    await this.recycleWorker();
  }

  // -- internals -----------------------------------------------------------

  private throwIfDisposed(): void {
    if (this.disposed) throw new Error('YaraEngine is disposed.');
  }

  private loadRuleSources(): { version: string; files: string[]; sources: YaraRuleSource[] } {
    const dir = this.explicitRulesDir ?? resolveBundledPath('catalogs', 'yara-rules') ?? null;
    if (!dir || !fs.existsSync(dir)) {
      throw new Error(
        'YARA rules catalog not found (looked for catalogs/yara-rules in dev and packaged layouts).'
      );
    }
    const manifestRaw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw) as { version?: unknown; files?: unknown };
    if (typeof manifest.version !== 'string' || !Array.isArray(manifest.files)) {
      throw new Error('YARA rules manifest is corrupt (expected { version, files[] }).');
    }
    const sources: YaraRuleSource[] = [];
    for (const file of manifest.files) {
      if (typeof file !== 'string') {
        throw new Error('YARA rules manifest is corrupt (expected { version, files[] }).');
      }
      sources.push({
        source: fs.readFileSync(path.join(dir, file), 'utf8'),
        namespace: path.basename(file, path.extname(file)),
      });
    }
    return { version: manifest.version, files: manifest.files as string[], sources };
  }

  private onMessage(payload: unknown): void {
    if (!isRecord(payload) || typeof payload['id'] !== 'number') return;
    const pending = this.pending.get(payload['id']);
    if (!pending) return;
    this.pending.delete(payload['id']);
    clearTimeout(pending.timer);
    pending.resolve(payload as WorkerResponse);
  }

  private onWorkerError(payload: unknown): void {
    const reason = payload instanceof Error ? payload.message : String(payload);
    this.failPending(new Error(`YARA worker failed: ${reason}`));
    void this.recycleWorker();
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private async recycleWorker(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.rulesInfo = null;
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        /* termination is best-effort */
      }
    }
  }

  private send(message: Omit<WorkerRequest, 'id'>, timeoutMs: number): Promise<WorkerResponse> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('YARA worker is not running.'));
    const id = this.nextId++;
    const full = { ...message, id } as WorkerRequest;
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A hung scan blocks the worker's event loop: terminate it so later
        // scans start from a fresh worker instead of queueing behind the hang.
        void this.recycleWorker().then(() => {
          reject(new Error(`File scan timeout after ${timeoutMs} ms (worker recycled).`));
        });
      }, timeoutMs);
      // Unref so a stray timer never keeps the app alive on its own.
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        worker.postMessage(full);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private expandScope(paths: string[]): { targets: string[]; truncated: string | null } {
    const targets: string[] = [];
    let truncated: string | null = null;
    const visit = (candidate: string): void => {
      if (targets.length >= this.maxFilesPerScan) {
        truncated =
          `Scope truncated to the first ${this.maxFilesPerScan} files ` +
          `(increase only deliberately: full-disk scans are slow and noisy).`;
        return;
      }
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(candidate);
      } catch {
        targets.push(candidate);
        return;
      }
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(candidate, { withFileTypes: true });
        } catch {
          targets.push(candidate);
          return;
        }
        entries
          .sort((a, b) => a.name.localeCompare(b.name))
          .forEach((entry) => visit(path.join(candidate, entry.name)));
        return;
      }
      targets.push(candidate);
    };
    for (const root of paths) {
      if (truncated) break;
      visit(root);
    }
    return { targets, truncated };
  }

  private async scanOneFile(target: string, timeoutMs: number): Promise<MalwareFileResult> {
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(target);
    } catch {
      return this.unknownResult(
        target,
        path.basename(target),
        null,
        'File not found or not readable.'
      );
    }
    if (!stat.isFile()) {
      return this.unknownResult(
        target,
        path.basename(target),
        null,
        'Not a regular file (directory reads that failed to expand, device or socket).'
      );
    }
    if (stat.size > this.maxFileBytes) {
      return this.unknownResult(
        target,
        path.basename(target),
        stat.size,
        `Skipped: ${stat.size} bytes exceeds the ${this.maxFileBytes} byte per-file limit.`
      );
    }
    try {
      const response = await this.send(
        { kind: 'scan-file', path: target } as WorkerRequest,
        timeoutMs
      );
      return this.toFileResult(target, path.basename(target), stat.size, response);
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) throw error;
      return this.unknownResult(target, path.basename(target), stat.size, String(error));
    }
  }

  private toFileResult(
    target: string,
    name: string,
    sizeBytes: number | null,
    response: WorkerResponse
  ): MalwareFileResult {
    if (response.kind !== 'scan' || !response.ok) {
      const reason =
        response.kind === 'scan' && !response.ok ? response.error : 'unexpected worker answer';
      return this.unknownResult(target, name, sizeBytes, reason);
    }
    const matches: MalwareRuleMatch[] = response.matches.map((match: YaraProtocolRuleMatch) => ({
      rule: match.rule,
      namespace: match.namespace,
      tags: [...match.tags],
      description: match.description,
    }));
    if (matches.length === 0) {
      return {
        path: target,
        name,
        status: 'clean',
        matches: [],
        reason: 'Scanned: no rule matched.',
        sizeBytes,
        scannedAt: new Date().toISOString(),
      };
    }
    const names = matches.map((match) => match.rule).join(', ');
    return {
      path: target,
      name,
      status: 'infected',
      matches,
      reason: `Matched rule(s): ${names}. Review the file manually — heuristic hits are suspicious, not a verdict.`,
      sizeBytes,
      scannedAt: new Date().toISOString(),
    };
  }

  private unknownResult(
    target: string,
    name: string,
    sizeBytes: number | null,
    reason: string
  ): MalwareFileResult {
    return {
      path: target,
      name,
      status: 'unknown',
      matches: [],
      reason,
      sizeBytes,
      scannedAt: new Date().toISOString(),
    };
  }
}

export function createYaraEngine(options: YaraEngineOptions = {}): YaraEngine {
  return new YaraEngine(options);
}

let sharedEngine: YaraEngine | null = null;

/** Process-wide engine (one worker at a time; scans serialize via the IPC lock). */
export function getYaraEngine(): YaraEngine {
  if (!sharedEngine) sharedEngine = new YaraEngine();
  return sharedEngine;
}

export type { MalwareScanScope } from '@shared/malware-scan';

/**
 * Honest preset scopes for the UI: the OS temp dir and the user's Downloads
 * folder, read live (never hardcoded usernames). Returned only when the
 * directory actually exists.
 */
export function getMalwareScanScopes(): MalwareScanScope[] {
  const scopes: MalwareScanScope[] = [];
  const temp = os.tmpdir();
  if (temp && fs.existsSync(temp)) {
    scopes.push({ id: 'temp', label: 'Windows Temp folder', path: temp });
  }
  const downloads = path.join(os.homedir(), 'Downloads');
  if (fs.existsSync(downloads)) {
    scopes.push({ id: 'downloads', label: 'Downloads folder', path: downloads });
  }
  return scopes;
}
