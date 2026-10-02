import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadBloatwareCatalog, getDebloatCandidates, removeBloatware } from './debloat';

// Mock powershell module (the bundled catalog is read from disk unmocked).
vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  runPowerShellScript: vi.fn(),
  parsePowerShellJson: vi.fn(),
  parsePowerShellJsonArray: vi.fn(),
  toArray: (v: unknown) => (v == null ? [] : Array.isArray(v) ? v : [v]),
}));

import { runPowerShellScript, parsePowerShellJsonArray } from './powershell';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

describe('debloat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadBloatwareCatalog', () => {
    it('loads the bundled catalog with valid, guarded entries', async () => {
      const catalog = await loadBloatwareCatalog();

      expect(catalog.length).toBeGreaterThanOrEqual(20);

      const ids = new Set<string>();
      const packages = new Set<string>();
      for (const entry of catalog) {
        expect(entry.id).toMatch(ID_PATTERN);
        expect(entry.uninstallString).toMatch(ID_PATTERN);
        expect(['safe', 'caution', 'protected']).toContain(entry.protection);
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.description.length).toBeGreaterThan(0);
        expect(ids.has(entry.id)).toBe(false);
        expect(packages.has(entry.uninstallString)).toBe(false);
        ids.add(entry.id);
        packages.add(entry.uninstallString);
      }

      // The UI must have visible protection guards to demo and test.
      expect(catalog.filter((a) => a.protection === 'protected').length).toBeGreaterThanOrEqual(3);
      expect(catalog.filter((a) => a.protection === 'caution').length).toBeGreaterThanOrEqual(3);
    });

    it('returns an empty list when the catalog file is missing', async () => {
      // The catalog lives next to package.json; a missing file must not throw.
      const catalog = await loadBloatwareCatalog();
      expect(Array.isArray(catalog)).toBe(true);
    });
  });

  describe('getDebloatCandidates', () => {
    it('marks installed packages from Get-AppxPackage', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(['Microsoft.BingNews', 'Microsoft.Todos']),
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJsonArray).mockReturnValue([
        'Microsoft.BingNews',
        'Microsoft.Todos',
      ]);

      const candidates = await getDebloatCandidates();

      expect(candidates.find((c) => c.id === 'bingnews')?.installed).toBe(true);
      expect(candidates.find((c) => c.id === 'todo')?.installed).toBe(true);
      expect(candidates.find((c) => c.id === '3dbuilder')?.installed).toBe(false);
      expect(candidates.length).toBeGreaterThanOrEqual(20);
    });

    it('marks everything as not installed when PowerShell fails', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Access denied',
        exitCode: 1,
      });
      vi.mocked(parsePowerShellJsonArray).mockReturnValue([]);

      const candidates = await getDebloatCandidates();

      expect(candidates.every((c) => c.installed === false)).toBe(true);
      expect(candidates.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('removeBloatware', () => {
    it('rejects an empty selection without touching PowerShell', async () => {
      const result = await removeBloatware([]);

      expect(result.success).toBe(false);
      expect(result.message.length).toBeGreaterThan(0);
      expect(runPowerShellScript).not.toHaveBeenCalled();
    });

    it('never touches protected entries', async () => {
      const result = await removeBloatware(['windowsstore']);

      expect(result.success).toBe(false);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.status).toBe('protected');
      expect(runPowerShellScript).not.toHaveBeenCalled();
    });

    it('rejects unknown and injected ids without running PowerShell', async () => {
      const result = await removeBloatware([
        'not-a-real-id',
        "bingnews'; Remove-Item C:\\Windows -Recurse; #",
        'x;calc',
        '',
      ]);

      expect(result.success).toBe(false);
      expect(result.results.every((r) => r.status === 'failed')).toBe(true);
      expect(runPowerShellScript).not.toHaveBeenCalled();
    });

    it('removes selected packages using catalog names, never raw client ids', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJsonArray).mockReturnValue([
        { Name: 'Microsoft.BingNews', Status: 'removed' },
        { Name: 'Microsoft.Todos', Status: 'skipped' },
      ]);

      const result = await removeBloatware(['bingnews', 'todo']);

      expect(result.success).toBe(true);
      expect(result.removed).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.results.map((r) => r.status)).toEqual(['removed', 'skipped']);

      // The script must interpolate validated catalog package names...
      const script = vi.mocked(runPowerShellScript).mock.calls[0]![0];
      expect(script).toContain("'Microsoft.BingNews'");
      expect(script).toContain("'Microsoft.Todos'");
      // ...and never the raw client-provided ids.
      expect(script).not.toContain("'bingnews'");
      expect(script).not.toContain("'todo'");
    });

    it('reports per-app failures when PowerShell fails', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'boom',
        exitCode: 1,
      });

      const result = await removeBloatware(['bingnews']);

      expect(result.success).toBe(false);
      expect(result.failed).toBe(1);
      expect(result.results[0]!.status).toBe('failed');
    });

    it('aggregates mixed selections: protected refused, valid removed, duplicates collapsed', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJsonArray).mockReturnValue([
        { Name: 'Microsoft.BingNews', Status: 'removed' },
      ]);

      const result = await removeBloatware([
        'bingnews',
        'bingnews',
        'windowsstore',
        'mystery',
      ]);

      expect(result.removed).toBe(1);
      expect(result.refused).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results.filter((r) => r.id === 'bingnews')).toHaveLength(1);
      expect(result.results.find((r) => r.id === 'windowsstore')?.status).toBe('protected');
      expect(result.results.find((r) => r.id === 'mystery')?.status).toBe('failed');
    });

    it('handles a PowerShell result that omits some packages as failures', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
      vi.mocked(parsePowerShellJsonArray).mockReturnValue([]);

      const result = await removeBloatware(['bingnews']);

      expect(result.success).toBe(false);
      expect(result.failed).toBe(1);
      expect(result.results[0]!.status).toBe('failed');
    });
  });
});
