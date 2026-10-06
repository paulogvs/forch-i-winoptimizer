import { describe, it, expect, vi } from 'vitest';
import {
  applyConfigProfileObject,
  exportConfigProfile,
  previewConfigProfileImportText,
  type ProfileEngineDeps,
} from './config-profile';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { serializeConfigProfile, type ConfigProfile } from '@shared/config-profile';

function deps(overrides: Partial<ProfileEngineDeps> = {}): ProfileEngineDeps {
  return {
    getCurrentSettings: () => ({ ...DEFAULT_SETTINGS }),
    listAppliedIds: () => Promise.resolve([]),
    listKnownTweakIds: () => Promise.resolve(['tweak-a', 'tweak-b', 'tweak-fails']),
    previewOne: vi.fn((_id: string) => Promise.resolve({})),
    applyOne: vi.fn((id: string) => Promise.resolve({ id, success: true, message: 'Applied.' })),
    updateAllSettings: vi.fn(() => ({ ok: true, message: 'Settings saved.' })),
    appVersion: () => '0.17.0',
    ...overrides,
  };
}

function profileJson(settings = {}, tweaks: string[] = ['tweak-a']): string {
  return serializeConfigProfile({
    kind: 'forchi-winoptimizer-profile',
    version: 1,
    exportedAt: new Date('2026-10-01T00:00:00.000Z').toISOString(),
    appVersion: '0.17.0',
    settings: { ...DEFAULT_SETTINGS, ...settings },
    appliedTweaks: tweaks,
  } as ConfigProfile);
}

describe('main/services/config-profile', () => {
  describe('exportConfigProfile', () => {
    it('snapshots current settings plus applied tweak ids', async () => {
      const d = deps({ listAppliedIds: () => Promise.resolve(['tweak-b', 'tweak-a']) });
      const profile = await exportConfigProfile(d);
      expect(profile.kind).toBe('forchi-winoptimizer-profile');
      expect(profile.version).toBe(1);
      expect(profile.settings).toEqual(DEFAULT_SETTINGS);
      expect(profile.appliedTweaks).toEqual(['tweak-a', 'tweak-b']);
    });
  });

  describe('previewConfigProfileImportText', () => {
    it('rejects corrupt input without calling the engine', async () => {
      const d = deps();
      const outcome = await previewConfigProfileImportText('{nope', d);
      expect(outcome.success).toBe(false);
      expect(outcome.error).toMatch(/not valid JSON/i);
      expect(d.previewOne).not.toHaveBeenCalled();
      expect(d.applyOne).not.toHaveBeenCalled();
      expect(d.updateAllSettings).not.toHaveBeenCalled();
    });

    it('rejects unknown versions without calling the engine', async () => {
      const d = deps();
      const raw = JSON.parse(profileJson()) as Record<string, unknown>;
      raw['version'] = 42;
      const outcome = await previewConfigProfileImportText(JSON.stringify(raw), d);
      expect(outcome.success).toBe(false);
      expect(outcome.error).toMatch(/unsupported profile version 42/i);
      expect(d.applyOne).not.toHaveBeenCalled();
      expect(d.updateAllSettings).not.toHaveBeenCalled();
    });

    it('builds a correct preview without mutating anything', async () => {
      const d = deps({ listAppliedIds: () => Promise.resolve(['tweak-b']) });
      const outcome = await previewConfigProfileImportText(
        profileJson({ enableNotifications: false }, ['tweak-a', 'tweak-b']),
        d
      );
      expect(outcome.success).toBe(true);
      expect(outcome.preview?.settingsChanges.map((c) => c.key)).toEqual(['enableNotifications']);
      expect(outcome.preview?.tweaksToApply).toEqual(['tweak-a']);
      expect(outcome.preview?.tweaksAlreadyApplied).toEqual(['tweak-b']);
      // Preview never applies.
      expect(d.applyOne).not.toHaveBeenCalled();
      expect(d.updateAllSettings).not.toHaveBeenCalled();
    });
  });

  describe('applyConfigProfileObject', () => {
    it('rejects invalid profiles without touching the engine or settings', async () => {
      const d = deps();
      const outcome = await applyConfigProfileObject({ kind: 'nope' }, d);
      expect(outcome.success).toBe(false);
      expect(outcome.error).toMatch(/unrecognized profile kind/i);
      expect(outcome.applied).toEqual([]);
      expect(d.previewOne).not.toHaveBeenCalled();
      expect(d.applyOne).not.toHaveBeenCalled();
      expect(d.updateAllSettings).not.toHaveBeenCalled();
    });

    it('applies tweak-by-tweak through the engine and reports partial failures honestly', async () => {
      const d = deps({
        listAppliedIds: () => Promise.resolve([]),
        applyOne: vi.fn(async (id: string) =>
          id === 'tweak-fails'
            ? { id, success: false, message: 'Registry denied.' }
            : { id, success: true, message: 'Applied.' }
        ),
      });
      const profile = JSON.parse(
        profileJson({ accentColor: '#FF8800' }, ['tweak-a', 'tweak-fails', 'ghost-id'])
      );
      const outcome = await applyConfigProfileObject(profile, d);

      expect(outcome.success).toBe(true);
      expect(outcome.applied).toEqual(['tweak-a']);
      expect(outcome.failed).toEqual([{ id: 'tweak-fails', message: 'Registry denied.' }]);
      // Unknown ids are skipped with a reason, never applied blindly.
      expect(outcome.skipped).toEqual([{ id: 'ghost-id', reason: 'Unknown tweak id.' }]);
      expect(d.previewOne).toHaveBeenCalledTimes(2);
      expect(d.applyOne).toHaveBeenCalledTimes(2);
      expect(d.applyOne).not.toHaveBeenCalledWith('ghost-id');
      // Settings go through the existing settings motor, not a blind write.
      expect(d.updateAllSettings).toHaveBeenCalledTimes(1);
      expect(outcome.settingsUpdated).toBe(true);
      expect(outcome.message).toMatch(/1 applied.*1 failed.*1 skipped/i);
    });

    it('skips already-applied tweaks instead of re-applying them', async () => {
      const d = deps({ listAppliedIds: () => Promise.resolve(['tweak-a']) });
      const outcome = await applyConfigProfileObject(JSON.parse(profileJson({}, ['tweak-a'])), d);
      expect(outcome.success).toBe(true);
      expect(outcome.applied).toEqual([]);
      expect(outcome.skipped).toEqual([{ id: 'tweak-a', reason: 'Already applied.' }]);
      expect(d.applyOne).not.toHaveBeenCalled();
    });
  });
});
