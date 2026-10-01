import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.fn();

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  default: { execFile: (...args: unknown[]) => mockExecFile(...args) },
}));

import { runPowerShell, runPowerShellScript, parsePowerShellJson, toArray, parsePowerShellJsonArray } from './powershell';

/** Decode the Base64/UTF-16LE script passed via -EncodedCommand. */
function decodeEncodedCall(call: unknown[]): string {
  const args = call[1] as string[];
  const idx = args.indexOf('-EncodedCommand');
  const b64 = args[idx + 1] ?? '';
  return Buffer.from(b64, 'base64').toString('utf16le');
}

describe('powershell', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockExecFile.mockImplementation(((_file: string, _args: unknown, _opts: unknown, callback: (err: unknown, out?: unknown) => void) => {
      callback(null, { stdout: '', stderr: '' });
      return {};
    }) as unknown as never);
  });

  describe('runPowerShell', () => {
    it('should execute via powershell.exe -EncodedCommand and return success', async () => {
      mockExecFile.mockImplementation(((_file: string, _args: unknown, _opts: unknown, callback: (err: unknown, out?: unknown) => void) => {
        callback(null, { stdout: '  hello world  \n', stderr: '' });
        return {};
      }) as unknown as never);

      const result = await runPowerShell('Get-Process');

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('hello world');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);

      const call = mockExecFile.mock.calls[0];
      expect(call[0]).toBe('powershell.exe');
      const args = call[1] as string[];
      expect(args).toContain('-NoProfile');
      expect(args).toContain('-NonInteractive');
      expect(args).toContain('-ExecutionPolicy');
      expect(args).toContain('-EncodedCommand');
    });

    it('should encode multi-line scripts with quotes losslessly', async () => {
      mockExecFile.mockImplementation(((_file: string, _args: unknown, _opts: unknown, callback: (err: unknown, out?: unknown) => void) => {
        callback(null, { stdout: 'ok', stderr: '' });
        return {};
      }) as unknown as never);

      const script = 'Write-Output "hello world"\n$p = @("a","b")\nforeach ($x in $p) { "$x" }';
      await runPowerShell(script);

      const decoded = decodeEncodedCall(mockExecFile.mock.calls[0]);
      expect(decoded).toContain('Write-Output "hello world"');
      expect(decoded).toContain('$p = @("a","b")');
      expect(decoded).toContain('foreach ($x in $p) { "$x" }');
    });

    it('should use a 60s timeout and hide the window', async () => {
      mockExecFile.mockImplementation(((_file: string, _args: unknown, _opts: unknown, callback: (err: unknown, out?: unknown) => void) => {
        callback(null, { stdout: '', stderr: '' });
        return {};
      }) as unknown as never);

      await runPowerShell('Get-Process');

      const opts = mockExecFile.mock.calls[0][2] as { timeout: number; windowsHide: boolean };
      expect(opts.timeout).toBe(60000);
      expect(opts.windowsHide).toBe(true);
    });

    it('should handle command failure preserving stderr and exit code', async () => {
      mockExecFile.mockImplementation(((_file: string, _args: unknown, _opts: unknown, callback: (err: unknown, out?: unknown) => void) => {
        const err = Object.assign(new Error('Command failed'), {
          stdout: '',
          stderr: 'Access denied',
          code: 1,
        });
        callback(err, undefined);
        return {};
      }) as unknown as never);

      const result = await runPowerShell('Invalid-Command');

      expect(result.success).toBe(false);
      expect(result.stderr).toBe('Access denied');
      expect(result.exitCode).toBe(1);
    });

    it('should handle timeout (killed) with exit code 124', async () => {
      mockExecFile.mockImplementation(((_file: string, _args: unknown, _opts: unknown, callback: (err: unknown, out?: unknown) => void) => {
        const err = Object.assign(new Error('Timeout'), {
          stdout: '',
          stderr: 'Operation timed out',
          killed: true,
        });
        callback(err, undefined);
        return {};
      }) as unknown as never);

      const result = await runPowerShell('Start-Sleep 100');

      expect(result.success).toBe(false);
      expect(result.stderr).toBe('Operation timed out');
      expect(result.exitCode).toBe(124);
    });
  });

  describe('runPowerShellScript', () => {
    it('should execute script and return success', async () => {
      mockExecFile.mockImplementation(((_file: string, _args: unknown, _opts: unknown, callback: (err: unknown, out?: unknown) => void) => {
        callback(null, { stdout: 'script output', stderr: '' });
        return {};
      }) as unknown as never);

      const result = await runPowerShellScript('Get-Process | Select-Object -First 1');

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('script output');
      expect(result.exitCode).toBe(0);
    });

    it('should use longer timeout than runPowerShell', async () => {
      mockExecFile.mockImplementation(((_file: string, _args: unknown, _opts: unknown, callback: (err: unknown, out?: unknown) => void) => {
        callback(null, { stdout: 'ok', stderr: '' });
        return {};
      }) as unknown as never);

      await runPowerShellScript('Get-Process');

      const opts = mockExecFile.mock.calls[0][2] as { timeout: number };
      expect(opts.timeout).toBe(120000);
    });

    it('should handle script failure', async () => {
      mockExecFile.mockImplementation(((_file: string, _args: unknown, _opts: unknown, callback: (err: unknown, out?: unknown) => void) => {
        const err = Object.assign(new Error('Script error'), {
          stdout: '',
          stderr: 'Script failed',
          code: 1,
        });
        callback(err, undefined);
        return {};
      }) as unknown as never);

      const result = await runPowerShellScript('Invalid-Script');

      expect(result.success).toBe(false);
      expect(result.stderr).toBe('Script failed');
    });
  });

  describe('parsePowerShellJson', () => {
    it('should parse valid JSON', () => {
      const result = parsePowerShellJson<{ name: string }>('{"name": "test"}');
      expect(result).toEqual({ name: 'test' });
    });

    it('should parse JSON array', () => {
      const result = parsePowerShellJson<Array<{ id: number }>>('[{"id": 1}, {"id": 2}]');
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should return null for invalid JSON', () => {
      expect(parsePowerShellJson('not json')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parsePowerShellJson('')).toBeNull();
    });

    it('should recover JSON preceded by noise/BOM text', () => {
      const result = parsePowerShellJson<{ ok: boolean }>('\uFEFFWARNING: something\n{"ok": true}');
      expect(result).toEqual({ ok: true });
    });

    it('should handle complex nested JSON', () => {
      const json = '{"cpu": {"model": "Intel", "cores": 8}, "memory": {"total": 16}}';
      const result = parsePowerShellJson<{ cpu: { model: string; cores: number } }>(json);
      expect(result?.cpu.model).toBe('Intel');
      expect(result?.cpu.cores).toBe(8);
    });
  });

  describe('toArray', () => {
    it('should wrap a single object in an array', () => {
      expect(toArray({ id: 1 })).toEqual([{ id: 1 }]);
    });

    it('should pass arrays through', () => {
      expect(toArray([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should return [] for null/undefined', () => {
      expect(toArray(null)).toEqual([]);
      expect(toArray(undefined)).toEqual([]);
    });
  });

  describe('parsePowerShellJsonArray', () => {
    it('should parse an array payload', () => {
      expect(parsePowerShellJsonArray<{ id: number }>('[{"id":1},{"id":2}]')).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should normalise a single-object payload into an array', () => {
      expect(parsePowerShellJsonArray<{ id: number }>('{"id":1}')).toEqual([{ id: 1 }]);
    });

    it('should return [] for invalid payloads', () => {
      expect(parsePowerShellJsonArray('')).toEqual([]);
      expect(parsePowerShellJsonArray('not json')).toEqual([]);
    });
  });
});
