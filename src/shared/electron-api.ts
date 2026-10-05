import type { ScanProgressEvent } from './scan-progress';
import type { TweakApplyResult, TweakPreview, TweakView } from './tweaks';
import type { AppSettings, SettingsPayload, UpdateSettingsResult } from './settings';
import type { StatsEvent, StatsExportResult } from './stats';
import type { UpdateStatus } from './updater-status';
import type { SecurityScanReport } from './security-scan';
import type { SecurityFixOutcome, SecurityFixPreview } from './security-fix';
import type {
  DriverDownloadOutcome,
  DriverInstallRequest,
  DriverProgressEvent,
} from './driver-update';
import type { DeleteReceipt, RetryFailedResult } from './cleanup';
import type { DiskRepairProgressEvent, DiskRepairResult } from './disk-repair';
import type {
  DriverStoreCandidate,
  DriverStoreCleanResult,
  DriverStorePreview,
} from './driver-store';
import type { SoftwareUpdateReport } from './software-update';

export interface SystemInfo {
  platform: string;
  release: string;
  arch: string;
  hostname: string;
  username: string;
  uptime: number;
  cpu: {
    model: string;
    cores: number;
    usage: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  gpu: {
    name: string;
    vram: number;
    driverVersion: string;
  };
  windowsVersion: string;
  windowsBuild: string;
  lastBootTime: Date;
}

export interface JunkFile {
  id: string;
  path: string;
  name: string;
  size: number;
  category: string;
  lastModified: Date;
  safeToDelete: boolean;
}

export interface JunkScanResult {
  files: JunkFile[];
  totalSize: number;
  totalCount: number;
  categories: Record<string, { count: number; size: number }>;
}

export interface StartupApp {
  id: string;
  name: string;
  path: string;
  publisher: string;
  enabled: boolean;
  impact: 'low' | 'medium' | 'high';
  description: string;
}

export interface InstalledApp {
  id: string;
  name: string;
  version: string;
  publisher: string;
  installDate: Date;
  size: number;
  installLocation: string;
  uninstallString: string;
  protection: 'safe' | 'caution' | 'protected';
  category: string;
}

// ===== Bloatware removal (P1.4) =====
export interface DebloatCandidate {
  id: string;
  name: string;
  publisher: string;
  category: string;
  protection: 'safe' | 'caution' | 'protected';
  description: string;
  /** UWP package base name from the curated catalog. */
  uninstallString: string;
  size: string;
  source: string;
  installed: boolean;
}

export interface DebloatItemResult {
  id: string;
  name: string;
  status: 'removed' | 'skipped' | 'failed' | 'protected';
  error?: string;
}

export interface DebloatResult {
  success: boolean;
  removed: number;
  skipped: number;
  failed: number;
  /** Protected entries refused by the server-side guard. */
  refused: number;
  message: string;
  results: DebloatItemResult[];
}

export interface SystemService {
  id: string;
  name: string;
  displayName: string;
  description: string;
  status: 'running' | 'stopped' | 'paused';
  startType: 'automatic' | 'manual' | 'disabled';
  canOptimize: boolean;
  recommendedAction: 'keep' | 'disable' | 'manual';
  protection: 'safe' | 'caution' | 'protected';
  impact: 'low' | 'medium' | 'high';
  /** Safety KB (Fase 4.8): level, risk and the warning to show before applying. */
  safety: 'safe' | 'caution' | 'protected';
  risk: 'low' | 'medium' | 'high' | 'critical';
  safetyWarning: string | null;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes: string;
  downloadUrl: string;
  publishedAt: Date;
  size: number;
}

// ===== Driver Updater =====
/**
 * Honest outcome of a driver "update" (Fase 0.2 / Fase 2.6): opening the
 * manufacturer's download page is a manual action the USER must finish,
 * never a success. `success` is only true when the app itself verified a
 * real effect (the new version re-read from the OS + the device reports OK).
 */
export type DriverInstallStatus =
  'manual-action-required' | 'completed' | 'failed' | 'blocked' | 'cancelled';

export interface DriverInstallResult extends OperationResult {
  status: DriverInstallStatus;
  /** URL that was opened (or that the user must open) for manual installs. */
  url?: string | undefined;
  driverId?: string | undefined;
  rebootRequired?: boolean | undefined;
  verified?: boolean | undefined;
  restorePointCreated?: boolean | undefined;
  rollbackAvailable?: boolean | undefined;
  downloadedBytes?: number | undefined;
  sha256?: string | undefined;
  signature?: string | undefined;
}
export interface DriverInfo {
  id: string;
  name: string;
  manufacturer: 'NVIDIA' | 'AMD' | 'Intel' | 'Generic';
  currentVersion: string;
  latestVersion: string;
  isUpToDate: boolean;
  status: 'up-to-date' | 'update-available' | 'unknown';
  deviceClass: string;
  hardwareId: string;
  releaseDate: string;
  downloadUrl: string;
  size: number;
  source: 'windows-update' | 'manual' | null;
  updateTitle: string;
  automatic: boolean;
  requiresAdmin: boolean;
}

export interface DriverScanResult {
  drivers: DriverInfo[];
  totalDevices: number;
  outdatedCount: number;
  upToDateCount: number;
  unknownCount: number;
  wuStatus: 'ok' | 'unavailable' | 'excluded';
  wuMessage: string;
  scanDate: Date;
}

// ===== Network Fixer =====
export interface NetworkFixResult {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  output: string;
  duration: number;
}

export interface NetworkFixReport {
  fixes: NetworkFixResult[];
  connectivityTest: {
    success: boolean;
    latency: number;
    downloadSpeed: number;
  };
  timestamp: Date;
}

// ===== Drift Guard =====
export interface DriftEvent {
  id: string;
  tweakId: string;
  tweakName: string;
  previousValue: string;
  currentValue: string;
  timestamp: Date;
  autoFixed: boolean;
}

export interface DriftGuardStatus {
  isMonitoring: boolean;
  lastCheck: Date;
  driftEvents: DriftEvent[];
  tweaksAtRisk: number;
}

// ===== System Audit =====
export interface AuditCheck {
  id: string;
  name: string;
  category: 'privacy' | 'performance' | 'memory' | 'storage' | 'startup' | 'network';
  status: 'pass' | 'warning' | 'critical';
  description: string;
  recommendation: string;
  impact: 'low' | 'medium' | 'high';
  autoFixable: boolean;
}

export interface AuditReport {
  checks: AuditCheck[];
  totalChecks: number;
  passedCount: number;
  warningCount: number;
  criticalCount: number;
  score: number;
  timestamp: Date;
}

// ===== Benchmark =====
export interface BenchmarkResult {
  id: string;
  name: string;
  category: 'cpu' | 'memory' | 'disk' | 'gpu' | 'network';
  score: number;
  unit: string;
  details: string;
  timestamp: Date;
}

export interface BenchmarkReport {
  results: BenchmarkResult[];
  totalScore: number;
  systemInfo: {
    cpu: string;
    memory: number;
    disk: string;
    gpu: string;
  };
  timestamp: Date;
}

// ===== Security & Privacy =====
export interface PrivacySetting {
  id: string;
  name: string;
  description: string;
  category: 'telemetry' | 'privacy' | 'security' | 'updates';
  registryPath: string;
  valueName: string;
  recommendedValue: number;
  currentValue: number | null;
  isApplied: boolean;
  impact: 'low' | 'medium' | 'high';
}

export interface SecurityAction {
  id: string;
  name: string;
  description: string;
  category: 'defender' | 'copilot' | 'recall' | 'privacy';
  command: string;
  warning?: string;
  isReversible: boolean;
}

export interface DNSBenchmarkResult {
  name: string;
  primaryDNS: string;
  secondaryDNS: string;
  avgLatency: number;
  reliability: number;
  isRecommended: boolean;
}

// ===== App Bundles =====
export interface AppBundle {
  id: string;
  name: string;
  description: string;
  category:
    | 'browsers'
    | 'media'
    | 'devtools'
    | 'utilities'
    | 'games'
    | 'productivity'
    | 'communication'
    | 'security';
  apps: BundleApp[];
  icon: string;
}

export interface BundleApp {
  id: string;
  name: string;
  wingetId: string;
  description: string;
  size: number;
  isInstalled: boolean;
  isSelected: boolean;
}

// ===== Scheduled Cleaning =====
export interface CleaningSchedule {
  id: string;
  name: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  categories: string[];
  enabled: boolean;
  lastRun: Date | null;
  nextRun: Date;
  notifyBefore: boolean;
}

export interface CleaningHistoryEntry {
  id: string;
  scheduleId: string;
  scheduleName: string;
  timestamp: Date;
  filesDeleted: number;
  spaceFreed: number;
  duration: number;
  status: 'success' | 'partial' | 'failed';
}

/** Read-through cache control exposed to the renderer (P1.2). */
export interface CacheOptions {
  /** Skip a fresh cache entry and recompute. */
  force?: boolean;
}

// ===== Window controls (P0.1) =====
export interface WindowControlsAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  unmaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  close: () => Promise<void>;
  /** Subscribe to maximize state changes. Returns an unsubscribe function. */
  onMaximized: (callback: () => void) => () => void;
  /** Subscribe to unmaximize state changes. Returns an unsubscribe function. */
  onUnmaximized: (callback: () => void) => () => void;
}

