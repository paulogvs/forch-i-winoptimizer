import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  TWEAKS,
  getTweaks,
  previewTweak,
  previewPreset,
  applyTweak,
  restoreTweak,
  applyPreset,
  setTweakRunner,
  resetTweakRunner,
  setTweakStatePath,
  setWindowsBuild,
} from './tweaks';
import type { TweakRunner } from './tweaks';

const PRESET_ID = 'ads-suggestions-preset';
const CHILDREN = [
  'ads-start-suggestions',
  'ads-lock-screen-spotlight',
  'ads-settings-tips',
  'ads-ai-pins',
  'ads-telemetry-hkcu',
];

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

describe('A1 master preset "Ads & Suggestions"', () => {
  beforeEach(() => {
    stateFile = path.join(os.tmpdir(), `forchi-preset-${Date.now()}-${Math.random()}.json`);
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

  it('ships the preset with atomic HKCU-only children', () => {
    const presetDef = TWEAKS.find((t) => t.id === PRESET_ID);
    expect(presetDef, 'missing preset ads-suggestions-preset').toBeDefined();
    expect(presetDef?.kind).toBe('preset');
    expect(presetDef?.children?.slice().sort()).toEqual(CHILDREN.slice().sort());
    for (const id of CHILDREN) {
      const child = TWEAKS.find((t) => t.id === id);
      expect(child, `missing child: ${id}`).toBeDefined();
      expect(child?.kind ?? 'tweak').not.toBe('preset');
      expect(child?.requiresAdmin).toBe(false);
      expect(child!.apply.length).toBeGreaterThan(0);
      expect(child!.revert.length).toBeGreaterThan(0);
      for (const op of [...child!.apply, ...child!.revert]) {
        expect(op.kind).toBe('registry');
        if (op.kind === 'registry') expect(op.hive).toBe('HKCU');
      }
    }
  });

  it('Deny applies every child', async () => {
    const results = await applyPreset(PRESET_ID, 'deny');
    expect(results).toHaveLength(CHILDREN.length);
    expect(results.every((r) => r.success)).toBe(true);
    const list = await getTweaks();
    for (const id of CHILDREN) {
      expect(list.find((t) => t.id === id)?.applied).toBe(true);
    }
    expect(list.find((t) => t.id === PRESET_ID)?.applied).toBe(true);
  });

  it('Allow reverts every child', async () => {
    await applyPreset(PRESET_ID, 'deny');
    const results = await applyPreset(PRESET_ID, 'allow');
    expect(results).toHaveLength(CHILDREN.length);
    expect(results.every((r) => r.success)).toBe(true);
    const list = await getTweaks();
    for (const id of [...CHILDREN, PRESET_ID]) {
      expect(list.find((t) => t.id === id)?.applied).toBe(false);
    }
  });

  it('Custom applies the selection and restores the rest', async () => {
    await applyPreset(PRESET_ID, 'deny');
    const first = CHILDREN[0] as string;
    const second = CHILDREN[1] as string;
    const results = await applyPreset(PRESET_ID, 'custom', [first, second]);
    expect(results.every((r) => r.success)).toBe(true);
    const list = await getTweaks();
    expect(list.find((t) => t.id === first)?.applied).toBe(true);
    expect(list.find((t) => t.id === second)?.applied).toBe(true);
    for (const id of CHILDREN.slice(2)) {
      expect(list.find((t) => t.id === id)?.applied).toBe(false);
    }
    // Partial selection: the preset itself is not fully applied.
    expect(list.find((t) => t.id === PRESET_ID)?.applied).toBe(false);
  });

  it('Custom rejects ids outside the preset children', async () => {
    const results = await applyPreset(PRESET_ID, 'custom', ['ghost-id']);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.success)).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it('Custom with an empty selection restores every child', async () => {
    await applyPreset(PRESET_ID, 'deny');
    const results = await applyPreset(PRESET_ID, 'custom', []);
    expect(results.every((r) => r.success)).toBe(true);
    const list = await getTweaks();
    for (const id of CHILDREN) {
      expect(list.find((t) => t.id === id)?.applied).toBe(false);
    }
  });

  it('preview shows the union of children operations', async () => {
    const preview = await previewTweak(PRESET_ID);
    const children = CHILDREN.map((id) => TWEAKS.find((t) => t.id === id)!);
    const expectedApply = children.reduce((n, c) => n + c.apply.length, 0);
    const expectedRevert = children.reduce((n, c) => n + c.revert.length, 0);
    expect(preview.applyOperations).toHaveLength(expectedApply);
    expect(preview.revertOperations).toHaveLength(expectedRevert);
  });

  it('previewPreset filters the union by mode and selection', async () => {
    const deny = await previewPreset(PRESET_ID, 'deny');
    const full = await previewTweak(PRESET_ID);
    expect(deny.applyOperations).toHaveLength(full.applyOperations.length);

    const firstId = CHILDREN[0] as string;
    const custom = await previewPreset(PRESET_ID, 'custom', [firstId]);
    const first = TWEAKS.find((t) => t.id === firstId)!;
    expect(custom.applyOperations).toHaveLength(first.apply.length);
    expect(custom.revertOperations).toHaveLength(first.revert.length);
  });

  it('applyTweak on the preset behaves as Deny, restoreTweak as Allow', async () => {
    const applied = await applyTweak(PRESET_ID);
    expect(applied.success).toBe(true);
    let list = await getTweaks();
    expect(CHILDREN.every((id) => list.find((t) => t.id === id)?.applied)).toBe(true);

    const restored = await restoreTweak(PRESET_ID);
    expect(restored.success).toBe(true);
    list = await getTweaks();
    expect(CHILDREN.every((id) => !list.find((t) => t.id === id)?.applied)).toBe(true);
  });

  it('rejects preset operations on unknown ids', async () => {
    await expect(applyPreset('ghost-preset', 'deny')).rejects.toThrow('Unknown tweak');
    await expect(previewPreset('ghost-preset', 'deny')).rejects.toThrow('Unknown tweak');
  });
});
