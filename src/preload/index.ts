import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const api = {
  // System
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),

  // Cleaner
  scanForJunkFiles: () => ipcRenderer.invoke('cleaner:scan'),
  deleteFiles: (files: string[]) => ipcRenderer.invoke('cleaner:delete', files),

  // Startup apps
  getStartupApps: () => ipcRenderer.invoke('startup:get-apps'),
  toggleStartupApp: (appId: string, enabled: boolean) =>
    ipcRenderer.invoke('startup:toggle', appId, enabled),

  // Installed apps
  getInstalledApps: () => ipcRenderer.invoke('apps:get-installed'),
  uninstallApp: (appId: string, uninstallString: string) =>
    ipcRenderer.invoke('apps:uninstall', appId, uninstallString),

  // System services
  getSystemServices: () => ipcRenderer.invoke('services:get-all'),
  toggleService: (serviceId: string, enabled: boolean) =>
    ipcRenderer.invoke('services:toggle', serviceId, enabled),
  setServiceStartType: (serviceId: string, startType: 'automatic' | 'manual' | 'disabled') =>
    ipcRenderer.invoke('services:set-start-type', serviceId, startType),

  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: (url: string) => ipcRenderer.invoke('updater:download', url),

  // Events
  onUpdateAvailable: (callback: (info: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, info: unknown) => callback(info);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onUpdateProgress: (callback: (percent: number) => void) => {
    const handler = (_event: IpcRendererEvent, percent: number) => callback(percent);
    ipcRenderer.on('updater:progress', handler);
    return () => ipcRenderer.removeListener('updater:progress', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
