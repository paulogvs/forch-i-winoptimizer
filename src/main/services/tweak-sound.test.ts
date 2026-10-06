import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  TWEAKS,
  applyTweak,
  restoreTweak,
  setTweakRunner,
  resetTweakRunner,
  setTweakStatePath,
  setWindowsBuild,
} from './tweaks';
import type { TweakRunner } from './tweaks';

const SOUND_IDS = ['sound-ducking-off', 'startup-sound-off', 'voice-activation-off'];

function okOk(script: string) {
  if (script.includes('# FORCHI_VERIFY')) {
    return { success: true, stdout: '{"verified":true}', stderr: '', exitCode: 0 };
  }
  if (script.includes('ConvertTo-Json')) {
    return { success: true, stdout: '{"r0":null}', stderr: '', exitCode: 0 };
  }
  return { success: true, stdout: 'OK', stderr: '', exitCode: 0 };
}

const runner = vi.fn(async (script: string) => okOk(script));

let stateFile = '';

describe('A5 sound tweaks (ducking, startup sound, voice)', () => {
  beforeEach(() => {
    stateFile = path.join(os.tmpdir(), `forchi-sound-${Date.now()}-${Math.random()}.json`);
    setTweakStatePath(stateFile);
    runner.mockReset();
    runner.mockImplementation(async (script: string) => okOk(script));
    setTweakRunner(runner as unknown as TweakRunner);
    setWindowsBuild(26200);
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

  it('ships every sound tweak reversible, HKCU-only and without admin', () => {
    for (const id of SOUND_IDS) {
      const tweak = TWEAKS.find((t) => t.id === id);
      expect(tweak, `missing sound tweak: ${id}`).toBeDefined();
      if (!tweak) continue;
      expect(tweak.reversible).toBe(true);
      expect(tweak.requiresAdmin).toBe(false);
      expect(tweak.apply.length).toBeGreaterThan(0);
      expect(tweak.revert.length).toBeGreaterThan(0);
      for (const op of [...tweak.apply, ...tweak.revert]) {
        expect(op.kind).toBe('registry');
        if (op.kind === 'registry') expect(op.hive).toBe('HKCU');
      }
    }
  });

  it.each(SOUND_IDS)('reverts %s after applying it', async (id) => {
    const applied = await applyTweak(id);
    expect(applied.success, `${id}: ${applied.message}`).toBe(true);

    const restored = await restoreTweak(id);
    expect(restored.success, `${id}: ${restored.message}`).toBe(true);
  });

  it('every apply target has a matching revert target', () => {
    for (const id of SOUND_IDS) {
      const tweak = TWEAKS.find((t) => t.id === id)!;
      const target = (op: { kind: string; path?: string; name?: string }) =>
        `${op.kind}:${op.path ?? ''}:${op.name ?? ''}`;
      const applyTargets = tweak.apply
        .filter((op) => op.kind === 'registry')
        .map((op) => target(op as { kind: string; path?: string; name?: string }))
        .sort();
      const revertTargets = tweak.revert
        .filter((op) => op.kind === 'registry')
        .map((op) => target(op as { kind: string; path?: string; name?: string }))
        .sort();
      expect(revertTargets, `${id} revert must mirror apply`).toEqual(applyTargets);
    }
  });
});
