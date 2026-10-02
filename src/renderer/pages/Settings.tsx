import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Toggle } from '../components/ui/Toggle';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { applyAccentColor } from '../utils/accent';
import {
  DEFAULT_SETTINGS,
  parseExcludePaths,
  formatExcludePaths,
  type AppSettings,
  type SettingsPayload,
  type UpdateSettingsResult,
} from '@shared/settings';
import type { Theme } from '@shared/types';
import type { UpdateInfo } from '@shared/electron-api';
import type { UpdateStatus } from '@shared/updater-status';

interface SettingsProps {
  theme: Theme;
  onThemeToggle: () => void;
}

const IDLE_STATUS: UpdateStatus = { state: 'idle', version: null, percent: null, message: null };

/** Human label for the background updater lifecycle. */
function updateStatusLabel(status: UpdateStatus): string {
  switch (status.state) {
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return `Version ${status.version ?? ''} is available`;
    case 'not-available':
      return 'You are up to date';
    case 'downloading':
      return `Downloading… ${status.percent ?? 0}%`;
    case 'downloaded':
      return `Version ${status.version ?? ''} is ready to install`;
    case 'error':
      return 'Update check failed';
    default:
      return 'Idle';
  }
}

function updateStatusVariant(status: UpdateStatus): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (status.state) {
    case 'not-available':
      return 'success';
    case 'available':
      return 'warning';
    case 'error':
      return 'error';
    case 'checking':
    case 'downloading':
    case 'downloaded':
      return 'info';
    default:
      return 'neutral';
  }
}

