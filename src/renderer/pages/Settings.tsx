import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Toggle } from '../components/ui/Toggle';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { useToast } from '../components/ui/toast-context';
import { applyAccentColor } from '../utils/accent';
import {
  serializeConfigProfile,
  type ConfigProfile,
  type ProfilePreview,
} from '@shared/config-profile';
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

function updateStatusVariant(
  status: UpdateStatus
): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
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
  const { notify } = useToast();
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [excludeText, setExcludeText] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Configuration profile (A3): export + preview-first import. An import is
  // NEVER applied without an explicit preview + confirmation.
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileResult, setProfileResult] = useState<string | null>(null);
  const [profilePending, setProfilePending] = useState<{
    profile: ConfigProfile;
    preview: ProfilePreview;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  /** Download the full configuration (settings + applied tweaks) as JSON. */
  const handleExportProfile = async () => {
    setProfileBusy(true);
    setProfileError(null);
    setProfileResult(null);
    try {
      const profile: ConfigProfile = await window.electronAPI.exportProfile();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
      const blob = new Blob([serializeConfigProfile(profile)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `winoptimizer-profile-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const message = `Exported ${profile.appliedTweaks.length} tweak(s) and the current settings.`;
      setProfileResult(message);
      notify({ title: 'Profile exported', message, variant: 'success' });
    } catch (error) {
      const message = `Could not export the profile: ${String(error)}`;
      setProfileError(message);
      notify({ title: 'Profile export failed', message, variant: 'error' });
    } finally {
      setProfileBusy(false);
    }
  };

  /** Read a profile file as text (FileReader fallback for older engines). */
  const readProfileFileText = (file: File): Promise<string> => {
    if (typeof file.text === 'function') {
      return file.text().catch(
        () =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read the file.'));
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.readAsText(file);
          })
      );
    }
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsText(file);
    });
  };

  /** Validate + preview a profile file. Zero side effects until confirmed. */
  const handleImportFile = async (file: File) => {
    setProfileBusy(true);
    setProfileError(null);
    setProfileResult(null);
    setProfilePending(null);
    try {
      const text = await readProfileFileText(file);
      const outcome = await window.electronAPI.previewProfile(text);
      if (!outcome.success || !outcome.profile || !outcome.preview) {
        const message = outcome.error ?? 'Invalid profile file.';
        setProfileError(message);
        notify({ title: 'Profile rejected', message, variant: 'error' });
        return;
      }
      setProfilePending({ profile: outcome.profile, preview: outcome.preview });
    } catch (error) {
      const message = `Could not read the profile: ${String(error)}`;
      setProfileError(message);
      notify({ title: 'Profile rejected', message, variant: 'error' });
    } finally {
      setProfileBusy(false);
    }
  };

  /** Apply the previewed profile tweak-by-tweak through the existing engine. */
  const handleConfirmApplyProfile = async () => {
    if (!profilePending) return;
    setProfileBusy(true);
    setProfileError(null);
    try {
      const outcome = await window.electronAPI.applyProfile(profilePending.profile);
      if (!outcome.success) {
        const message = outcome.error ?? 'Profile rejected.';
        setProfileError(message);
        notify({ title: 'Profile rejected', message, variant: 'error' });
        return;
      }
      const detail = outcome.failed.map((item) => `${item.id}: ${item.message}`).join('; ');
      const message = detail ? `${outcome.message} Details: ${detail}` : outcome.message;
      setProfileResult(message);
      notify({
        title: 'Profile imported',
        message,
        variant: outcome.failed.length > 0 ? 'info' : 'success',
      });
      // Mirror the authoritative post-import state.
      try {
        const fresh = await window.electronAPI.getSettings();
        setPayload(fresh);
        setExcludeText(formatExcludePaths(fresh.settings.excludePaths));
        applyAccentColor(fresh.settings.accentColor);
      } catch {
        /* the result above is already reported honestly */
      }
      setProfilePending(null);
    } catch (error) {
      const message = `Could not apply the profile: ${String(error)}`;
      setProfileError(message);
      notify({ title: 'Profile import failed', message, variant: 'error' });
    } finally {
      setProfileBusy(false);
    }
  };

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
              The accent is applied live and persisted. Every component derives its highlight colour
              from this token.
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

        <Card title="Configuration profile">
          <div className="flex flex-col gap-4">
            <p className="text-xs text-fg-tertiary">
              Export your tweaks and settings to a JSON file, or import one back. An import is
              always previewed first — nothing is applied until you confirm.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleExportProfile()}
                disabled={!settings || profileBusy}
                data-testid="profile-export"
              >
                {profileBusy ? 'Working…' : 'Export profile'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={!settings || profileBusy}
                data-testid="profile-import"
              >
                Import profile
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                data-testid="profile-file"
                aria-label="Choose a profile JSON file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void handleImportFile(file);
                }}
              />
            </div>
            <div aria-live="polite">
              {profileError && (
                <p role="alert" className="text-xs text-error" data-testid="profile-error">
                  {profileError}
                </p>
              )}
              {profileResult && (
                <p role="status" className="text-xs text-fg-secondary" data-testid="profile-result">
                  {profileResult}
                </p>
              )}
              {profilePending && (
                <div
                  className="flex flex-col gap-2 p-3 rounded-lg bg-bg-tertiary"
                  data-testid="profile-preview"
                >
                  <p className="text-sm text-fg-primary">
                    This profile will change {profilePending.preview.counts.settingsChanges}{' '}
                    setting(s) and apply {profilePending.preview.counts.toApply} tweak(s).
                  </p>
                  {profilePending.preview.settingsChanges.length > 0 && (
                    <ul className="text-xs text-fg-secondary list-disc pl-5">
                      {profilePending.preview.settingsChanges.map((change) => (
                        <li key={change.key}>
                          {change.key}: {JSON.stringify(change.from)} → {JSON.stringify(change.to)}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-fg-tertiary">
                    Tweaks to apply:{' '}
                    {profilePending.preview.tweaksToApply.length > 0
                      ? profilePending.preview.tweaksToApply.join(', ')
                      : 'none — everything already matches'}
                  </p>
                  {profilePending.preview.tweaksAlreadyApplied.length > 0 && (
                    <p className="text-xs text-fg-tertiary">
                      Already applied (skipped):{' '}
                      {profilePending.preview.tweaksAlreadyApplied.join(', ')}
                    </p>
                  )}
                  {profilePending.preview.tweaksUnknown.length > 0 && (
                    <p className="text-xs text-warning">
                      Unknown ids (omitted, never applied blindly):{' '}
                      {profilePending.preview.tweaksUnknown.join(', ')}
                    </p>
                  )}
                  {profilePending.preview.extrasKept.length > 0 && (
                    <p className="text-xs text-fg-tertiary">
                      Currently applied and kept as-is (never auto-reverted):{' '}
                      {profilePending.preview.extrasKept.join(', ')}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void handleConfirmApplyProfile()}
                      disabled={profileBusy}
                      data-testid="profile-apply-confirm"
                    >
                      Apply profile
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setProfilePending(null)}
                      disabled={profileBusy}
                      data-testid="profile-apply-cancel"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
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
                    <span
                      className="text-xs text-fg-tertiary truncate"
                      title={updateStatus.message}
                    >
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
                Automatic updates are not available in the portable build. Download the latest
                installer from GitHub Releases to update.
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
