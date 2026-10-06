/**
 * Configuration profile contract (A3): export/import the full WinOptimizer
 * configuration (settings + applied tweaks) as a downloadable JSON file.
 *
 * Rules:
 * - Validation is STRICT: corrupt JSON, an unknown version, or any invalid
 *   field rejects the whole profile with a clear reason and NOTHING is
 *   mutated (callers must validate before applying).
 * - Import NEVER writes blindly: `previewProfileImport` diffs the profile
 *   against the current state first, and application happens tweak-by-tweak
 *   through the existing tweak engine (preview/revert) in main.
 */

import { isValidAccentColor, type AppSettings } from './settings';

/** Discriminator for profile files (never changes silently). */
export const PROFILE_KIND = 'forchi-winoptimizer-profile';

/** The only profile version this app build reads and writes. */
export const PROFILE_VERSION = 1;

const MAX_APPLIED_TWEAKS = 500;
const MAX_EXCLUDE_PATHS = 100;

const TOP_LEVEL_FIELDS = new Set([
  'kind',
  'version',
  'exportedAt',
  'appVersion',
  'settings',
  'appliedTweaks',
]);

const SETTING_KEYS: (keyof AppSettings)[] = [
  'accentColor',
  'startWithWindows',
  'minimizeToTrayOnClose',
  'enableNotifications',
  'automaticUpdates',
  'scanBrowserCache',
  'scanWindowsTempFiles',
  'scanRecycleBin',
  'excludePaths',
];

export interface ConfigProfile {
  kind: typeof PROFILE_KIND;
  version: typeof PROFILE_VERSION;
  /** ISO timestamp of the export. */
  exportedAt: string;
  /** App version that produced the export (informational). */
  appVersion?: string;
  settings: AppSettings;
  /** Desired applied tweak ids (leaf tweaks; presets expand through the engine). */
  appliedTweaks: string[];
}

export type ConfigProfileValidation =
  { success: true; profile: ConfigProfile } | { success: false; error: string };

export interface SettingsChange {
  key: keyof AppSettings;
  from: unknown;
  to: unknown;
}

export interface ProfilePreview {
  settingsChanges: SettingsChange[];
  /** Profile ids missing locally (and known): candidates to apply. */
  tweaksToApply: string[];
  /** Profile ids already applied locally: omitted, no change. */
  tweaksAlreadyApplied: string[];
  /** Profile ids outside the known catalog: omitted, never applied blindly. */
  tweaksUnknown: string[];
  /** Locally applied ids absent from the profile: kept as-is, never auto-reverted. */
  extrasKept: string[];
  counts: {
    settingsChanges: number;
    toApply: number;
    alreadyApplied: number;
    unknown: number;
  };
}

export interface ProfileApplyOutcome {
  success: boolean;
  /** Set only when the profile itself was rejected (nothing was touched). */
  error?: string;
  applied: string[];
  failed: { id: string; message: string }[];
  skipped: { id: string; reason: string }[];
  settingsUpdated: boolean;
  settingsMessage: string;
  message: string;
}

export interface ProfilePreviewOutcome {
  success: boolean;
  profile?: ConfigProfile;
  preview?: ProfilePreview;
  error?: string;
}

/** Build a deterministic profile snapshot (tweak ids de-duplicated + sorted). */
export function buildConfigProfile(
  settings: AppSettings,
  appliedTweakIds: string[],
  appVersion?: string
): ConfigProfile {
  const appliedTweaks = [...new Set(appliedTweakIds)].sort();
  return {
    kind: PROFILE_KIND,
    version: PROFILE_VERSION,
    exportedAt: new Date().toISOString(),
    ...(appVersion !== undefined ? { appVersion } : {}),
    settings: { ...settings, excludePaths: [...settings.excludePaths] },
    appliedTweaks,
  };
}

export function serializeConfigProfile(profile: ConfigProfile): string {
  return JSON.stringify(profile, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateSettingsStrict(
  raw: unknown
): { ok: true; settings: AppSettings } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: 'Invalid profile: "settings" must be an object.' };

  for (const key of Object.keys(raw)) {
    if (!(SETTING_KEYS as string[]).includes(key)) {
      return { ok: false, error: `Invalid profile: unknown settings field "${key}".` };
    }
  }
  for (const key of SETTING_KEYS) {
    if (!(key in raw)) {
      return { ok: false, error: `Invalid profile: missing settings field "${key}".` };
    }
  }

  if (!isValidAccentColor(raw['accentColor'])) {
    return { ok: false, error: 'Invalid profile: "accentColor" must be a #RRGGBB colour.' };
  }

  const booleans: (keyof AppSettings)[] = [
    'startWithWindows',
    'minimizeToTrayOnClose',
    'enableNotifications',
    'automaticUpdates',
    'scanBrowserCache',
    'scanWindowsTempFiles',
    'scanRecycleBin',
  ];
  for (const key of booleans) {
    if (typeof raw[key] !== 'boolean') {
      return { ok: false, error: `Invalid profile: "${key}" must be a boolean.` };
    }
  }

  const paths = raw['excludePaths'];
  if (!Array.isArray(paths)) {
    return { ok: false, error: 'Invalid profile: "excludePaths" must be an array of strings.' };
  }
  if (paths.length > MAX_EXCLUDE_PATHS) {
    return {
      ok: false,
      error: `Invalid profile: "excludePaths" holds too many entries (max ${MAX_EXCLUDE_PATHS}).`,
    };
  }
  const cleaned: string[] = [];
  for (const entry of paths) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return {
        ok: false,
        error: 'Invalid profile: every "excludePaths" entry must be a non-empty string.',
      };
    }
    cleaned.push(entry.trim());
  }

  return {
    ok: true,
    settings: {
      accentColor: raw['accentColor'] as string,
      startWithWindows: raw['startWithWindows'] as boolean,
      minimizeToTrayOnClose: raw['minimizeToTrayOnClose'] as boolean,
      enableNotifications: raw['enableNotifications'] as boolean,
      automaticUpdates: raw['automaticUpdates'] as boolean,
      scanBrowserCache: raw['scanBrowserCache'] as boolean,
      scanWindowsTempFiles: raw['scanWindowsTempFiles'] as boolean,
      scanRecycleBin: raw['scanRecycleBin'] as boolean,
      excludePaths: cleaned,
    },
  };
}

