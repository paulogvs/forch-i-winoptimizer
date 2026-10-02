import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc';
import { setupAutoUpdater } from './updater';
import { WINDOW_BACKGROUND } from '../shared/theme';
import { registerWindowControls, attachWindowStateEvents } from './window-controls';
import { setProgressSender } from './services/scan-progress';
import { setBehaviorWindow, refreshWindowBehavior, beginQuit } from './window-behavior';
import { destroyTray } from './tray';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: WINDOW_BACKGROUND,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load the dev server URL in development, or the built files in production
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Window controls (P0.1): forward native maximize/unmaximize to the renderer.
  attachWindowStateEvents(mainWindow);

  // Close-to-tray + tray icon, driven by the persisted setting.
  setBehaviorWindow(mainWindow);
  refreshWindowBehavior();

  // Scan progress (P0.3): stream stage/percent events to this window.
  setProgressSender((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan:progress', event);
    }
  });

  mainWindow.on('closed', () => {
    setProgressSender(null);
    setBehaviorWindow(null);
    destroyTray();
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerWindowControls();
  // Create the window first so IPC closures capture a live reference.
  createWindow();
  registerIpcHandlers(mainWindow);
  setupAutoUpdater(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// A real quit (tray menu, Ctrl+Q, updater install) must let the window close.
app.on('before-quit', () => {
  beginQuit();
});

// Security: prevent new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});
