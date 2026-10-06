import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadTweakCatalog } from './tweak-catalog';
import { readBundledCatalog } from './catalog-data';

vi.mock('./catalog-data', () => ({ readBundledCatalog: vi.fn() }));

const readMock = vi.mocked(readBundledCatalog);

function atomicTweak(id: string): Record<string, unknown> {
  return {
    id,
    name: `Atomic ${id}`,
    description: `Atomic child tweak ${id} for preset tests.`,
    category: 'privacy',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    apply: [
      {
        kind: 'registry',
        hive: 'HKCU',
        path: 'Software\\Forchi\\PresetTest',
        name: id,
        type: 'DWORD',
        value: 0,
      },
    ],
    revert: [
      {
        kind: 'registry',
        hive: 'HKCU',
        path: 'Software\\Forchi\\PresetTest',
        name: id,
        type: 'DWORD',
        value: 1,
      },
    ],
  };
}

function preset(
  id: string,
  children: unknown,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    name: `Preset ${id}`,
    description: `Master preset ${id} applied as the union of its children.`,
    category: 'privacy',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    kind: 'preset',
    children,
    apply: [{ kind: 'info', detail: 'Master switch: expands to its children.' }],
    revert: [{ kind: 'info', detail: 'Master switch: restores its children.' }],
    ...extra,
  };
}

describe('preset schema validation (A1)', () => {
  beforeEach(() => {
    readMock.mockReset();
  });

  it('keeps a valid preset whose children are known atomic tweaks', () => {
    readMock.mockReturnValue({
      tweaks: [
        atomicTweak('ads-child-a'),
        atomicTweak('ads-child-b'),
        preset('ads-preset', ['ads-child-a', 'ads-child-b']),
      ],
    });
    const loaded = loadTweakCatalog();
    expect(loaded.map((t) => t.id).sort()).toEqual(['ads-child-a', 'ads-child-b', 'ads-preset']);
    const kept = loaded.find((t) => t.id === 'ads-preset');
    expect(kept?.kind).toBe('preset');
    expect(kept?.children).toEqual(['ads-child-a', 'ads-child-b']);
  });

  it('drops a preset with empty children', () => {
    readMock.mockReturnValue({ tweaks: [atomicTweak('ads-child-a'), preset('ads-preset', [])] });
    const loaded = loadTweakCatalog();
    expect(loaded.find((t) => t.id === 'ads-preset')).toBeUndefined();
    expect(loaded.find((t) => t.id === 'ads-child-a')).toBeDefined();
  });

  it('drops a preset with non-string children', () => {
    readMock.mockReturnValue({
      tweaks: [atomicTweak('ads-child-a'), preset('ads-preset', ['ads-child-a', 42])],
    });
    expect(loadTweakCatalog().find((t) => t.id === 'ads-preset')).toBeUndefined();
  });

  it('drops a non-preset tweak that declares children', () => {
    readMock.mockReturnValue({
      tweaks: [
        { ...atomicTweak('plain-tweak'), children: ['ads-child-a'] },
        atomicTweak('ads-child-a'),
      ],
    });
    const loaded = loadTweakCatalog();
    expect(loaded.find((t) => t.id === 'plain-tweak')).toBeUndefined();
  });

  it('drops a preset with an unknown child id', () => {
    readMock.mockReturnValue({
      tweaks: [atomicTweak('ads-child-a'), preset('ads-preset', ['ads-child-a', 'ghost-child'])],
    });
    expect(loadTweakCatalog().find((t) => t.id === 'ads-preset')).toBeUndefined();
  });

  it('drops a preset whose child is another preset (no nesting)', () => {
    readMock.mockReturnValue({
      tweaks: [
        atomicTweak('ads-child-a'),
        preset('inner-preset', ['ads-child-a']),
        preset('outer-preset', ['inner-preset']),
      ],
    });
    const loaded = loadTweakCatalog();
    expect(loaded.find((t) => t.id === 'inner-preset')).toBeDefined();
    expect(loaded.find((t) => t.id === 'outer-preset')).toBeUndefined();
  });

  it('drops a self-referencing preset', () => {
    readMock.mockReturnValue({
      tweaks: [atomicTweak('ads-child-a'), preset('loop-preset', ['ads-child-a', 'loop-preset'])],
    });
    expect(loadTweakCatalog().find((t) => t.id === 'loop-preset')).toBeUndefined();
  });

  it('drops a preset with an invalid kind discriminator', () => {
    readMock.mockReturnValue({
      tweaks: [
        atomicTweak('ads-child-a'),
        preset('ads-preset', ['ads-child-a'], { kind: 'bundle' }),
      ],
    });
    expect(loadTweakCatalog().find((t) => t.id === 'ads-preset')).toBeUndefined();
  });
});
