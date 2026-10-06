import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  ElectronAPI,
  WinOptimizerAPI,
  OperationStatus,
  FreeMemoryResult,
} from '../shared/electron-api';
import type { DriverProgressEvent } from '../shared/driver-update';
import type { ScanProgressEvent } from '../shared/scan-progress';
import type { TweakApplyResult, TweakPreview, TweakView } from '../shared/tweaks';
import type { AppSettings } from '../shared/settings';
import type { UpdateStatus } from '../shared/updater-status';
import type { DiskRepairProgressEvent } from '../shared/disk-repair';

const api: ElectronAPI = {
  // System
  getSystemInfo: (options) => ipcRenderer.invoke('system:get-info', options),

  // Cleaner
  scanForJunkFiles: (options) => ipcRenderer.invoke('cleaner:scan', options),
  deleteFiles: (files: string[]) => ipcRenderer.invoke('cleaner:delete', files),
  retryFailedFiles: () => ipcRenderer.invoke('cleaner:retry-failed'),

  // Startup apps
  getStartupApps: (options) => ipcRenderer.invoke('startup:get-apps', options),
  toggleStartupApp: (appId: string, enabled: boolean) =>
    ipcRenderer.invoke('startup:toggle', appId, enabled),

  // Installed apps
  getInstalledApps: (options) => ipcRenderer.invoke('apps:get-installed', options),
  uninstallApp: (appId: string, uninstallString: string) =>
    ipcRenderer.invoke('apps:uninstall', appId, uninstallString),

  // Bloatware removal (P1.4)
  getBloatwareCatalog: () => ipcRenderer.invoke('debloat:get-catalog'),
  removeBloatware: (ids: string[]) => ipcRenderer.invoke('debloat:remove', ids),

  // System services
  getSystemServices: (options) => ipcRenderer.invoke('services:get-all', options),
  toggleService: (serviceId: string, enabled: boolean) =>
    ipcRenderer.invoke('services:toggle', serviceId, enabled),
  setServiceStartType: (serviceId: string, startType: 'automatic' | 'manual' | 'disabled') =>
    ipcRenderer.invoke('services:set-start-type', serviceId, startType),

  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: (url: string) => ipcRenderer.invoke('updater:download', url),

  // Settings (main is the single source of truth)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', patch),

  // Usage statistics
  getStats: () => ipcRenderer.invoke('stats:get'),
  exportStats: () => ipcRenderer.invoke('stats:export'),

  // Background updater (electron-updater)
  getUpdateStatus: () => ipcRenderer.invoke('updater:status'),
  checkForUpdatesNow: () => ipcRenderer.invoke('updater:check-now'),
  downloadUpdateNow: () => ipcRenderer.invoke('updater:download-now'),
  installUpdateNow: () => ipcRenderer.invoke('updater:install-now'),

  // Windows utilities
  launchTool: (id: string) => ipcRenderer.invoke('tools:launch', id),

  // Disk repair (Fase 4.9)
  diskRepair: {
    isAdmin: () => ipcRenderer.invoke('tools:disk-repair-status'),
    run: (toolId: string) => ipcRenderer.invoke('tools:disk-repair', toolId),
    cancel: () => ipcRenderer.invoke('tools:disk-repair-cancel'),
    relaunchElevated: () => ipcRenderer.invoke('tools:relaunch-elevated'),
    onProgress: (callback: (event: DiskRepairProgressEvent) => void) => {
      const handler = (_event: IpcRendererEvent, payload: DiskRepairProgressEvent) =>
        callback(payload);
      ipcRenderer.on('tools:disk-repair-progress', handler);
      return () => ipcRenderer.removeListener('tools:disk-repair-progress', handler);
    },
  },

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

  // Quick "Free RAM" (P1.1)
  freeMemory: (): Promise<FreeMemoryResult> => ipcRenderer.invoke('memory:free'),

  // Quick fixes (Fase 3): 1-click utilities with verified real results.
  quickFixes: {
    freeRam: (): Promise<FreeMemoryResult> => ipcRenderer.invoke('memory:free'),
    cleanTemp: () => ipcRenderer.invoke('quickfix:clean-temp'),
    flushDns: () => ipcRenderer.invoke('network:flush-dns'),
    createRestorePoint: (description: string) =>
      ipcRenderer.invoke('quickfix:restore-point', description),
    scanDrivers: () => ipcRenderer.invoke('quickfix:scan-drivers'),
  },

  // Events
  onUpdateProgress: (callback: (percent: number) => void) => {
    const handler = (_event: IpcRendererEvent, percent: number) => callback(percent);
    ipcRenderer.on('updater:progress', handler);
    return () => ipcRenderer.removeListener('updater:progress', handler);
  },

  // Background updater lifecycle (electron-updater).
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

// Namespaced API used by the advanced feature pages (Drivers, Network, Audit,
// Benchmark, Security & Privacy, App Bundles, Scheduled Cleaning, Tweaks).
const winoptimizer: WinOptimizerAPI = {
  drivers: {
    scan: (options) => ipcRenderer.invoke('drivers:scan', options),
    createRestorePoint: (description: string) =>
      ipcRenderer.invoke('drivers:create-restore-point', description),
    install: (request) => ipcRenderer.invoke('drivers:install', request),
    installSilent: (request) => ipcRenderer.invoke('drivers:install-silent', request),
    download: (request) => ipcRenderer.invoke('drivers:download', request),
    cancel: (driverId: string) => ipcRenderer.invoke('drivers:cancel', driverId),
    rollback: (driverId: string) => ipcRenderer.invoke('drivers:rollback', driverId),
    onProgress: (callback) => {
      const handler = (_event: IpcRendererEvent, payload: DriverProgressEvent) => callback(payload);
      ipcRenderer.on('drivers:progress', handler);
      return () => ipcRenderer.removeListener('drivers:progress', handler);
    },
  },
  driverStore: {
    preview: () => ipcRenderer.invoke('drivers:store-preview'),
    clean: (candidates) => ipcRenderer.invoke('drivers:store-clean', candidates),
    isAdmin: () => ipcRenderer.invoke('drivers:store-status'),
  },
  softwareUpdates: {
    check: (options) => ipcRenderer.invoke('apps:check-updates', options),
    update: (id: string) => ipcRenderer.invoke('apps:update', id),
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
    run: (options) => ipcRenderer.invoke('audit:run', options),
  },
  benchmark: {
    run: (options) => ipcRenderer.invoke('benchmark:run', options),
    exportMarkdown: (report) => ipcRenderer.invoke('benchmark:export-markdown', report),
  },
  privacy: {
    getSettings: (options) => ipcRenderer.invoke('privacy:get-settings', options),
    applySetting: (settingId: string) => ipcRenderer.invoke('privacy:apply-setting', settingId),
    applyAll: () => ipcRenderer.invoke('privacy:apply-all'),
  },
  security: {
    getActions: () => ipcRenderer.invoke('security:get-actions'),
    runAction: (actionId: string) => ipcRenderer.invoke('security:run-action', actionId),
    scan: (options) => ipcRenderer.invoke('security:scan', options),
    // Reversible auto-fix (v0.7.0): preview -> confirm -> apply -> revert.
    previewFix: (checkId: string) => ipcRenderer.invoke('security:fix-preview', checkId),
    applyFix: (checkId: string) => ipcRenderer.invoke('security:fix-apply', checkId),
    revertFix: (checkId: string) => ipcRenderer.invoke('security:fix-revert', checkId),
    relaunchElevated: () => ipcRenderer.invoke('security:relaunch-elevated'),
  },
  malware: {
    scan: (request) => ipcRenderer.invoke('malware:scan', request),
    scanBuffer: (base64: string, filename: string) =>
      ipcRenderer.invoke('malware:scan-buffer', base64, filename),
    cancel: () => ipcRenderer.invoke('malware:cancel'),
    scopes: () => ipcRenderer.invoke('malware:scopes'),
  },
  dns: {
    benchmark: (options) => ipcRenderer.invoke('dns:benchmark', options),
    set: (primaryDNS: string, secondaryDNS: string) =>
      ipcRenderer.invoke('dns:set', primaryDNS, secondaryDNS),
  },
  bundles: {
    get: () => ipcRenderer.invoke('bundles:get'),
    checkInstalled: () => ipcRenderer.invoke('bundles:check-installed'),
    install: (wingetId: string) => ipcRenderer.invoke('bundles:install', wingetId),
    installMultiple: (wingetIds: string[]) =>
      ipcRenderer.invoke('bundles:install-multiple', wingetIds),
    uninstall: (wingetId: string) => ipcRenderer.invoke('bundles:uninstall', wingetId),
  },
  cleaning: {
    getSchedules: () => ipcRenderer.invoke('cleaning:get-schedules'),
    getDefaultSchedules: () => ipcRenderer.invoke('cleaning:get-default-schedules'),
    createSchedule: (schedule) => ipcRenderer.invoke('cleaning:create-schedule', schedule),
    updateSchedule: (id: string, updates) =>
      ipcRenderer.invoke('cleaning:update-schedule', id, updates),
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
    applyMany: (ids: string[]): Promise<TweakApplyResult[]> =>
      ipcRenderer.invoke('tweaks:apply-many', ids),
    restoreMany: (ids: string[]): Promise<TweakApplyResult[]> =>
      ipcRenderer.invoke('tweaks:restore-many', ids),
  },
};

contextBridge.exposeInMainWorld('winoptimizer', winoptimizer);

export type { ElectronAPI, WinOptimizerAPI };
