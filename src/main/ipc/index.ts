import type { IpcMainInvokeEvent, BrowserWindow } from 'electron';
import { ipcMain, dialog } from 'electron';
import type { BenchmarkReport, CleaningSchedule } from '@shared/types';
import { getSystemInfoThrottled } from '../services/system-info';
import { cache, withCache, type CacheOptions } from '../services/cache';
import { createProgressReporter } from '../services/scan-progress';
import {
  getTweaks,
  previewTweak,
  applyTweak,
  restoreTweak,
  applyTweaks,
  restoreTweaks,
} from '../services/tweaks';
import type { JunkScanResult } from '../services/junk-scanner';
import { scanForJunkFiles, deleteJunkFiles } from '../services/junk-scanner';
import { junkSession } from '../services/junk-cache';
import type { StartupApp } from '../services/startup-apps';
import { getStartupApps, toggleStartupApp } from '../services/startup-apps';
import type { InstalledApp } from '../services/installed-apps';
import {
  getInstalledApps,
  uninstallApp as uninstallInstalledApp,
} from '../services/installed-apps';
import { getDebloatCandidates, removeBloatware } from '../services/debloat';
import type { SystemService } from '../services/system-services';
import { getSystemServices, toggleService, setServiceStartType } from '../services/system-services';
import type { UpdateInfo } from '../services/updater';
import { checkForUpdates, downloadUpdate } from '../services/updater';
import {
  scanDrivers,
  createRestorePoint,
  installDriver,
  downloadDriverUpdate,
  rollbackDriver,
  cancelDriverOperation,
} from '../services/driver-updater';
import type { DriverInstallRequest, DriverProgressEvent } from '@shared/driver-update';
import { runNetworkFix, testConnectivity, fixError0x00000709 } from '../services/network-fixer';
import {
  checkForDrift,
  reapplyTweak,
  reapplyAllTweaks,
  getDriftStatus,
  startDriftMonitoring,
  stopDriftMonitoring,
} from '../services/drift-guard';
import { runSystemAudit } from '../services/system-audit';
import { runBenchmark, generateMarkdownReport } from '../services/benchmark';
import {
  getPrivacySettings,
  applyPrivacySetting,
  applyAllPrivacySettings,
  runSecurityAction,
  getSecurityActions,
  benchmarkDNS,
  setDNS,
} from '../services/security-privacy';
import { runSecurityScan } from '../services/security-scan';
import {
  previewSecurityFix,
  applySecurityFix,
  revertSecurityFix,
  relaunchElevated,
} from '../services/security-fix';
import {
  getAppBundles,
  checkInstalledApps,
  installApp,
  installApps,
  uninstallApp,
} from '../services/app-bundles';
import {
  getSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduleNow,
  getHistory,
  getDefaultSchedules,
} from '../services/scheduled-cleaning';
import {
  checkAllSources,
  formatReport,
  getPendingUpdates,
  formatPendingForDisplay,
} from '../source-updater';
import { importUpdates, importAllPending, rejectUpdate, rejectAllPending } from '../source-updater';
import type { PendingUpdate } from '../source-updater';
import {
  withOperationLock,
  getOperationStatus,
  setOperationNotifier,
} from '../services/operation-lock';
import { getSettings, updateSettings, getScanPreferences } from '../services/settings';
import {
  getStatsEvents,
  recordStatsEvent,
  defaultStatsFileName,
  exportStatsCsv,
} from '../services/stats';
import { launchWindowsTool } from '../services/tool-launcher';
import { cleanTempQuick, flushDns } from '../services/quick-fixes';
import { recordCleanupReceipt, retryLatestFailedDeletions } from '../services/cleanup-receipts';
import { runDiskRepair, cancelDiskRepair, isDiskRepairAdmin } from '../services/disk-repair';
import {
  previewDriverStoreCleanup,
  applyDriverStoreCleanup,
} from '../services/driver-store-cleanup';
import { getSoftwareUpdates, updateSoftwareApp } from '../services/software-updater';
import { isElevated } from '../services/security-fix';
import type { DriverStoreCandidate } from '@shared/driver-store';
import type { DiskRepairProgressEvent } from '@shared/disk-repair';
import type { AppSettings } from '@shared/settings';
import type { JunkCategory } from '../services/junk-scanner';