/** Global operation-lock status (P0.3): mirrors main's operation-lock state. */
export interface OperationStatus {
  /** True while an operation is running OR queued. */
  busy: boolean;
  /** IPC channel of the operation currently holding the lock. */
  current: string | null;
  /** Number of operations waiting for the lock. */
  queued: number;
  /** Epoch ms when the current operation started (null when idle). */
  startedAt: number | null;
}

/** Result of the quick "Free RAM" action (P1.1). */
export interface FreeMemoryResult {
  success: boolean;
  /** MB trimmed from this app's working set (max(0, before - after)). */
  freedMb: number;
  /** Working set of the app's processes BEFORE the trim, measured in the OS. */
  rssBeforeMb: number;
  /** Working set of the app's processes AFTER the trim, re-read from the OS. */
  rssAfterMb: number;
  error?: string;
}

/** One-click "Clean Temp" outcome (Fase 3): only safeToDelete files. */
export interface QuickCleanResult {
  success: boolean;
  /** Safe candidate files (after the safeToDelete filter). */
  scanned: number;
  /** Bytes of the candidates before deletion. */
  scannedBytes: number;
  /** Paths the OS confirmed removed. */
  deleted: number;
  /** Bytes actually freed (only confirmed-removed paths). */
  freedBytes: number;
  failed: number;
  errors: string[];
  message: string;
}

