import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { VirtualList } from '../components/ui/VirtualList';
import { QuickFixBar } from '../components/QuickFixBar';
import { formatBytes } from '../utils/format';
import { WINDOWS_TOOLS } from '@shared/windows-tools';
import { DISK_REPAIR_TOOLS } from '@shared/disk-repair';
import type { DiskRepairProgressEvent, DiskRepairResult } from '@shared/disk-repair';
import type {
  DebloatCandidate,
  DebloatResult,
  InstalledApp,
  StartupApp,
} from '@shared/electron-api';
import type { SoftwareUpdateReport, UpdateSeverity } from '@shared/software-update';
import type { DriverStoreCleanResult, DriverStorePreview } from '@shared/driver-store';
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

/** Substantive severity colours for the software-updater list. */
const SEVERITY_VARIANT: Record<UpdateSeverity, 'error' | 'warning' | 'info' | 'neutral'> = {
  major: 'error',
  minor: 'warning',
  patch: 'info',
  unknown: 'neutral',
};

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
  // B3 (v0.18.0): search + per-category select-all + explicit post verification.
  const [debloatQuery, setDebloatQuery] = useState('');
  const [debloatVerifiedAt, setDebloatVerifiedAt] = useState<string | null>(null);
  const [launchingTool, setLaunchingTool] = useState<string | null>(null);
  const [toolFeedback, setToolFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  // Disk repair (Fase 4.9): live output + real result.
  const [repairToolId, setRepairToolId] = useState<string | null>(null);
  const [repairLines, setRepairLines] = useState<string[]>([]);
  const [repairPercent, setRepairPercent] = useState<number | null>(null);
  const [repairResult, setRepairResult] = useState<DiskRepairResult | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  // Software updater (Fase 4.7): winget detection + update.
  const [updatesReport, setUpdatesReport] = useState<SoftwareUpdateReport | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatesNote, setUpdatesNote] = useState<string | null>(null);
  // Driver Store cleanup (Fase 4.1): preview -> clean.
  const [storePreview, setStorePreview] = useState<DriverStorePreview | null>(null);
  const [storeBusy, setStoreBusy] = useState(false);
  const [storeResult, setStoreResult] = useState<DriverStoreCleanResult | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);

  useEffect(() => {
    const repairApi = window.electronAPI?.diskRepair;
    if (!repairApi) return undefined;
    return repairApi.onProgress((event: DiskRepairProgressEvent) => {
      setRepairLines((prev) => [...prev.slice(-199), event.line]);
      if (event.percent !== null) setRepairPercent(event.percent);
    });
  }, []);

  useEffect(() => {
    if (activeTab === 'apps') {
      loadInstalledApps();
    } else if (activeTab === 'startup') {
      loadStartupApps();
    } else if (activeTab === 'debloat') {
      setDebloatResult(null);
      setSelectedBloatware([]);
      setDebloatQuery('');
      setDebloatVerifiedAt(null);
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

  // B3: the visible rows after the search filter (name, id or description).
  const debloatFiltered = debloatQuery.trim()
    ? debloatCatalog.filter((a) => {
        const q = debloatQuery.trim().toLowerCase();
        return (
          a.name.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q)
        );
      })
    : debloatCatalog;

  // B3: group the visible rows by catalog category (fixed taxonomy first,
  // then any other category in first-seen order, so fixtures keep working).
  const DEBLOAT_CATEGORY_ORDER = [
    'entertainment',
    'social',
    'gaming',
    'productivity',
    'utilities',
    'system',
  ];
  const debloatGroups: { category: string; apps: DebloatCandidate[] }[] = [];
  for (const app of debloatFiltered) {
    const group = debloatGroups.find((g) => g.category === app.category);
    if (group) group.apps.push(app);
    else debloatGroups.push({ category: app.category, apps: [app] });
  }
  debloatGroups.sort((a, b) => {
    const ia = DEBLOAT_CATEGORY_ORDER.indexOf(a.category);
    const ib = DEBLOAT_CATEGORY_ORDER.indexOf(b.category);
    return (
      (ia === -1 ? DEBLOAT_CATEGORY_ORDER.length : ia) -
      (ib === -1 ? DEBLOAT_CATEGORY_ORDER.length : ib)
    );
  });

  const isDebloatSelectable = (app: DebloatCandidate) =>
    app.installed && app.protection !== 'protected';

  const selectCategoryAll = (category: string) => {
    const ids = debloatFiltered
      .filter((a) => a.category === category && isDebloatSelectable(a))
      .map((a) => a.id);
    setSelectedBloatware((prev) => [...prev.filter((id) => !ids.includes(id)), ...ids]);
  };

  const clearCategory = (category: string) => {
    const ids = new Set(debloatCatalog.filter((a) => a.category === category).map((a) => a.id));
    setSelectedBloatware((prev) => prev.filter((id) => !ids.has(id)));
  };

  const selectedEntries = debloatCatalog.filter((a) => selectedBloatware.includes(a.id));

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
    setDebloatVerifiedAt(null);
    try {
      const result = await window.electronAPI.removeBloatware(selectedBloatware);
      setDebloatResult(result);
      setSelectedBloatware([]);
      await loadDebloatCatalog();
      // Post verification: the catalog above was re-read from a fresh
      // Get-AppxPackage query, so installed flags reflect the removal.
      setDebloatVerifiedAt(new Date().toLocaleTimeString());
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

  const handleDiskRepair = async (id: string) => {
    const tool = DISK_REPAIR_TOOLS.find((t) => t.id === id);
    if (!tool) return;
    const scope = tool.modifiesSystem
      ? 'This MODIFIES system state.'
      : 'This is read-only and does not change your files.';
    const interrupt = tool.cancellable
      ? 'You can cancel it safely.'
      : 'It cannot be interrupted safely — do not close the app while it runs.';
    const confirmed = window.confirm(
      `Run ${tool.name}?\n\n${tool.whatItDoes}\n\nRequires administrator rights. Estimated time: ${tool.estimatedDuration}. ${scope} ${interrupt}`
    );
    if (!confirmed) return;

    setRepairToolId(id);
    setRepairLines([]);
    setRepairPercent(null);
    setRepairResult(null);
    setRepairError(null);
    try {
      const result = await window.electronAPI.diskRepair.run(id);
      setRepairResult(result);
    } catch (error) {
      setRepairError(`Disk repair failed to start: ${String(error)}`);
    } finally {
      setRepairToolId(null);
    }
  };

  const handleCancelRepair = async () => {
    try {
      await window.electronAPI.diskRepair.cancel();
    } catch (error) {
      setRepairError(`Could not cancel: ${String(error)}`);
    }
  };

  const handleRelaunchElevated = async () => {
    try {
      const result = await window.electronAPI.diskRepair.relaunchElevated();
      setToolFeedback({ ok: result.success, message: result.message });
    } catch (error) {
      setToolFeedback({ ok: false, message: `Could not relaunch elevated: ${String(error)}` });
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setUpdatesNote(null);
    try {
      const report = await window.winoptimizer.softwareUpdates.check({ force: true });
      setUpdatesReport(report);
    } catch (error) {
      setUpdatesReport({
        success: false,
        status: 'unavailable',
        updates: [],
        count: 0,
        message: `Could not check for updates: ${String(error)}`,
        scannedAt: new Date().toISOString(),
      });
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUpdateApp = async (id: string, name: string) => {
    if (!window.confirm(`Update ${name} (${id}) now?`)) return;
    setUpdatingId(id);
    setUpdatesNote(null);
    try {
      const result = await window.winoptimizer.softwareUpdates.update(id);
      setUpdatesNote(result.message);
      const report = await window.winoptimizer.softwareUpdates.check({ force: true });
      setUpdatesReport(report);
    } catch (error) {
      setUpdatesNote(`Update failed: ${String(error)}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleStorePreview = async () => {
    setStoreBusy(true);
    setStoreResult(null);
    setStoreError(null);
    try {
      setStorePreview(await window.winoptimizer.driverStore.preview());
    } catch (error) {
      setStoreError(`Driver Store scan failed: ${String(error)}`);
    } finally {
      setStoreBusy(false);
    }
  };

  const handleStoreClean = async () => {
    if (!storePreview || storePreview.candidates.length === 0) return;
    const summary = `Remove ${storePreview.candidates.length} superseded driver package(s) (~${formatBytes(
      storePreview.reclaimableBytes
    )})? This cannot be undone.`;
    if (!window.confirm(summary)) return;
    setStoreBusy(true);
    setStoreError(null);
    try {
      const result = await window.winoptimizer.driverStore.clean(storePreview.candidates);
      setStoreResult(result);
      setStorePreview(await window.winoptimizer.driverStore.preview());
    } catch (error) {
      setStoreError(`Driver Store cleanup failed: ${String(error)}`);
    } finally {
      setStoreBusy(false);
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
            title="Software updates"
            footer={
              <Button
                variant="secondary"
                size="sm"
                loading={checkingUpdates}
                onClick={handleCheckUpdates}
                data-testid="check-updates"
              >
                Check for updates
              </Button>
            }
          >
            <p className="text-xs text-fg-tertiary mb-3">
              Updates detected with the Windows Package Manager (winget). Detection is read-only; an
              empty answer is shown as “cannot confirm”, never as “up to date”.
            </p>
            {updatesNote && (
              <div role="status" className="mb-2 text-xs text-fg-secondary">
                {updatesNote}
              </div>
            )}
            {updatesReport && (
              <div data-testid="software-updates">
                <div className="flex items-center gap-2 mb-2">
                  <Badge
                    variant={
                      updatesReport.status === 'ok'
                        ? 'info'
                        : updatesReport.status === 'up-to-date'
                          ? 'success'
                          : 'warning'
                    }
                  >
                    {updatesReport.status}
                  </Badge>
                  <span className="text-xs text-fg-tertiary">{updatesReport.message}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {updatesReport.updates.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-bg-hover"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-fg-primary">{u.name || u.id}</span>
                          <Badge variant={SEVERITY_VARIANT[u.severity]}>{u.severity}</Badge>
                        </div>
                        <div className="text-xs text-fg-tertiary truncate">
                          {u.currentVersion} → {u.availableVersion}
                          {u.source ? ` · ${u.source}` : ''}
                        </div>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={updatingId === u.id}
                        disabled={updatingId !== null}
                        onClick={() => handleUpdateApp(u.id, u.name || u.id)}
                        data-testid={`update-app-${u.id}`}
                      >
                        Update
                      </Button>
                    </div>
                  ))}
                  {updatesReport.updates.length === 0 && updatesReport.status === 'ok' && (
                    <div className="text-sm text-fg-tertiary">No updates available.</div>
                  )}
                </div>
              </div>
            )}
          </Card>
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

          {/* B3: per-app receipt of what the removal actually did. */}
          {debloatResult && debloatResult.results.length > 0 && (
            <Card title="Removal receipt">
              <div className="flex flex-col gap-2" data-testid="debloat-receipt">
                {debloatResult.results.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-fg-primary truncate">{r.id}</span>
                    <span className="flex items-center gap-2">
                      <Badge
                        variant={
                          r.status === 'removed'
                            ? 'success'
                            : r.status === 'skipped'
                              ? 'neutral'
                              : r.status === 'protected'
                                ? 'error'
                                : 'warning'
                        }
                      >
                        {r.status}
                      </Badge>
                      {r.error && (
                        <span className="text-fg-tertiary truncate max-w-48">{r.error}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              {debloatVerifiedAt && (
                <p className="text-xs text-fg-tertiary mt-3" data-testid="debloat-verify">
                  Post-check: catalog re-read from Get-AppxPackage at {debloatVerifiedAt} —{' '}
                  {debloatCatalog.filter((a) => a.installed).length} installed of{' '}
                  {debloatCatalog.length} cataloged.
                </p>
              )}
            </Card>
          )}

          {/* B3: pre-removal summary — what is about to be removed, with the
              caution warnings spelled out, before the confirmation runs. */}
          {selectedEntries.length > 0 && (
            <Card title={`Planned removal (${selectedEntries.length})`}>
              <div className="flex flex-col gap-2" data-testid="debloat-summary">
                {selectedEntries.map((a) => (
                  <div key={a.id} className="text-xs">
                    <span className="text-fg-primary font-medium">{a.name}</span>
                    {a.protection === 'caution' && (
                      <span className="text-fg-tertiary"> — {a.description}</span>
                    )}
                  </div>
                ))}
                <p className="text-xs text-fg-tertiary mt-1">
                  Protected apps are never removed, even from here.
                </p>
              </div>
            </Card>
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
            <div className="mb-3">
              <input
                type="search"
                placeholder="Search apps..."
                aria-label="Search bloatware"
                data-testid="debloat-search"
                className="w-full px-3 py-2 rounded-lg bg-bg-input text-sm text-fg-primary border border-border"
                value={debloatQuery}
                onChange={(e) => setDebloatQuery(e.target.value)}
              />
            </div>
            {/* B3: grouped by catalog category so select-all/clear is per
                category. The catalog is bounded (~tens of curated rows), so a
                flat virtualizer would hide the group headers; the machine-grown
                lists (Apps/Startup/Cleaner/Drivers) keep VirtualList. */}
            <div
              className="flex flex-col gap-4 max-h-96 overflow-y-auto"
              data-testid="debloat-catalog"
            >
              {debloatGroups.map((group) => {
                const selectable = group.apps.filter(isDebloatSelectable);
                const selectedInGroup = group.apps.filter((a) =>
                  selectedBloatware.includes(a.id)
                ).length;
                return (
                  <div key={group.category}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-fg-secondary capitalize">
                          {group.category}
                        </span>
                        <Badge variant="neutral">
                          {selectedInGroup}/{selectable.length} selected
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid={`debloat-select-all-${group.category}`}
                          disabled={selectable.length === 0}
                          onClick={() => selectCategoryAll(group.category)}
                        >
                          Select all
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid={`debloat-clear-${group.category}`}
                          disabled={selectedInGroup === 0}
                          onClick={() => clearCategory(group.category)}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      {group.apps.map((app) => (
                        <DebloatRow
                          key={app.id}
                          app={app}
                          checked={selectedBloatware.includes(app.id)}
                          onToggle={toggleBloatware}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {debloatFiltered.length === 0 && (
                <div className="text-sm text-fg-tertiary">
                  {debloatCatalog.length === 0
                    ? 'Catalog unavailable.'
                    : 'No apps match the search.'}
                </div>
              )}
            </div>
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
            <h3 className="text-sm font-semibold text-fg-secondary mb-3">Quick fixes</h3>
            <p className="text-xs text-fg-tertiary mb-3">
              One-click maintenance that runs for real and reports the verified result. Actions are
              queued through the global operation lock, so they never run two at a time.
            </p>
            <QuickFixBar onNavigate={onNavigate} />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-fg-secondary mb-3">Driver Store cleanup</h3>
            <p className="text-xs text-fg-tertiary mb-3">
              Removes only SUPERSEDED driver packages (an older version replaced by a newer one for
              the same vendor INF). Virtual drivers (Tailscale/Wintun/WireGuard/Hyper-V) and drivers
              currently in use are never touched. Preview first; a post-clean re-scan confirms each
              removal. Requires administrator rights.
            </p>
            <Card>
              <div className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleStorePreview}
                    loading={storeBusy}
                    disabled={storeBusy}
                    data-testid="driver-store-preview"
                  >
                    Scan for superseded drivers
                  </Button>
                  {storePreview?.status === 'requires-admin' && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleRelaunchElevated}
                      data-testid="driver-store-relaunch"
                    >
                      Restart as administrator
                    </Button>
                  )}
                  {storePreview?.canApply && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={handleStoreClean}
                      loading={storeBusy}
                      disabled={storeBusy}
                      data-testid="driver-store-clean"
                    >
                      Remove {storePreview.reclaimableCount} package(s)
                    </Button>
                  )}
                </div>
                {storeError && (
                  <div role="alert" className="text-sm text-error">
                    {storeError}
                  </div>
                )}
                {storePreview && (
                  <div data-testid="driver-store-result" className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={storePreview.status === 'ok' ? 'success' : 'warning'}>
                        {storePreview.status}
                      </Badge>
                      <span className="text-xs text-fg-tertiary">
                        {storePreview.totalPackages} package(s) · {storePreview.reclaimableCount}{' '}
                        superseded · {formatBytes(storePreview.reclaimableBytes)} reclaimable
                      </span>
                    </div>
                    <p className="text-xs text-fg-secondary">{storePreview.message}</p>
                    {storePreview.candidates.map((candidate) => (
                      <div
                        key={candidate.publishedName}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="text-fg-primary truncate">
                          {candidate.provider} · {candidate.originalName} ({candidate.publishedName}
                          )
                        </span>
                        <span className="text-fg-tertiary whitespace-nowrap">
                          {candidate.version} → {candidate.supersededBy.version}
                          {candidate.sizeBytes ? ` · ${formatBytes(candidate.sizeBytes)}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {storeResult && (
                  <div
                    role="status"
                    className={`text-sm ${storeResult.success ? 'text-success' : 'text-error'}`}
                    data-testid="driver-store-clean-result"
                  >
                    {storeResult.message}
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-fg-secondary mb-3">Disk repair</h3>
            <p className="text-xs text-fg-tertiary mb-3">
              Real Windows repair tools with live output and real results. Every one requires
              administrator rights and asks for confirmation first. If the app is not elevated, use
              “Restart as administrator”.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {DISK_REPAIR_TOOLS.map((tool) => {
                const running = repairToolId === tool.id;
                return (
                  <Card key={tool.id}>
                    <div className="flex flex-col gap-3 p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl" aria-hidden="true">
                          {tool.icon}
                        </span>
                        <h4 className="text-md font-semibold text-fg-primary">{tool.name}</h4>
                      </div>
                      <p className="text-sm text-fg-secondary">{tool.description}</p>
                      <p className="text-xs text-fg-tertiary font-mono break-all">{tool.command}</p>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={tool.modifiesSystem ? 'warning' : 'success'}>
                          {tool.modifiesSystem ? 'modifies system' : 'read-only'}
                        </Badge>
                        <Badge variant="neutral">{tool.estimatedDuration}</Badge>
                        <Badge variant="info">admin</Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleDiskRepair(tool.id)}
                          loading={running}
                          disabled={repairToolId !== null}
                          data-testid={`disk-repair-${tool.id}`}
                        >
                          Run
                        </Button>
                        {running && tool.cancellable && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={handleCancelRepair}
                            data-testid={`disk-repair-cancel-${tool.id}`}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            {repairError && (
              <div role="alert" className="mt-4 p-3 rounded-lg text-sm text-error">
                {repairError}
              </div>
            )}

            {(repairToolId !== null || repairResult !== null || repairLines.length > 0) && (
              <div
                className="mt-4"
                role="status"
                aria-live="polite"
                data-testid="disk-repair-output"
              >
                {repairToolId !== null && (
                  <Progress
                    indeterminate={repairPercent === null}
                    value={repairPercent ?? 0}
                    label={repairPercent === null ? 'Running...' : `${repairPercent}%`}
                  />
                )}
                {repairResult && (
                  <div
                    className={`mt-3 p-3 rounded-lg text-sm ${
                      repairResult.success ? 'text-success' : 'text-error'
                    }`}
                  >
                    <div data-testid="disk-repair-summary">{repairResult.summary}</div>
                    {repairResult.status === 'requires-admin' && (
                      <Button
                        variant="primary"
                        size="sm"
                        className="mt-2"
                        onClick={handleRelaunchElevated}
                        data-testid="disk-repair-relaunch"
                      >
                        Restart as administrator
                      </Button>
                    )}
                  </div>
                )}
                <pre className="mt-3 max-h-48 overflow-auto text-xs font-mono text-fg-tertiary whitespace-pre-wrap">
                  {repairLines.join('\n')}
                </pre>
              </div>
            )}
          </div>

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
