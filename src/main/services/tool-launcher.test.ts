import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const openPath = vi.hoisted(() => vi.fn());
const existsSync = vi.hoisted(() => vi.fn());
const runPowerShell = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  shell: { openPath },
}));

vi.mock('fs', () => ({
  existsSync,
}));

vi.mock('./powershell', () => ({
  runPowerShell,
}));

import { launchWindowsTool, resolveToolPath } from './tool-launcher';
import { WINDOWS_TOOLS, getWindowsTool } from '@shared/windows-tools';

describe('main/services/tool-launcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReturnValue(true);
    openPath.mockResolvedValue('');
    runPowerShell.mockResolvedValue({
      success: true,
      stdout: 'RUNNING',
      stderr: '',
      exitCode: 0,
    });
  });

  it('resolves a tool inside System32', () => {
    const tool = getWindowsTool('task-manager');
    expect(tool).not.toBeNull();
    expect(resolveToolPath(tool!, 'D:\\Win')).toBe('D:\\Win\\System32\\taskmgr.exe');
  });

  it('rejects an unknown utility id', async () => {
    const result = await launchWindowsTool('definitely-not-a-tool');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Unknown utility/);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('validates that the binary exists before launching', async () => {
    existsSync.mockReturnValue(false);
    const result = await launchWindowsTool('task-manager');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('opens a validated tool', async () => {
    const result = await launchWindowsTool('task-manager');
    expect(result.success).toBe(true);
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(String(openPath.mock.calls[0]?.[0])).toContain('taskmgr.exe');
  });

  // Regression guard: openPath resolves with '' even when the tool never starts.
  it('reports failure when no process appears after opening', async () => {
    runPowerShell.mockResolvedValue({ success: true, stdout: 'NO', stderr: '', exitCode: 0 });

    const result = await launchWindowsTool('task-manager');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/did not appear to start/);
  }, 15000);

  it('surfaces an OS error from openPath', async () => {
    openPath.mockResolvedValue('No application is associated with the file');
    const result = await launchWindowsTool('task-manager');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No application/);
  });

  it('never accepts an arbitrary path: only catalogued ids launch', () => {
    // Every catalog entry has a safe bare file name and no traversal.
    for (const tool of WINDOWS_TOOLS) {
      expect(tool.file).not.toMatch(/[\\/]/);
      expect(tool.file).not.toContain('..');
    }
  });

  describe('non-Windows platform', () => {
    const original = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    });

    it('refuses to launch', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      const result = await launchWindowsTool('task-manager');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/only available on Windows/);
    });
  });
});
