import { contextBridge, ipcRenderer } from 'electron';

const api = {
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    import: (updates: any[]) => ipcRenderer.invoke('updater:import', updates),
    importAll: () => ipcRenderer.invoke('updater:import-all'),
    reject: (updateId: string) => ipcRenderer.invoke('updater:reject', updateId),
    rejectAll: () => ipcRenderer.invoke('updater:reject-all'),
    pending: () => ipcRenderer.invoke('updater:pending'),
  },
  catalog: {
    load: (name: string) => ipcRenderer.invoke('catalog:load', name),
  },
  dialog: {
    confirm: (options: { title: string; message: string; detail?: string }) =>
      ipcRenderer.invoke('dialog:confirm', options),
    info: (options: { title: string; message: string }) =>
      ipcRenderer.invoke('dialog:info', options),
  },
};

contextBridge.exposeInMainWorld('winoptimizer', api);

export type WinOptimizerAPI = typeof api;
