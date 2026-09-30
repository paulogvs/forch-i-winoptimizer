import { Page } from '@playwright/test';

const mockSystemInfo = {
  platform: 'win32',
  release: '10.0.19045',
  arch: 'x64',
  hostname: 'DESKTOP-TEST',
  username: 'TestUser',
  uptime: 86400,
  cpu: {
    model: 'Intel Core i7-12700K',
    cores: 12,
    usage: 35,
  },
  memory: {
    total: 17179869184,
    free: 8589934592,
    used: 8589934592,
    usagePercent: 50,
  },
  disk: {
    total: 512000000000,
    free: 256000000000,
    used: 256000000000,
    usagePercent: 50,
  },
  gpu: {
    name: 'NVIDIA GeForce RTX 3070',
    vram: 8589934592,
    driverVersion: '546.17',
  },
  windowsVersion: 'Windows 11 Pro',
  windowsBuild: '22631',
  lastBootTime: new Date(),
};

const mockJunkFiles = {
  files: [
    {
      id: '1',
      path: 'C:\\Users\\TestUser\\AppData\\Local\\Temp\\temp1.tmp',
      name: 'temp1.tmp',
      size: 1024000,
      category: 'Temporary Files',
      lastModified: new Date(),
      safeToDelete: true,
    },
    {
      id: '2',
      path: 'C:\\Users\\TestUser\\AppData\\Local\\Temp\\temp2.tmp',
      name: 'temp2.tmp',
      size: 2048000,
      category: 'Temporary Files',
      lastModified: new Date(),
      safeToDelete: true,
    },
    {
      id: '3',
      path: 'C:\\Windows\\Temp\\cache1.tmp',
      name: 'cache1.tmp',
      size: 512000,
      category: 'Cache',
      lastModified: new Date(),
      safeToDelete: true,
    },
  ],
  totalSize: 3584000,
  totalCount: 3,
  categories: {
    'Temporary Files': { count: 2, size: 3072000 },
    Cache: { count: 1, size: 512000 },
  },
};

const mockStartupApps = [
  {
    id: '1',
    name: 'Discord',
    path: 'C:\\Users\\TestUser\\AppData\\Local\\Discord\\Update.exe',
    publisher: 'Discord Inc.',
    enabled: true,
    impact: 'medium' as const,
    description: 'Discord voice and text chat',
  },
  {
    id: '2',
    name: 'Steam',
    path: 'C:\\Program Files (x86)\\Steam\\steam.exe',
    publisher: 'Valve Corporation',
    enabled: true,
    impact: 'high' as const,
    description: 'Steam gaming platform',
  },
];

const mockInstalledApps = [
  {
    id: '1',
    name: 'Google Chrome',
    version: '120.0.0',
    publisher: 'Google LLC',
    installDate: new Date(),
    size: 512000000,
    installLocation: 'C:\\Program Files\\Google\\Chrome',
    uninstallString: 'C:\\Program Files\\Google\\Chrome\\uninstall.exe',
    protection: 'safe' as const,
    category: 'Web Browsers',
  },
  {
    id: '2',
    name: 'VS Code',
    version: '1.85.0',
    publisher: 'Microsoft',
    installDate: new Date(),
    size: 300000000,
    installLocation: 'C:\\Users\\TestUser\\AppData\\Local\\Programs\\Code',
    uninstallString: 'C:\\Users\\TestUser\\AppData\\Local\\Programs\\Code\\uninstall.exe',
    protection: 'safe' as const,
    category: 'Development',
  },
];

const mockSystemServices = [
  {
    id: '1',
    name: 'WSearch',
    displayName: 'Windows Search',
    description: 'Provides content indexing and search',
    status: 'running' as const,
    startType: 'automatic' as const,
    canOptimize: true,
    recommendedAction: 'manual' as const,
    protection: 'caution' as const,
    impact: 'medium' as const,
  },
  {
    id: '2',
    name: 'SysMain',
    displayName: 'SysMain',
    description: 'Maintains and improves system performance',
    status: 'running' as const,
    startType: 'automatic' as const,
    canOptimize: true,
    recommendedAction: 'disable' as const,
    protection: 'safe' as const,
    impact: 'low' as const,
  },
];

const mockUpdateInfo = {
  currentVersion: '0.1.0',
  latestVersion: '0.1.0',
  updateAvailable: false,
  releaseNotes: '',
  downloadUrl: '',
  publishedAt: new Date(),
  size: 0,
};