export const Settings: React.FC<SettingsProps> = ({ theme, onThemeToggle }) => {
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [excludeText, setExcludeText] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Legacy GitHub-release check (manual, read-only) — still available for a
  // quick "is there a newer release?" without touching the installed app.
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);

  // Background electron-updater lifecycle (download/install capable).
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(IDLE_STATUS);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const settings = payload?.settings;
  const environment = payload?.environment;

  useEffect(() => {
    let active = true;
    void window.electronAPI
      .getSettings()
      .then((result) => {
        if (!active) return;
        setPayload(result);
        setExcludeText(formatExcludePaths(result.settings.excludePaths));
        applyAccentColor(result.settings.accentColor);
      })
      .catch(() => {
        /* keep defaults visible if the main process is unavailable */
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribeStatus = window.electronAPI.onUpdateStatus((status) => {
      setUpdateStatus(status);
      if (status.state === 'downloading') setDownloadProgress(status.percent ?? 0);
    });
    const unsubscribeProgress = window.electronAPI.onUpdateProgress((percent) => {
      setDownloadProgress(percent);
    });
    void window.electronAPI
      .getUpdateStatus()
      .then((status) => setUpdateStatus(status))
      .catch(() => {});
    return () => {
      unsubscribeStatus();
      unsubscribeProgress();
    };
  }, []);

  /** Persist a partial change and mirror the authoritative main-process state. */
  const applyPatch = useCallback(async (patch: Partial<AppSettings>) => {
    setSaving(true);
    try {
      const result: UpdateSettingsResult = await window.electronAPI.updateSettings(patch);
      setPayload({ settings: result.settings, environment: result.environment });
      setExcludeText(formatExcludePaths(result.settings.excludePaths));
      setFeedback(result.ok ? null : { ok: false, message: result.message });
    } catch (error) {
      setFeedback({ ok: false, message: `Could not save settings: ${String(error)}` });
    } finally {
      setSaving(false);
    }
  }, []);

  const handleAccent = (value: string) => {
    applyAccentColor(value);
    void applyPatch({ accentColor: value });
  };

  const checkForUpdates = async () => {
    setChecking(true);
    try {
      const info = await window.electronAPI.checkForUpdates();
      setUpdateInfo(info);
    } catch (error) {
      console.error('Failed to check for updates:', error);
    } finally {
      setChecking(false);
    }
  };

  const checkBackgroundUpdates = async () => {
    try {
      const status = await window.electronAPI.checkForUpdatesNow();
      setUpdateStatus(status);
    } catch (error) {
      console.error('Failed to trigger background update check:', error);
    }
  };

  const downloadBackgroundUpdate = async () => {
    try {
      const status = await window.electronAPI.downloadUpdateNow();
      setUpdateStatus(status);
    } catch (error) {
      console.error('Failed to download update:', error);
    }
  };

  const installBackgroundUpdate = async () => {
    try {
      await window.electronAPI.installUpdateNow();
    } catch (error) {
      console.error('Failed to install update:', error);
    }
  };

  const loginItemSupported = environment?.loginItemSupported ?? true;
  const isPortable = environment?.portable ?? false;

  return (
    <div className="page">
      <h2 className="page-title mb-6">Settings</h2>

      <div className="flex flex-col gap-6 max-w-2xl">
        <Card title="Appearance">
          <div className="flex flex-col gap-4">
            <Toggle checked={theme === 'dark'} onChange={onThemeToggle} label="Dark Mode" />
            <div className="flex items-end gap-3">
              <Input
                label="Accent Color"
                type="color"
                value={settings?.accentColor ?? DEFAULT_SETTINGS.accentColor}
                onChange={(e) => handleAccent(e.target.value)}
                disabled={!settings}
                className="w-16 h-10 p-1 cursor-pointer"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleAccent(DEFAULT_SETTINGS.accentColor)}
                disabled={!settings}
              >
                Reset to brand cyan
              </Button>
            </div>
            <p className="text-xs text-fg-tertiary">
              The accent is applied live and persisted. Every component derives its
              highlight colour from this token.
            </p>
          </div>
        </Card>

        <Card title="General">
          <div className="flex flex-col gap-4">
            <Toggle
              checked={settings?.startWithWindows ?? false}
              onChange={(checked) => void applyPatch({ startWithWindows: checked })}
              disabled={!settings || !loginItemSupported}
              label="Start with Windows"
              title={
                loginItemSupported
                  ? 'Launch FORCH.iA WinOptimizer when you sign in to Windows'
                  : 'Not available in the portable build'
              }
            />
            {!loginItemSupported && (
              <p className="text-xs text-warning -mt-2">
                {isPortable
                  ? 'Start with Windows is not available in the portable build. Install the NSIS version to enable it.'
                  : 'Start with Windows is not supported on this platform.'}
              </p>
            )}
            <Toggle
              checked={settings?.minimizeToTrayOnClose ?? false}
              onChange={(checked) => void applyPatch({ minimizeToTrayOnClose: checked })}
              disabled={!settings}
              label="Minimize to tray on close"
              title="Closing the window keeps the app running in the system tray"
            />
            <Toggle
              checked={settings?.enableNotifications ?? true}
              onChange={(checked) => void applyPatch({ enableNotifications: checked })}
              disabled={!settings}
              label="Enable notifications"
            />
            <Toggle
              checked={settings?.automaticUpdates ?? false}
              onChange={(checked) => void applyPatch({ automaticUpdates: checked })}
              disabled={!settings || isPortable}
              label="Automatic updates"
              title={
                isPortable
                  ? 'Automatic updates are not available in the portable build'
                  : 'Check for updates in the background every 4 hours'
              }
            />
          </div>
        </Card>

        <Card title="Cleaner">
          <div className="flex flex-col gap-4">
            <Toggle
              checked={settings?.scanBrowserCache ?? true}
              onChange={(checked) => void applyPatch({ scanBrowserCache: checked })}
              disabled={!settings}
              label="Scan browser cache"
            />
            <Toggle
              checked={settings?.scanWindowsTempFiles ?? true}
              onChange={(checked) => void applyPatch({ scanWindowsTempFiles: checked })}
              disabled={!settings}
              label="Scan Windows temp files"
            />
            <Toggle
              checked={settings?.scanRecycleBin ?? false}
              onChange={(checked) => void applyPatch({ scanRecycleBin: checked })}
              disabled={!settings}
              label="Scan recycle bin"
            />
            <Input
              label="Exclude paths"
              placeholder="C:\Important, D:\Projects"
              helperText="Comma-separated paths the junk scanner must skip. Applied when the field loses focus."
              value={excludeText}
              onChange={(e) => setExcludeText(e.target.value)}
              onBlur={() => void applyPatch({ excludePaths: parseExcludePaths(excludeText) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              disabled={!settings}
            />
          </div>
        </Card>

        <Card title="Updates">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-fg-primary">Current Version</div>
                <div className="text-xs text-fg-tertiary">v{__APP_VERSION__}</div>
              </div>
              <Button variant="secondary" size="sm" onClick={checkForUpdates} loading={checking}>
                {checking ? 'Checking...' : 'Check for Updates'}
              </Button>
            </div>

            {updateInfo && (
              <div className="flex flex-col gap-2 p-3 rounded-lg bg-bg-tertiary">
                <div className="flex items-center gap-2">
                  <Badge variant={updateInfo.updateAvailable ? 'warning' : 'success'}>
                    {updateInfo.updateAvailable ? 'Update Available' : 'Up to Date'}
                  </Badge>
                  <span className="text-sm text-fg-secondary">v{updateInfo.latestVersion}</span>
                </div>
                {updateInfo.updateAvailable && updateInfo.releaseNotes && (
                  <pre className="text-xs text-fg-tertiary whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {updateInfo.releaseNotes}
                  </pre>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3 p-3 rounded-lg bg-bg-tertiary">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant={updateStatusVariant(updateStatus)}>
                    {updateStatusLabel(updateStatus)}
                  </Badge>
                  {updateStatus.message && updateStatus.state === 'error' && (
                    <span className="text-xs text-fg-tertiary truncate" title={updateStatus.message}>
                      {updateStatus.message}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(updateStatus.state === 'idle' || updateStatus.state === 'not-available') && (
                    <Button variant="secondary" size="sm" onClick={checkBackgroundUpdates}>
                      Check now
                    </Button>
                  )}
                  {updateStatus.state === 'available' && (
                    <Button variant="primary" size="sm" onClick={downloadBackgroundUpdate}>
                      Download
                    </Button>
                  )}
                  {updateStatus.state === 'downloaded' && (
                    <Button variant="primary" size="sm" onClick={installBackgroundUpdate}>
                      Restart &amp; install
                    </Button>
                  )}
                </div>
              </div>
              {updateStatus.state === 'downloading' && (
                <Progress value={downloadProgress} label="Downloading update..." />
              )}
            </div>

            {isPortable && (
              <p className="text-xs text-warning">
                Automatic updates are not available in the portable build. Download the
                latest installer from GitHub Releases to update.
              </p>
            )}

            {feedback && !feedback.ok && (
              <p role="alert" className="text-xs text-error">
                {feedback.message}
              </p>
            )}
            {saving && <span className="sr-only">Saving settings…</span>}
          </div>
        </Card>

        <Card title="About">
          <div className="flex flex-col gap-2 text-sm text-fg-secondary">
            <p>
              <strong>FORCH.iA WinOptimizer</strong> v{__APP_VERSION__}
            </p>
            <p>Built with FORCH.i by Paulo Velasco</p>
            <p>Electron 31 + React 18 + TypeScript 5.5 + Vite 5</p>
          </div>
        </Card>
      </div>
    </div>
  );
};
