import { Menu, Tray, nativeImage, app, type BrowserWindow } from 'electron';
import * as path from 'path';

let tray: Tray | null = null;

/** The packaged icon lives inside `assets/**` (included by the builder). */
function trayIconPath(): string {
  return path.join(app.getAppPath(), 'assets', 'icons', 'icon.ico');
}

function buildTray(win: BrowserWindow, onQuit: () => void): Tray {
  const image = nativeImage.createFromPath(trayIconPath());
  const created = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  created.setToolTip('FORCH.iA WinOptimizer');
  created.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show FORCH.iA WinOptimizer',
        click: () => {
          win.show();
          win.focus();
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: onQuit },
    ])
  );
  created.on('double-click', () => {
    win.show();
    win.focus();
  });
  return created;
}

export function createTray(win: BrowserWindow, onQuit: () => void): void {
  if (tray) return;
  try {
    tray = buildTray(win, onQuit);
  } catch {
    // A tray may be unavailable (e.g. some Linux desktops); degrade quietly.
    tray = null;
  }
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

export function hasTray(): boolean {
  return tray !== null;
}
