import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import { getSystemInfo } from '../services/system-info';
import { scanForJunkFiles, deleteJunkFiles, JunkScanResult } from '../services/junk-scanner';
import { getStartupApps, toggleStartupApp, StartupApp } from '../services/startup-apps';
import { getInstalledApps, uninstallApp as uninstallInstalledApp, InstalledApp } from '../services/installed-apps';
import { getSystemServices, toggleService, setServiceStartType, SystemService } from '../services/system-services';
import { checkForUpdates, downloadUpdate, UpdateInfo } from '../services/updater';
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
  // System info
  ipcMain.handle('system:get-info', () => getSystemInfo());

  // Junk file scanner
  ipcMain.handle('cleaner:scan', async (_event: IpcMainInvokeEvent) => {
    return scanForJunkFiles();
  });

  ipcMain.handle('cleaner:delete', async (_event: IpcMainInvokeEvent, files: string[]) => {
    return deleteJunkFiles(files);
  });

  // Startup apps
  ipcMain.handle('startup:get-apps', () => getStartupApps());
  ipcMain.handle('startup:toggle', async (_event: IpcMainInvokeEvent, appId: string, enabled: boolean) => {
    return toggleStartupApp(appId, enabled);
  });

  // Installed apps
  ipcMain.handle('apps:get-installed', () => getInstalledApps());
  ipcMain.handle('apps:uninstall', async (_event: IpcMainInvokeEvent, appId: string, uninstallString: string) => {
    return uninstallInstalledApp(appId, uninstallString);
  });

  // System services
  ipcMain.handle('services:get-all', () => getSystemServices());
  ipcMain.handle('services:toggle', async (_event: IpcMainInvokeEvent, serviceId: string, enabled: boolean) => {
    return toggleService(serviceId, enabled);
  });
  ipcMain.handle('services:set-start-type', async (_event: IpcMainInvokeEvent, serviceId: string, startType: 'automatic' | 'manual' | 'disabled') => {
    return setServiceStartType(serviceId, startType);
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

  // ===== Driver Updater =====
  ipcMain.handle('drivers:scan', () => scanDrivers());
  ipcMain.handle('drivers:create-restore-point', async (_event: IpcMainInvokeEvent, description: string) => {
    return createRestorePoint(description);
  });
  ipcMain.handle('drivers:install', async (_event: IpcMainInvokeEvent, driverId: string, downloadUrl: string) => {
    return installDriver(driverId, downloadUrl);
  });
  ipcMain.handle('drivers:rollback', async (_event: IpcMainInvokeEvent, driverId: string) => {
    return rollbackDriver(driverId);
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

  // ===== System Audit =====
  ipcMain.handle('audit:run', () => runSystemAudit());

  // ===== Benchmark =====
  ipcMain.handle('benchmark:run', () => runBenchmark());
  ipcMain.handle('benchmark:export-markdown', async (_event: IpcMainInvokeEvent, report: any) => {
    return generateMarkdownReport(report);
  });

  // ===== Security & Privacy =====
  ipcMain.handle('privacy:get-settings', () => getPrivacySettings());
  ipcMain.handle('privacy:apply-setting', async (_event: IpcMainInvokeEvent, settingId: string) => {
    return applyPrivacySetting(settingId);
  });
  ipcMain.handle('privacy:apply-all', () => applyAllPrivacySettings());
  ipcMain.handle('security:get-actions', () => getSecurityActions());
  ipcMain.handle('security:run-action', async (_event: IpcMainInvokeEvent, actionId: string) => {
    return runSecurityAction(actionId);
  });
  ipcMain.handle('dns:benchmark', () => benchmarkDNS());
  ipcMain.handle('dns:set', async (_event: IpcMainInvokeEvent, primaryDNS: string, secondaryDNS: string) => {
    return setDNS(primaryDNS, secondaryDNS);
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
  ipcMain.handle('cleaning:create-schedule', async (_event: IpcMainInvokeEvent, schedule: any) => {
    return createSchedule(schedule);
  });
  ipcMain.handle('cleaning:update-schedule', async (_event: IpcMainInvokeEvent, id: string, updates: any) => {
    return updateSchedule(id, updates);
  });
  ipcMain.handle('cleaning:delete-schedule', async (_event: IpcMainInvokeEvent, id: string) => {
    return deleteSchedule(id);
  });
  ipcMain.handle('cleaning:run-now', async (_event: IpcMainInvokeEvent, id: string) => {
    return runScheduleNow(id);
  });
  ipcMain.handle('cleaning:get-history', () => getHistory());
}

export type {
  JunkScanResult,
  StartupApp,
  InstalledApp,
  SystemService,
  UpdateInfo,
};
