import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import { getSystemInfo } from '../services/system-info';
import { scanForJunkFiles, deleteJunkFiles, JunkScanResult } from '../services/junk-scanner';
import { getStartupApps, toggleStartupApp, StartupApp } from '../services/startup-apps';
import { getInstalledApps, uninstallApp, InstalledApp } from '../services/installed-apps';
import { getSystemServices, toggleService, setServiceStartType, SystemService } from '../services/system-services';
import { checkForUpdates, downloadUpdate, UpdateInfo } from '../services/updater';

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
    return uninstallApp(appId, uninstallString);
  });

  // System services
  ipcMain.handle('services:get-all', () => getSystemServices());
  ipcMain.handle('services:toggle', async (_event: IpcMainInvokeEvent, serviceId: string, enabled: boolean) => {
    return toggleService(serviceId, enabled);
  });
  ipcMain.handle('services:set-start-type', async (_event: IpcMainInvokeEvent, serviceId: string, startType: 'automatic' | 'manual' | 'disabled') => {
    return setServiceStartType(serviceId, startType);
  });

  // Updater
  ipcMain.handle('updater:check', () => checkForUpdates());
  ipcMain.handle('updater:download', async (_event: IpcMainInvokeEvent, url: string) => {
    return downloadUpdate(url, (percent) => {
      mainWindow?.webContents.send('updater:progress', percent);
    });
  });
}

export type {
  JunkScanResult,
  StartupApp,
  InstalledApp,
  SystemService,
  UpdateInfo,
};
