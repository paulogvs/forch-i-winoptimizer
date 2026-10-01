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

export function registerIpcHandlers(mainWindow: BrowserWindow | null): void {
  // System info (TTL 60s; `force` bypasses after an explicit Refresh)
  ipcMain.handle('system:get-info', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('systemInfo', () => getSystemInfo(createProgressReporter('system')), options ?? {})
  );

  // Junk file scanner (TTL 30s)
  ipcMain.handle('cleaner:scan', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('junk', () => scanForJunkFiles(createProgressReporter('junk')), options ?? {})
  );

  ipcMain.handle('cleaner:delete', async (_event: IpcMainInvokeEvent, files: string[]) => {
    const result = await deleteJunkFiles(files);
    cache.invalidateModule('junk');
    return result;
  });

  // Startup apps (TTL 60s)
  ipcMain.handle('startup:get-apps', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('startup', () => getStartupApps(), options ?? {})
  );
  ipcMain.handle('startup:toggle', async (_event: IpcMainInvokeEvent, appId: string, enabled: boolean) => {
    const result = await toggleStartupApp(appId, enabled);
    cache.invalidateModule('startup');
    return result;
  });

  // Installed apps (TTL 60s)
  ipcMain.handle('apps:get-installed', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('apps', () => getInstalledApps(), options ?? {})
  );
  ipcMain.handle('apps:uninstall', async (_event: IpcMainInvokeEvent, appId: string, uninstallString: string) => {
    const result = await uninstallInstalledApp(appId, uninstallString);
    cache.invalidateModule('apps');
    return result;
  });

  // System services (TTL 60s)
  ipcMain.handle('services:get-all', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('services', () => getSystemServices(), options ?? {})
  );
  ipcMain.handle('services:toggle', async (_event: IpcMainInvokeEvent, serviceId: string, enabled: boolean) => {
    const result = await toggleService(serviceId, enabled);
    cache.invalidateModule('services');
    cache.invalidateModule('health');
    return result;
  });
  ipcMain.handle('services:set-start-type', async (_event: IpcMainInvokeEvent, serviceId: string, startType: 'automatic' | 'manual' | 'disabled') => {
    const result = await setServiceStartType(serviceId, startType);
    cache.invalidateModule('services');
    cache.invalidateModule('health');
    return result;
  });

  // Updater (app self-update via GitHub Releases)
  ipcMain.handle('updater:check', () => checkForUpdates());
  ipcMain.handle('updater:download', async (_event: IpcMainInvokeEvent, url: string) => {
    return downloadUpdate(url, (percent) => {
      mainWindow?.webContents.send('updater:progress', percent);
    });
  });

  // ===== Source Monitor (updates from the 4 base repositories) =====
  ipcMain.handle('source-updater:check', async () => {
    const report = await checkAllSources();
    return { report, formatted: formatReport(report) };
  });
  ipcMain.handle('source-updater:pending', () => {
    return { pending: getPendingUpdates(), formatted: formatPendingForDisplay() };
  });
  ipcMain.handle('source-updater:import', async (_event: IpcMainInvokeEvent, updates: PendingUpdate[]) => {
    return importUpdates(updates);
  });
  ipcMain.handle('source-updater:import-all', () => importAllPending());
  ipcMain.handle('source-updater:reject', async (_event: IpcMainInvokeEvent, updateId: string) => {
    rejectUpdate(updateId);
    return { success: true };
  });
  ipcMain.handle('source-updater:reject-all', () => {
    rejectAllPending();
    return { success: true };
  });

  // ===== Driver Updater (TTL 5m) =====
  ipcMain.handle('drivers:scan', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('drivers', () => scanDrivers(createProgressReporter('drivers')), options ?? {})
  );
  ipcMain.handle('drivers:create-restore-point', async (_event: IpcMainInvokeEvent, description: string) => {
    return createRestorePoint(description);
  });
  ipcMain.handle('drivers:install', async (_event: IpcMainInvokeEvent, driverId: string, downloadUrl: string) => {
    const result = await installDriver(driverId, downloadUrl);
    cache.invalidateModule('drivers');
    return result;
  });
  ipcMain.handle('drivers:rollback', async (_event: IpcMainInvokeEvent, driverId: string) => {
    const result = await rollbackDriver(driverId);
    cache.invalidateModule('drivers');
    return result;
  });

  // ===== Network Fixer =====
  ipcMain.handle('network:fix', () => runNetworkFix());
  ipcMain.handle('network:test', () => testConnectivity());
  ipcMain.handle('network:fix-0x00000709', () => fixError0x00000709());

  // ===== Drift Guard =====
  ipcMain.handle('drift:check', () => checkForDrift());
  ipcMain.handle('drift:reapply', async (_event: IpcMainInvokeEvent, tweakId: string) => {
    return reapplyTweak(tweakId);
  });
  ipcMain.handle('drift:reapply-all', () => reapplyAllTweaks());
  ipcMain.handle('drift:status', () => getDriftStatus());
  ipcMain.handle('drift:start-monitoring', () => startDriftMonitoring());
  ipcMain.handle('drift:stop-monitoring', () => stopDriftMonitoring());

  // ===== System Audit (TTL 30s) =====
  ipcMain.handle('audit:run', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('health', () => runSystemAudit(), options ?? {})
  );

  // ===== Benchmark =====
  ipcMain.handle('benchmark:run', () => runBenchmark());
  ipcMain.handle('benchmark:export-markdown', async (_event: IpcMainInvokeEvent, report: BenchmarkReport) => {
    return generateMarkdownReport(report);
  });

  // ===== Security & Privacy =====
  ipcMain.handle('privacy:get-settings', (_event: IpcMainInvokeEvent, options?: CacheOptions) =>
    withCache('health', () => getPrivacySettings(), options ?? {})
  );
  ipcMain.handle('privacy:apply-setting', async (_event: IpcMainInvokeEvent, settingId: string) => {
    const result = await applyPrivacySetting(settingId);
    cache.invalidateModule('health');
    return result;
  });
  ipcMain.handle('privacy:apply-all', async () => {
    const result = await applyAllPrivacySettings();
    cache.invalidateModule('health');
    return result;
  });
  ipcMain.handle('security:get-actions', () => getSecurityActions());
  ipcMain.handle('security:run-action', async (_event: IpcMainInvokeEvent, actionId: string) => {
    const result = await runSecurityAction(actionId);
    cache.invalidateModule('health');
    return result;
  });
  ipcMain.handle('dns:benchmark', () => benchmarkDNS());
  ipcMain.handle('dns:set', async (_event: IpcMainInvokeEvent, primaryDNS: string, secondaryDNS: string) => {
    const result = await setDNS(primaryDNS, secondaryDNS);
    cache.invalidateModule('health');
    return result;
  });

  // ===== App Bundles =====
  ipcMain.handle('bundles:get', () => getAppBundles());
  ipcMain.handle('bundles:check-installed', () => checkInstalledApps());
  ipcMain.handle('bundles:install', async (_event: IpcMainInvokeEvent, wingetId: string) => {
    return installApp(wingetId);
  });
  ipcMain.handle('bundles:install-multiple', async (_event: IpcMainInvokeEvent, wingetIds: string[]) => {
    return installApps(wingetIds);
  });
  ipcMain.handle('bundles:uninstall', async (_event: IpcMainInvokeEvent, wingetId: string) => {
    return uninstallApp(wingetId);
  });

  // ===== Scheduled Cleaning =====
  ipcMain.handle('cleaning:get-schedules', () => getSchedules());
  ipcMain.handle('cleaning:get-default-schedules', () => getDefaultSchedules());
  ipcMain.handle('cleaning:create-schedule', async (_event: IpcMainInvokeEvent, schedule: CleaningSchedule) => {
    return createSchedule(schedule);
  });
  ipcMain.handle('cleaning:update-schedule', async (_event: IpcMainInvokeEvent, id: string, updates: Partial<CleaningSchedule>) => {
    return updateSchedule(id, updates);
  });
  ipcMain.handle('cleaning:delete-schedule', async (_event: IpcMainInvokeEvent, id: string) => {
    return deleteSchedule(id);
  });
  ipcMain.handle('cleaning:run-now', async (_event: IpcMainInvokeEvent, id: string) => {
    return runScheduleNow(id);
  });
  ipcMain.handle('cleaning:get-history', () => getHistory());

  // ===== Cache control =====
  ipcMain.handle('cache:clear', () => {
    cache.clear();
    return { success: true };
  });

  // ===== Safe Tweaks (P2) =====
  ipcMain.handle('tweaks:get', () => getTweaks());
  ipcMain.handle('tweaks:preview', (_event: IpcMainInvokeEvent, id: string) => previewTweak(id));
  ipcMain.handle('tweaks:apply', async (_event: IpcMainInvokeEvent, id: string) => {
    const result = await applyTweak(id);
    cache.invalidateModule('health');
    return result;
  });
  ipcMain.handle('tweaks:restore', async (_event: IpcMainInvokeEvent, id: string) => {
    const result = await restoreTweak(id);
    cache.invalidateModule('health');
    return result;
  });
  ipcMain.handle('tweaks:apply-many', async (_event: IpcMainInvokeEvent, ids: string[]) => {
    const result = await applyTweaks(ids);
    cache.invalidateModule('health');
    return result;
  });
  ipcMain.handle('tweaks:restore-many', async (_event: IpcMainInvokeEvent, ids: string[]) => {
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
