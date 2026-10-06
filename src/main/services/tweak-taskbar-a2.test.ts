import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadTweakCatalog } from './tweak-catalog';
import {
  applyTweak,
  restoreTweak,
  previewTweak,
  setTweakRunner,
  resetTweakRunner,
  setTweakStatePath,
  setWindowsBuild,
  type TweakRunner,
} from './tweaks';
import type { TweakDefinition } from '@shared/tweaks';

/**
 * Lote 2 (A2): missing Taskbar/Explorer settings.
 *
 * Every setting must be HKCU-only, reversible, carry an Explorer-restart note
 * where the shell needs a refresh (never forced), and round-trip
 * apply -> restore through the real engine with a mocked runner.
 */

const A2_IDS = [
  'taskbar-badges-off',
  'taskbar-never-combine',
  'taskbar-end-task-on',
  'desktop-icons-show',
  'shortcut-arrow-blank',
  'dynamic-lighting-off',
] as const;

/** These need an Explorer refresh; the note must say so (warned, never forced). */
const NEEDS_EXPLORER_REFRESH = [
  'taskbar-badges-off',
  'taskbar-never-combine',
  'desktop-icons-show',
  'shortcut-arrow-blank',
] as const;

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

function byId(tweaks: TweakDefinition[], id: string): TweakDefinition {
  const found = tweaks.find((t) => t.id === id);
  expect(found, `catalog must contain tweak ${id}`).toBeDefined();
  return found as TweakDefinition;
}

describe('A2 taskbar/explorer catalog entries', () => {
  it('ships every missing setting', () => {
    const tweaks = loadTweakCatalog();
    for (const id of A2_IDS) {
      expect(
        tweaks.some((t) => t.id === id),
        `missing tweak ${id}`
      ).toBe(true);
    }
  });

  it('keeps every A2 tweak HKCU-only, reversible, safe and non-admin', () => {
    const tweaks = loadTweakCatalog();
    for (const id of A2_IDS) {
      const tweak = byId(tweaks, id);
      expect(tweak.reversible).toBe(true);
      expect(tweak.safety).toBe('safe');
      expect(tweak.requiresAdmin).toBe(false);
      expect(tweak.apply.length).toBeGreaterThan(0);
      expect(tweak.revert.length).toBeGreaterThan(0);
      for (const op of [...tweak.apply, ...tweak.revert]) {
        expect(op.kind).toBe('registry');
        if (op.kind === 'registry') {
          expect(op.hive).toBe('HKCU');
        }
      }
    }
  });

  it('gates Win11-only settings behind requiresBuild', () => {
    const tweaks = loadTweakCatalog();
    expect(byId(tweaks, 'taskbar-end-task-on').requiresBuild).toBe(22631);
    expect(byId(tweaks, 'dynamic-lighting-off').requiresBuild).toBe(22631);
  });

  it('warns about the Explorer refresh where the shell needs one', () => {
    const tweaks = loadTweakCatalog();
    for (const id of NEEDS_EXPLORER_REFRESH) {
      const tweak = byId(tweaks, id);
      expect(tweak.note ?? '', `${id} must warn about the Explorer refresh`).toMatch(/explorer/i);
    }
  });
});

describe('A2 apply/restore round-trip (mocked runner)', () => {
  beforeEach(() => {
    stateFile = path.join(os.tmpdir(), `forchi-a2-${Date.now()}-${Math.random()}.json`);
    setTweakStatePath(stateFile);
    setWindowsBuild(22631);
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

  for (const id of A2_IDS) {
    it(`${id}: preview exposes ops and apply->restore succeeds`, async () => {
      const preview = await previewTweak(id);
      expect(preview.applyOperations.length).toBeGreaterThan(0);
      expect(preview.revertOperations.length).toBeGreaterThan(0);

      const applied = await applyTweak(id);
      expect(applied.success).toBe(true);

      const restored = await restoreTweak(id);
      expect(restored.success).toBe(true);
      expect(restored.message).toMatch(/previous state|restored/i);
    });
  }
});
