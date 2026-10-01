import type { BrowserWindow} from 'electron';
import { dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

export function setupAutoUpdater(mainWindow: BrowserWindow | null): void {
  // Configure auto-updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Check for updates on startup
  autoUpdater.checkForUpdatesAndNotify();

  // Check for updates every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000);

  // Event: Update available
  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} is available. Would you like to download it now?`,
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  // Event: Update not available
  autoUpdater.on('update-not-available', () => {
    // No action needed
  });

  // Event: Download progress
  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow?.webContents.send('updater:progress', progressObj.percent);
  });

  // Event: Update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded. The app will restart to install the update.`,
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  // Event: Error
  autoUpdater.on('error', (error) => {
    console.error('Auto-updater error:', error);
  });
}

export function checkForUpdatesManually(): void {
  autoUpdater.checkForUpdates();
}
