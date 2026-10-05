import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { PowerShellPool } from './powershell-pool';

/**
 * Unit tests for the Fase 5.1 persistent PowerShell pool.
 *
 * A fake `spawn` stands in for `powershell.exe` and speaks the same frame
 * protocol, so the queueing, frame parsing, timeout/recycle and fallback
 * behaviour are all exercised without spawning a real process.
 */

const JOB = '@@JOB@@';
const ID = 'a'.repeat(32);

type FakeProc = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (signal?: string) => boolean;
};

function makeFakeSpawn(): () => FakeProc {
  return () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const emitter = new EventEmitter();
    let buf = '';

    stdin.on('data', (chunk: Buffer | string) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.startsWith(JOB)) continue;
        const script = Buffer.from(line.slice(JOB.length), 'base64').toString('utf8');
        if (script === 'DIE') {
          emitter.emit('exit', 1);
          continue;
        }
        if (script === 'HANG') continue; // never answers -> timeout path
        const code = script === 'FAIL' ? 1 : 0;
        // Mirror real Windows PowerShell: CRLF line endings.
        stdout.write(`@@B@@${ID}\r\n`);
        stdout.write(`OUT:${script}\r\n`);
        if (code) stderr.write(`ERR:${script}\r\n`);
        stdout.write(`\r\n@@E@@${ID}@@${code}\r\n`);
      }
    });

    return Object.assign(emitter, {
      stdin,
      stdout,
      stderr,
      kill: () => emitter.emit('exit', -1),
    }) as FakeProc;
  };
}

const onWindows = process.platform === 'win32';

describe.skipIf(!onWindows)('PowerShellPool', () => {
  it('parses a successful job from the frame protocol', async () => {
    const pool = new PowerShellPool(1, makeFakeSpawn() as never);
    pool.enable();
    const result = await pool.run('Get-Process', 5000);
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.stdout).toBe('OUT:Get-Process');
    expect(result?.stderr).toBe('');
    expect(result?.exitCode).toBe(0);
    pool.dispose();
  });

  it('reports a non-zero exit code honestly', async () => {
    const pool = new PowerShellPool(1, makeFakeSpawn() as never);
    pool.enable();
    const result = await pool.run('FAIL', 5000);
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
    expect(result?.stderr).toBe('ERR:FAIL');
    pool.dispose();
  });

  it('drains queued jobs after a worker frees up (no 3rd-job hang)', async () => {
    // Regression: with a single worker, a batch of >1 concurrent jobs used to
    // leave every job after the first queued forever.
    const pool = new PowerShellPool(1, makeFakeSpawn() as never);
    pool.enable();
    const results = await Promise.all([
      pool.run('A', 5000),
      pool.run('B', 5000),
      pool.run('C', 5000),
    ]);
    expect(results.map((r) => r?.stdout)).toEqual(['OUT:A', 'OUT:B', 'OUT:C']);
    expect(results.every((r) => r?.success)).toBe(true);
    pool.dispose();
  });

  it('falls back (null) when the worker cannot start', async () => {
    const spawn = vi.fn(() => {
      throw new Error('powershell.exe not found');
    });
    const pool = new PowerShellPool(1, spawn as never);
    pool.enable();
    const result = await pool.run('Get-Process', 5000);
    expect(result).toBeNull();
    pool.dispose();
  });

  it('returns exit code 124 and recycles the worker on a job timeout', async () => {
    const pool = new PowerShellPool(1, makeFakeSpawn() as never);
    pool.enable();
    const result = await pool.run('HANG', 40);
    expect(result).not.toBeNull();
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(124);
    expect(pool.stats().recycles).toBe(1);
    pool.dispose();
  });

  it('falls back (null) when the worker dies mid-job', async () => {
    const pool = new PowerShellPool(1, makeFakeSpawn() as never);
    pool.enable();
    const result = await pool.run('DIE', 5000);
    expect(result).toBeNull();
    pool.dispose();
  });

  it('resolves queued jobs to null on dispose (app shutdown)', async () => {
    const pool = new PowerShellPool(1, makeFakeSpawn() as never);
    pool.enable();
    // First job hangs and occupies the single worker; second stays queued.
    const first = pool.run('HANG', 10_000);
    const second = pool.run('OK', 10_000);
    pool.dispose();
    expect(await second).toBeNull();
    // First resolves either via dispose(null) or its timeout; never a success.
    const firstResult = await first;
    expect(firstResult === null || firstResult.exitCode === 124).toBe(true);
  });

  it('returns null immediately when disabled', async () => {
    const pool = new PowerShellPool(1, makeFakeSpawn() as never); // not enabled
    expect(await pool.run('Get-Process', 1000)).toBeNull();
  });
});
