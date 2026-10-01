import { BrowserWindow, ipcMain } from 'electron';

/**
 * Register the frameless-window controls (P0.1).
 *
 * Every handler resolves the *invoking* window via `BrowserWindow.fromWebContents`
 * instead of relying on a module-level reference, so it stays correct even after
 * reopen (`activate`) or with multiple windows.
 */
export function registerWindowControls(): void {
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window:maximize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.maximize();
  });

  ipcMain.handle('window:unmaximize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.unmaximize();
  });

  ipcMain.handle('window:isMaximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

/**
 * Forward native maximize/unmaximize events to the renderer so the Maximize
 * button can toggle its icon (including when the user double-clicks the drag
 * region or uses the OS shortcut).
 */
export function attachWindowStateEvents(win: BrowserWindow): void {
  const notify = (channel: string) => () => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel);
    }
  };

  win.on('maximize', notify('window:maximized'));
  win.on('unmaximize', notify('window:unmaximized'));
}
