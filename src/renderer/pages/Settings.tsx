import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Toggle } from '../components/ui/Toggle';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import type { Theme } from '@shared/types';
import type { UpdateInfo } from '@shared/electron-api';

interface SettingsProps {
  theme: Theme;
  onThemeToggle: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ theme, onThemeToggle }) => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onUpdateProgress((percent) => {
      setDownloadProgress(percent);
    });

    return unsubscribe;
  }, []);

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

  const downloadUpdate = async () => {
    if (!updateInfo?.downloadUrl) return;

    setDownloading(true);
    setDownloadProgress(0);

    try {
      await window.electronAPI.downloadUpdate(updateInfo.downloadUrl);
    } catch (error) {
      console.error('Failed to download update:', error);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="page">
      <h2 className="page-title mb-6">Settings</h2>

      <div className="flex flex-col gap-6 max-w-2xl">
        <Card title="Appearance">
          <div className="flex flex-col gap-4">
            <Toggle
              checked={theme === 'dark'}
              onChange={onThemeToggle}
              label="Dark Mode"
            />
            <Input
              label="Accent Color"
              type="color"
              defaultValue="#06B6D4"
              disabled
              title="Accent color customization is not implemented yet"
            />
          </div>
        </Card>

        <Card title="General">
          <div className="flex flex-col gap-4">
            <Toggle checked={true} onChange={() => {}} disabled label="Start with Windows" title="Not implemented yet" />
            <Toggle checked={false} onChange={() => {}} disabled label="Minimize to tray on close" title="Not implemented yet" />
            <Toggle checked={true} onChange={() => {}} disabled label="Enable notifications" title="Not implemented yet" />
            <Toggle checked={false} onChange={() => {}} disabled label="Automatic updates" title="Not implemented yet" />
          </div>
        </Card>

        <Card title="Cleaner">
          <div className="flex flex-col gap-4">
            <Toggle checked={true} onChange={() => {}} disabled label="Scan browser cache" title="Not implemented yet" />
            <Toggle checked={true} onChange={() => {}} disabled label="Scan Windows temp files" title="Not implemented yet" />
            <Toggle checked={false} onChange={() => {}} disabled label="Scan recycle bin" title="Not implemented yet" />
            <Input
              label="Exclude paths"
              placeholder="C:\Important"
              helperText="Comma-separated list of paths to exclude"
              disabled
              title="Path exclusions are not implemented yet"
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
                  <span className="text-sm text-fg-secondary">
                    v{updateInfo.latestVersion}
                  </span>
                </div>
                {updateInfo.updateAvailable && (
                  <>
                    {updateInfo.releaseNotes && (
                      <pre className="text-xs text-fg-tertiary whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {updateInfo.releaseNotes}
                      </pre>
                    )}
                    {downloading ? (
                      <Progress value={downloadProgress} label="Downloading..." />
                    ) : (
                      <Button variant="primary" size="sm" onClick={downloadUpdate}>
                        Download Update
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card title="About">
          <div className="flex flex-col gap-2 text-sm text-fg-secondary">
            <p><strong>FORCH.iA WinOptimizer</strong> v{__APP_VERSION__}</p>
            <p>Built with FORCH.i by Paulo Velasco</p>
            <p>Electron 31 + React 18 + TypeScript 5.5 + Vite 5</p>
            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={checkForUpdates} loading={checking}>
                Check for Updates
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
