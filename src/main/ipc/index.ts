import type { IpcMainInvokeEvent, BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import type { BenchmarkReport, CleaningSchedule } from '@shared/types';
import { getSystemInfo } from '../services/system-info';
import { cache, withCache, type CacheOptions } from '../services/cache';
import { createProgressReporter } from '../services/scan-progress';
import { getTweaks, previewTweak, applyTweak, restoreTweak, applyTweaks, restoreTweaks } from '../services/tweaks';
import type { JunkScanResult } from '../services/junk-scanner';
import { scanForJunkFiles, deleteJunkFiles } from '../services/junk-scanner';
import type { StartupApp } from '../services/startup-apps';
import { getStartupApps, toggleStartupApp } from '../services/startup-apps';
import type { InstalledApp } from '../services/installed-apps';
import { getInstalledApps, uninstallApp as uninstallInstalledApp } from '../services/installed-apps';
import { getDebloatCandidates, removeBloatware } from '../services/debloat';
import type { SystemService } from '../services/system-services';
import { getSystemServices, toggleService, setServiceStartType } from '../services/system-services';
import type { UpdateInfo } from '../services/updater';
import { checkForUpdates, downloadUpdate } from '../services/updater';
import { scanDrivers, createRestorePoint, installDriver, rollbackDriver } from '../services/driver-updater';
import { runNetworkFix, testConnectivity, fixError0x00000709 } from '../services/network-fixer';
import { checkForDrift, reapplyTweak, reapplyAllTweaks, getDriftStatus, startDriftMonitoring, stopDriftMonitoring } from '../services/drift-guard';
import { runSystemAudit } from '../services/system-audit';
import { runBenchmark, generateMarkdownReport } from '../services/benchmark';
import { getPrivacySettings, applyPrivacySetting, applyAllPrivacySettings, runSecurityAction, getSecurityActions, benchmarkDNS, setDNS } from '../services/security-privacy';
import { getAppBundles, checkInstalledApps, installApp, installApps, uninstallApp } from '../services/app-bundles';
import { getSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow, getHistory, getDefaultSchedules } from '../services/scheduled-cleaning';
import { checkAllSources, formatReport, getPendingUpdates, formatPendingForDisplay } from '../source-updater';
import { importUpdates, importAllPending, rejectUpdate, rejectAllPending } from '../source-updater';
import type { PendingUpdate } from '../source-updater';
import { withOperationLock, getOperationStatus, setOperationNotifier } from '../services/operation-lock';

/**
 * Channels whose handlers mutate system state (PowerShell / winget / service
 * changes). They are serialized through the global operation lock so two
 * conflicting operations can never run at the same time (P0.3).
 * Pure reads (get/scan/check/preview/benchmark/audit) are intentionally
 * excluded to keep the UI responsive while an operation runs.
 */
export const MUTATING_CHANNELS: ReadonlySet<string> = new Set([
  'cleaner:delete',
  'startup:toggle',
  'apps:uninstall',
  'services:toggle',
  'services:set-start-type',
  'drivers:create-restore-point',
  'drivers:install',
  'drivers:rollback',
  'network:fix',
  'network:fix-0x00000709',
  'drift:reapply',
  'drift:reapply-all',
  'privacy:apply-setting',
  'privacy:apply-all',
  'security:run-action',
  'dns:set',
  'bundles:install',
  'bundles:install-multiple',
  'bundles:uninstall',
  'cleaning:run-now',
  'memory:free',
  'debloat:remove',
  'tweaks:apply',
  'tweaks:restore',
  'tweaks:apply-many',
  'tweaks:restore-many',
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
    return freeMemory();
  });

  // System info (TTL 60s; `force` bypasses after an explicit Refresh)
  handle('system:get-info', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('systemInfo', () => getSystemInfo(createProgressReporter('system')), options ?? {})
  );

  // Junk file scanner (TTL 30s)
  handle('cleaner:scan', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('junk', () => scanForJunkFiles(createProgressReporter('junk')), options ?? {})
  );

  handle('cleaner:delete', async (_event: IpcMainInvokeEvent, files: string[]) => {
    const result = await deleteJunkFiles(files);
    cache.invalidateModule('junk');
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
  handle('apps:uninstall', async (_event: IpcMainInvokeEvent, appId: string, uninstallString: string) => {
    const result = await uninstallInstalledApp(appId, uninstallString);
    cache.invalidateModule('apps');
    return result;
  });

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
  handle('services:toggle', async (_event: IpcMainInvokeEvent, serviceId: string, enabled: boolean) => {
    const result = await toggleService(serviceId, enabled);
    cache.invalidateModule('services');
    cache.invalidateModule('health');
    return result;
  });
  handle('services:set-start-type', async (_event: IpcMainInvokeEvent, serviceId: string, startType: 'automatic' | 'manual' | 'disabled') => {
    const result = await setServiceStartType(serviceId, startType);
    cache.invalidateModule('services');
    cache.invalidateModule('health');
    return result;
  });

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
  handle('drivers:scan', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('drivers', () => scanDrivers(createProgressReporter('drivers')), options ?? {})
  );
  handle('drivers:create-restore-point', async (_event: IpcMainInvokeEvent, description: string) => {
    return createRestorePoint(description);
  });
  handle('drivers:install', async (_event: IpcMainInvokeEvent, driverId: string, downloadUrl: string) => {
    const result = await installDriver(driverId, downloadUrl);
    cache.invalidateModule('drivers');
    return result;
  });
  handle('drivers:rollback', async (_event: IpcMainInvokeEvent, driverId: string) => {
    const result = await rollbackDriver(driverId);
    cache.invalidateModule('drivers');
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
    withCache('health', () => runSystemAudit(), options ?? {})
  );

  // ===== Benchmark =====
  handle('benchmark:run', () => runBenchmark());
  handle('benchmark:export-markdown', async (_event: IpcMainInvokeEvent, report: BenchmarkReport) => {
    return generateMarkdownReport(report);
  });

  // ===== Security & Privacy =====
  handle('privacy:get-settings', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('health', () => getPrivacySettings(), options ?? {})
  );
  handle('privacy:apply-setting', async (_event: IpcMainInvokeEvent, settingId: string) => {
    const result = await applyPrivacySetting(settingId);
    cache.invalidateModule('health');
    return result;
  });
  handle('privacy:apply-all', async () => {
    const result = await applyAllPrivacySettings();
    cache.invalidateModule('health');
    return result;
  });
  handle('security:get-actions', () => getSecurityActions());
  handle('security:run-action', async (_event: IpcMainInvokeEvent, actionId: string) => {
    const result = await runSecurityAction(actionId);
    cache.invalidateModule('health');
    return result;
  });
  handle('dns:benchmark', () => benchmarkDNS());
  handle('dns:set', async (_event: IpcMainInvokeEvent, primaryDNS: string, secondaryDNS: string) => {
    const result = await setDNS(primaryDNS, secondaryDNS);
    cache.invalidateModule('health');
    return result;
  });

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
  handle('cleaning:create-schedule', async (_event: IpcMainInvokeEvent, schedule: CleaningSchedule) => {
    return createSchedule(schedule);
  });
  handle('cleaning:update-schedule', async (_event: IpcMainInvokeEvent, id: string, updates: Partial<CleaningSchedule>) => {
    return updateSchedule(id, updates);
  });
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

export type {
  JunkScanResult,
  StartupApp,
  InstalledApp,
  SystemService,
  UpdateInfo,
};
