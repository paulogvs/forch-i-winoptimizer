import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const loginState = vi.hoisted(() => ({ openAtLogin: false }));

vi.mock('electron', () => ({
  app: {
    // Only used when `setSettingsDir` has not been called; keep it harmless.
    getPath: () => os.tmpdir(),
    getLoginItemSettings: () => ({ openAtLogin: loginState.openAtLogin }),
    setLoginItemSettings: (options: { openAtLogin?: boolean }) => {
      loginState.openAtLogin = Boolean(options.openAtLogin);
    },
  },
}));

import {
  areNotificationsEnabled,
  automaticUpdatesEnabled,
  getEnvironment,
  getLoginItemState,
  getScanPreferences,
  getSettings,
  isLoginItemSupported,
  isPortableBuild,
  loadPersistedSettings,
  setLoginItemState,
  setSettingsDir,
  updateSettings,
} from './settings';

describe('main/services/settings', () => {
  let dir: string;
  const originalPortable = process.env['PORTABLE_EXECUTABLE_DIR'];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forchi-settings-'));
    setSettingsDir(dir);
    loginState.openAtLogin = false;
    delete process.env['PORTABLE_EXECUTABLE_DIR'];
    delete process.env['PORTABLE_EXECUTABLE_FILE'];
  });

  afterEach(() => {
    setSettingsDir(null);
    fs.rmSync(dir, { recursive: true, force: true });
    if (originalPortable === undefined) delete process.env['PORTABLE_EXECUTABLE_DIR'];
    else process.env['PORTABLE_EXECUTABLE_DIR'] = originalPortable;
  });

  it('returns defaults when no settings file exists', () => {
    const payload = getSettings();
    expect(payload.settings.accentColor).toBe('#06B6D4');
    expect(payload.environment.platform).toBe(process.platform);
  });

  it('persists and reflects a toggle change', () => {
    const result = updateSettings({ enableNotifications: false });
    expect(result.settings.enableNotifications).toBe(false);
    expect(areNotificationsEnabled()).toBe(false);

    // Round-trips through disk: clear the cache.
    setSettingsDir(dir);
    expect(loadPersistedSettings().enableNotifications).toBe(false);
  });

  it('ignores invalid accent colours', () => {
    const result = updateSettings({ accentColor: 'not-a-colour' });
    expect(result.settings.accentColor).toBe('#06B6D4');
  });

  it('accepts valid accent colours', () => {
    const result = updateSettings({ accentColor: '#FF8800' });
    expect(result.settings.accentColor).toBe('#FF8800');
  });

  it('reflects cleaner scan preferences', () => {
    updateSettings({ scanBrowserCache: false, scanRecycleBin: true, excludePaths: ['C:\\skip'] });
    const prefs = getScanPreferences();
    expect(prefs.scanBrowserCache).toBe(false);
    expect(prefs.scanRecycleBin).toBe(true);
    expect(prefs.excludePaths).toEqual(['C:\\skip']);
  });

  it('exposes the automatic-update gate', () => {
    expect(automaticUpdatesEnabled()).toBe(false);
    updateSettings({ automaticUpdates: true });
    expect(automaticUpdatesEnabled()).toBe(true);
  });

  describe('portable build', () => {
    beforeEach(() => {
      process.env['PORTABLE_EXECUTABLE_DIR'] = 'C:\\Portable';
    });

    it('reports portability and disables login item support', () => {
      expect(isPortableBuild()).toBe(true);
      expect(isLoginItemSupported()).toBe(false);
      expect(getEnvironment().portable).toBe(true);
      expect(getLoginItemState()).toBe(false);
    });

    it('refuses to register a login item and explains why', () => {
      const result = setLoginItemState(true);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/portable/i);
    });
  });

  describe.runIf(process.platform === 'win32' || process.platform === 'darwin')(
    'login item (native)',
    () => {
      it('writes and reads the real OS login-item state', () => {
        expect(isLoginItemSupported()).toBe(true);
        const enabled = setLoginItemState(true);
        expect(enabled.success).toBe(true);
        expect(getLoginItemState()).toBe(true);
        expect(getSettings().settings.startWithWindows).toBe(true);

        // Always leave the machine as we found it.
        expect(setLoginItemState(false).success).toBe(true);
        expect(getLoginItemState()).toBe(false);
      });
    }
  );
});
