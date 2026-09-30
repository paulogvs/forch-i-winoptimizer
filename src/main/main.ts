import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { checkAllSources } from '../../updater/check-updates';
import { importUpdates, importAllPending, rejectUpdate, rejectAllPending } from '../../updater/import-updates';
import { formatReport, formatPendingForDisplay, getPendingUpdates } from '../../updater/update-report';
import { loadLocalCatalog } from '../../updater/diff-catalogs';
import { PendingUpdate } from '../../updater/types';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'FORCH.iA WinOptimizer',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('updater:check', async () => {
  const report = await checkAllSources();
  return { report, formatted: formatReport(report) };
});

ipcMain.handle('updater:import', async (_event, updates: PendingUpdate[]) => {
  const result = await importUpdates(updates);
  return result;
});

ipcMain.handle('updater:import-all', async () => {
  const result = await importAllPending();
  return result;
});

ipcMain.handle('updater:reject', async (_event, updateId: string) => {
  rejectUpdate(updateId);
  return { success: true };
});

ipcMain.handle('updater:reject-all', async () => {
  rejectAllPending();
  return { success: true };
});

ipcMain.handle('updater:pending', () => {
  return { pending: getPendingUpdates(), formatted: formatPendingForDisplay() };
});

ipcMain.handle('catalog:load', (_event, catalogName: string) => {
  return loadLocalCatalog(catalogName);
});

ipcMain.handle('dialog:confirm', async (_event, options: { title: string; message: string; detail?: string }) => {
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    buttons: ['Cancelar', 'Confirmar'],
    defaultId: 1,
    cancelId: 0,
    title: options.title,
    message: options.message,
    ...(options.detail !== undefined && { detail: options.detail }),
  });
  return result.response === 1;
});

ipcMain.handle('dialog:info', async (_event, options: { title: string; message: string }) => {
  await dialog.showMessageBox(mainWindow!, {
    type: 'info',
    buttons: ['OK'],
    title: options.title,
    message: options.message,
  });
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
