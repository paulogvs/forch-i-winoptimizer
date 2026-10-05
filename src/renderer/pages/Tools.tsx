import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { VirtualList } from '../components/ui/VirtualList';
import { formatBytes } from '../utils/format';
import { WINDOWS_TOOLS } from '@shared/windows-tools';
import type {
  DebloatCandidate,
  DebloatResult,
  InstalledApp,
  StartupApp,
} from '@shared/electron-api';
import type { PageId } from '@shared/types';

type ToolTab = 'apps' | 'startup' | 'debloat' | 'utilities';

interface ToolsProps {
  onNavigate?: (page: PageId) => void;
}

/** In-app utilities that open a real, dedicated page instead of an OS tool. */
const NAV_UTILITIES: { icon: string; title: string; description: string; target: PageId }[] = [
  {
    icon: '🌐',
    title: 'Network Optimizer',
    description: 'Optimize network settings',
    target: 'network',
  },
  {
    icon: 'ℹ️',
    title: 'System Info',
    description: 'View detailed system information',
    target: 'dashboard',
  },
];

/** Lists larger than this are virtualized (same rule as Drivers). */
const VIRTUALIZE_THRESHOLD = 50;

interface AppRowProps {
  app: InstalledApp;
  uninstalling: boolean;
  onUninstall: (app: InstalledApp) => void;
}

interface StartupRowProps {
  app: StartupApp;
  onToggle: (app: StartupApp) => void;
}

const StartupRow = React.memo(function StartupRow({ app, onToggle }: StartupRowProps) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-bg-hover">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-fg-primary">{app.name}</span>
          <Badge
            variant={
              app.impact === 'high' ? 'error' : app.impact === 'medium' ? 'warning' : 'success'
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
          onClick={() => onToggle(app)}
        >
          {app.enabled ? 'Disable' : 'Enable'}
        </Button>
      </div>
    </div>
  );
});

interface DebloatRowProps {
  app: DebloatCandidate;
  checked: boolean;
  onToggle: (id: string, checked: boolean) => void;
}

