import { globalShortcut } from 'electron';
import { logger } from './logger';

export interface Shortcut {
  accelerator: string;
  action: () => void;
  description: string;
}

const shortcuts: Shortcut[] = [
  { accelerator: 'Ctrl+1', action: () => {}, description: 'Go to Dashboard' },
  { accelerator: 'Ctrl+2', action: () => {}, description: 'Go to Cleaner' },
  { accelerator: 'Ctrl+3', action: () => {}, description: 'Go to Boost' },
  { accelerator: 'Ctrl+4', action: () => {}, description: 'Go to Tools' },
  { accelerator: 'Ctrl+5', action: () => {}, description: 'Go to Security' },
  { accelerator: 'Ctrl+6', action: () => {}, description: 'Go to Statistics' },
  { accelerator: 'Ctrl+7', action: () => {}, description: 'Go to Settings' },
  { accelerator: 'Ctrl+R', action: () => {}, description: 'Refresh current page' },
  { accelerator: 'Ctrl+D', action: () => {}, description: 'Toggle theme' },
  { accelerator: 'Ctrl+L', action: () => {}, description: 'Change language' },
  { accelerator: 'F1', action: () => {}, description: 'Open help' },
];

export function registerShortcuts(): void {
  for (const shortcut of shortcuts) {
    try {
      globalShortcut.register(shortcut.accelerator, () => {
        logger.info(`Shortcut triggered: ${shortcut.accelerator}`);
        shortcut.action();
      });
    } catch (error) {
      logger.warn(`Failed to register shortcut: ${shortcut.accelerator}`, error);
    }
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}

export function getShortcuts(): Shortcut[] {
  return shortcuts;
}