/** Strict validator: anything unexpected rejects the whole profile. No mutation. */
export function validateConfigProfileObject(raw: unknown): ConfigProfileValidation {
  if (!isRecord(raw)) {
    return { success: false, error: 'Invalid profile: the file must contain a JSON object.' };
  }

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      return { success: false, error: `Invalid profile: unknown field "${key}".` };
    }
  }

  if (raw['kind'] !== PROFILE_KIND) {
    return {
      success: false,
      error: `Invalid profile: unrecognized profile kind ${JSON.stringify(raw['kind'])}.`,
    };
  }

  if (raw['version'] !== PROFILE_VERSION) {
    return {
      success: false,
      error: `Unsupported profile version ${JSON.stringify(raw['version'])} (this app reads version ${PROFILE_VERSION}).`,
    };
  }

  const exportedAt = raw['exportedAt'];
  if (typeof exportedAt !== 'string' || Number.isNaN(Date.parse(exportedAt))) {
    return { success: false, error: 'Invalid profile: "exportedAt" must be a valid date string.' };
  }

  if (raw['appVersion'] !== undefined && typeof raw['appVersion'] !== 'string') {
    return { success: false, error: 'Invalid profile: "appVersion" must be a string.' };
  }

  const settings = validateSettingsStrict(raw['settings']);
  if (!settings.ok) return { success: false, error: settings.error };

  const tweaks = raw['appliedTweaks'];
  if (!Array.isArray(tweaks)) {
    return { success: false, error: 'Invalid profile: "appliedTweaks" must be an array of ids.' };
  }
  if (tweaks.length > MAX_APPLIED_TWEAKS) {
    return {
      success: false,
      error: `Invalid profile: too many tweaks (max ${MAX_APPLIED_TWEAKS}).`,
    };
  }
  const appliedTweaks: string[] = [];
  for (const entry of tweaks) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return {
        success: false,
        error: 'Invalid profile: every "appliedTweaks" entry must be a non-empty tweak id.',
      };
    }
    appliedTweaks.push(entry.trim());
  }

  return {
    success: true,
    profile: {
      kind: PROFILE_KIND,
      version: PROFILE_VERSION,
      exportedAt,
      ...(typeof raw['appVersion'] === 'string' ? { appVersion: raw['appVersion'] } : {}),
      settings: settings.settings,
      appliedTweaks: [...new Set(appliedTweaks)].sort(),
    },
  };
}

/** Parse + strictly validate profile file text. Never throws, never mutates. */
export function parseConfigProfileText(text: string): ConfigProfileValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { success: false, error: 'Invalid profile: the file is not valid JSON.' };
  }
  return validateConfigProfileObject(parsed);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Diff a validated profile against the current state. Pure: no side effects,
 * so the UI can always show this BEFORE asking for confirmation.
 */
export function previewProfileImport(
  profile: ConfigProfile,
  current: { settings: AppSettings; appliedIds: string[] },
  options: { knownTweakIds?: string[] } = {}
): ProfilePreview {
  const settingsChanges: SettingsChange[] = [];
  for (const key of SETTING_KEYS) {
    if (!sameValue(current.settings[key], profile.settings[key])) {
      settingsChanges.push({ key, from: current.settings[key], to: profile.settings[key] });
    }
  }

  const applied = new Set(current.appliedIds);
  const known = options.knownTweakIds ? new Set(options.knownTweakIds) : null;
  const tweaksToApply: string[] = [];
  const tweaksAlreadyApplied: string[] = [];
  const tweaksUnknown: string[] = [];
  for (const id of profile.appliedTweaks) {
    if (known && !known.has(id)) {
      tweaksUnknown.push(id);
    } else if (applied.has(id)) {
      tweaksAlreadyApplied.push(id);
    } else {
      tweaksToApply.push(id);
    }
  }

  const wanted = new Set(profile.appliedTweaks);
  const extrasKept = current.appliedIds.filter((id) => !wanted.has(id));

  return {
    settingsChanges,
    tweaksToApply,
    tweaksAlreadyApplied,
    tweaksUnknown,
    extrasKept,
    counts: {
      settingsChanges: settingsChanges.length,
      toApply: tweaksToApply.length,
      alreadyApplied: tweaksAlreadyApplied.length,
      unknown: tweaksUnknown.length,
    },
  };
}

/** Honest one-line summary of a profile application (applied / failed / skipped). */
export function summarizeApplyResult(result: {
  applied: unknown[];
  failed: unknown[];
  skipped: unknown[];
}): string {
  const done = result.applied.length;
  const failed = result.failed.length;
  const skipped = result.skipped.length;
  const parts = [`${done} applied`, `${failed} failed`, `${skipped} skipped`];
  return `Profile import: ${parts.join(', ')}.`;
}
