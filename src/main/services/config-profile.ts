/**
 * Configuration profile orchestration (A3, main process).
 *
 * Export snapshots the current settings (single source of truth) plus the
 * applied tweak ids. Import is a strict two-step flow: preview (validate +
 * diff, NEVER mutates) and apply (settings through the existing settings
 * motor, tweaks one-by-one through the existing tweak engine with its
 * preview/revert — never a blind direct write).
 *
 * Every function accepts injectable `ProfileEngineDeps` so unit tests run
 * fully mocked: no real tweaks, no real services, no real registry writes.
 */

import { app } from 'electron';
import { getLoginItemState, getPersistedSettingsSnapshot, updateSettings } from './settings';
import { applyTweak, getTweaks, previewTweak } from './tweaks';
import {
  buildConfigProfile,
  parseConfigProfileText,
  previewProfileImport,
  summarizeApplyResult,
  validateConfigProfileObject,
  type ConfigProfile,
  type ProfileApplyOutcome,
  type ProfilePreviewOutcome,
} from '@shared/config-profile';
import type { AppSettings } from '@shared/settings';

export interface ProfileEngineDeps {
  getCurrentSettings: () => AppSettings;
  listAppliedIds: () => Promise<string[]>;
  listKnownTweakIds: () => Promise<string[]>;
  previewOne: (id: string) => Promise<unknown>;
  applyOne: (id: string) => Promise<{ id: string; success: boolean; message: string }>;
  updateAllSettings: (
    settings: AppSettings
  ) => { ok: boolean; message: string } | Promise<{ ok: boolean; message: string }>;
  appVersion: () => string;
}

function readAppVersion(): string {
  try {
    const version = app?.getVersion?.();
    if (typeof version === 'string' && version.length > 0) return version;
  } catch {
    /* non-Electron context (unit tests): fall through */
  }
  return 'unknown';
}

async function leafAppliedIds(): Promise<string[]> {
  const views = await getTweaks();
  return views.filter((tweak) => tweak.applied && tweak.kind !== 'preset').map((tweak) => tweak.id);
}

export function defaultProfileEngineDeps(): ProfileEngineDeps {
  return {
    // Effective state: persisted snapshot plus the real OS login-item value,
    // so the exported profile never lies about "Start with Windows".
    getCurrentSettings: () => ({
      ...getPersistedSettingsSnapshot(),
      startWithWindows: getLoginItemState(),
    }),
    listAppliedIds: () => leafAppliedIds(),
    listKnownTweakIds: async () => (await getTweaks()).map((tweak) => tweak.id),
    previewOne: (id: string) => previewTweak(id),
    applyOne: (id: string) => applyTweak(id),
    updateAllSettings: (settings: AppSettings) => updateSettings(settings),
    appVersion: () => readAppVersion(),
  };
}

function rejected(error: string): ProfileApplyOutcome {
  return {
    success: false,
    error,
    applied: [],
    failed: [],
    skipped: [],
    settingsUpdated: false,
    settingsMessage: '',
    message: error,
  };
}

/** Snapshot the full configuration as an exportable profile. Read-only. */
export async function exportConfigProfile(
  deps: ProfileEngineDeps = defaultProfileEngineDeps()
): Promise<ConfigProfile> {
  return buildConfigProfile(
    deps.getCurrentSettings(),
    await deps.listAppliedIds(),
    deps.appVersion()
  );
}

/**
 * Validate profile file text and diff it against the current state.
 * NEVER mutates: no settings writes, no tweak applications.
 */
export async function previewConfigProfileImportText(
  jsonText: string,
  deps: ProfileEngineDeps = defaultProfileEngineDeps()
): Promise<ProfilePreviewOutcome> {
  const parsed = parseConfigProfileText(jsonText);
  if (!parsed.success) return { success: false, error: parsed.error };
  const preview = previewProfileImport(
    parsed.profile,
    {
      settings: deps.getCurrentSettings(),
      appliedIds: await deps.listAppliedIds(),
    },
    { knownTweakIds: await deps.listKnownTweakIds() }
  );
  return { success: true, profile: parsed.profile, preview };
}

/**
 * Apply a (previously previewed) profile: settings through the existing
 * settings motor, then each missing tweak through the existing tweak engine
 * (preview first, then apply). Unknown or already-applied ids are reported
 * as skipped — never applied blindly. Partial failures are reported honestly.
 */
export async function applyConfigProfileObject(
  rawProfile: unknown,
  deps: ProfileEngineDeps = defaultProfileEngineDeps()
): Promise<ProfileApplyOutcome> {
  const validated = validateConfigProfileObject(rawProfile);
  if (!validated.success) return rejected(validated.error);
  const profile = validated.profile;

  let settingsUpdated = false;
  let settingsMessage = '';
  try {
    const result = await deps.updateAllSettings(profile.settings);
    settingsUpdated = result.ok;
    settingsMessage = result.message;
  } catch (error) {
    settingsMessage = `Settings could not be applied: ${String(error)}`;
  }

  const known = new Set(await deps.listKnownTweakIds());
  const appliedNow = new Set(await deps.listAppliedIds());

  const applied: string[] = [];
  const failed: { id: string; message: string }[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const id of profile.appliedTweaks) {
    if (!known.has(id)) {
      skipped.push({ id, reason: 'Unknown tweak id.' });
      continue;
    }
    if (appliedNow.has(id)) {
      skipped.push({ id, reason: 'Already applied.' });
      continue;
    }
    try {
      await deps.previewOne(id);
    } catch (error) {
      failed.push({ id, message: `Preview failed: ${String(error)}` });
      continue;
    }
    try {
      const result = await deps.applyOne(id);
      if (result.success) {
        applied.push(id);
        appliedNow.add(id);
      } else {
        failed.push({ id, message: result.message });
      }
    } catch (error) {
      failed.push({ id, message: String(error) });
    }
  }

  const summary = summarizeApplyResult({ applied, failed, skipped });
  return {
    success: true,
    applied,
    failed,
    skipped,
    settingsUpdated,
    settingsMessage,
    message: settingsUpdated ? summary : `${summary} ${settingsMessage}`.trim(),
  };
}
