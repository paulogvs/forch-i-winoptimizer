import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { getSystemInfo } from '../services/system-info';
import { scanForJunkFiles, JunkScanResult } from '../services/junk-scanner';
import { getStartupApps, StartupApp } from '../services/startup-apps';
import { getInstalledApps, InstalledApp } from '../services/installed-apps';
import { getSystemServices, SystemService } from '../services/system-services';
import { checkForUpdates, UpdateInfo } from '../services/updater';

export function registerIpcHandlers(): void {
  // System info
  ipcMain.handle('system:get-info', () => getSystemInfo());

  // Junk file scanner
  ipcMain.handle('cleaner:scan', async (_event: IpcMainInvokeEvent) => {
    return scanForJunkFiles();
  });

  ipcMain.handle('cleaner:delete', async (_event: IpcMainInvokeEvent, files: string[]) => {
    // TODO: Implement actual file deletion with safety checks
    console.log('[IPC] Deleting files:', files);
    return { success: true, deleted: files.length };
  });

  // Startup apps
  ipcMain.handle('startup:get-apps', () => getStartupApps());
  ipcMain.handle('startup:toggle', (_event: IpcMainInvokeEvent, appId: string, enabled: boolean) => {
    console.log('[IPC] Toggling startup app:', appId, enabled);
    return { success: true };
  });

  // Installed apps
  ipcMain.handle('apps:get-installed', () => getInstalledApps());
  ipcMain.handle('apps:uninstall', (_event: IpcMainInvokeEvent, appId: string) => {
    console.log('[IPC] Uninstalling app:', appId);
    return { success: true };
  });

  // System services
  ipcMain.handle('services:get-all', () => getSystemServices());
  ipcMain.handle('services:toggle', (_event: IpcMainInvokeEvent, serviceId: string, enabled: boolean) => {
    console.log('[IPC] Toggling service:', serviceId, enabled);
    return { success: true };
  });

  // Updater
  ipcMain.handle('updater:check', () => checkForUpdates());
  ipcMain.handle('updater:download', (_event: IpcMainInvokeEvent, url: string) => {
    console.log('[IPC] Downloading update from:', url);
    return { success: true };
  });
}

export type {
  JunkScanResult,
  StartupApp,
  InstalledApp,
  SystemService,
  UpdateInfo,
};
