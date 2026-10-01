import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { ElectronAPI, WinOptimizerAPI, OperationStatus } from '../shared/electron-api';
import type { ScanProgressEvent } from '../shared/scan-progress';
import type { TweakApplyResult, TweakPreview, TweakView } from '../shared/tweaks';

const api: ElectronAPI = {
  // System
  getSystemInfo: (options) => ipcRenderer.invoke('system:get-info', options),

  // Cleaner
  scanForJunkFiles: (options) => ipcRenderer.invoke('cleaner:scan', options),
  deleteFiles: (files: string[]) => ipcRenderer.invoke('cleaner:delete', files),

  // Startup apps
  getStartupApps: (options) => ipcRenderer.invoke('startup:get-apps', options),
  toggleStartupApp: (appId: string, enabled: boolean) =>
    ipcRenderer.invoke('startup:toggle', appId, enabled),

  // Installed apps
  getInstalledApps: (options) => ipcRenderer.invoke('apps:get-installed', options),
  uninstallApp: (appId: string, uninstallString: string) =>
    ipcRenderer.invoke('apps:uninstall', appId, uninstallString),

  // System services
  getSystemServices: (options) => ipcRenderer.invoke('services:get-all', options),
  toggleService: (serviceId: string, enabled: boolean) =>
    ipcRenderer.invoke('services:toggle', serviceId, enabled),
  setServiceStartType: (serviceId: string, startType: 'automatic' | 'manual' | 'disabled') =>
    ipcRenderer.invoke('services:set-start-type', serviceId, startType),

  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: (url: string) => ipcRenderer.invoke('updater:download', url),

  // Window controls (P0.1)
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    unmaximize: () => ipcRenderer.invoke('window:unmaximize'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    close: () => ipcRenderer.invoke('window:close'),
    onMaximized: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('window:maximized', handler);
      return () => ipcRenderer.removeListener('window:maximized', handler);
    },
    onUnmaximized: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('window:unmaximized', handler);
      return () => ipcRenderer.removeListener('window:unmaximized', handler);
    },
  },

  // Scan progress (P0.3)
  onScanProgress: (callback: (event: ScanProgressEvent) => void) => {
    const handler = (_event: IpcRendererEvent, payload: ScanProgressEvent) => callback(payload);
    ipcRenderer.on('scan:progress', handler);
    return () => ipcRenderer.removeListener('scan:progress', handler);
  },

  // Global operation lock (P0.3)
  getOperationStatus: () => ipcRenderer.invoke('system:op-status'),
  onOperationStatus: (callback: (status: OperationStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: OperationStatus) => callback(status);
    ipcRenderer.on('system:op-changed', handler);
    return () => ipcRenderer.removeListener('system:op-changed', handler);
  },

  // Cache control (P1.2)
  clearCache: () => ipcRenderer.invoke('cache:clear'),

  // Events
  onUpdateProgress: (callback: (percent: number) => void) => {
    const handler = (_event: IpcRendererEvent, percent: number) => callback(percent);
    ipcRenderer.on('updater:progress', handler);
    return () => ipcRenderer.removeListener('updater:progress', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

// Namespaced API used by the advanced feature pages (Drivers, Network, Audit,
// Benchmark, Security & Privacy, App Bundles, Scheduled Cleaning, Tweaks).
const winoptimizer: WinOptimizerAPI = {
  drivers: {
    scan: (options) => ipcRenderer.invoke('drivers:scan', options),
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
    exportMarkdown: (report) => ipcRenderer.invoke('benchmark:export-markdown', report),
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
    createSchedule: (schedule) => ipcRenderer.invoke('cleaning:create-schedule', schedule),
    updateSchedule: (id: string, updates) => ipcRenderer.invoke('cleaning:update-schedule', id, updates),
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
  tweaks: {
    get: (): Promise<TweakView[]> => ipcRenderer.invoke('tweaks:get'),
    preview: (id: string): Promise<TweakPreview> => ipcRenderer.invoke('tweaks:preview', id),
    apply: (id: string): Promise<TweakApplyResult> => ipcRenderer.invoke('tweaks:apply', id),
    restore: (id: string): Promise<TweakApplyResult> => ipcRenderer.invoke('tweaks:restore', id),
    applyMany: (ids: string[]): Promise<TweakApplyResult[]> => ipcRenderer.invoke('tweaks:apply-many', ids),
    restoreMany: (ids: string[]): Promise<TweakApplyResult[]> => ipcRenderer.invoke('tweaks:restore-many', ids),
  },
};

contextBridge.exposeInMainWorld('winoptimizer', winoptimizer);

export type { ElectronAPI, WinOptimizerAPI };
