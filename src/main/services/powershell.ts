import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface PowerShellResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

const MAX_BUFFER = 1024 * 1024 * 32; // 32 MB
const POWERSHELL_EXE = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

/**
 * Preamble prepended to every script:
 * - Silences the progress stream (otherwise PowerShell writes CLIXML noise to stderr).
 * - Forces UTF-8 output so accented text (Spanish Windows) is not mangled.
 */
const PREAMBLE =
  "$ProgressPreference='SilentlyContinue';" +
  ' [Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' +
  ' $OutputEncoding=[System.Text.Encoding]::UTF8;';

/**
 * Windows caps a process command line at ~32767 characters. `-EncodedCommand`
 * expands the script to Base64 of UTF-16LE (~2.67x), so a script that is fine
 * to author can overflow the limit and make PowerShell fail to start — which
 * used to surface as an empty success-shaped result (every downstream check
 * degrading to `unknown`). Above this threshold we write the script to a temp
 * `.ps1` and run it with `-File`, which has no such limit.
 */
const ENCODED_COMMAND_LIMIT = 30_000;

async function runViaFile(full: string, timeout: number): Promise<PowerShellResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forchi-ps-'));
  const file = path.join(dir, 'script.ps1');
  // UTF-8 BOM: PowerShell 5.1 reads a no-BOM .ps1 as ANSI and mangles accents.
  await fs.writeFile(file, '\ufeff' + full, 'utf8');
  try {
    const { stdout, stderr } = await execFileAsync(
      POWERSHELL_EXE,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { timeout, maxBuffer: MAX_BUFFER, windowsHide: true }
    );
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Run an arbitrary PowerShell script safely.
 *
 * The script is passed via `-EncodedCommand` (Base64 of UTF-16LE). This avoids
 * every shell-quoting problem: multi-line scripts, double quotes, single quotes,
 * `$variables`, pipes, etc. all survive intact. Strongly preferred over
 * `-Command "..."`, which silently truncates scripts containing quotes.
 *
 * When the encoded form would exceed the Windows command-line limit the script
 * is run from a temp file instead (see `runViaFile`).
 */
async function runScript(script: string, timeout: number): Promise<PowerShellResult> {
  const full = `${PREAMBLE} ${script}`;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');

  try {
    if (encoded.length > ENCODED_COMMAND_LIMIT) {
      return await runViaFile(full, timeout);
    }
    const { stdout, stderr } = await execFileAsync(
      POWERSHELL_EXE,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout, maxBuffer: MAX_BUFFER, windowsHide: true }
    );
    return {
      success: true,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (error: unknown) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };
    return {
      success: false,
      stdout: (err.stdout ?? '').trim(),
      stderr: (err.stderr ?? '').trim(),
      exitCode: err.killed ? 124 : typeof err.code === 'number' ? err.code : 1,
    };
  }
}

/** Run a short PowerShell command (60s timeout). */
export async function runPowerShell(command: string): Promise<PowerShellResult> {
  return runScript(command, 60_000);
}

/** Run a longer PowerShell script (120s timeout). */
export async function runPowerShellScript(script: string): Promise<PowerShellResult> {
  return runScript(script, 120_000);
}

/**
 * Run a script with an explicit timeout. Used by the driver installer, whose
 * real-world silent installs can take minutes (Fase 2.4 uses 600s), and by the
 * Windows Update driver search, which may block on the network.
 */
export async function runPowerShellWithTimeout(
  script: string,
  timeoutMs: number
): Promise<PowerShellResult> {
  return runScript(script, timeoutMs);
}

export function parsePowerShellJson<T>(output: string): T | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Some scripts emit a BOM or leading text before the JSON payload.
    const start = Math.min(...[trimmed.indexOf('{'), trimmed.indexOf('[')].filter((i) => i >= 0));
    if (Number.isFinite(start) && start >= 0) {
      try {
        return JSON.parse(trimmed.slice(start)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Normalise a value that may be a single item or an array into an array.
 * `ConvertTo-Json` emits a bare object when a pipeline returns exactly one item,
 * which would otherwise crash array iteration.
 */
export function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Parse JSON and always return an array (handles the single-item case). */
export function parsePowerShellJsonArray<T>(output: string): T[] {
  return toArray(parsePowerShellJson<T | T[]>(output));
}