/** One-click "Flush DNS" outcome (Fase 3), verified against the real cache. */
export interface FlushDnsResult {
  success: boolean;
  /** Resolver cache entries measured before the flush. */
  entriesBefore: number;
  /** Resolver cache entries re-read after the flush. */
  entriesAfter: number;
  message: string;
}

export interface ElectronAPI {
  getSystemInfo: (options?: CacheOptions) => Promise<SystemInfo>;
  scanForJunkFiles: (options?: CacheOptions) => Promise<JunkScanResult>;
  deleteFiles: (files: string[]) => Promise<{
    success: boolean;
    deleted: number;
    failed: number;
    errors: string[];
    removed?: string[];
    /** Fase 4.6: per-file outcome (why a delete failed) for the UI. */
    receipts?: DeleteReceipt[];
  }>;
  /** Fase 4.6: retry only the files that failed in the last cleanup. */
  retryFailedFiles: () => Promise<RetryFailedResult>;
  getStartupApps: (options?: CacheOptions) => Promise<StartupApp[]>;
  toggleStartupApp: (
    appId: string,
    enabled: boolean
  ) => Promise<{ success: boolean; message: string }>;
  getInstalledApps: (options?: CacheOptions) => Promise<InstalledApp[]>;
  uninstallApp: (
    appId: string,
    uninstallString: string
  ) => Promise<{ success: boolean; message: string }>;
  // Bloatware removal (P1.4)
  getBloatwareCatalog: () => Promise<DebloatCandidate[]>;
  removeBloatware: (ids: string[]) => Promise<DebloatResult>;
  getSystemServices: (options?: CacheOptions) => Promise<SystemService[]>;
  toggleService: (
    serviceId: string,
    enabled: boolean
  ) => Promise<{ success: boolean; message: string }>;
  setServiceStartType: (
    serviceId: string,
    startType: 'automatic' | 'manual' | 'disabled'
  ) => Promise<{ success: boolean; message: string }>;
  checkForUpdates: () => Promise<UpdateInfo>;
  downloadUpdate: (url: string) => Promise<string>;
  onUpdateProgress: (callback: (percent: number) => void) => () => void;
  /** Subscribe to background updater lifecycle status. Returns an unsubscribe. */
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  // Settings (single source of truth in main)
  getSettings: () => Promise<SettingsPayload>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<UpdateSettingsResult>;
  // Usage statistics (real recorded events)
  getStats: () => Promise<StatsEvent[]>;
  exportStats: () => Promise<StatsExportResult>;
  // Background updater (electron-updater)
  getUpdateStatus: () => Promise<UpdateStatus>;
  checkForUpdatesNow: () => Promise<UpdateStatus>;
  downloadUpdateNow: () => Promise<UpdateStatus>;
  installUpdateNow: () => Promise<OperationResult>;
  // Windows utilities (validated before launch)
  launchTool: (id: string) => Promise<OperationResult>;
  // Disk repair (Fase 4.9): real Windows repair tools, admin-gated + streamed.
  diskRepair: {
    isAdmin: () => Promise<boolean>;
    run: (toolId: string) => Promise<DiskRepairResult>;
    cancel: () => Promise<OperationResult>;
    relaunchElevated: () => Promise<OperationResult>;
    onProgress: (callback: (event: DiskRepairProgressEvent) => void) => () => void;
  };
  // Window controls
  window: WindowControlsAPI;
  // Scan progress (P0.3)
  onScanProgress: (callback: (event: ScanProgressEvent) => void) => () => void;
  // Global operation lock (P0.3)
  getOperationStatus: () => Promise<OperationStatus>;
  /** Subscribe to global operation status changes. Returns an unsubscribe function. */
  onOperationStatus: (callback: (status: OperationStatus) => void) => () => void;
  // Quick "Free RAM" (P1.1)
  freeMemory: () => Promise<FreeMemoryResult>;
  // Quick fixes (Fase 3): 1-click actions with verified real results.
  quickFixes: {
    /** Trim THIS app's own working set and report the measured MB delta. */
    freeRam: () => Promise<FreeMemoryResult>;
    /** Delete only safeToDelete categories (temp/cache/logs/thumbs/browser). */
    cleanTemp: () => Promise<QuickCleanResult>;
    /** Run `ipconfig /flushdns` and verify the resolver cache really shrank. */
    flushDns: () => Promise<FlushDnsResult>;
    /** Create a verified System Restore point. */
    createRestorePoint: (description: string) => Promise<OperationResult>;
    /** Fresh (uncached) driver scan using the real Windows Update source. */
    scanDrivers: () => Promise<DriverScanResult>;
  };
  // Cache control (P1.2)
  clearCache: () => Promise<{ success: boolean }>;
}