const DebloatRow = React.memo(function DebloatRow({ app, checked, onToggle }: DebloatRowProps) {
  const selectable = app.installed && app.protection !== 'protected';
  return (
    <label
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
          checked={checked}
          onChange={(e) => onToggle(app.id, e.target.checked)}
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
});

const AppRow = React.memo(function AppRow({ app, uninstalling, onUninstall }: AppRowProps) {
  return (
    <div className="app-row flex items-center justify-between p-3 rounded-lg hover:bg-bg-hover">
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
        {uninstalling ? (
          <Progress indeterminate label="Uninstalling..." className="w-24" />
        ) : (
          <Button
            variant="danger"
            size="sm"
            onClick={() => onUninstall(app)}
            disabled={app.protection === 'protected'}
          >
            Uninstall
          </Button>
        )}
      </div>
    </div>
  );
});

export const Tools: React.FC<ToolsProps> = ({ onNavigate }) => {
  const [activeTab, setActiveTab] = useState<ToolTab>('apps');
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [startupApps, setStartupApps] = useState<StartupApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [debloatCatalog, setDebloatCatalog] = useState<DebloatCandidate[]>([]);
  const [selectedBloatware, setSelectedBloatware] = useState<string[]>([]);
  const [removing, setRemoving] = useState(false);
  const [debloatResult, setDebloatResult] = useState<DebloatResult | null>(null);
  const [launchingTool, setLaunchingTool] = useState<string | null>(null);
  const [toolFeedback, setToolFeedback] = useState<{ ok: boolean; message: string } | null>(null);

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
      // Fase 1.2 (SWR): cache paint first, silent revalidation after.
      const apps = await window.electronAPI.getInstalledApps();
      setInstalledApps(apps);
    } catch (error) {
      console.error('Failed to load installed apps:', error);
    } finally {
      setLoading(false);
    }
    try {
      const fresh = await window.electronAPI.getInstalledApps({ force: true });
      setInstalledApps(fresh);
    } catch (error) {
      console.error('Background apps revalidation failed:', error);
    }
  };

  const loadStartupApps = async () => {
    setLoading(true);
    try {
      // Fase 1.2 (SWR): cache paint first, silent revalidation after.
      const apps = await window.electronAPI.getStartupApps();
      setStartupApps(apps);
    } catch (error) {
      console.error('Failed to load startup apps:', error);
    } finally {
      setLoading(false);
    }
    try {
      const fresh = await window.electronAPI.getStartupApps({ force: true });
      setStartupApps(fresh);
    } catch (error) {
      console.error('Background startup revalidation failed:', error);
    }
  };

  const handleUninstall = async (app: InstalledApp) => {
    if (app.protection === 'protected') {
      if (
        !window.confirm(
          `WARNING: ${app.name} is a protected app. Are you sure you want to uninstall it?`
        )
      ) {
        return;
      }
    } else if (app.protection === 'caution') {
      if (!window.confirm(`Are you sure you want to uninstall ${app.name}?`)) {
        return;
      }
    }

    setUninstalling(app.id);

    try {
      // Fase 0.5: no cosmetic progress — the backend reports no percent, so
      // the row shows an honest indeterminate indicator until uninstallApp
      // resolves with its verified result.
      const result = await window.electronAPI.uninstallApp(app.id, app.uninstallString);

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
    setSelectedBloatware((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  const handleDebloat = async () => {
    if (selectedBloatware.length === 0) return;

    const cautionCount = debloatCatalog.filter(
      (a) => selectedBloatware.includes(a.id) && a.protection === 'caution'
    ).length;
    const cautionNote = cautionCount > 0 ? ` ${cautionCount} of them are marked "caution".` : '';
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

  const handleLaunchTool = async (id: string) => {
    setLaunchingTool(id);
    setToolFeedback(null);
    try {
      const result = await window.electronAPI.launchTool(id);
      setToolFeedback({ ok: result.success, message: result.message });
    } catch (error) {
      setToolFeedback({ ok: false, message: `Failed to open utility: ${String(error)}` });
    } finally {
      setLaunchingTool(null);
    }
  };

  const safeApps = installedApps.filter((a) => a.protection === 'safe');
  const cautionApps = installedApps.filter((a) => a.protection === 'caution');
  const protectedApps = installedApps.filter((a) => a.protection === 'protected');

  const renderAppRow = (app: InstalledApp) => (
    <AppRow app={app} uninstalling={uninstalling === app.id} onUninstall={handleUninstall} />
  );

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
            {installedApps.length > VIRTUALIZE_THRESHOLD ? (
              <VirtualList
                items={installedApps}
                estimateSize={64}
                getKey={(app) => app.id}
                renderItem={renderAppRow}
                maxHeight={384}
                testId="installed-apps"
              />
            ) : (
              <div
                className="flex flex-col gap-2 max-h-96 overflow-y-auto"
                data-testid="installed-apps"
              >
                {installedApps.map((app) => (
                  <div key={app.id}>{renderAppRow(app)}</div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'startup' && !loading && (
        <Card title="Startup Apps">
          {/* Fase 1.5: same VirtualList + threshold as Apps/Cleaner/Drivers. */}
          {startupApps.length > VIRTUALIZE_THRESHOLD ? (
            <VirtualList
              items={startupApps}
              estimateSize={64}
              getKey={(app) => app.id}
              renderItem={(app) => <StartupRow app={app} onToggle={handleToggleStartup} />}
              maxHeight={384}
              testId="startup-apps"
            />
          ) : (
            <div className="flex flex-col gap-2" data-testid="startup-apps">
              {startupApps.map((app) => (
                <StartupRow key={app.id} app={app} onToggle={handleToggleStartup} />
              ))}
            </div>
          )}
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
              Curated removable UWP packages. Protection is enforced server-side: protected apps can
              never be removed, even from here.
            </p>
            {/* Fase 1.5: same VirtualList + threshold as the other machine-grown lists. */}
            {debloatCatalog.length > VIRTUALIZE_THRESHOLD ? (
              <VirtualList
                items={debloatCatalog}
                estimateSize={64}
                getKey={(app) => app.id}
                renderItem={(app) => (
                  <DebloatRow
                    app={app}
                    checked={selectedBloatware.includes(app.id)}
                    onToggle={toggleBloatware}
                  />
                )}
                maxHeight={384}
                testId="debloat-catalog"
              />
            ) : (
              <div
                className="flex flex-col gap-2 max-h-96 overflow-y-auto"
                data-testid="debloat-catalog"
              >
                {debloatCatalog.map((app) => (
                  <DebloatRow
                    key={app.id}
                    app={app}
                    checked={selectedBloatware.includes(app.id)}
                    onToggle={toggleBloatware}
                  />
                ))}
                {debloatCatalog.length === 0 && (
                  <div className="text-sm text-fg-tertiary">Catalog unavailable.</div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'utilities' && (
        <div className="flex flex-col gap-6">
          {toolFeedback && (
            <div
              role="status"
              data-testid="tool-feedback"
              className={`p-3 rounded-lg text-sm ${
                toolFeedback.ok ? 'text-success' : 'text-error'
              }`}
            >
              {toolFeedback.message}
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-fg-secondary mb-3">In-app utilities</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {NAV_UTILITIES.map((utility) => (
                <Card key={utility.title} hoverable>
                  <div className="flex flex-col items-center text-center gap-3 p-4">
                    <span className="text-3xl">{utility.icon}</span>
                    <h3 className="text-md font-semibold text-fg-primary">{utility.title}</h3>
                    <p className="text-sm text-fg-secondary">{utility.description}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onNavigate?.(utility.target)}
                    >
                      Open
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-fg-secondary mb-3">Windows utilities</h3>
            <p className="text-xs text-fg-tertiary mb-3">
              Opens the system tool that ships with Windows. The binary is validated before
              launching and any error is reported here.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {WINDOWS_TOOLS.map((tool) => (
                <Card key={tool.id} hoverable>
                  <div className="flex flex-col items-center text-center gap-3 p-4">
                    <span className="text-3xl" aria-hidden="true">
                      {tool.icon}
                    </span>
                    <h3 className="text-md font-semibold text-fg-primary">{tool.name}</h3>
                    <p className="text-sm text-fg-secondary">{tool.description}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleLaunchTool(tool.id)}
                      loading={launchingTool === tool.id}
                      data-testid={`launch-tool-${tool.id}`}
                      title={`Open ${tool.file}`}
                    >
                      Open
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
