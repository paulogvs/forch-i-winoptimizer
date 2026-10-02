import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_SETTINGS,
  isValidAccentColor,
  normalizeSettings,
  type AppEnvironment,
  type AppSettings,
  type SettingsPayload,
  type UpdateSettingsResult,
} from '@shared/settings';

const SETTINGS_FILE = 'settings.json';
const MAX_EXCLUDE_PATHS = 100;

let cached: AppSettings | null = null;
/** Test seam: override the directory that holds `settings.json`. */
let dirOverride: string | null = null;

export function setSettingsDir(dir: string | null): void {
  dirOverride = dir;
  cached = null;
}

function settingsDir(): string {
  if (dirOverride) return dirOverride;
  try {
    return app.getPath('userData');
  } catch {
    return process.cwd();
  }
}

function settingsFile(): string {
  return path.join(settingsDir(), SETTINGS_FILE);
}

// ===== Environment / portability =====

export function isPortableBuild(): boolean {
  return Boolean(process.env['PORTABLE_EXECUTABLE_DIR'] || process.env['PORTABLE_EXECUTABLE_FILE']);
}

export function isLoginItemSupported(): boolean {
  if (isPortableBuild()) return false;
  return process.platform === 'win32' || process.platform === 'darwin';
}

export function getEnvironment(): AppEnvironment {
  return {
    portable: isPortableBuild(),
    loginItemSupported: isLoginItemSupported(),
    platform: process.platform,
  };
}

// ===== Persistence =====

/** Read the persisted settings (normalised). Never throws. */
export function loadPersistedSettings(): AppSettings {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    cached = normalizeSettings(JSON.parse(raw));
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached;
}

function persist(settings: AppSettings): void {
  cached = settings;
  try {
    const dir = settingsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    // Persistence failure must never crash the app; in-memory state stays valid.
  }
}

// ===== Login item (Start with Windows) =====

/** Real OS state, so the toggle reflects the truth rather than a stored wish. */
export function getLoginItemState(): boolean {
  if (!isLoginItemSupported()) return false;
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

export function setLoginItemState(enabled: boolean): { success: boolean; message: string } {
  if (!isLoginItemSupported()) {
    return {
      success: false,
      message: isPortableBuild()
        ? 'Start with Windows is not available in the portable build.'
        : 'Start with Windows is not supported on this platform.',
    };
  }
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return {
      success: true,
      message: enabled
        ? 'FORCH.iA WinOptimizer will start with Windows.'
        : 'FORCH.iA WinOptimizer will no longer start with Windows.',
    };
  } catch (error) {
    return { success: false, message: `Could not update login item: ${String(error)}` };
  }
}

// ===== Public API =====

/** Current settings with the effective login-item state merged in. */
export function getSettings(): SettingsPayload {
  const persisted = loadPersistedSettings();
  const settings: AppSettings = {
    ...persisted,
    startWithWindows: getLoginItemState(),
  };
  return { settings, environment: getEnvironment() };
}

export type { UpdateSettingsResult } from '@shared/settings';

/**
 * Apply a partial settings update. Only recognised fields are accepted; the
 * result always reflects the real, post-write state.
 */
export function updateSettings(patch: Partial<AppSettings>): UpdateSettingsResult {
  const current = loadPersistedSettings();
  const next: AppSettings = { ...current };
  let ok = true;
  let message = 'Settings saved.';

  if (patch.accentColor !== undefined) {
    if (isValidAccentColor(patch.accentColor)) next.accentColor = patch.accentColor;
  }
  if (typeof patch.minimizeToTrayOnClose === 'boolean') {
    next.minimizeToTrayOnClose = patch.minimizeToTrayOnClose;
  }
  if (typeof patch.enableNotifications === 'boolean') {
    next.enableNotifications = patch.enableNotifications;
  }
  if (typeof patch.automaticUpdates === 'boolean') {
    next.automaticUpdates = patch.automaticUpdates;
  }
  if (typeof patch.scanBrowserCache === 'boolean') {
    next.scanBrowserCache = patch.scanBrowserCache;
  }
  if (typeof patch.scanWindowsTempFiles === 'boolean') {
    next.scanWindowsTempFiles = patch.scanWindowsTempFiles;
  }
  if (typeof patch.scanRecycleBin === 'boolean') {
    next.scanRecycleBin = patch.scanRecycleBin;
  }
  if (Array.isArray(patch.excludePaths)) {
    next.excludePaths = patch.excludePaths
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .slice(0, MAX_EXCLUDE_PATHS);
  }

  // Login item is OS state, not a stored preference: apply it first and only
  // persist what actually succeeded.
  if (typeof patch.startWithWindows === 'boolean') {
    const result = setLoginItemState(patch.startWithWindows);
    ok = result.success;
    message = result.message;
    next.startWithWindows = patch.startWithWindows;
  }

  persist(next);

  // `getSettings()` re-reads the OS login-item state.
  const payload = getSettings();
  return { ...payload, ok, message };
}

/** Notification gate used by the notifications service. */
export function areNotificationsEnabled(): boolean {
  return loadPersistedSettings().enableNotifications;
}

/** Cleaner scan options derived from settings (single source of truth). */
export function getScanPreferences(): {
  scanBrowserCache: boolean;
  scanWindowsTempFiles: boolean;
  scanRecycleBin: boolean;
  excludePaths: string[];
} {
  const s = loadPersistedSettings();
  return {
    scanBrowserCache: s.scanBrowserCache,
    scanWindowsTempFiles: s.scanWindowsTempFiles,
    scanRecycleBin: s.scanRecycleBin,
    excludePaths: s.excludePaths,
  };
}

/** Auto-update gate used by the updater bootstrap. */
export function automaticUpdatesEnabled(): boolean {
  return loadPersistedSettings().automaticUpdates;
}
