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

  // Source Monitor (pull updates from the 4 base repositories)
  sourceUpdater: {
    check: () => ipcRenderer.invoke('source-updater:check'),
    pending: () => ipcRenderer.invoke('source-updater:pending'),
    import: (updates: unknown[]) => ipcRenderer.invoke('source-updater:import', updates),
    importAll: () => ipcRenderer.invoke('source-updater:import-all'),
    reject: (updateId: string) => ipcRenderer.invoke('source-updater:reject', updateId),
    rejectAll: () => ipcRenderer.invoke('source-updater:reject-all'),
  },

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

// Namespaced API used by the advanced feature pages (Drivers, Network, Audit,
// Benchmark, Security & Privacy, App Bundles, Scheduled Cleaning).
const winoptimizer = {
  drivers: {
    scan: () => ipcRenderer.invoke('drivers:scan'),
    createRestorePoint: (description: string) => ipcRenderer.invoke('drivers:create-restore-point', description),
    install: (driverId: string, downloadUrl: string) => ipcRenderer.invoke('drivers:install', driverId, downloadUrl),
    rollback: (driverId: string) => ipcRenderer.invoke('drivers:rollback', driverId),
  },
  network: {
    fix: () => ipcRenderer.invoke('network:fix'),
    test: () => ipcRenderer.invoke('network:test'),
    fixError0x00000709: () => ipcRenderer.invoke('network:fix-0x00000709'),
  },
  drift: {
    check: () => ipcRenderer.invoke('drift:check'),
    reapply: (tweakId: string) => ipcRenderer.invoke('drift:reapply', tweakId),
    reapplyAll: () => ipcRenderer.invoke('drift:reapply-all'),
    status: () => ipcRenderer.invoke('drift:status'),
    startMonitoring: () => ipcRenderer.invoke('drift:start-monitoring'),
    stopMonitoring: () => ipcRenderer.invoke('drift:stop-monitoring'),
  },
  audit: {
    run: () => ipcRenderer.invoke('audit:run'),
  },
  benchmark: {
    run: () => ipcRenderer.invoke('benchmark:run'),
    exportMarkdown: (report: unknown) => ipcRenderer.invoke('benchmark:export-markdown', report),
  },
  privacy: {
    getSettings: () => ipcRenderer.invoke('privacy:get-settings'),
    applySetting: (settingId: string) => ipcRenderer.invoke('privacy:apply-setting', settingId),
    applyAll: () => ipcRenderer.invoke('privacy:apply-all'),
  },
  security: {
    getActions: () => ipcRenderer.invoke('security:get-actions'),
    runAction: (actionId: string) => ipcRenderer.invoke('security:run-action', actionId),
  },
  dns: {
    benchmark: () => ipcRenderer.invoke('dns:benchmark'),
    set: (primaryDNS: string, secondaryDNS: string) => ipcRenderer.invoke('dns:set', primaryDNS, secondaryDNS),
  },
  bundles: {
    get: () => ipcRenderer.invoke('bundles:get'),
    checkInstalled: () => ipcRenderer.invoke('bundles:check-installed'),
    install: (wingetId: string) => ipcRenderer.invoke('bundles:install', wingetId),
    installMultiple: (wingetIds: string[]) => ipcRenderer.invoke('bundles:install-multiple', wingetIds),
    uninstall: (wingetId: string) => ipcRenderer.invoke('bundles:uninstall', wingetId),
  },
  cleaning: {
    getSchedules: () => ipcRenderer.invoke('cleaning:get-schedules'),
    getDefaultSchedules: () => ipcRenderer.invoke('cleaning:get-default-schedules'),
    createSchedule: (schedule: unknown) => ipcRenderer.invoke('cleaning:create-schedule', schedule),
    updateSchedule: (id: string, updates: unknown) => ipcRenderer.invoke('cleaning:update-schedule', id, updates),
    deleteSchedule: (id: string) => ipcRenderer.invoke('cleaning:delete-schedule', id),
    runNow: (id: string) => ipcRenderer.invoke('cleaning:run-now', id),
    getHistory: () => ipcRenderer.invoke('cleaning:get-history'),
  },
  sourceUpdater: {
    check: () => ipcRenderer.invoke('source-updater:check'),
    pending: () => ipcRenderer.invoke('source-updater:pending'),
    import: (updates: unknown[]) => ipcRenderer.invoke('source-updater:import', updates),
    importAll: () => ipcRenderer.invoke('source-updater:import-all'),
    reject: (updateId: string) => ipcRenderer.invoke('source-updater:reject', updateId),
    rejectAll: () => ipcRenderer.invoke('source-updater:reject-all'),
  },
};

contextBridge.exposeInMainWorld('winoptimizer', winoptimizer);

export type ElectronAPI = typeof api;
export type WinOptimizerAPI = typeof winoptimizer;
