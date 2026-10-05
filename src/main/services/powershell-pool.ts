/**
 * Persistent PowerShell pool (Fase 5.1).
 *
 * Every `runPowerShell` call used to spawn a fresh `powershell.exe`, paying the
 * process cold-start on every single call. This module keeps a small number of
 * long-lived PowerShell processes alive and multiplexes jobs onto them using a
 * request/response frame protocol, so the cold-start is paid once per worker
 * instead of once per call.
 *
 * Design constraints (safety first — `powershell.ts` keeps the exact same
 * public API and contract):
 *
 *  - The pool is **opt-in** (`enablePowerShellPool()`), so unit tests and any
 *    host that does not opt in keep the proven `execFile` path unchanged.
 *  - Any anomaly (worker won't start, dies mid-job, non-Windows) returns `null`
 *    and the caller transparently falls back to `execFile`.
 *  - A per-job timeout kills and recycles that worker; the job resolves with
 *    the existing timeout contract (exit code 124).
 *  - Only stdout/stderr/exit code are surfaced, identical to `execFile`.
 *
 * Frame protocol over each worker's stdin/stdout:
 *
 *    parent -> worker:  @@JOB@@<base64(utf8 script)>\n
 *    worker -> parent:  @@B@@<id>\n            (job started)
 *                       <script output>
 *                       \n@@E@@<id>@@<exitCode>\n (job finished)
 *
 * `<id>` is a per-job random 32-hex GUID generated inside the worker, so script
 * output can never forge a frame.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export interface PooledResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PowerShellPoolStats {
  enabled: boolean;
  size: number;
  started: number;
  busy: number;
  queued: number;
  jobsCompleted: number;
  jobsFallback: number;
  recycles: number;
}

const PREFIX = '@@JOB@@';
const QUIT = '@@FORCHI_QUIT@@';
const START_MARK = '@@B@@';
const END_MARK = '@@E@@';
const MAX_BUFFER = 1024 * 1024 * 32; // 32 MB, mirrors powershell.ts
const POWERSHELL_EXE = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

/**
 * Worker bootstrap. Runs once per persistent process and then loops reading
 * one base64 job per line. Kept under the `-EncodedCommand` limit.
 */
const BOOTSTRAP = [
  "$ProgressPreference='SilentlyContinue'",
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
  '$OutputEncoding=[System.Text.Encoding]::UTF8',
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  '  if ($null -eq $line) { break }',
  `  if ($line -eq '${QUIT}') { break }`,
  `  if (-not $line.StartsWith('${PREFIX}')) { continue }`,
  `  $b64 = $line.Substring(${PREFIX.length})`,
  '  try { $script = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64)) } catch { continue }',
  "  $id = [Guid]::NewGuid().ToString('N')",
  `  [Console]::Out.WriteLine('${START_MARK}' + $id)`,
  '  [Console]::Out.Flush()',
  '  $global:LASTEXITCODE = 0',
  '  $failed = $false',
  '  try { & { Invoke-Expression $script } } catch { $failed = $true; [Console]::Error.WriteLine($_.Exception.Message) }',
  '  $code = if ($failed) { 1 } elseif ($null -ne $global:LASTEXITCODE) { $global:LASTEXITCODE } else { 0 }',
  "  [Console]::Out.WriteLine('')",
  `  [Console]::Out.WriteLine('${END_MARK}' + $id + '@@' + $code)`,
  '  [Console]::Out.Flush()',
  '}',
].join('\n');

interface Job {
  script: string;
  timeoutMs: number;
  resolve: (result: PooledResult | null) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

type SpawnFn = (
  command: string,
  args: string[],
  options: Record<string, unknown>
) => ChildProcessWithoutNullStreams;

/** One long-lived PowerShell process with at most one in-flight job. */
class Worker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private outBuf = '';
  private job: Job | null = null;
  private jobOut = '';
  private jobErr = '';
  private jobStarted = false;
  private startId = '';
  private dead = false;

  constructor(private readonly spawnFn: SpawnFn) {}

  isStarted(): boolean {
    return this.proc !== null && !this.dead;
  }

  isBusy(): boolean {
    return this.job !== null;
  }

  isIdle(): boolean {
    return this.isStarted() && !this.job;
  }

  /** Start the process if needed. Returns false when it could not be started. */
  ensureStarted(): boolean {
    if (this.proc && !this.dead) return true;
    this.start();
    return this.proc !== null && !this.dead;
  }

