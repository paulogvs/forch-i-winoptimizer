/**
 * Application settings contract (shared by main + renderer).
 *
 * The main process owns persistence (single source of truth: `settings.json` in
 * `app.getPath('userData')`). The renderer only ever sees this shape and edits
 * it through `window.electronAPI.updateSettings`.
 */

export interface AppSettings {
  /** Accent colour token, `#RRGGBB`. */
  accentColor: string;
  /**
   * User intent for "Start with Windows". The *effective* value returned by
   * `getSettings()` is read back from the OS, so the toggle never lies.
   */
  startWithWindows: boolean;
  /** Hide the window to the tray instead of quitting on close. */
  minimizeToTrayOnClose: boolean;
  /** Master switch for native notifications. */
  enableNotifications: boolean;
  /** Allow the background electron-updater check. */
  automaticUpdates: boolean;
  /** Cleaner scan categories. */
  scanBrowserCache: boolean;
  scanWindowsTempFiles: boolean;
  scanRecycleBin: boolean;
  /** Paths skipped by the junk scanner (case-insensitive prefix match). */
  excludePaths: string[];
}

/** Runtime capabilities that the UI must surface honestly. */
export interface AppEnvironment {
  /** True for the electron-builder portable (self-extracting) build. */
  portable: boolean;
  /** Whether "Start with Windows" can be registered on this platform/build. */
  loginItemSupported: boolean;
  /** Platform identifier (`win32`, `darwin`, `linux`). */
  platform: string;
}

export interface SettingsPayload {
  settings: AppSettings;
  environment: AppEnvironment;
}

export interface UpdateSettingsResult extends SettingsPayload {
  /** False when a requested change could not be applied (e.g. login item). */
  ok: boolean;
  /** Human-readable outcome for the UI. */
  message: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  accentColor: '#06B6D4',
  startWithWindows: false,
  minimizeToTrayOnClose: false,
  enableNotifications: true,
  automaticUpdates: false,
  scanBrowserCache: true,
  scanWindowsTempFiles: true,
  scanRecycleBin: false,
  excludePaths: [],
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isValidAccentColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

/** Normalise an untrusted partial settings object into a complete, valid one. */
export function normalizeSettings(raw: unknown): AppSettings {
  const input =
    raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const bool = (key: keyof AppSettings, fallback: boolean): boolean =>
    typeof input[key] === 'boolean' ? (input[key] as boolean) : fallback;

  const rawPaths = input['excludePaths'];
  const excludePaths = Array.isArray(rawPaths)
    ? rawPaths
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .slice(0, 100)
    : DEFAULT_SETTINGS.excludePaths;

  const accent = input['accentColor'];

  return {
    accentColor: isValidAccentColor(accent) ? accent : DEFAULT_SETTINGS.accentColor,
    startWithWindows: bool('startWithWindows', DEFAULT_SETTINGS.startWithWindows),
    minimizeToTrayOnClose: bool('minimizeToTrayOnClose', DEFAULT_SETTINGS.minimizeToTrayOnClose),
    enableNotifications: bool('enableNotifications', DEFAULT_SETTINGS.enableNotifications),
    automaticUpdates: bool('automaticUpdates', DEFAULT_SETTINGS.automaticUpdates),
    scanBrowserCache: bool('scanBrowserCache', DEFAULT_SETTINGS.scanBrowserCache),
    scanWindowsTempFiles: bool('scanWindowsTempFiles', DEFAULT_SETTINGS.scanWindowsTempFiles),
    scanRecycleBin: bool('scanRecycleBin', DEFAULT_SETTINGS.scanRecycleBin),
    excludePaths,
  };
}

/** Parse the comma/newline separated "Exclude paths" input from the UI. */
export function parseExcludePaths(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .slice(0, 100);
}

export function formatExcludePaths(paths: string[]): string {
  return paths.join(', ');
}
