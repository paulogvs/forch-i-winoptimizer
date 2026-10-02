import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { formatBytes } from '../utils/format';
import type { DebloatCandidate, DebloatResult, InstalledApp, StartupApp } from '@shared/electron-api';

type ToolTab = 'apps' | 'startup' | 'debloat' | 'utilities';

export const Tools: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ToolTab>('apps');
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [startupApps, setStartupApps] = useState<StartupApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [debloatCatalog, setDebloatCatalog] = useState<DebloatCandidate[]>([]);
  const [selectedBloatware, setSelectedBloatware] = useState<string[]>([]);
  const [removing, setRemoving] = useState(false);
  const [debloatResult, setDebloatResult] = useState<DebloatResult | null>(null);

  useEffect(() => {
    if (activeTab === 'apps') {
      loadInstalledApps();
    } else if (activeTab === 'startup') {
      loadStartupApps();
    } else if (activeTab === 'debloat') {
      setDebloatResult(null);
      setSelectedBloatware([]);
      void loadDebloatCatalog();
    }
  }, [activeTab]);

  const loadInstalledApps = async () => {
    setLoading(true);
    try {
      const apps = await window.electronAPI.getInstalledApps();
      setInstalledApps(apps);
    } catch (error) {
      console.error('Failed to load installed apps:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStartupApps = async () => {
    setLoading(true);
    try {
      const apps = await window.electronAPI.getStartupApps();
      setStartupApps(apps);
    } catch (error) {
      console.error('Failed to load startup apps:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUninstall = async (app: InstalledApp) => {
    if (app.protection === 'protected') {
      if (!window.confirm(`WARNING: ${app.name} is a protected app. Are you sure you want to uninstall it?`)) {
        return;
      }
    } else if (app.protection === 'caution') {
      if (!window.confirm(`Are you sure you want to uninstall ${app.name}?`)) {
        return;
      }
    }

    setUninstalling(app.id);
    setProgress(0);

    try {
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 100);

      const result = await window.electronAPI.uninstallApp(app.id, app.uninstallString);

      clearInterval(progressInterval);
      setProgress(100);

      if (result.success) {
        setInstalledApps((prev) => prev.filter((a) => a.id !== app.id));
      }
    } catch (error) {
      console.error('Uninstall failed:', error);
    } finally {
      setUninstalling(null);
    }
  };

  const handleToggleStartup = async (app: StartupApp) => {
    try {
      const result = await window.electronAPI.toggleStartupApp(app.id, !app.enabled);
      if (result.success) {
        setStartupApps((prev) =>
          prev.map((a) => (a.id === app.id ? { ...a, enabled: !a.enabled } : a))
        );
      }
    } catch (error) {
      console.error('Failed to toggle startup app:', error);
    }
  };

  const loadDebloatCatalog = async () => {
    try {
      const catalog = await window.electronAPI.getBloatwareCatalog();
      setDebloatCatalog(catalog);
    } catch (error) {
      console.error('Failed to load bloatware catalog:', error);
    }
  };

  const toggleBloatware = (id: string, checked: boolean) => {
    setSelectedBloatware((prev) =>
      checked ? [...prev, id] : prev.filter((x) => x !== id)
    );
  };

  const handleDebloat = async () => {
    if (selectedBloatware.length === 0) return;

    const cautionCount = debloatCatalog.filter(
      (a) => selectedBloatware.includes(a.id) && a.protection === 'caution'
    ).length;
    const cautionNote =
      cautionCount > 0 ? ` ${cautionCount} of them are marked "caution".` : '';
    const confirmed = window.confirm(
      `Remove ${selectedBloatware.length} app(s)?${cautionNote} Protected apps are never removed.`
    );
    if (!confirmed) return;

    setRemoving(true);
    setDebloatResult(null);
    try {
      const result = await window.electronAPI.removeBloatware(selectedBloatware);
      setDebloatResult(result);
      setSelectedBloatware([]);
      await loadDebloatCatalog();
    } catch (error) {
      console.error('Debloat failed:', error);
    } finally {
      setRemoving(false);
    }
  };

  const safeApps = installedApps.filter((a) => a.protection === 'safe');
  const cautionApps = installedApps.filter((a) => a.protection === 'caution');
  const protectedApps = installedApps.filter((a) => a.protection === 'protected');

  return (
    <div className="page">
      <h2 className="page-title mb-6">Tools</h2>

      <div className="flex gap-2 mb-6">
        <Button
          variant={activeTab === 'apps' ? 'primary' : 'secondary'}
          onClick={() => setActiveTab('apps')}
        >
          App Manager
        </Button>
        <Button
          variant={activeTab === 'startup' ? 'primary' : 'secondary'}
          onClick={() => setActiveTab('startup')}
        >
          Startup Manager
        </Button>
        <Button
          variant={activeTab === 'debloat' ? 'primary' : 'secondary'}
          onClick={() => setActiveTab('debloat')}
        >
          Debloat
        </Button>
        <Button
          variant={activeTab === 'utilities' ? 'primary' : 'secondary'}
          onClick={() => setActiveTab('utilities')}
        >
          Utilities
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-64">
          <div className="text-fg-tertiary">Loading...</div>
        </div>
      )}

      {activeTab === 'apps' && !loading && (
        <div className="flex flex-col gap-4">
          <Card
            title="Installed Apps"
            footer={
              <div className="flex gap-2">
                <Badge variant="success">{safeApps.length} safe</Badge>
                <Badge variant="warning">{cautionApps.length} caution</Badge>
                <Badge variant="error">{protectedApps.length} protected</Badge>
              </div>
            }
          >
            <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
              {installedApps.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-bg-hover"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg-primary">{app.name}</span>
                      <Badge
                        variant={
                          app.protection === 'protected'
                            ? 'error'
                            : app.protection === 'caution'
                              ? 'warning'
                              : 'success'
                        }
                      >
                        {app.protection}
                      </Badge>
                    </div>
                    <div className="text-xs text-fg-tertiary">
                      {app.publisher} • {app.version} • {formatBytes(app.size)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {uninstalling === app.id ? (
                      <Progress value={progress} className="w-24" />
                    ) : (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleUninstall(app)}
                        disabled={app.protection === 'protected'}
                      >
                        Uninstall
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'startup' && !loading && (
        <Card title="Startup Apps">
          <div className="flex flex-col gap-2">
            {startupApps.map((app) => (
              <div
                key={app.id}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-bg-hover"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg-primary">{app.name}</span>
                    <Badge
                      variant={
                        app.impact === 'high'
                          ? 'error'
                          : app.impact === 'medium'
                            ? 'warning'
                            : 'success'
                      }
                    >
                      {app.impact} impact
                    </Badge>
                  </div>
                  <div className="text-xs text-fg-tertiary truncate">{app.path}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={app.enabled ? 'success' : 'neutral'}>
                    {app.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                  <Button
                    variant={app.enabled ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => handleToggleStartup(app)}
                  >
                    {app.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === 'debloat' && (
        <div className="flex flex-col gap-4">
          {debloatResult && (
            <div
              data-testid="debloat-result"
              role="status"
              className={`p-3 rounded-lg text-sm ${
                debloatResult.success ? 'text-success' : 'text-error'
              }`}
            >
              {debloatResult.message}
            </div>
          )}

          <Card
            title="Bloatware Removal"
            footer={
              <div className="flex items-center justify-between gap-4">
                <div className="flex gap-2">
                  <Badge variant="success">
                    {debloatCatalog.filter((a) => a.protection === 'safe').length} safe
                  </Badge>
                  <Badge variant="warning">
                    {debloatCatalog.filter((a) => a.protection === 'caution').length} caution
                  </Badge>
                  <Badge variant="error">
                    {debloatCatalog.filter((a) => a.protection === 'protected').length} protected
                  </Badge>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDebloat}
                  disabled={selectedBloatware.length === 0 || removing}
                >
                  {removing ? 'Removing...' : `Remove selected (${selectedBloatware.length})`}
                </Button>
              </div>
            }
          >
            <p className="text-xs text-fg-tertiary mb-3">
              Curated removable UWP packages. Protection is enforced server-side:
              protected apps can never be removed, even from here.
            </p>
            <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
              {debloatCatalog.map((app) => {
                const selectable = app.installed && app.protection !== 'protected';
                return (
                  <label
                    key={app.id}
                    className={`flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-bg-hover ${
                      selectable ? 'cursor-pointer' : 'opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        data-testid={`debloat-check-${app.id}`}
                        disabled={!selectable}
                        checked={selectedBloatware.includes(app.id)}
                        onChange={(e) => toggleBloatware(app.id, e.target.checked)}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-fg-primary">{app.name}</span>
                          <Badge
                            variant={
                              app.protection === 'protected'
                                ? 'error'
                                : app.protection === 'caution'
                                  ? 'warning'
                                  : 'success'
                            }
                          >
                            {app.protection}
                          </Badge>
                          {!app.installed && <Badge variant="neutral">not installed</Badge>}
                        </div>
                        <div className="text-xs text-fg-tertiary truncate">{app.description}</div>
                      </div>
                    </div>
                  </label>
                );
              })}
              {debloatCatalog.length === 0 && (
                <div className="text-sm text-fg-tertiary">Catalog unavailable.</div>
              )}
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'utilities' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card hoverable>
            <div className="flex flex-col items-center text-center gap-3 p-4">
              <span className="text-3xl">🔍</span>
              <h3 className="text-md font-semibold text-fg-primary">Registry Cleaner</h3>
              <p className="text-sm text-fg-secondary">Scan and fix registry errors</p>
              <Button variant="secondary" size="sm">Open</Button>
            </div>
          </Card>
          <Card hoverable>
            <div className="flex flex-col items-center text-center gap-3 p-4">
              <span className="text-3xl">💽</span>
              <h3 className="text-md font-semibold text-fg-primary">Disk Defragmenter</h3>
              <p className="text-sm text-fg-secondary">Optimize disk performance</p>
              <Button variant="secondary" size="sm">Open</Button>
            </div>
          </Card>
          <Card hoverable>
            <div className="flex flex-col items-center text-center gap-3 p-4">
              <span className="text-3xl">🔒</span>
              <h3 className="text-md font-semibold text-fg-primary">Privacy Eraser</h3>
              <p className="text-sm text-fg-secondary">Remove browsing history and traces</p>
              <Button variant="secondary" size="sm">Open</Button>
            </div>
          </Card>
          <Card hoverable>
            <div className="flex flex-col items-center text-center gap-3 p-4">
              <span className="text-3xl">🗑️</span>
              <h3 className="text-md font-semibold text-fg-primary">File Shredder</h3>
              <p className="text-sm text-fg-secondary">Permanently delete sensitive files</p>
              <Button variant="secondary" size="sm">Open</Button>
            </div>
          </Card>
          <Card hoverable>
            <div className="flex flex-col items-center text-center gap-3 p-4">
              <span className="text-3xl">🌐</span>
              <h3 className="text-md font-semibold text-fg-primary">Network Optimizer</h3>
              <p className="text-sm text-fg-secondary">Optimize network settings</p>
              <Button variant="secondary" size="sm">Open</Button>
            </div>
          </Card>
          <Card hoverable>
            <div className="flex flex-col items-center text-center gap-3 p-4">
              <span className="text-3xl">ℹ️</span>
              <h3 className="text-md font-semibold text-fg-primary">System Info</h3>
              <p className="text-sm text-fg-secondary">View detailed system information</p>
              <Button variant="secondary" size="sm">Open</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
