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
  }
}