// ===== Advanced (namespaced) API used by feature pages =====
export interface OperationResult {
  success: boolean;
  message: string;
}

export interface ConnectivityTestResult {
  success: boolean;
  latency: number;
  downloadSpeed: number;
}

export interface RunScheduleResult extends OperationResult {
  filesDeleted: number;
  spaceFreed: number;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: string[];
}

export interface WinOptimizerAPI {
  drivers: {
    scan: (options?: CacheOptions) => Promise<DriverScanResult>;
    createRestorePoint: (description: string) => Promise<OperationResult>;
    /** Fase 2.6: automatic pipeline (download -> verify -> silent install -> verify). */
    install: (request: DriverInstallRequest) => Promise<DriverInstallResult>;
    /** Fase 2.6: explicit silent-install channel (same pipeline, distinct channel). */
    installSilent: (request: DriverInstallRequest) => Promise<DriverInstallResult>;
    /** Download + verify only (no install). */
    download: (request: DriverInstallRequest) => Promise<DriverDownloadOutcome>;
    /** Cancel an in-flight download/install for a driver id. */
    cancel: (driverId: string) => Promise<OperationResult>;
    /** Real rollback (pnputil uninstall + restore point) for what the app installed. */
    rollback: (driverId: string) => Promise<DriverInstallResult>;
    /** Subscribe to real driver operation progress. Returns an unsubscribe. */
    onProgress: (callback: (event: DriverProgressEvent) => void) => () => void;
  };
  /** Driver Store cleanup (Fase 4.1): preview first, then remove superseded. */
  driverStore: {
    preview: () => Promise<DriverStorePreview>;
    clean: (candidates: DriverStoreCandidate[]) => Promise<DriverStoreCleanResult>;
    isAdmin: () => Promise<boolean>;
  };
  /** Software updater (Fase 4.7): real winget detection + update. */
  softwareUpdates: {
    check: (options?: CacheOptions) => Promise<SoftwareUpdateReport>;
    update: (id: string) => Promise<OperationResult>;
  };
  network: {
    fix: () => Promise<NetworkFixReport>;
    test: () => Promise<ConnectivityTestResult>;
    fixError0x00000709: () => Promise<OperationResult>;
  };
  drift: {
    check: () => Promise<{ events: DriftEvent[] }>;
    reapply: (tweakId: string) => Promise<{ success: boolean }>;
    reapplyAll: () => Promise<{ success: boolean }>;
    status: () => Promise<DriftGuardStatus>;
    startMonitoring: () => Promise<{ success: boolean }>;
    stopMonitoring: () => Promise<{ success: boolean }>;
  };
  audit: {
    run: (options?: CacheOptions) => Promise<AuditReport>;
  };
  benchmark: {
    run: (options?: CacheOptions) => Promise<BenchmarkReport>;
    exportMarkdown: (report: BenchmarkReport) => Promise<string>;
  };
  privacy: {
    getSettings: (options?: CacheOptions) => Promise<PrivacySetting[]>;
    applySetting: (settingId: string) => Promise<OperationResult>;
    applyAll: () => Promise<OperationResult>;
  };
  security: {
    getActions: () => Promise<SecurityAction[]>;
    runAction: (actionId: string) => Promise<OperationResult>;
    /** Live, read-only security scan of the real machine (v0.6.0). */
    scan: (options?: CacheOptions) => Promise<SecurityScanReport>;
    /** Reversible auto-fix (v0.7.0): mandatory preview before any change. */
    previewFix: (checkId: string) => Promise<SecurityFixPreview | null>;
    applyFix: (checkId: string) => Promise<SecurityFixOutcome>;
    revertFix: (checkId: string) => Promise<SecurityFixOutcome>;
    /** Relaunch the app with elevation (used when a fix requires admin). */
    relaunchElevated: () => Promise<OperationResult>;
  };
  dns: {
    benchmark: (options?: CacheOptions) => Promise<DNSBenchmarkResult[]>;
    set: (primaryDNS: string, secondaryDNS: string) => Promise<OperationResult>;
  };
  bundles: {
    get: () => Promise<AppBundle[]>;
    checkInstalled: () => Promise<Map<string, boolean>>;
    install: (wingetId: string) => Promise<OperationResult>;
    installMultiple: (wingetIds: string[]) => Promise<OperationResult>;
    uninstall: (wingetId: string) => Promise<OperationResult>;
  };
  cleaning: {
    getSchedules: () => Promise<CleaningSchedule[]>;
    getDefaultSchedules: () => Promise<CleaningSchedule[]>;
    createSchedule: (schedule: CleaningSchedule) => Promise<CleaningSchedule>;
    updateSchedule: (
      id: string,
      updates: Partial<CleaningSchedule>
    ) => Promise<CleaningSchedule | null>;
    deleteSchedule: (id: string) => Promise<boolean>;
    runNow: (id: string) => Promise<RunScheduleResult>;
    getHistory: () => Promise<CleaningHistoryEntry[]>;
  };
  sourceUpdater: {
    check: () => Promise<{ report: unknown; formatted: string }>;
    pending: () => Promise<{ pending: unknown[]; formatted: string }>;
    import: (updates: unknown[]) => Promise<ImportResult>;
    importAll: () => Promise<ImportResult>;
    reject: (updateId: string) => Promise<{ success: boolean }>;
    rejectAll: () => Promise<{ success: boolean }>;
  };
  tweaks: {
    get: () => Promise<TweakView[]>;
    preview: (id: string) => Promise<TweakPreview>;
    apply: (id: string) => Promise<TweakApplyResult>;
    restore: (id: string) => Promise<TweakApplyResult>;
    applyMany: (ids: string[]) => Promise<TweakApplyResult[]>;
    restoreMany: (ids: string[]) => Promise<TweakApplyResult[]>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    winoptimizer: WinOptimizerAPI;
  }
}
