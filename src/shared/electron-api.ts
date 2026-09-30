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
export interface DriverInfo {
  id: string;
  name: string;
  manufacturer: 'NVIDIA' | 'AMD' | 'Intel' | 'Generic';
  currentVersion: string;
  latestVersion: string;
  isUpToDate: boolean;
  deviceClass: string;
  hardwareId: string;
  releaseDate: string;
  downloadUrl: string;
  size: number;
}

export interface DriverScanResult {
  drivers: DriverInfo[];
  totalDevices: number;
  outdatedCount: number;
  upToDateCount: number;
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
  category: 'browsers' | 'media' | 'devtools' | 'utilities' | 'games';
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

export interface ElectronAPI {
  getSystemInfo: () => Promise<SystemInfo>;
  scanForJunkFiles: () => Promise<JunkScanResult>;
  deleteFiles: (files: string[]) => Promise<{ success: boolean; deleted: number; failed: number; errors: string[] }>;
  getStartupApps: () => Promise<StartupApp[]>;
  toggleStartupApp: (appId: string, enabled: boolean) => Promise<{ success: boolean; message: string }>;
  getInstalledApps: () => Promise<InstalledApp[]>;
  uninstallApp: (appId: string, uninstallString: string) => Promise<{ success: boolean; message: string }>;
  getSystemServices: () => Promise<SystemService[]>;
  toggleService: (serviceId: string, enabled: boolean) => Promise<{ success: boolean; message: string }>;
  setServiceStartType: (serviceId: string, startType: 'automatic' | 'manual' | 'disabled') => Promise<{ success: boolean; message: string }>;
  checkForUpdates: () => Promise<UpdateInfo>;
  downloadUpdate: (url: string) => Promise<string>;
  onUpdateProgress: (callback: (percent: number) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    winoptimizer: any;
  }
}
