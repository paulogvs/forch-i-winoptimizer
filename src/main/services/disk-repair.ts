import { spawn, type ChildProcess } from 'node:child_process';
import {
  getDiskRepairTool,
  isDiskRepairToolId,
  type DiskRepairProgressEvent,
  type DiskRepairResult,
  type DiskRepairToolId,
} from '@shared/disk-repair';
import { isElevated } from './security-fix';

/**
 * Disk repair runner (Fase 4.9).
 *
 * Wraps real Windows repair tools with LIVE output and REAL results:
 *  - admin gated: without elevation the tool never runs and the caller gets an
 *    explicit `requires-admin`, so the UI can offer "Restart as administrator"
 *    (never a silent failure);
 *  - streaming: stdout/stderr are forwarded line by line; a percent is parsed
 *    only when the tool actually prints one, otherwise it stays `null`
 *    (honest indeterminate progress — no fake bar);
 *  - cancellable where safe (the catalog says so);
 *  - the result carries the real exit code + a parsed summary.
 *
 * Tests NEVER run the real tools: `spawnFn` is injected. The unit suite only
 * exercises the pure parsers and a fake child process.
 */

const POWERSHELL_EXE = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
const MAX_LINES = 400;

/** Build the PowerShell command that runs a catalog tool with a real exit code. */
export function buildDiskRepairPsCommand(toolId: DiskRepairToolId): string {
  switch (toolId) {
    case 'dism-restore-health':
      return '& DISM.exe /Online /Cleanup-Image /RestoreHealth; exit $LASTEXITCODE';
    case 'sfc-scannow':
      return '& sfc.exe /scannow; exit $LASTEXITCODE';
    case 'chkdsk':
      return '& chkdsk.exe C: /scan; exit $LASTEXITCODE';
    case 'trim':
      return 'Optimize-Volume -DriveLetter C -ReTrim -Verbose; if ($?) { exit 0 } else { exit 1 }';
  }
}

