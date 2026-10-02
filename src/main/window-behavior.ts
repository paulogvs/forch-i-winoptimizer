import { app, type BrowserWindow, type Event } from 'electron';
import { getSettings } from './services/settings';
import { createTray, destroyTray } from './tray';

let mainWindow: BrowserWindow | null = null;
let quitting = false;

/**
 * Intercept window close so "Minimize to tray on close" works, and let the
 * tray "Quit" action (or app shutdown) close for real.
 */
export function setBehaviorWindow(window: BrowserWindow | null): void {
  mainWindow = window;
  if (!window) return;

  window.on('close', (event: Event) => {
    if (quitting) return;
    if (getSettings().settings.minimizeToTrayOnClose) {
      event.preventDefault();
      window.hide();
    }
  });
}

export function beginQuit(): void {
  quitting = true;
}

export function isQuitting(): boolean {
  return quitting;
}

/** Keep the tray in sync with the current setting. */
export function refreshWindowBehavior(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    destroyTray();
    return;
  }

  if (getSettings().settings.minimizeToTrayOnClose) {
    createTray(mainWindow, () => {
      beginQuit();
      app.quit();
    });
  } else {
    destroyTray();
  }
}
