import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { freeMemory, buildFreeMemoryScript } from './memory-free';
import type * as PowerShell from './powershell';

// Keep the real parser; only stub the process runner.
vi.mock('./powershell', async (importOriginal) => {
  const actual = await importOriginal<typeof PowerShell>();
  return { ...actual, runPowerShell: vi.fn() };
});

import { runPowerShell } from './powershell';

const ok = (stdout: string) => ({ success: true, stdout, stderr: '', exitCode: 0 });
const fail = () => ({ success: false, stdout: '', stderr: 'Access denied', exitCode: 1 });

const mb = (n: number) => n * 1024 * 1024;

const mockRss = (beforeMb: number, afterMb: number) =>
  vi
    .spyOn(process, 'memoryUsage')
    .mockReturnValueOnce({
      rss: mb(beforeMb),
      heapTotal: mb(10),
      heapUsed: mb(5),
      external: mb(1),
      arrayBuffers: 0,
    })
    .mockReturnValueOnce({
      rss: mb(afterMb),
      heapTotal: mb(10),
      heapUsed: mb(5),
      external: mb(1),
      arrayBuffers: 0,
    });

describe('memory-free (P1.1 Liberar RAM)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a psapi EmptyWorkingSet script for self + child processes', () => {
    const script = buildFreeMemoryScript(4242);

    expect(script).toContain('psapi.dll');
    expect(script).toContain('EmptyWorkingSet');
    expect(script).toContain('ParentProcessId=4242');
    expect(script).toContain('@(4242)');
    // Never allow non-integer pids into the script (injection guard).
    expect(buildFreeMemoryScript(-1)).toBe('');
    expect(buildFreeMemoryScript(4.5)).toBe('');
    expect(buildFreeMemoryScript(NaN)).toBe('');
  });

  it('trims the app working set and reports the RSS delta', async () => {
    mockRss(200, 130);
    vi.mocked(runPowerShell).mockResolvedValue(ok('OK'));

    const result = await freeMemory();

    expect(runPowerShell).toHaveBeenCalledTimes(1);
    const script = vi.mocked(runPowerShell).mock.calls[0]?.[0] ?? '';
    expect(script).toContain('EmptyWorkingSet');
    expect(script).toContain(String(process.pid));
    expect(result.success).toBe(true);
    expect(result.rssBeforeMb).toBe(200);
    expect(result.rssAfterMb).toBe(130);
    expect(result.freedMb).toBe(70);
    expect(result.error).toBeUndefined();
  });

  it('accepts the GC fallback path', async () => {
    mockRss(150, 150);
    vi.mocked(runPowerShell).mockResolvedValue(ok('FALLBACK'));

    const result = await freeMemory();

    expect(result.success).toBe(true);
    expect(result.freedMb).toBe(0);
  });

  it('reports failure when PowerShell fails', async () => {
    mockRss(200, 200);
    vi.mocked(runPowerShell).mockResolvedValue(fail());

    const result = await freeMemory();

    expect(result.success).toBe(false);
    expect(result.freedMb).toBe(0);
    expect(result.error).toBeTruthy();
  });

  it('never reports negative freed memory (RSS can grow)', async () => {
    mockRss(100, 180);
    vi.mocked(runPowerShell).mockResolvedValue(ok('OK'));

    const result = await freeMemory();

    expect(result.success).toBe(true);
    expect(result.freedMb).toBe(0);
    expect(result.rssAfterMb).toBe(180);
  });

  it('fails fast on a pid that is not a positive integer', async () => {
    const result = await freeMemory(-1);

    expect(result.success).toBe(false);
    expect(result.error).toContain('pid');
    expect(runPowerShell).not.toHaveBeenCalled();
  });
});
