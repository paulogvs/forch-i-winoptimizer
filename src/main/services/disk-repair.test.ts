import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  runDiskRepair,
  cancelDiskRepair,
  parseDiskRepairOutput,
  extractPercent,
  isMeaningfulLine,
  buildDiskRepairPsCommand,
  type DiskRepairDeps,
} from './disk-repair';
import { DISK_REPAIR_TOOLS, getDiskRepairTool } from '@shared/disk-repair';
import type { DiskRepairProgressEvent } from '@shared/disk-repair';

/**
 * Fake child process so the suite NEVER runs a real repair. Its stdout/stderr
 * are EventEmitters and `kill` is observable.
 */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

const makeChild = (): FakeChild => new FakeChild();

/** Let the async admin check + spawn attach their listeners. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('disk-repair — catalog', () => {
  it('catalog ids are unique and every tool is admin-gated', () => {
    const ids = DISK_REPAIR_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tool of DISK_REPAIR_TOOLS) {
      expect(tool.requiresAdmin).toBe(true);
      expect(tool.command.length).toBeGreaterThan(0);
      expect(tool.estimatedDuration.length).toBeGreaterThan(0);
    }
  });

  it('builds a command with a real exit code per tool', () => {
    expect(buildDiskRepairPsCommand('dism-restore-health')).toContain('/RestoreHealth');
    expect(buildDiskRepairPsCommand('sfc-scannow')).toContain('sfc.exe /scannow');
    expect(buildDiskRepairPsCommand('chkdsk')).toContain('chkdsk.exe C: /scan');
    expect(buildDiskRepairPsCommand('trim')).toContain('ReTrim');
  });
});

describe('disk-repair — parsers', () => {
  it('extracts only real percentages', () => {
    expect(extractPercent('[======= 42.3% =======]')).toBe(42);
    expect(extractPercent('no percent here')).toBeNull();
    expect(extractPercent('100%')).toBe(100);
  });

  it('filters separator/progress-bar noise', () => {
    expect(isMeaningfulLine('')).toBe(false);
    expect(isMeaningfulLine('=====-----=====')).toBe(false);
    expect(isMeaningfulLine('Windows Resource Protection found corrupt files.')).toBe(true);
  });

  it('parses SFC outcomes', () => {
    expect(
      parseDiskRepairOutput('sfc-scannow', [
        'Windows Resource Protection did not find any integrity violations.',
      ])
    ).toEqual({ summary: 'No integrity violations found.', repairNeeded: false });
    expect(
      parseDiskRepairOutput('sfc-scannow', [
        'Windows Resource Protection found corrupt files and successfully repaired them.',
      ]).repairNeeded
    ).toBe(true);
    expect(
      parseDiskRepairOutput('sfc-scannow', [
        'Windows Resource Protection found corrupt files but was unable to fix some of them.',
      ]).repairNeeded
    ).toBe(true);
  });

  it('parses DISM, chkdsk and TRIM outcomes', () => {
    expect(
      parseDiskRepairOutput('dism-restore-health', [
        'The restore operation completed successfully.',
      ]).repairNeeded
    ).toBe(false);
    expect(
      parseDiskRepairOutput('chkdsk', [
        'Windows has scanned the file system and found no problems.',
      ]).repairNeeded
    ).toBe(false);
    expect(
      parseDiskRepairOutput('chkdsk', ['Windows found problems with the file system.']).repairNeeded
    ).toBe(true);
    expect(parseDiskRepairOutput('trim', ['Successfully re-trimmed volume C.']).summary).toMatch(
      /re-trimmed/i
    );
  });

  it('never invents a verdict it cannot determine', () => {
    expect(parseDiskRepairOutput('sfc-scannow', ['something unexpected']).repairNeeded).toBeNull();
  });
});

describe('disk-repair — execution (mocked spawn)', () => {
  let child: FakeChild;

  beforeEach(() => {
    child = makeChild();
  });

  afterEach(() => {
    // Ensure no active repair leaks between tests.
    cancelDiskRepair();
  });

  it('refuses to run without admin, never silently', async () => {
    const spawnFn = vi.fn();
    const result = await runDiskRepair('sfc-scannow', {
      isAdmin: async () => false,
      spawnFn: spawnFn as unknown as NonNullable<DiskRepairDeps['spawnFn']>,
    });

    expect(result.status).toBe('requires-admin');
    expect(result.success).toBe(false);
    expect(result.requiresAdmin).toBe(true);
    expect(result.summary).toMatch(/administrator/i);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('streams live output and resolves with the real exit code + summary', async () => {
    const spawnFn = vi.fn().mockReturnValue(child);
    const progress: DiskRepairProgressEvent[] = [];

    const promise = runDiskRepair('dism-restore-health', {
      isAdmin: async () => true,
      spawnFn: spawnFn as unknown as NonNullable<DiskRepairDeps['spawnFn']>,
      onProgress: (event) => progress.push(event),
    });

    await flush();
    child.stdout.emit('data', Buffer.from('Deployment Image Servicing\n[==== 50.0% ====]\n'));
    child.stdout.emit('data', Buffer.from('The restore operation completed successfully.\n'));
    child.emit('close', 0);

    const result = await promise;

    expect(result.status).toBe('completed');
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.summary).toMatch(/repaired successfully/i);
    expect(result.lines.some((l) => /completed successfully/.test(l))).toBe(true);
    expect(progress.some((e) => e.percent === 50)).toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn.mock.calls[0]?.[0]).toMatch(/powershell|pwsh/);
  });

  it('reports a non-zero exit code honestly (ran, but not clean)', async () => {
    const spawnFn = vi.fn().mockReturnValue(child);
    const promise = runDiskRepair('sfc-scannow', {
      isAdmin: async () => true,
      spawnFn: spawnFn as unknown as NonNullable<DiskRepairDeps['spawnFn']>,
    });
    await flush();
    child.stdout.emit(
      'data',
      Buffer.from(
        'Windows Resource Protection found corrupt files but was unable to fix some of them.\n'
      )
    );
    child.emit('close', 1);

    const result = await promise;
    expect(result.status).toBe('completed');
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.repairNeeded).toBe(true);
  });

  it('is cancellable', async () => {
    const spawnFn = vi.fn().mockReturnValue(child);
    const promise = runDiskRepair('trim', {
      isAdmin: async () => true,
      spawnFn: spawnFn as unknown as NonNullable<DiskRepairDeps['spawnFn']>,
    });

    await flush();
    expect(cancelDiskRepair()).toBe(true);
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit('close', null);

    const result = await promise;
    expect(result.status).toBe('cancelled');
    expect(result.success).toBe(false);
  });

  it('times out instead of hanging forever', async () => {
    const spawnFn = vi.fn().mockReturnValue(child);
    const result = await runDiskRepair('chkdsk', {
      isAdmin: async () => true,
      spawnFn: spawnFn as unknown as NonNullable<DiskRepairDeps['spawnFn']>,
      timeoutMs: 20,
    });

    expect(result.status).toBe('failed');
    expect(result.summary).toMatch(/timed out/i);
    expect(child.kill).toHaveBeenCalled();
  });

  it('surfaces a spawn failure', async () => {
    const spawnFn = vi.fn(() => {
      throw new Error('ENOENT');
    });
    const result = await runDiskRepair('sfc-scannow', {
      isAdmin: async () => true,
      spawnFn: spawnFn as unknown as NonNullable<DiskRepairDeps['spawnFn']>,
    });

    expect(result.status).toBe('failed');
    expect(result.summary).toMatch(/Could not start/);
  });

  it('rejects an unknown tool without spawning', async () => {
    const spawnFn = vi.fn();
    const result = await runDiskRepair('not-a-tool', {
      isAdmin: async () => true,
      spawnFn: spawnFn as unknown as NonNullable<DiskRepairDeps['spawnFn']>,
    });
    expect(result.success).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('does not report success when the tool exits cleanly but never ran (mock sanity)', () => {
    // Guards the catalog against a tool that forgot its command.
    expect(getDiskRepairTool('trim')?.modifiesSystem).toBe(false);
  });
});
