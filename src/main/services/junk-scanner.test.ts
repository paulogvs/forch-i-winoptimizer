import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scanForJunkFiles,
  deleteJunkFiles,
  isExcludedPath,
  classifyDeleteFailure,
  retryFailedDeletions,
} from './junk-scanner';

// Mock powershell module
vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  parsePowerShellJson: vi.fn(),
}));

import { runPowerShell, parsePowerShellJson } from './powershell';

describe('junk-scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scanForJunkFiles', () => {
    it('should return empty result when no files found', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(null);

      const result = await scanForJunkFiles();

      expect(result.files).toEqual([]);
      expect(result.totalSize).toBe(0);
      expect(result.totalCount).toBe(0);
    });

    it('should scan and categorize junk files', async () => {
      const mockFiles = [
        {
          FullName: 'C:\\Windows\\Temp\\temp1.tmp',
          Name: 'temp1.tmp',
          Length: 1024,
          LastWriteTime: '2024-01-15T10:30:00Z',
        },
        {
          FullName: 'C:\\Windows\\Temp\\temp2.tmp',
          Name: 'temp2.tmp',
          Length: 2048,
          LastWriteTime: '2024-01-15T11:00:00Z',
        },
      ];

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(mockFiles),
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(mockFiles);

      const result = await scanForJunkFiles();

      expect(result.totalCount).toBeGreaterThanOrEqual(0);
      expect(result.totalSize).toBeGreaterThanOrEqual(0);
      expect(result.categories).toBeDefined();
    });

    it('should handle PowerShell errors gracefully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Access denied',
        exitCode: 1,
      });

      const result = await scanForJunkFiles();

      expect(result.files).toEqual([]);
      expect(result.totalSize).toBe(0);
    });

    it('should handle exceptions during scan', async () => {
      vi.mocked(runPowerShell).mockRejectedValue(new Error('Unexpected error'));

      const result = await scanForJunkFiles();

      expect(result.files).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('should expand environment variables in paths', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(null);

      await scanForJunkFiles();

      // Verify that runPowerShell was called with expanded paths
      const calls = vi.mocked(runPowerShell).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  describe('isExcludedPath', () => {
    it('matches an exact prefix and its children (case-insensitive)', () => {
      expect(isExcludedPath('C:\\Keep\\a.tmp', ['C:\\Keep'])).toBe(true);
      expect(isExcludedPath('c:\\keep\\nested\\b.tmp', ['C:\\KEEP'])).toBe(true);
    });

    it('does not match a sibling with a shared prefix', () => {
      expect(isExcludedPath('C:\\KeepOther\\a.tmp', ['C:\\Keep'])).toBe(false);
    });

    it('ignores blank entries and trailing separators', () => {
      expect(isExcludedPath('C:\\a.tmp', ['  ', ''])).toBe(false);
      expect(isExcludedPath('C:\\Keep\\a.tmp', ['C:\\Keep\\'])).toBe(true);
    });
  });

  describe('scan options', () => {
    it('filters results by exclude paths', async () => {
      const mockFiles = [
        {
          FullName: 'C:\\Windows\\Temp\\keep.tmp',
          Name: 'keep.tmp',
          Length: 10,
          LastWriteTime: '',
        },
        {
          FullName: 'C:\\Windows\\Temp\\skip.tmp',
          Name: 'skip.tmp',
          Length: 20,
          LastWriteTime: '',
        },
      ];
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(mockFiles);

      const result = await scanForJunkFiles(undefined, {
        excludePaths: ['C:\\Windows\\Temp\\skip.tmp'],
      });

      expect(result.files.map((f) => f.name)).toEqual(['keep.tmp']);
    });

    it('restricts the PowerShell targets to the requested categories', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockReturnValue(null);

      await scanForJunkFiles(undefined, { categories: ['temp'] });

      const script = String(vi.mocked(runPowerShell).mock.calls.at(-1)?.[0] ?? '');
      expect(script).toContain("'temp'");
      expect(script).not.toContain("'browser-cache'");
    });
  });

  describe('deleteJunkFiles (Fase 1.6: N files -> 1 spawn, per-file report)', () => {
    beforeEach(() => {
      vi.mocked(parsePowerShellJson).mockImplementation((output: string) => {
        try {
          return JSON.parse(output);
        } catch {
          return null;
        }
      });
    });
    /** Batch stdout for the given per-file statuses (what the script emits). */
    const batchStdout = (rows: Array<{ Path: string; Status: string }>): string =>
      JSON.stringify(rows);

    it('should delete files successfully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: batchStdout([{ Path: 'C:\\Windows\\Temp\\temp1.tmp', Status: 'DELETED' }]),
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteJunkFiles(['C:\\Windows\\Temp\\temp1.tmp']);

      expect(vi.mocked(runPowerShell)).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('does not count a missing file as deleted', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: batchStdout([{ Path: 'C:\\Windows\\Temp\\nonexistent.tmp', Status: 'NOT_FOUND' }]),
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteJunkFiles(['C:\\Windows\\Temp\\nonexistent.tmp']);

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(0);
    });

    // Regression guard: a Remove-Item that fails silently used to be reported
    // as "DELETED" because the script printed it unconditionally.
    it('reports a failure when the path is still present after removal', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: batchStdout([
          { Path: 'C:\\Windows\\Temp\\locked.tmp', Status: 'FAILED: still present after removal' },
        ]),
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteJunkFiles(['C:\\Windows\\Temp\\locked.tmp']);

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('should handle deletion failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Access denied',
        exitCode: 1,
      });

      const result = await deleteJunkFiles(['C:\\Windows\\Temp\\protected.tmp']);

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
    });

    it('should handle multiple files in a single spawn', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: batchStdout([
          { Path: 'C:\\Windows\\Temp\\temp1.tmp', Status: 'DELETED' },
          { Path: 'C:\\Windows\\Temp\\temp2.tmp', Status: 'DELETED' },
          { Path: 'C:\\Windows\\Temp\\temp3.tmp', Status: 'DELETED' },
        ]),
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteJunkFiles([
        'C:\\Windows\\Temp\\temp1.tmp',
        'C:\\Windows\\Temp\\temp2.tmp',
        'C:\\Windows\\Temp\\temp3.tmp',
      ]);

      expect(vi.mocked(runPowerShell)).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.deleted).toBe(3);
      expect(result.failed).toBe(0);
    });

    it('should handle mixed success and failure with a per-file report', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: batchStdout([
          { Path: 'C:\\Windows\\Temp\\temp1.tmp', Status: 'DELETED' },
          { Path: 'C:\\Windows\\Temp\\temp2.tmp', Status: 'FAILED: Access to the path is denied' },
        ]),
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteJunkFiles([
        'C:\\Windows\\Temp\\temp1.tmp',
        'C:\\Windows\\Temp\\temp2.tmp',
      ]);

      expect(vi.mocked(runPowerShell)).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain('temp2.tmp');
    });

    it('deletes N files in a single spawn, reporting each file honestly', async () => {
      const files = [
        'C:\\Scratch\\a.tmp',
        'C:\\Scratch\\b.tmp',
        'C:\\Scratch\\c.tmp',
        'C:\\Scratch\\gone.tmp',
        'C:\\Scratch\\locked.tmp',
      ];
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: batchStdout([
          { Path: files[0]!, Status: 'DELETED' },
          { Path: files[1]!, Status: 'DELETED' },
          { Path: files[2]!, Status: 'DELETED' },
          { Path: files[3]!, Status: 'NOT_FOUND' },
          { Path: files[4]!, Status: 'FAILED: still present after removal' },
        ]),
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteJunkFiles(files);

      expect(vi.mocked(runPowerShell)).toHaveBeenCalledTimes(1);
      // The whole path list travels in the single script.
      const script = String(vi.mocked(runPowerShell).mock.calls[0]?.[0] ?? '');
      for (const f of files) expect(script).toContain(f);
      expect(result.deleted).toBe(3);
      expect(result.failed).toBe(1);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('locked.tmp');
    });

    it('should handle exceptions', async () => {
      vi.mocked(runPowerShell).mockRejectedValue(new Error('Unexpected error'));

      const result = await deleteJunkFiles(['C:\\Windows\\Temp\\temp1.tmp']);

      expect(result.success).toBe(false);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
    });
  });

  describe('delete receipt classification (Fase 4.6)', () => {
    it('maps each real failure cause to a stable reason', () => {
      expect(classifyDeleteFailure('EBUSY: resource busy or locked')).toBe('in-use');
      expect(classifyDeleteFailure('EPERM: operation not permitted')).toBe('in-use');
      expect(
        classifyDeleteFailure(
          'The process cannot access the file because it is being used by another process'
        )
      ).toBe('in-use');
      expect(classifyDeleteFailure('EACCES: permission denied')).toBe('permissions');
      expect(classifyDeleteFailure('Access to the path is denied.')).toBe('permissions');
      expect(classifyDeleteFailure('ENOTEMPTY: directory not empty')).toBe('not-empty');
      expect(classifyDeleteFailure('still present after removal')).toBe('still-present');
      expect(classifyDeleteFailure('ENOENT: no such file')).toBe('not-found');
      expect(classifyDeleteFailure('something bizarre happened')).toBe('unknown');
      expect(classifyDeleteFailure(null)).toBe('unknown');
    });

    it('returns a per-file receipt for successes, no-ops and failures', async () => {
      vi.mocked(parsePowerShellJson).mockImplementation((output: string) => {
        try {
          return JSON.parse(output);
        } catch {
          return null;
        }
      });
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify([
          { Path: 'C:\\Temp\\a.tmp', Status: 'DELETED', Error: '' },
          { Path: 'C:\\Temp\\gone.tmp', Status: 'NOT_FOUND', Error: '' },
          { Path: 'C:\\Temp\\busy.tmp', Status: 'FAILED', Error: 'being used by another process' },
          { Path: 'C:\\Temp\\denied.tmp', Status: 'FAILED', Error: 'Access to the path is denied' },
        ]),
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteJunkFiles([
        'C:\\Temp\\a.tmp',
        'C:\\Temp\\gone.tmp',
        'C:\\Temp\\busy.tmp',
        'C:\\Temp\\denied.tmp',
      ]);

      const byPath = new Map(result.receipts.map((r) => [r.path, r]));
      expect(byPath.get('C:\\Temp\\a.tmp')).toMatchObject({ deleted: true, reason: null });
      expect(byPath.get('C:\\Temp\\gone.tmp')).toMatchObject({
        deleted: false,
        reason: 'not-found',
      });
      expect(byPath.get('C:\\Temp\\busy.tmp')).toMatchObject({ deleted: false, reason: 'in-use' });
      expect(byPath.get('C:\\Temp\\denied.tmp')).toMatchObject({
        deleted: false,
        reason: 'permissions',
      });
      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(2);
      // Every requested path got exactly one receipt.
      expect(result.receipts).toHaveLength(4);
    });

    it('accepts the legacy "FAILED: <message>" status form', async () => {
      vi.mocked(parsePowerShellJson).mockImplementation((output: string) => {
        try {
          return JSON.parse(output);
        } catch {
          return null;
        }
      });
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify([
          { Path: 'C:\\Temp\\x.tmp', Status: 'FAILED: Access to the path is denied' },
        ]),
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteJunkFiles(['C:\\Temp\\x.tmp']);
      expect(result.receipts[0]).toMatchObject({ deleted: false, reason: 'permissions' });
    });

    it('retries only the previously-failed paths', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify([{ Path: 'C:\\Temp\\busy.tmp', Status: 'DELETED', Error: '' }]),
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJson).mockImplementation((output: string) => {
        try {
          return JSON.parse(output);
        } catch {
          return null;
        }
      });

      const result = await retryFailedDeletions([
        { path: 'C:\\Temp\\ok.tmp', deleted: true, reason: null, message: '', at: '' },
        { path: 'C:\\Temp\\busy.tmp', deleted: false, reason: 'in-use', message: '', at: '' },
      ]);

      expect(result.deleted).toBe(1);
      const script = String(vi.mocked(runPowerShell).mock.calls.at(-1)?.[0] ?? '');
      expect(script).toContain('busy.tmp');
      expect(script).not.toContain('ok.tmp');
    });
  });
});
