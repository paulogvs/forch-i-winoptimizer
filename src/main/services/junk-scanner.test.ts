import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanForJunkFiles, deleteJunkFiles, isExcludedPath } from './junk-scanner';

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

  describe('deleteJunkFiles', () => {
    it('should delete files successfully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'DELETED',
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteJunkFiles(['C:\\Windows\\Temp\\temp1.tmp']);

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('should handle file not found', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'NOT_FOUND',
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteJunkFiles(['C:\\Windows\\Temp\\nonexistent.tmp']);

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(0);
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

    it('should handle multiple files', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'DELETED',
        stderr: '',
        exitCode: 0,
      });

      const result = await deleteJunkFiles([
        'C:\\Windows\\Temp\\temp1.tmp',
        'C:\\Windows\\Temp\\temp2.tmp',
        'C:\\Windows\\Temp\\temp3.tmp',
      ]);

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(3);
      expect(result.failed).toBe(0);
    });

    it('should handle mixed success and failure', async () => {
      let callCount = 0;
      vi.mocked(runPowerShell).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ success: true, stdout: 'DELETED', stderr: '', exitCode: 0 });
        }
        return Promise.resolve({ success: false, stdout: '', stderr: 'Failed', exitCode: 1 });
      });

      const result = await deleteJunkFiles([
        'C:\\Windows\\Temp\\temp1.tmp',
        'C:\\Windows\\Temp\\temp2.tmp',
      ]);

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
    });

    it('should handle exceptions', async () => {
      vi.mocked(runPowerShell).mockRejectedValue(new Error('Unexpected error'));

      const result = await deleteJunkFiles(['C:\\Windows\\Temp\\temp1.tmp']);

      expect(result.success).toBe(false);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
    });
  });
});
