import { describe, it, expect } from 'vitest';
import {
  PROFILE_KIND,
  PROFILE_VERSION,
  buildConfigProfile,
  parseConfigProfileText,
  previewProfileImport,
  serializeConfigProfile,
  summarizeApplyResult,
  validateConfigProfileObject,
  type ConfigProfile,
} from './config-profile';
import { DEFAULT_SETTINGS } from './settings';

function sampleProfile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    kind: PROFILE_KIND,
    version: PROFILE_VERSION,
    exportedAt: new Date('2026-10-01T00:00:00.000Z').toISOString(),
    appVersion: '0.17.0',
    settings: { ...DEFAULT_SETTINGS, enableNotifications: false },
    appliedTweaks: ['show-file-extensions', 'hide-recent-files'],
    ...overrides,
  };
}

describe('shared/config-profile', () => {
  describe('round-trip', () => {
    it('export -> serialize -> parse returns an identical profile', () => {
      const built = buildConfigProfile(
        { ...DEFAULT_SETTINGS, accentColor: '#FF8800' },
        ['hide-recent-files', 'show-file-extensions', 'show-file-extensions'],
        '0.17.0'
      );
      // Deterministic: tweak ids are de-duplicated and sorted.
      expect(built.appliedTweaks).toEqual(['hide-recent-files', 'show-file-extensions']);

      const text = serializeConfigProfile(built);
      const parsed = parseConfigProfileText(text);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.profile).toEqual(built);
      }
    });
  });

  describe('strict validation', () => {
    it('rejects corrupt JSON without throwing', () => {
      const result = parseConfigProfileText('{not json');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toMatch(/not valid JSON/i);
    });

    it('rejects an unknown profile version without touching anything', () => {
      const result = parseConfigProfileText(
        serializeConfigProfile(sampleProfile({ version: 999 as never }))
      );
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toMatch(/unsupported profile version 999/i);
    });

    it('rejects a wrong profile kind', () => {
      const result = validateConfigProfileObject(
        sampleProfile({ kind: 'something-else' as never })
      );
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toMatch(/unrecognized profile kind/i);
    });

    it('rejects invalid settings fields with a clear reason', () => {
      const badAccent = validateConfigProfileObject(
        sampleProfile({ settings: { ...DEFAULT_SETTINGS, accentColor: 'red' } })
      );
      expect(badAccent.success).toBe(false);
      if (!badAccent.success) expect(badAccent.error).toMatch(/accentColor/i);

      const badBool = validateConfigProfileObject(
        sampleProfile({
          settings: { ...DEFAULT_SETTINGS, enableNotifications: 'yes' as never },
        })
      );
      expect(badBool.success).toBe(false);
      if (!badBool.success) expect(badBool.error).toMatch(/enableNotifications/i);

      const badPaths = validateConfigProfileObject(
        sampleProfile({
          settings: { ...DEFAULT_SETTINGS, excludePaths: ['ok', 42 as never] },
        })
      );
      expect(badPaths.success).toBe(false);
      if (!badPaths.success) expect(badPaths.error).toMatch(/excludePaths/i);
    });

    it('rejects missing settings fields', () => {
      const partial = { ...DEFAULT_SETTINGS };
      delete (partial as Partial<typeof partial>).scanRecycleBin;
      const result = validateConfigProfileObject(sampleProfile({ settings: partial as never }));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toMatch(/scanRecycleBin/i);
    });

    it('rejects malformed appliedTweaks entries', () => {
      const result = validateConfigProfileObject(
        sampleProfile({ appliedTweaks: ['ok-id', '', 42 as never] })
      );
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toMatch(/appliedTweaks/i);
    });

    it('rejects unknown top-level fields', () => {
      const result = validateConfigProfileObject({
        ...sampleProfile(),
        extraField: true,
      } as never);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toMatch(/unknown field/i);
    });
  });

  describe('preview', () => {
    it('diffs settings and classifies tweaks against current state', () => {
      const profile = sampleProfile({
        settings: { ...DEFAULT_SETTINGS, enableNotifications: false, accentColor: '#FF8800' },
        appliedTweaks: ['show-file-extensions', 'brand-new-tweak'],
      });
      const preview = previewProfileImport(
        profile,
        {
          settings: { ...DEFAULT_SETTINGS },
          appliedIds: ['show-file-extensions', 'local-only-tweak'],
        },
        { knownTweakIds: ['show-file-extensions', 'brand-new-tweak'] }
      );

      expect(preview.settingsChanges.map((c) => c.key).sort()).toEqual([
        'accentColor',
        'enableNotifications',
      ]);
      expect(preview.tweaksToApply).toEqual(['brand-new-tweak']);
      expect(preview.tweaksAlreadyApplied).toEqual(['show-file-extensions']);
      expect(preview.tweaksUnknown).toEqual([]);
      // Currently applied but absent from the profile: kept, never auto-reverted.
      expect(preview.extrasKept).toEqual(['local-only-tweak']);
      expect(preview.counts).toMatchObject({
        settingsChanges: 2,
        toApply: 1,
        alreadyApplied: 1,
        unknown: 0,
      });
    });

    it('flags profile ids outside the known catalog as unknown (omitted, not applied)', () => {
      const profile = sampleProfile({ appliedTweaks: ['ghost-tweak'] });
      const preview = previewProfileImport(
        profile,
        { settings: { ...DEFAULT_SETTINGS }, appliedIds: [] },
        { knownTweakIds: ['show-file-extensions'] }
      );
      expect(preview.tweaksToApply).toEqual([]);
      expect(preview.tweaksUnknown).toEqual(['ghost-tweak']);
    });
  });

  describe('summary', () => {
    it('reports honest counts (applied / failed / skipped)', () => {
      expect(
        summarizeApplyResult({
          applied: ['a'],
          failed: [{ id: 'b', message: 'boom' }],
          skipped: [{ id: 'c', reason: 'already applied' }],
        })
      ).toMatch(/1 applied.*1 failed.*1 skipped/i);
    });
  });
});
