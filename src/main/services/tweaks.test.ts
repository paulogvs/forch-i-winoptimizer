import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  TWEAKS,
  getTweaks,
  previewTweak,
  applyTweak,
  restoreTweak,
  applyTweaks,
  setTweakRunner,
  resetTweakRunner,
  setTweakStatePath,
  setWindowsBuild,
} from './tweaks';
import type { TweakRunner } from './tweaks';

let stateFile = '';

function okOk(script: string) {
  if (script.includes('ConvertTo-Json')) {
    return { success: true, stdout: '{"r0":null}', stderr: '', exitCode: 0 };
  }
  return { success: true, stdout: 'OK', stderr: '', exitCode: 0 };
}

const runner = vi.fn(async (script: string) => okOk(script));

describe('safe tweaks', () => {
  beforeEach(() => {
    stateFile = path.join(os.tmpdir(), `forchi-tweaks-${Date.now()}-${Math.random()}.json`);
    setTweakStatePath(stateFile);
    runner.mockReset();
    runner.mockImplementation(async (script: string) => okOk(script));
    setTweakRunner(runner as unknown as TweakRunner);
  });

  afterEach(() => {
    resetTweakRunner();
    setTweakStatePath(null);
    setWindowsBuild(null);
    try {
      fs.unlinkSync(stateFile);
    } catch {
      /* already gone */
    }
  });

  it('ships only reversible tweaks and marks everything as safe/advanced explicitly', () => {
    expect(TWEAKS.length).toBeGreaterThan(0);
    for (const tweak of TWEAKS) {
      expect(tweak.reversible).toBe(true);
      expect(['safe', 'advanced']).toContain(tweak.safety);
      expect(tweak.description.length).toBeGreaterThan(10);
    }
  });

  it('lists tweaks with an applied flag', async () => {
    const list = await getTweaks();
    expect(list).toHaveLength(TWEAKS.length);
    expect(list.every((t) => t.applied === false)).toBe(true);
  });

  it('previews the exact operations and rejects unknown ids', async () => {
    const preview = await previewTweak('show-file-extensions');
    expect(preview.applyOperations.length).toBeGreaterThan(0);
    expect(preview.revertOperations.length).toBeGreaterThan(0);
    await expect(previewTweak('nope')).rejects.toThrow('Unknown tweak');
  });

  it('applies, persists and restores a tweak', async () => {
    const applied = await applyTweak('show-file-extensions');
    expect(applied.success).toBe(true);
    // capture read + apply write
    expect(runner).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(stateFile)).toBe(true);

    const afterApply = await getTweaks();
    expect(afterApply.find((t) => t.id === 'show-file-extensions')?.applied).toBe(true);

    const restored = await restoreTweak('show-file-extensions');
    expect(restored.success).toBe(true);
    const afterRestore = await getTweaks();
    expect(afterRestore.find((t) => t.id === 'show-file-extensions')?.applied).toBe(false);
  });

  it('treats informational tweaks as no-ops (never runs PowerShell)', async () => {
    const result = await applyTweak('game-mode-hags');
    expect(result.success).toBe(true);
    expect(runner).not.toHaveBeenCalled();
  });

  it('does not mark a tweak as applied when the script fails', async () => {
    runner.mockImplementation(async (script: string) =>
      script.includes('ConvertTo-Json')
        ? { success: true, stdout: '{"r0":1}', stderr: '', exitCode: 0 }
        : { success: true, stdout: 'FAILED: access denied', stderr: '', exitCode: 0 }
    );

    const result = await applyTweak('show-file-extensions');
    expect(result.success).toBe(false);
    expect(result.message).toContain('FAILED');
    const list = await getTweaks();
    expect(list.find((t) => t.id === 'show-file-extensions')?.applied).toBe(false);
  });

  it('applies multiple tweaks sequentially', async () => {
    const results = await applyTweaks(['show-file-extensions', 'hide-recent-files']);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  // ===== P1.2 (+10 safe tweaks, requiresBuild gate) =====

  const P12_IDS = [
    'snappier-animations',
    'mouse-acceleration-off',
    'startup-delay-zero',
    'taskbar-align-left',
    'taskbar-search-hidden',
    'hide-task-view-button',
    'hide-widgets',
    'hide-copilot',
    'windows-spotlight-off',
    'sticky-keys-off',
  ];

  it('ships the 10 P1.2 tweaks with unique ids and reversible safe definitions', () => {
    // The curated list is DATA (catalogs/tweaks-catalog.json); v0.8.0 reconciled
    // the stale 10-entry winutil import into this 19-entry native catalog.
    expect(TWEAKS.length).toBe(19);
    const ids = TWEAKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of P12_IDS) {
      const tweak = TWEAKS.find((t) => t.id === id);
      expect(tweak, `missing tweak: ${id}`).toBeDefined();
      if (!tweak) continue;
      expect(tweak.apply.length).toBeGreaterThan(0);
      expect(tweak.revert.length).toBeGreaterThan(0);
      expect(tweak.reversible).toBe(true);
      expect(tweak.safety).toBe('safe');
      expect(tweak.description.length).toBeGreaterThan(10);
      for (const op of [...tweak.apply, ...tweak.revert]) {
        expect(['registry', 'service', 'scheduled-task', 'info']).toContain(op.kind);
      }
    }
  });

  it('declares requiresBuild on every Windows 11-only tweak', () => {
    const win11Only = [
      'taskbar-align-left',
      'taskbar-search-hidden',
      'hide-task-view-button',
      'hide-widgets',
      'hide-copilot',
    ];
    for (const id of win11Only) {
      const tweak = TWEAKS.find((t) => t.id === id);
      expect(
        tweak?.requiresBuild,
        `${id} must declare requiresBuild >= 22000`
      ).toBeGreaterThanOrEqual(22000);
    }
    // Not Windows 11 specific:
    expect(TWEAKS.find((t) => t.id === 'sticky-keys-off')?.requiresBuild).toBeUndefined();
    expect(TWEAKS.find((t) => t.id === 'sticky-keys-off')?.category).toBe('accessibility');
  });

  it('gates apply behind requiresBuild (no PowerShell on old builds)', async () => {
    setWindowsBuild(19045);
    const blocked = await applyTweak('taskbar-align-left');
    expect(blocked.success).toBe(false);
    expect(blocked.message).toMatch(/build 22000/);
    expect(runner).not.toHaveBeenCalled();

    setWindowsBuild(26200);
    const applied = await applyTweak('taskbar-align-left');
    expect(applied.success).toBe(true);
    expect(runner).toHaveBeenCalled();
  });

  it('never gates restore behind requiresBuild', async () => {
    setWindowsBuild(19045);
    const restored = await restoreTweak('taskbar-align-left');
    expect(restored.success).toBe(true);
  });

  it('applies every new P1.2 tweak end to end', async () => {
    setWindowsBuild(26200);
    for (const id of P12_IDS) {
      const result = await applyTweak(id);
      expect(result.success, `${id}: ${result.message}`).toBe(true);
    }
    const list = await getTweaks();
    expect(P12_IDS.every((id) => list.find((t) => t.id === id)?.applied)).toBe(true);
  });
});