/** Parse a real percentage token from a line, or null (never invented). */
export function extractPercent(line: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(line);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** A separator/progress-bar line carries no information worth keeping. */
export function isMeaningfulLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  return !/^[\s=*#.[\]|/\\-]+$/.test(trimmed);
}

export interface ParsedDiskRepair {
  summary: string;
  repairNeeded: boolean | null;
}

/** Parse the verified markers each tool prints into a human summary. */
export function parseDiskRepairOutput(
  toolId: DiskRepairToolId,
  lines: readonly string[]
): ParsedDiskRepair {
  const text = lines.join('\n');
  switch (toolId) {
    case 'sfc-scannow':
      if (/did not find any integrity violations/i.test(text)) {
        return { summary: 'No integrity violations found.', repairNeeded: false };
      }
      if (/found corrupt files and successfully repaired/i.test(text)) {
        return { summary: 'Corrupt files found and successfully repaired.', repairNeeded: true };
      }
      if (/found corrupt files but was unable to fix/i.test(text)) {
        return {
          summary: 'Corrupt files found but some could not be repaired.',
          repairNeeded: true,
        };
      }
      break;
    case 'dism-restore-health':
      if (/restore operation completed successfully/i.test(text)) {
        return { summary: 'Component store repaired successfully.', repairNeeded: false };
      }
      if (/no component store corruption detected/i.test(text)) {
        return { summary: 'No component store corruption detected.', repairNeeded: false };
      }
      if (/operation completed successfully/i.test(text)) {
        return { summary: 'Operation completed successfully.', repairNeeded: false };
      }
      if (/error|failed/i.test(text)) {
        return { summary: 'DISM reported an error (see the live output).', repairNeeded: null };
      }
      break;
    case 'chkdsk':
      if (
        /found no problems|no problems were found|scanned the file system and found no problems/i.test(
          text
        )
      ) {
        return { summary: 'No filesystem problems found.', repairNeeded: false };
      }
      if (/found problems|errors detected|corruption/i.test(text)) {
        return { summary: 'Filesystem problems were reported.', repairNeeded: true };
      }
      break;
    case 'trim':
      if (/successfully re-?trimmed|re-?trim completed/i.test(text)) {
        return { summary: 'Volume re-trimmed successfully.', repairNeeded: false };
      }
      if (/completed/i.test(text)) {
        return { summary: 'Optimize-Volume completed.', repairNeeded: false };
      }
      break;
  }
  return { summary: 'No recognizable summary in the tool output.', repairNeeded: null };
}

export interface DiskRepairDeps {
  /** Test seam: elevation check. Defaults to the live `isElevated()`. */
  isAdmin?: () => Promise<boolean>;
  /** Test seam: process spawner. Defaults to Node's `spawn`. */
  spawnFn?: typeof spawn;
  onProgress?: (event: DiskRepairProgressEvent) => void;
  timeoutMs?: number;
  now?: () => number;
}

interface ActiveRepair {
  child: ChildProcess;
  cancelled: boolean;
}

let active: ActiveRepair | null = null;

/** Request cancellation of the in-flight repair. Returns true if one was active. */
export function cancelDiskRepair(): boolean {
  if (!active) return false;
  active.cancelled = true;
  try {
    active.child.kill();
  } catch {
    /* already gone */
  }
  return true;
}

export function isDiskRepairRunning(): boolean {
  return active !== null;
}

/** Whether the current process is elevated (used by the UI to warn upfront). */
export async function isDiskRepairAdmin(): Promise<boolean> {
  try {
    return await isElevated();
  } catch {
    return false;
  }
}

function buildResult(
  toolId: DiskRepairToolId,
  toolName: string,
  overrides: Partial<DiskRepairResult>
): DiskRepairResult {
  return {
    toolId,
    toolName,
    success: false,
    status: 'failed',
    exitCode: null,
    summary: '',
    lines: [],
    durationMs: 0,
    requiresAdmin: true,
    repairNeeded: null,
    ...overrides,
  };
}

/**
 * Run a catalog tool and resolve with its REAL outcome. `spawnFn` is injectable
 * so the suite never executes a real repair.
 */
export async function runDiskRepair(
  toolId: string,
  deps: DiskRepairDeps = {}
): Promise<DiskRepairResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();

  if (!isDiskRepairToolId(toolId)) {
    return buildResult('dism-restore-health', String(toolId), {
      summary: `Unknown disk repair tool: ${toolId}`,
      requiresAdmin: false,
      durationMs: now() - startedAt,
    });
  }

  const tool = getDiskRepairTool(toolId);
  if (!tool) {
    return buildResult(toolId, toolId, {
      summary: `Unknown disk repair tool: ${toolId}`,
      requiresAdmin: false,
      durationMs: now() - startedAt,
    });
  }

  const checkAdmin = deps.isAdmin ?? isElevated;
  let admin = false;
  try {
    admin = await checkAdmin();
  } catch {
    admin = false;
  }
  if (!admin) {
    return buildResult(toolId, tool.name, {
      status: 'requires-admin',
      summary: `${tool.name} requires administrator rights. Restart the app as administrator to run it.`,
      durationMs: now() - startedAt,
    });
  }

  const spawnFn = deps.spawnFn ?? spawn;
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    buildDiskRepairPsCommand(toolId),
  ];

  return await new Promise<DiskRepairResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(POWERSHELL_EXE, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }) as ChildProcess;
    } catch (error) {
      resolve(
        buildResult(toolId, tool.name, {
          summary: `Could not start ${tool.name}: ${String(error)}`,
          durationMs: now() - startedAt,
        })
      );
      return;
    }

    active = { child, cancelled: false };

    const lines: string[] = [];
    let stdoutBuf = '';
    let stderrBuf = '';
    let settled = false;
    let timedOut = false;

    const emit = (raw: string, stream: 'stdout' | 'stderr'): void => {
      for (const line of raw.split(/\r?\n/)) {
        if (line.length === 0) continue;
        if (isMeaningfulLine(line)) {
          lines.push(line);
          if (lines.length > MAX_LINES) lines.shift();
        }
        deps.onProgress?.({ toolId, line, stream, percent: extractPercent(line) });
      }
    };

    const onData = (stream: 'stdout' | 'stderr') => (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString();
      const buffer = (stream === 'stdout' ? stdoutBuf : stderrBuf) + text;
      const parts = buffer.split(/\r?\n/);
      const tail = parts.pop() ?? '';
      if (stream === 'stdout') stdoutBuf = tail;
      else stderrBuf = tail;
      emit(parts.join('\n'), stream);
    };

    child.stdout?.on('data', onData('stdout'));
    child.stderr?.on('data', onData('stderr'));

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        active?.child.kill();
      } catch {
        /* ignore */
      }
      finish(null);
    }, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (stdoutBuf) emit(stdoutBuf, 'stdout');
      if (stderrBuf) emit(stderrBuf, 'stderr');

      const wasCancelled = active?.cancelled === true;
      active = null;

      const parsed = parseDiskRepairOutput(toolId, lines);
      const status = wasCancelled ? 'cancelled' : timedOut ? 'failed' : 'completed';
      const success = status === 'completed' && exitCode === 0;
      const summary = wasCancelled
        ? 'Cancelled.'
        : timedOut
          ? `${tool.name} timed out.`
          : parsed.summary;

      resolve(
        buildResult(toolId, tool.name, {
          success,
          status,
          exitCode: wasCancelled || timedOut ? null : exitCode,
          summary,
          lines: lines.slice(-50),
          durationMs: now() - startedAt,
          repairNeeded: parsed.repairNeeded,
        })
      );
    };

    child.on('close', (code) => finish(typeof code === 'number' ? code : null));
    child.on('error', () => finish(null));
  });
}