export async function setupElectronMock(page: Page): Promise<void> {
  await page.addInitScript((data) => {
    const {
      systemInfo,
      junkFiles,
      startupApps,
      installedApps,
      systemServices,
      updateInfo,
    } = data;

    const mockAPI = {
      getSystemInfo: () => Promise.resolve(systemInfo),
      scanForJunkFiles: () =>
        new Promise((resolve) => setTimeout(() => resolve(junkFiles), 100)),
      deleteFiles: (files: string[]) =>
        Promise.resolve({
          success: true,
          deleted: files.length,
          failed: 0,
          errors: [],
        }),
      getStartupApps: () => Promise.resolve(startupApps),
      toggleStartupApp: (appId: string, enabled: boolean) =>
        Promise.resolve({ success: true, message: `App ${enabled ? 'enabled' : 'disabled'}` }),
      getInstalledApps: () => Promise.resolve(installedApps),
      uninstallApp: (appId: string, uninstallString: string) =>
        Promise.resolve({ success: true, message: 'Uninstalled' }),
      getSystemServices: () => Promise.resolve(systemServices),
      toggleService: (serviceId: string, enabled: boolean) =>
        Promise.resolve({ success: true, message: `Service ${enabled ? 'enabled' : 'disabled'}` }),
      setServiceStartType: (serviceId: string, startType: string) =>
        Promise.resolve({ success: true, message: `Start type set to ${startType}` }),
      checkForUpdates: () =>
        new Promise((resolve) => setTimeout(() => resolve(updateInfo), 100)),
      downloadUpdate: (url: string) => Promise.resolve('C:\\Downloads\\update.exe'),
      onUpdateProgress: (callback: (percent: number) => void) => {
        callback(50);
        callback(100);
        return () => {};
      },
    };

    (window as unknown as { electronAPI: typeof mockAPI }).electronAPI = mockAPI;

    // Advanced feature pages use the `winoptimizer` namespace.
    const mockWinoptimizer = {
      drivers: {
        scan: () =>
          Promise.resolve({ drivers: [], totalDevices: 0, outdatedCount: 0, upToDateCount: 0, scanDate: new Date() }),
        createRestorePoint: () => Promise.resolve({ success: true, message: 'ok' }),
        install: () => Promise.resolve({ success: true, message: 'ok' }),
        rollback: () => Promise.resolve({ success: true, message: 'ok' }),
      },
      network: {
        fix: () =>
          Promise.resolve({
            fixes: [],
            connectivityTest: { success: true, latency: 12, downloadSpeed: 0 },
            timestamp: new Date(),
          }),
        test: () => Promise.resolve({ success: true, latency: 12, downloadSpeed: 0 }),
        fixError0x00000709: () => Promise.resolve({ success: true, message: 'ok' }),
      },
      drift: {
        check: () => Promise.resolve({ events: [] }),
        reapply: () => Promise.resolve({ success: true }),
        reapplyAll: () => Promise.resolve({ success: true }),
        status: () =>
          Promise.resolve({ isMonitoring: false, lastCheck: new Date(), driftEvents: [], tweaksAtRisk: 0 }),
        startMonitoring: () => Promise.resolve({ success: true }),
        stopMonitoring: () => Promise.resolve({ success: true }),
      },
      audit: {
        run: () =>
          Promise.resolve({
            checks: [],
            totalChecks: 0,
            passedCount: 0,
            warningCount: 0,
            criticalCount: 0,
            score: 100,
            timestamp: new Date(),
          }),
      },
      benchmark: {
        run: () =>
          Promise.resolve({
            results: [],
            totalScore: 0,
            systemInfo: { cpu: '', memory: 0, disk: '', gpu: '' },
            timestamp: new Date(),
          }),
        exportMarkdown: () => Promise.resolve('# report'),
      },
      privacy: {
        getSettings: () => Promise.resolve([]),
        applySetting: () => Promise.resolve({ success: true, message: 'ok' }),
        applyAll: () => Promise.resolve({ success: true, message: 'ok' }),
      },
      security: {
        getActions: () => Promise.resolve([]),
        runAction: () => Promise.resolve({ success: true, message: 'ok' }),
      },
      dns: {
        benchmark: () => Promise.resolve([]),
        set: () => Promise.resolve({ success: true, message: 'ok' }),
      },
      bundles: {
        get: () => Promise.resolve([]),
        checkInstalled: () => Promise.resolve([]),
        install: () => Promise.resolve({ success: true, message: 'ok' }),
        installMultiple: () => Promise.resolve({ success: true, message: 'ok' }),
        uninstall: () => Promise.resolve({ success: true, message: 'ok' }),
      },
      cleaning: {
        getSchedules: () => Promise.resolve([]),
        getDefaultSchedules: () => Promise.resolve([]),
        createSchedule: (schedule: unknown) => Promise.resolve(schedule),
        updateSchedule: () => Promise.resolve(null),
        deleteSchedule: () => Promise.resolve(true),
        runNow: () => Promise.resolve({ success: true, message: 'ok', filesDeleted: 0, spaceFreed: 0 }),
        getHistory: () => Promise.resolve([]),
      },
      sourceUpdater: {
        check: () => Promise.resolve({ report: {}, formatted: '' }),
        pending: () => Promise.resolve({ pending: [], formatted: '' }),
        import: () => Promise.resolve({ success: true, imported: 0, failed: 0, errors: [] }),
        importAll: () => Promise.resolve({ success: true, imported: 0, failed: 0, errors: [] }),
        reject: () => Promise.resolve({ success: true }),
        rejectAll: () => Promise.resolve({ success: true }),
      },
    };

    (window as unknown as { winoptimizer: typeof mockWinoptimizer }).winoptimizer = mockWinoptimizer;
  }, {
    systemInfo: mockSystemInfo,
    junkFiles: mockJunkFiles,
    startupApps: mockStartupApps,
    installedApps: mockInstalledApps,
    systemServices: mockSystemServices,
    updateInfo: mockUpdateInfo,
  });
}