/**
 * Channels whose handlers mutate system state (PowerShell / winget / service
 * changes). They are serialized through the global operation lock so two
 * conflicting operations can never run at the same time (P0.3).
 * Pure reads (get/scan/check/preview/benchmark/audit) are intentionally
 * excluded to keep the UI responsive while an operation runs.
 */
export const MUTATING_CHANNELS: ReadonlySet<string> = new Set([
  'cleaner:delete',
  'cleaner:retry-failed',
  'startup:toggle',
  'apps:uninstall',
  'services:toggle',
  'services:set-start-type',
  'drivers:create-restore-point',
  'drivers:download',
  'drivers:install',
  'drivers:install-silent',
  'drivers:rollback',
  'drivers:store-clean',
  'apps:update',
  'network:fix',
  'network:fix-0x00000709',
  'drift:reapply',
  'drift:reapply-all',
  'privacy:apply-setting',
  'privacy:apply-all',
  'security:run-action',
  'security:fix-apply',
  'security:fix-revert',
  'security:relaunch-elevated',
  'dns:set',
  'bundles:install',
  'bundles:install-multiple',
  'bundles:uninstall',
  'cleaning:run-now',
  'memory:free',
  'quickfix:clean-temp',
  'quickfix:restore-point',
  'quickfix:scan-drivers',
  'network:flush-dns',
  'debloat:remove',
  'tweaks:apply',
  'tweaks:restore',
  'tweaks:apply-many',
  'tweaks:restore-many',
  'settings:update',
  'tools:launch',
  'tools:disk-repair',
  'tools:relaunch-elevated',
]);

