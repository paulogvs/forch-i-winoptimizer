import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as PowerShell from './powershell';

// Keep the real parser; only stub the process runner.
vi.mock('./powershell', async (importOriginal) => {
  const actual = await importOriginal<typeof PowerShell>();
  return { ...actual, runPowerShell: vi.fn() };
});

vi.mock('./junk-scanner', () => ({
  scanForJunkFiles: vi.fn(),
  deleteJunkFiles: vi.fn(),
}));

import { runPowerShell } from './powershell';
import { scanForJunkFiles, deleteJunkFiles } from './junk-scanner';
import { cleanTempQuick, flushDns, SAFE_CLEAN_CATEGORIES } from './quick-fixes';
import type { JunkFile, JunkScanResult } from './junk-scanner';

const ok = (stdout: string) => ({ success: true, stdout, stderr: '', exitCode: 0 });
const fail = (stderr = 'boom') => ({ success: false, stdout: '', stderr, exitCode: 1 });

function junkFile(over: Partial<JunkFile> = {}): JunkFile {
  return {
    id: over.path ?? 'x',
    path: 'C:\\Temp\\x.tmp',
    name: 'x.tmp',
    size: 1024,
    category: 'temp',
    lastModified: new Date(),
    safeToDelete: true,
    ...over,
  };
}

function scanResult(files: JunkFile[]): JunkScanResult {
  return {
    files,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    totalCount: files.length,
    categories: {} as JunkScanResult['categories'],
  };
}

describe('quick-fixes: Clean Temp (Fase 3.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scans only the safe categories and deletes ONLY files flagged safeToDelete', async () => {
    vi.mocked(scanForJunkFiles).mockResolvedValue(
      scanResult([
        junkFile({ path: 'C:\\Temp\\a.tmp', size: 2048 }),
        junkFile({
          path: 'C:\\$Recycle.Bin\\hidden',
          size: 999,
          category: 'recycle-bin',
          safeToDelete: false,
        }),
        junkFile({
          path: 'C:\\Windows\\SoftwareDistribution\\Download\\x',
          size: 5000,
          category: 'windows-update',
          safeToDelete: false,
        }),
      ])
    );
    vi.mocked(deleteJunkFiles).mockResolvedValue({
      success: true,
      deleted: 1,
      failed: 0,
      errors: [],
      removed: ['C:\\Temp\\a.tmp'],
    });

    const result = await cleanTempQuick();

    // The scan is scoped to the safe set, never the full default rule set.
    expect(vi.mocked(scanForJunkFiles).mock.calls[0]?.[1]).toEqual({
      categories: SAFE_CLEAN_CATEGORIES,
    });
    // The destructive call receives ONLY the safe path.
    expect(vi.mocked(deleteJunkFiles).mock.calls[0]?.[0]).toEqual(['C:\\Temp\\a.tmp']);
    expect(result.success).toBe(true);
    expect(result.scanned).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.freedBytes).toBe(2048);
  });

  it('never hides a failure: reports failed count + errors and does not claim success', async () => {
    vi.mocked(scanForJunkFiles).mockResolvedValue(
      scanResult([junkFile({ path: 'C:\\Temp\\locked.tmp', size: 4096 })])
    );
    vi.mocked(deleteJunkFiles).mockResolvedValue({
      success: false,
      deleted: 0,
      failed: 1,
      errors: ['Failed to delete: C:\\Temp\\locked.tmp (in use)'],
      removed: [],
    });

    const result = await cleanTempQuick();

    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.freedBytes).toBe(0);
    expect(result.errors[0]).toContain('locked.tmp');
  });

  it('reports an honest no-op when nothing safe is found (never calls delete)', async () => {
    vi.mocked(scanForJunkFiles).mockResolvedValue(
      scanResult([
        junkFile({ path: 'C:\\$Recycle.Bin\\x', category: 'recycle-bin', safeToDelete: false }),
      ])
    );

    const result = await cleanTempQuick();

    expect(vi.mocked(deleteJunkFiles)).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.scanned).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.message.toLowerCase()).toContain('no safe');
  });

  it('counts freed bytes only for the paths the OS confirms removed', async () => {
    vi.mocked(scanForJunkFiles).mockResolvedValue(
      scanResult([
        junkFile({ path: 'C:\\Temp\\a.tmp', size: 1000 }),
        junkFile({ path: 'C:\\Temp\\b.tmp', size: 2000 }),
      ])
    );
    vi.mocked(deleteJunkFiles).mockResolvedValue({
      success: false,
      deleted: 1,
      failed: 1,
      errors: ['Failed to delete: C:\\Temp\\b.tmp'],
      removed: ['C:\\Temp\\a.tmp'],
    });

    const result = await cleanTempQuick();

    expect(result.deleted).toBe(1);
    expect(result.freedBytes).toBe(1000);
    expect(result.failed).toBe(1);
  });
});

describe('quick-fixes: Flush DNS (Fase 3.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies the real effect and reports the measured cache delta', async () => {
    vi.mocked(runPowerShell).mockResolvedValue(
      ok(JSON.stringify({ exitCode: 0, before: 25, after: 0, verified: true, output: 'ok' }))
    );

    const result = await flushDns();

    expect(result.success).toBe(true);
    expect(result.entriesBefore).toBe(25);
    expect(result.entriesAfter).toBe(0);
    expect(result.message).toContain('flush');
  });

  it('reports failure when the command did not flush (unverified)', async () => {
    vi.mocked(runPowerShell).mockResolvedValue(
      ok(JSON.stringify({ exitCode: 1, before: 25, after: 25, verified: false, output: 'denied' }))
    );

    const result = await flushDns();

    expect(result.success).toBe(false);
    expect(result.message).toContain('denied');
  });

  it('reports failure when PowerShell itself fails', async () => {
    vi.mocked(runPowerShell).mockResolvedValue(fail('powershell missing'));

    const result = await flushDns();

    expect(result.success).toBe(false);
    expect(result.message).toContain('powershell missing');
  });
});
