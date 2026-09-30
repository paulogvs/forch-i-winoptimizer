import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock child_process before powershell module loads
const mockExec = vi.fn();

vi.mock('child_process', () => ({
  exec: (...args: unknown[]) => mockExec(...args),
  default: {
    exec: (...args: unknown[]) => mockExec(...args),
  },
}));

import { runPowerShell, runPowerShellScript, parsePowerShellJson } from './powershell';

describe('powershell', () => {
  beforeEach(() => {
    mockExec.mockReset();
    // Default success
    mockExec.mockImplementation(((_cmd: string, _opts: unknown, callback: Function) => {
      callback(null, { stdout: '', stderr: '' });
      return {};
    }) as any);
  });

  describe('runPowerShell', () => {
    it('should execute command and return success', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: unknown, callback: Function) => {
        callback(null, { stdout: '  hello world  \n', stderr: '' });
        return {} as any;
      }) as any);

      const result = await runPowerShell('Get-Process');

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('hello world');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('should handle command with quotes', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: unknown, callback: Function) => {
        callback(null, { stdout: 'ok', stderr: '' });
        return {} as any;
      }) as any);

      await runPowerShell('Write-Output "hello world"');

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('hello world'),
        expect.objectContaining({ timeout: 60000 }),
        expect.any(Function)
      );
    });

    it('should handle command failure', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: unknown, callback: Function) => {
        const err = Object.assign(new Error('Command failed'), {
          stdout: '',
          stderr: 'Access denied',
          code: 1,
        });
        callback(err, { stdout: '', stderr: 'Access denied' });
        return {} as any;
      }) as any);

      const result = await runPowerShell('Invalid-Command');

      expect(result.success).toBe(false);
      expect(result.stderr).toBe('Access denied');
      expect(result.exitCode).toBe(1);
    });

    it('should handle timeout', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: unknown, callback: Function) => {
        const err = Object.assign(new Error('Timeout'), {
          stdout: '',
          stderr: 'Operation timed out',
          code: 1,
        });
        callback(err, { stdout: '', stderr: 'Operation timed out' });
        return {} as any;
      }) as any);

      const result = await runPowerShell('Start-Sleep 100');

      expect(result.success).toBe(false);
      expect(result.stderr).toBe('Operation timed out');
    });

    it('should escape double quotes in command', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: unknown, callback: Function) => {
        callback(null, { stdout: 'ok', stderr: '' });
        return {} as any;
      }) as any);

      await runPowerShell('Write-Output "test"');

      const call = mockExec.mock.calls[0];
      const cmd = call[0] as string;
      expect(cmd).toContain('\\"');
    });
  });

  describe('runPowerShellScript', () => {
    it('should execute script and return success', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: unknown, callback: Function) => {
        callback(null, { stdout: 'script output', stderr: '' });
        return {} as any;
      }) as any);

      const result = await runPowerShellScript('Get-Process | Select-Object -First 1');

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('script output');
      expect(result.exitCode).toBe(0);
    });

    it('should use longer timeout than runPowerShell', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: unknown, callback: Function) => {
        callback(null, { stdout: 'ok', stderr: '' });
        return {} as any;
      }) as any);

      await runPowerShellScript('Get-Process');

      const call = mockExec.mock.calls[0];
      const opts = call[1] as { timeout: number };
      expect(opts.timeout).toBe(120000);
    });

    it('should handle script failure', async () => {
      mockExec.mockImplementation(((_cmd: string, _opts: unknown, callback: Function) => {
        const err = Object.assign(new Error('Script error'), {
          stdout: '',
          stderr: 'Script failed',
          code: 1,
        });
        callback(err, { stdout: '', stderr: 'Script failed' });
        return {} as any;
      }) as any);

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
      const result = parsePowerShellJson('not json');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parsePowerShellJson('');
      expect(result).toBeNull();
    });

    it('should handle complex nested JSON', () => {
      const json = '{"cpu": {"model": "Intel", "cores": 8}, "memory": {"total": 16}}';
      const result = parsePowerShellJson<{ cpu: { model: string; cores: number } }>(json);
      expect(result?.cpu.model).toBe('Intel');
      expect(result?.cpu.cores).toBe(8);
    });
  });
});