export function registerIpcHandlers(mainWindow: BrowserWindow | null): void {
  const rawHandle = ipcMain.handle.bind(ipcMain);

  /** Register an IPC handler, wrapping mutating channels in the global lock. */
  const handle = <A extends unknown[], R>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: A) => R
  ): void => {
    if (MUTATING_CHANNELS.has(channel)) {
      rawHandle(channel, (event, ...args: A) =>
        withOperationLock(channel, () => Promise.resolve(listener(event, ...args)))
      );
    } else {
      rawHandle(channel, listener);
    }
  };

  // Push operation status changes to the renderer (global busy indicator).
  setOperationNotifier((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('system:op-changed', status);
    }
  });

  // ===== Operation status (global mutex, P0.3) =====
  handle('system:op-status', () => getOperationStatus());

  // Quick "Free RAM" (P1.1): trims this app's working set (serialized by the
  // global lock so it never interleaves with another mutating operation).
  handle('memory:free', async () => {
    const { freeMemory } = await import('../services/memory-free');
    const result = await freeMemory();
    if (result.success && result.freedMb > 0) {
      recordStatsEvent({ type: 'boost', bytes: Math.round(result.freedMb * 1024 * 1024) });
    }
    return result;
  });

  // ===== Quick fixes (Fase 3): 1-click utilities =====
  // All are serialized by the global lock so the renderer can queue/disable
  // them uniformly and no two heavy actions run at once.
  handle('quickfix:clean-temp', async () => {
    const result = await cleanTempQuick(createProgressReporter('junk'));
    if (result.deleted > 0) {
      // Only confirmed-removed files/bytes are recorded (real observation).
      recordStatsEvent({ type: 'clean', files: result.deleted, bytes: result.freedBytes });
    }
    return result;
  });
  handle('network:flush-dns', async () => {
    const result = await flushDns();
    if (result.success) recordStatsEvent({ type: 'maintenance', files: 1 });
    return result;
  });
  handle('quickfix:restore-point', async (_event: IpcMainInvokeEvent, description: string) => {
    const result = await createRestorePoint(String(description));
    if (result.success) recordStatsEvent({ type: 'maintenance', files: 1 });
    return result;
  });
  handle('quickfix:scan-drivers', async () => {
    const result = await scanDrivers(createProgressReporter('drivers'));
    recordStatsEvent({ type: 'maintenance', files: 1 });
    return result;
  });

  // System info (Fase 4.5: TTL 60s + a ~5 s single-flight throttle so the SWR
  // `force` revalidation never spams a second PowerShell process).
  handle('system:get-info', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache(
      'systemInfo',
      () =>
        getSystemInfoThrottled(createProgressReporter('system'), {
          force: options?.force === true,
        }),
      options ?? {}
    )
  );

  // Junk file scanner (Fase 4.3: per-category scan cache — a re-clean never
  // re-scans). The scan scope comes from the persisted settings (Cleaner
  // toggles + exclude paths) so there is a single source of truth.
  handle('cleaner:scan', async (_event: IpcMainInvokeEvent, options?: CacheOptions) => {
    const prefs = getScanPreferences();
    const categories: JunkCategory[] = ['cache', 'logs', 'thumbnails', 'windows-update'];
    if (prefs.scanWindowsTempFiles) categories.push('temp');
    if (prefs.scanBrowserCache) categories.push('browser-cache');
    if (prefs.scanRecycleBin) categories.push('recycle-bin');

    const scanOptions = { categories, excludePaths: prefs.excludePaths };
    const wasCached = junkSession.isCached(scanOptions);
    const result = await junkSession.scan(
      (reporter, opts) => scanForJunkFiles(reporter, opts),
      createProgressReporter('junk'),
      scanOptions,
      options?.force === true
    );
    // Only a real scan is recorded; a cache hit is not a new observation.
    if (!wasCached) {
      recordStatsEvent({ type: 'scan', bytes: result.totalSize, files: result.totalCount });
    }
    return result;
  });

  handle('cleaner:delete', async (_event: IpcMainInvokeEvent, files: string[]) => {
    const targets = Array.isArray(files) ? files : [];

    // Attribute freed bytes using the session's last scan (if still warm),
    // captured BEFORE the clean mutates the cached result.
    const lastScan = junkSession.lastResult;
    const sizeByPath = new Map<string, number>(
      (lastScan?.files ?? []).map((f) => [f.path, f.size] as const)
    );

    // `clean` removes the confirmed paths from the scan cache, so a subsequent
    // clean of the remaining files is served without re-scanning.
    const result = await junkSession.clean((paths) => deleteJunkFiles(paths), targets);

    const bytes = (result.removed ?? []).reduce((sum, p) => sum + (sizeByPath.get(p) ?? 0), 0);
    if (result.deleted > 0) {
      recordStatsEvent({ type: 'clean', files: result.deleted, bytes });
    }
    // Fase 4.6: persist a per-file cleanup receipt so the failure reasons
    // survive and a retry can target exactly the failed paths.
    if (result.receipts.length > 0) {
      await recordCleanupReceipt({
        deleted: result.deleted,
        failed: result.failed,
        receipts: result.receipts,
      });
    }
    return result;
  });

  // Fase 4.6: retry only the files that failed in the last cleanup.
  handle('cleaner:retry-failed', async () => {
    const result = await retryLatestFailedDeletions();
    // Drop the now-deleted paths from the scan cache too (a successful retry
    // must not leave stale entries behind).
    const removedPaths = result.receipts.filter((r) => r.deleted).map((r) => r.path);
    if (removedPaths.length > 0) junkSession.removePaths(removedPaths);
    return result;
  });

  // Startup apps (TTL 60s)
  handle('startup:get-apps', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('startup', () => getStartupApps(), options ?? {})
  );
  handle('startup:toggle', async (_event: IpcMainInvokeEvent, appId: string, enabled: boolean) => {
    const result = await toggleStartupApp(appId, enabled);
    cache.invalidateModule('startup');
    return result;
  });

  // Installed apps (TTL 60s)
  handle('apps:get-installed', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('apps', () => getInstalledApps(), options ?? {})
  );
  handle(
    'apps:uninstall',
    async (_event: IpcMainInvokeEvent, appId: string, uninstallString: string) => {
      const result = await uninstallInstalledApp(appId, uninstallString);
      cache.invalidateModule('apps');
      return result;
    }
  );

  // Bloatware removal (P1.4). Reads are uncached on purpose: the catalog is
  // small and `installed` flags must stay fresh while the user decides.
  handle('debloat:get-catalog', () => getDebloatCandidates());
  handle('debloat:remove', (_event: IpcMainInvokeEvent, ids: string[]) =>
    removeBloatware(Array.isArray(ids) ? ids : [])
  );

  // System services (TTL 60s)
  handle('services:get-all', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('services', () => getSystemServices(), options ?? {})
  );
  handle(
    'services:toggle',
    async (_event: IpcMainInvokeEvent, serviceId: string, enabled: boolean) => {
      const result = await toggleService(serviceId, enabled);
      cache.invalidateModule('services');
      cache.invalidateModule('health');
      return result;
    }
  );
  handle(
    'services:set-start-type',
    async (
      _event: IpcMainInvokeEvent,
      serviceId: string,
      startType: 'automatic' | 'manual' | 'disabled'
    ) => {
      const result = await setServiceStartType(serviceId, startType);
      cache.invalidateModule('services');
      cache.invalidateModule('health');
      return result;
    }
  );

  // Updater (app self-update via GitHub Releases)
  handle('updater:check', () => checkForUpdates());
  handle('updater:download', async (_event: IpcMainInvokeEvent, url: string) => {
    return downloadUpdate(url, (percent) => {
      mainWindow?.webContents.send('updater:progress', percent);
    });
  });

  // ===== Source Monitor (updates from the 4 base repositories) =====
  handle('source-updater:check', async () => {
    const report = await checkAllSources();
    return { report, formatted: formatReport(report) };
  });
  handle('source-updater:pending', () => {
    return { pending: getPendingUpdates(), formatted: formatPendingForDisplay() };
  });
  handle('source-updater:import', async (_event: IpcMainInvokeEvent, updates: PendingUpdate[]) => {
    return importUpdates(updates);
  });
  handle('source-updater:import-all', () => importAllPending());
  handle('source-updater:reject', async (_event: IpcMainInvokeEvent, updateId: string) => {
    rejectUpdate(updateId);
    return { success: true };
  });
  handle('source-updater:reject-all', () => {
    rejectAllPending();
    return { success: true };
  });

  // ===== Driver Updater (TTL 5m) =====
  const sendDriverProgress = (event: DriverProgressEvent): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('drivers:progress', event);
    }
  };

  handle('drivers:scan', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('drivers', () => scanDrivers(createProgressReporter('drivers')), options ?? {})
  );
  handle(
    'drivers:create-restore-point',
    async (_event: IpcMainInvokeEvent, description: string) => {
      return createRestorePoint(description);
    }
  );
  // Download + verify only (no install): Fase 2.3.
  handle('drivers:download', async (_event: IpcMainInvokeEvent, request: DriverInstallRequest) => {
    return downloadDriverUpdate(request);
  });
  // Full automatic pipeline: download -> verify -> silent install -> re-verify.
  handle('drivers:install', async (_event: IpcMainInvokeEvent, request: DriverInstallRequest) => {
    const result = await installDriver(request, { onProgress: sendDriverProgress });
    cache.invalidateModule('drivers');
    return result;
  });
  handle(
    'drivers:install-silent',
    async (_event: IpcMainInvokeEvent, request: DriverInstallRequest) => {
      const result = await installDriver(request, { onProgress: sendDriverProgress });
      cache.invalidateModule('drivers');
      return result;
    }
  );
  // Cancel is intentionally NOT in MUTATING_CHANNELS: it must run while the
  // install it targets holds the global lock.
  handle('drivers:cancel', async (_event: IpcMainInvokeEvent, driverId: string) => {
    const cancelled = cancelDriverOperation(driverId);
    return {
      success: cancelled,
      message: cancelled ? 'Cancellation requested.' : 'No operation is running for that driver.',
    };
  });
  handle('drivers:rollback', async (_event: IpcMainInvokeEvent, driverId: string) => {
    const result = await rollbackDriver(driverId);
    cache.invalidateModule('drivers');
    return result;
  });

  // ===== Driver Store cleanup (Fase 4.1): preview (read-only) then clean =====
  handle('drivers:store-status', async () => {
    try {
      return await isElevated();
    } catch {
      return false;
    }
  });
  handle('drivers:store-preview', () => previewDriverStoreCleanup());
  handle(
    'drivers:store-clean',
    async (_event: IpcMainInvokeEvent, candidates: DriverStoreCandidate[]) =>
      applyDriverStoreCleanup(Array.isArray(candidates) ? candidates : [])
  );

  // ===== Software updater (Fase 4.7): winget detection (read-only) + update =====
  handle('apps:check-updates', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('softwareUpdates', () => getSoftwareUpdates(), options ?? {})
  );
  handle('apps:update', async (_event: IpcMainInvokeEvent, id: string) => {
    const result = await updateSoftwareApp(String(id));
    cache.invalidateModule('softwareUpdates');
    return result;
  });

  // ===== Network Fixer =====
  handle('network:fix', () => runNetworkFix());
  handle('network:test', () => testConnectivity());
  handle('network:fix-0x00000709', () => fixError0x00000709());

  // ===== Drift Guard =====
  handle('drift:check', () => checkForDrift());
  handle('drift:reapply', async (_event: IpcMainInvokeEvent, tweakId: string) => {
    return reapplyTweak(tweakId);
  });
  handle('drift:reapply-all', () => reapplyAllTweaks());
  handle('drift:status', () => getDriftStatus());
  handle('drift:start-monitoring', () => startDriftMonitoring());
  handle('drift:stop-monitoring', () => stopDriftMonitoring());

  // ===== System Audit (TTL 30s) =====
  handle('audit:run', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache(
      'health',
      async () => {
        const report = await runSystemAudit();
        recordStatsEvent({ type: 'audit', score: report.score });
        return report;
      },
      options ?? {}
    )
  );

  // ===== Benchmark (TTL 60s; `force` bypasses after an explicit re-run) =====
  // Fase 1.4: the batched run still costs seconds cold; reuse it for 60s.
  handle('benchmark:run', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('benchmark', () => runBenchmark(), options ?? {})
  );
  handle(
    'benchmark:export-markdown',
    async (_event: IpcMainInvokeEvent, report: BenchmarkReport) => {
      return generateMarkdownReport(report);
    }
  );

  // ===== Security & Privacy =====
  // NOTE: `privacy:get-settings` must NOT share the `health` module used by
  // `audit:run` — a shared module with identical params serves one channel's
  // payload to the other, which crashed the renderer on `report.checks.filter`.
  handle('privacy:get-settings', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('privacy', () => getPrivacySettings(), options ?? {})
  );
  handle('privacy:apply-setting', async (_event: IpcMainInvokeEvent, settingId: string) => {
    const result = await applyPrivacySetting(settingId);
    cache.invalidateModule('privacy');
    // Privacy settings feed the audit's privacy checks, so the report is stale too.
    cache.invalidateModule('health');
    return result;
  });
  handle('privacy:apply-all', async () => {
    const result = await applyAllPrivacySettings();
    cache.invalidateModule('privacy');
    cache.invalidateModule('health');
    return result;
  });
  handle('security:get-actions', () => getSecurityActions());
  handle('security:run-action', async (_event: IpcMainInvokeEvent, actionId: string) => {
    const result = await runSecurityAction(actionId);
    cache.invalidateModule('health');
    return result;
  });
  // Live security scan (v0.6.0): READ-ONLY, hence not in MUTATING_CHANNELS.
  // TTL-cached for 30s; a scored run is recorded as an audit data point.
  handle('security:scan', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache(
      'security',
      async () => {
        const report = await runSecurityScan();
        if (report.score !== null) {
          recordStatsEvent({ type: 'audit', score: report.score });
        }
        return report;
      },
      options ?? {}
    )
  );
  // Reversible auto-fix (v0.7.0, extended in v0.10.0): preview is read-only;
  // apply/revert are mutating and serialized by the global lock. All four are
  // admin-gated in the service (they return `blocked` with `requires-admin`,
  // never silent).
  handle('security:fix-preview', (_event: IpcMainInvokeEvent, checkId: string) =>
    previewSecurityFix(String(checkId))
  );
  handle('security:fix-apply', async (_event: IpcMainInvokeEvent, checkId: string) => {
    const result = await applySecurityFix(String(checkId));
    cache.invalidateModule('security');
    return result;
  });
  handle('security:fix-revert', async (_event: IpcMainInvokeEvent, checkId: string) => {
    const result = await revertSecurityFix(String(checkId));
    cache.invalidateModule('security');
    return result;
  });
  handle('security:relaunch-elevated', () => relaunchElevated());

  // Fase 1.1: TTL 90s; the renderer also loads the DNS tab on demand so
  // visiting Security no longer pays the ~12s cold benchmark.
  handle('dns:benchmark', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('dns', () => benchmarkDNS(), options ?? {})
  );
  handle(
    'dns:set',
    async (_event: IpcMainInvokeEvent, primaryDNS: string, secondaryDNS: string) => {
      const result = await setDNS(primaryDNS, secondaryDNS);
      cache.invalidateModule('health');
      return result;
    }
  );

  // ===== App Bundles =====
  handle('bundles:get', () => getAppBundles());
  handle('bundles:check-installed', () => checkInstalledApps());
  handle('bundles:install', async (_event: IpcMainInvokeEvent, wingetId: string) => {
    return installApp(wingetId);
  });
  handle('bundles:install-multiple', async (_event: IpcMainInvokeEvent, wingetIds: string[]) => {
    return installApps(wingetIds);
  });
  handle('bundles:uninstall', async (_event: IpcMainInvokeEvent, wingetId: string) => {
    return uninstallApp(wingetId);
  });

  // ===== Scheduled Cleaning =====
  handle('cleaning:get-schedules', () => getSchedules());
  handle('cleaning:get-default-schedules', () => getDefaultSchedules());
  handle(
    'cleaning:create-schedule',
    async (_event: IpcMainInvokeEvent, schedule: CleaningSchedule) => {
      return createSchedule(schedule);
    }
  );
  handle(
    'cleaning:update-schedule',
    async (_event: IpcMainInvokeEvent, id: string, updates: Partial<CleaningSchedule>) => {
      return updateSchedule(id, updates);
    }
  );
  handle('cleaning:delete-schedule', async (_event: IpcMainInvokeEvent, id: string) => {
    return deleteSchedule(id);
  });
  handle('cleaning:run-now', async (_event: IpcMainInvokeEvent, id: string) => {
    return runScheduleNow(id);
  });
  handle('cleaning:get-history', () => getHistory());

  // ===== Cache control =====
  handle('cache:clear', () => {
    cache.clear();
    return { success: true };
  });

  // ===== Settings (single source of truth in main) =====
  handle('settings:get', () => getSettings());
  handle('settings:update', (_event: IpcMainInvokeEvent, patch: Partial<AppSettings>) => {
    const result = updateSettings(patch ?? {});
    // A settings change may toggle the tray (window behaviour) or the
    // automatic-update schedule; apply both immediately. Imported lazily so the
    // heavy electron-updater/tray modules stay out of the base IPC graph.
    void import('../window-behavior').then(({ refreshWindowBehavior }) => refreshWindowBehavior());
    void import('../updater').then(({ syncAutoUpdateSchedule }) => syncAutoUpdateSchedule());
    return result;
  });

  // ===== Usage statistics =====
  handle('stats:get', () => getStatsEvents());
  handle('stats:export', async () => {
    const options = {
      title: 'Export statistics as CSV',
      defaultPath: defaultStatsFileName(),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { success: false, message: 'Export canceled.' };
    }
    return exportStatsCsv(result.filePath);
  });

  // ===== Background updater (electron-updater) =====
  // Imported lazily: `electron-updater` is heavy and must stay out of the base
  // IPC graph (and out of unit tests that register handlers with a bare mock).
  const updater = () => import('../updater');
  handle('updater:status', async () => (await updater()).getUpdateStatus());
  handle('updater:check-now', async () => {
    const mod = await updater();
    mod.checkForUpdatesManually();
    return mod.getUpdateStatus();
  });
  handle('updater:download-now', async () => {
    const mod = await updater();
    await mod.downloadUpdateNow();
    return mod.getUpdateStatus();
  });
  handle('updater:install-now', async () => {
    const mod = await updater();
    mod.quitAndInstallUpdate();
    return { success: true };
  });

  // ===== Windows utilities =====
  handle('tools:launch', (_event: IpcMainInvokeEvent, id: string) => launchWindowsTool(String(id)));

  // ===== Disk repair (Fase 4.9) =====
  const sendDiskRepairProgress = (event: DiskRepairProgressEvent): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tools:disk-repair-progress', event);
    }
  };
  handle('tools:disk-repair-status', () => isDiskRepairAdmin());
  handle('tools:disk-repair', async (_event: IpcMainInvokeEvent, toolId: string) => {
    const result = await runDiskRepair(String(toolId), { onProgress: sendDiskRepairProgress });
    // Record the attempt when the tool actually ran to completion.
    if (result.status === 'completed') {
      recordStatsEvent({ type: 'maintenance', files: 1 });
    }
    return result;
  });
  // Cancel is intentionally NOT in MUTATING_CHANNELS: it must run while the
  // repair it targets holds the global lock.
  handle('tools:disk-repair-cancel', () => {
    const cancelled = cancelDiskRepair();
    return {
      success: cancelled,
      message: cancelled ? 'Cancellation requested.' : 'No repair is running.',
    };
  });
  handle('tools:relaunch-elevated', () => relaunchElevated());

  // ===== Safe Tweaks (P2) =====
  handle('tweaks:get', () => getTweaks());
  handle('tweaks:preview', (_event: IpcMainInvokeEvent, id: string) => previewTweak(id));
  handle('tweaks:apply', async (_event: IpcMainInvokeEvent, id: string) => {
    const result = await applyTweak(id);
    cache.invalidateModule('health');
    return result;
  });
  handle('tweaks:restore', async (_event: IpcMainInvokeEvent, id: string) => {
    const result = await restoreTweak(id);
    cache.invalidateModule('health');
    return result;
  });
  handle('tweaks:apply-many', async (_event: IpcMainInvokeEvent, ids: string[]) => {
    const result = await applyTweaks(ids);
    cache.invalidateModule('health');
    return result;
  });
  handle('tweaks:restore-many', async (_event: IpcMainInvokeEvent, ids: string[]) => {
    const result = await restoreTweaks(ids);
    cache.invalidateModule('health');
    return result;
  });
}

export type { JunkScanResult, StartupApp, InstalledApp, SystemService, UpdateInfo };
