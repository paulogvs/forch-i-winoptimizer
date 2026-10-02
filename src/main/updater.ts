import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { automaticUpdatesEnabled } from './services/settings';
import type { UpdateStatus } from '@shared/updater-status';

export type { UpdateStatus, UpdateStatusState } from '@shared/updater-status';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let targetWindow: BrowserWindow | null = null;
let interval: NodeJS.Timeout | null = null;
let configured = false;
let lastStatus: UpdateStatus = { state: 'idle', version: null, percent: null, message: null };

function emit(status: UpdateStatus): void {
  lastStatus = status;
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('updater:status', status);
  }
}

/** Last status emitted by the background updater (for IPC reads). */
export function getUpdateStatus(): UpdateStatus {
  return lastStatus;
}

/**
 * Wire the electron-updater event stream and start (or stop) the background
 * check based on the "Automatic updates" setting. Safe to call more than once;
 * the event listeners are only registered the first time.
 */
export function setupAutoUpdater(mainWindow: BrowserWindow | null): void {
  targetWindow = mainWindow;

  if (configured) {
    syncAutoUpdateSchedule();
    return;
  }
  configured = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    emit({ state: 'checking', version: null, percent: null, message: null });
  });

  autoUpdater.on('update-available', (info) => {
    // The renderer owns the "download" decision (Settings → Updates shows the
    // status and a Download button). Do not auto-download here.
    emit({
      state: 'available',
      version: info.version,
      percent: null,
      message: `Version ${info.version} is available.`,
    });
  });

  autoUpdater.on('update-not-available', () => {
    emit({ state: 'not-available', version: null, percent: null, message: null });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    emit({
      state: 'downloading',
      version: null,
      percent: Math.round(progressObj.percent),
      message: null,
    });
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('updater:progress', progressObj.percent);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    emit({
      state: 'downloaded',
      version: info.version,
      percent: 100,
      message: `Version ${info.version} is ready to install.`,
    });

    if (!targetWindow || targetWindow.isDestroyed()) return;
    void dialog
      .showMessageBox(targetWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded. The app will restart to install the update.`,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (error) => {
    emit({
      state: 'error',
      version: null,
      percent: null,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  emit({ state: 'idle', version: null, percent: null, message: null });
  syncAutoUpdateSchedule();
}

/** Re-evaluate the automatic check schedule after the setting changes. */
export function syncAutoUpdateSchedule(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }

  if (!automaticUpdatesEnabled()) return;

  void autoUpdater.checkForUpdates().catch(() => {
    /* surfaced through the 'error' event */
  });

  interval = setInterval(() => {
    if (!automaticUpdatesEnabled()) {
      syncAutoUpdateSchedule();
      return;
    }
    void autoUpdater.checkForUpdates().catch(() => {
      /* surfaced through the 'error' event */
    });
  }, CHECK_INTERVAL_MS);
}

export function checkForUpdatesManually(): void {
  void autoUpdater.checkForUpdates().catch(() => {
    /* surfaced through the 'error' event */
  });
}

/**
 * Download the pending update (progress and completion arrive through the
 * `updater:status` / `updater:progress` events). Only valid when the updater
 * reported `available`.
 */
export async function downloadUpdateNow(): Promise<void> {
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    emit({
      state: 'error',
      version: lastStatus.version,
      percent: null,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Quit and install the already-downloaded update. */
export function quitAndInstallUpdate(): void {
  autoUpdater.quitAndInstall();
}

/** Update the window reference (e.g. after a window is recreated). */
export function setUpdateWindow(mainWindow: BrowserWindow | null): void {
  targetWindow = mainWindow;
}