  private start(): void {
    const encoded = Buffer.from(BOOTSTRAP, 'utf16le').toString('base64');
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = this.spawnFn(
        POWERSHELL_EXE,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          encoded,
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch {
      this.dead = true;
      return;
    }
    this.proc = proc;
    this.dead = false;
    this.outBuf = '';

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    proc.stderr.on('data', (chunk: string) => {
      if (this.job) this.jobErr += chunk;
    });
    proc.on('error', () => this.onDeath());
    proc.on('exit', () => this.onDeath());
    proc.stdin.on('error', () => this.onDeath());
  }

  private onStdout(chunk: string): void {
    this.outBuf += chunk;
    if (this.outBuf.length > MAX_BUFFER) this.outBuf = this.outBuf.slice(-MAX_BUFFER);
    this.drainFrames();
  }

  private drainFrames(): void {
    if (this.job && !this.jobStarted) {
      const idx = this.outBuf.indexOf('\n');
      if (idx < 0) return;
      // Windows PowerShell emits CRLF; drop the trailing CR from the marker line
      // so the GUID used to close the frame matches byte-for-byte.
      const rawLine = this.outBuf.slice(0, idx);
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      this.outBuf = this.outBuf.slice(idx + 1);
      if (line.startsWith(START_MARK)) {
        this.startId = line.slice(START_MARK.length);
        this.jobStarted = true;
        this.jobOut = '';
      }
      // Any pre-start line is discarded rather than corrupting job output.
    }

    if (this.job && this.jobStarted) {
      const endToken = `\n${END_MARK}${this.startId}@@`;
      const idx = this.outBuf.indexOf(endToken);
      if (idx < 0) return;
      this.jobOut = this.outBuf.slice(0, idx);
      const after = this.outBuf.slice(idx + 1 + END_MARK.length + this.startId.length + 2);
      const nl = after.indexOf('\n');
      const codeText = nl >= 0 ? after.slice(0, nl) : after;
      this.outBuf = nl >= 0 ? after.slice(nl + 1) : '';
      const exitCode = Number.parseInt(codeText, 10);
      this.complete({
        success: Number.isFinite(exitCode) ? exitCode === 0 : false,
        stdout: this.jobOut.replace(/\r?\n$/, '').trim(),
        stderr: this.jobErr.replace(/\r?\n$/, '').trim(),
        exitCode: Number.isFinite(exitCode) ? exitCode : 1,
      });
    }
  }

  private complete(result: PooledResult): void {
    const job = this.job;
    if (!job) return;
    if (job.timer) clearTimeout(job.timer);
    this.job = null;
    this.jobStarted = false;
    this.jobOut = '';
    this.jobErr = '';
    this.startId = '';
    job.resolve(result);
  }

  /**
   * A worker death (crash, `exit`, stdin error). Fails the in-flight job as a
   * pool miss (`null`) so the caller retries through `execFile`.
   */
  private onDeath(): void {
    this.dead = true;
    const job = this.job;
    this.proc = null;
    this.job = null;
    this.jobStarted = false;
    if (job) {
      if (job.timer) clearTimeout(job.timer);
      job.resolve(null);
    }
  }

  /** Dispatch a job. Returns false if the worker could not be started. */
  run(job: Job): boolean {
    if (!this.ensureStarted() || !this.proc || this.job || this.dead) return false;
    this.job = job;
    this.jobStarted = false;
    this.jobOut = '';
    this.jobErr = '';
    const payload = `${PREFIX}${Buffer.from(job.script, 'utf8').toString('base64')}\n`;
    try {
      this.proc.stdin.write(payload);
    } catch {
      this.onDeath();
      return false;
    }
    return true;
  }

  currentOutput(): { stdout: string; stderr: string } {
    return { stdout: this.jobOut.trim(), stderr: this.jobErr.trim() };
  }

  /** Stop the process. `resolveJob` resolves any in-flight job with `null`. */
  kill(resolveJob = true): void {
    const proc = this.proc;
    const job = this.job;
    this.proc = null;
    this.dead = true;
    this.job = null;
    this.jobStarted = false;
    if (job) {
      if (job.timer) clearTimeout(job.timer);
      if (resolveJob) job.resolve(null);
    }
    if (proc) {
      try {
        proc.stdin.end();
      } catch {
        /* ignore */
      }
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

export class PowerShellPool {
  private readonly workers: Worker[] = [];
  private readonly queue: Array<{
    script: string;
    timeoutMs: number;
    resolve: (r: PooledResult | null) => void;
  }> = [];
  private enabled = false;
  private disposed = false;
  private jobsCompleted = 0;
  private jobsFallback = 0;
  private totalRecycles = 0;

  constructor(
    private readonly size = 2,
    private readonly spawnFn?: SpawnFn
  ) {}

  enable(): void {
    this.enabled = true;
    this.disposed = false;
  }

  disable(): void {
    this.enabled = false;
    this.dispose();
  }

  isEnabled(): boolean {
    return this.enabled && !this.disposed;
  }

  stats(): PowerShellPoolStats {
    return {
      enabled: this.enabled,
      size: this.size,
      started: this.workers.filter((w) => w.isStarted()).length,
      busy: this.workers.filter((w) => w.isBusy()).length,
      queued: this.queue.length,
      jobsCompleted: this.jobsCompleted,
      jobsFallback: this.jobsFallback,
      recycles: this.totalRecycles,
    };
  }

  /**
   * Run a job on a pooled worker.
   *
   *  - a `PooledResult` when the worker produced a definitive outcome
   *    (including a non-zero exit code),
   *  - `null` when the pool could not be used, so the caller falls back to
   *    `execFile`.
   *
   * A job timeout is a definitive outcome (exit code 124, matching the
   * `execFile` timeout contract) and recycles the worker.
   */
  run(script: string, timeoutMs: number): Promise<PooledResult | null> {
    if (!this.isEnabled() || process.platform !== 'win32') return Promise.resolve(null);

    return new Promise<PooledResult | null>((resolve) => {
      this.queue.push({ script, timeoutMs, resolve });
      this.pump();
    });
  }

  private ensureWorkers(): void {
    while (this.workers.length < this.size) {
      const spawnFn = this.spawnFn ?? (spawn as unknown as SpawnFn);
      this.workers.push(new Worker(spawnFn));
    }
  }

  private pump(): void {
    if (!this.isEnabled()) return;
    this.ensureWorkers();
    for (const worker of this.workers) {
      if (!this.queue.length) return;
      if (worker.isBusy()) continue;
      this.assign(worker);
    }
  }

  private assign(worker: Worker): void {
    const next = this.queue[0];
    if (!next) return;
    const job: Job = {
      script: next.script,
      timeoutMs: next.timeoutMs,
      resolve: (result) => {
        if (result === null) this.jobsFallback++;
        else this.jobsCompleted++;
        next.resolve(result);
        // The worker just became free: drain the queue. Without this, the 3rd+
        // job of a concurrent batch would sit queued until an unrelated call.
        this.pump();
      },
      timer: null,
    };
    if (!worker.run(job)) {
      // Worker could not start: fall back for this job, drop it from the queue.
      this.queue.shift();
      this.jobsFallback++;
      next.resolve(null);
      return;
    }
    this.queue.shift();
    job.timer = setTimeout(
      () => {
        const partial = worker.currentOutput();
        this.totalRecycles++;
        // Detach the job without resolving, then resolve the timeout result.
        worker.kill(false);
        job.timer = null;
        this.jobsCompleted++;
        next.resolve({
          success: false,
          stdout: partial.stdout,
          stderr: partial.stderr,
          exitCode: 124,
        });
      },
      Math.max(1, next.timeoutMs)
    );

    // A job can complete synchronously (mock spawn in tests); guard against
    // assigning another job to a worker that is no longer busy.
    if (!worker.isBusy()) this.pump();
  }

  /** Kill every worker and drain the queue (app shutdown / tests). */
  dispose(): void {
    this.disposed = true;
    const pending = this.queue.splice(0, this.queue.length);
    for (const item of pending) item.resolve(null);
    for (const worker of this.workers) worker.kill(true);
    this.workers.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton, wired behind `powershell.ts`.
// ---------------------------------------------------------------------------

let poolSize = 2;
const parsedSize = Number.parseInt(process.env.FORCHI_PS_POOL_SIZE ?? '', 10);
if (Number.isFinite(parsedSize) && parsedSize > 0) {
  poolSize = Math.min(parsedSize, 6);
}

export const pool = new PowerShellPool(poolSize);

/**
 * Safety net: if the host process exits without a graceful `will-quit`
 * (Playwright/abrupt termination, crash handler), synchronously kill every
 * pooled process so no PowerShell worker is orphaned. `child.kill()` is
 * synchronous and therefore safe inside an `exit` handler.
 */
let exitHookRegistered = false;
function registerExitHook(): void {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  process.on('exit', () => pool.dispose());
}

/** Opt in to the persistent pool (called from the main process and harnesses). */
export function enablePowerShellPool(): void {
  registerExitHook();
  pool.enable();
}

export function disablePowerShellPool(): void {
  pool.disable();
}

/** Ensure no pooled PowerShell process survives shutdown. */
export function disposePowerShellPool(): void {
  pool.dispose();
}

export function getPowerShellPoolStats(): PowerShellPoolStats {
  return pool.stats();
}
