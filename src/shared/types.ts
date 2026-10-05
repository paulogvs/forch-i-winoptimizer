// Shared types between main and renderer processes

export type Theme = 'dark' | 'light';

export type PageId =
  | 'dashboard'
  | 'cleaner'
  | 'boost'
  | 'tools'
  | 'statistics'
  | 'security'
  | 'settings'
  | 'drivers'
  | 'network'
  | 'audit'
  | 'benchmark'
  | 'bundles'
  | 'cleaning'
  | 'tweaks';

export interface NavItem {
  id: PageId;
  label: string;
  icon: string;
}

export interface KpiData {
  label: string;
  value: number;
  unit: string;
  trend?: 'up' | 'down';
  trendValue?: number;
}

export interface ToolItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'system' | 'privacy' | 'performance' | 'utilities';
  action: () => void;
}

export interface SecurityIssue {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  recommendation: string;
  autoFixable: boolean;
}

export interface StatDataPoint {
  date: string;
  value: number;
}

export interface StatSeries {
  name: string;
  data: StatDataPoint[];
  color: string;
}

// ===== Driver Updater =====
export interface DriverInfo {
  id: string;
  name: string;
  manufacturer: 'NVIDIA' | 'AMD' | 'Intel' | 'Generic';
  currentVersion: string;
  latestVersion: string;
  /** Back-compat: equals `status === 'up-to-date'`. */
  isUpToDate: boolean;
  /** Honest state: `unknown` means Windows Update did not answer. */
  status: 'up-to-date' | 'update-available' | 'unknown';
  deviceClass: string;
  hardwareId: string;
  releaseDate: string;
  downloadUrl: string;
  size: number;
  /** Where the offered update comes from (null when nothing is offered). */
  source: 'windows-update' | 'manual' | null;
  /** Windows Update title of the offered driver, when applicable. */
  updateTitle: string;
  /** True when the app can install this update without manual steps. */
  automatic: boolean;
  /** Always true for real installs (Windows Update / PnP need admin). */
  requiresAdmin: boolean;
}

export interface DriverScanResult {
  drivers: DriverInfo[];
  totalDevices: number;
  /** Drivers with an update available. */
  outdatedCount: number;
  upToDateCount: number;
  /** Drivers whose state could not be determined (WU silent/blocked). */
  unknownCount: number;
  /** Whether Windows Update answered the driver search. */
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
