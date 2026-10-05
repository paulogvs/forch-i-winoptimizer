import type { Page } from '@playwright/test';

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
  await page.addInitScript(
    (data) => {
      const { systemInfo, junkFiles, startupApps, installedApps, systemServices, updateInfo } =
        data;

      const mockAPI = {
        getSystemInfo: () => Promise.resolve(systemInfo),
        scanForJunkFiles: () => new Promise((resolve) => setTimeout(() => resolve(junkFiles), 100)),
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
        uninstallApp: (_appId: string, _uninstallString: string) =>
          Promise.resolve({ success: true, message: 'Uninstalled' }),
        // Bloatware removal (P1.4): fixture with every protection level plus a
        // not-installed row, so guards and badges are assertable.
        getBloatwareCatalog: () =>
          Promise.resolve([
            {
              id: 'bingnews',
              name: 'MSN News',
              publisher: 'Microsoft',
              category: 'bloatware',
              protection: 'safe' as const,
              description: 'App de noticias preinstalada.',
              uninstallString: 'Microsoft.BingNews',
              size: '~70 MB',
              source: 'winutil',
              installed: true,
            },
            {
              id: 'todo',
              name: 'Microsoft To Do',
              publisher: 'Microsoft',
              category: 'bloatware',
              protection: 'safe' as const,
              description: 'App de tareas preinstalada.',
              uninstallString: 'Microsoft.Todos',
              size: '~80 MB',
              source: 'winutil',
              installed: true,
            },
            {
              id: 'xbox',
              name: 'Xbox App',
              publisher: 'Microsoft',
              category: 'bloatware',
              protection: 'caution' as const,
              description: 'App de Xbox.',
              uninstallString: 'Microsoft.XboxApp',
              size: '~200 MB',
              source: 'winutil',
              installed: true,
            },
            {
              id: 'windowsstore',
              name: 'Microsoft Store',
              publisher: 'Microsoft',
              category: 'bloatware',
              protection: 'protected' as const,
              description: 'Tienda de apps de Windows.',
              uninstallString: 'Microsoft.WindowsStore',
              size: '—',
              source: 'winutil',
              installed: true,
            },
            {
              id: 'clipchamp',
              name: 'Clipchamp',
              publisher: 'Microsoft',
              category: 'bloatware',
              protection: 'safe' as const,
              description: 'Editor de video basico preinstalado.',
              uninstallString: 'Clipchamp.Clipchamp',
              size: '~200 MB',
              source: 'winutil',
              installed: false,
            },
          ]),
        removeBloatware: (ids: string[]) =>
          Promise.resolve({
            success: ids.length > 0,
            removed: ids.length,
            skipped: 0,
            failed: 0,
            refused: 0,
            message: `Removed ${ids.length} app(s).`,
            results: ids.map((id) => ({ id, name: id, status: 'removed' as const })),
          }),
        getSystemServices: () => Promise.resolve(systemServices),
        toggleService: (serviceId: string, enabled: boolean) =>
          Promise.resolve({
            success: true,
            message: `Service ${enabled ? 'enabled' : 'disabled'}`,
          }),
        setServiceStartType: (serviceId: string, startType: string) =>
          Promise.resolve({ success: true, message: `Start type set to ${startType}` }),
        checkForUpdates: () => new Promise((resolve) => setTimeout(() => resolve(updateInfo), 100)),
        downloadUpdate: (_url: string) => Promise.resolve('C:\\Downloads\\update.exe'),
        onUpdateProgress: (callback: (percent: number) => void) => {
          callback(50);
          callback(100);
          return () => {};
        },
        window: {
          minimize: () => Promise.resolve(),
          maximize: () => Promise.resolve(),
          unmaximize: () => Promise.resolve(),
          isMaximized: () => Promise.resolve(false),
          close: () => Promise.resolve(),
          onMaximized: () => () => {},
          onUnmaximized: () => () => {},
        },
        onScanProgress: () => () => {},
        // Global operation lock (P0.3): idle by default. E2E pushes a status
        // through `window.__emitOperationStatus(status)` to assert the busy UI.
        getOperationStatus: () =>
          Promise.resolve({ busy: false, current: null, queued: 0, startedAt: null }),
        onOperationStatus: (callback: (status: unknown) => void) => {
          const w = window as unknown as { __opStatusListeners?: Array<(status: unknown) => void> };
          w.__opStatusListeners = w.__opStatusListeners ?? [];
          w.__opStatusListeners.push(callback);
          return () => {
            w.__opStatusListeners = (w.__opStatusListeners ?? []).filter((l) => l !== callback);
          };
        },
        clearCache: () => Promise.resolve({ success: true }),
        // Settings (v0.5.0): main is the source of truth. Tests can seed state
        // through `window.__settings` before the page mounts.
        getSettings: () => {
          const w = window as unknown as {
            __settings?: Record<string, unknown>;
            __environment?: Record<string, unknown>;
          };
          return Promise.resolve({
            settings: {
              accentColor: '#06B6D4',
              startWithWindows: false,
              minimizeToTrayOnClose: false,
              enableNotifications: true,
              automaticUpdates: false,
              scanBrowserCache: true,
              scanWindowsTempFiles: true,
              scanRecycleBin: false,
              excludePaths: [],
              ...(w.__settings ?? {}),
            },
            environment: {
              portable: false,
              loginItemSupported: true,
              platform: 'win32',
              ...(w.__environment ?? {}),
            },
          });
        },
        updateSettings: (patch: Record<string, unknown>) => {
          const w = window as unknown as {
            __settings?: Record<string, unknown>;
            __environment?: Record<string, unknown>;
          };
          w.__settings = { ...(w.__settings ?? {}), ...patch };
          return Promise.resolve({
            settings: {
              accentColor: '#06B6D4',
              startWithWindows: false,
              minimizeToTrayOnClose: false,
              enableNotifications: true,
              automaticUpdates: false,
              scanBrowserCache: true,
              scanWindowsTempFiles: true,
              scanRecycleBin: false,
              excludePaths: [],
              ...w.__settings,
            },
            environment: {
              portable: false,
              loginItemSupported: true,
              platform: 'win32',
              ...(w.__environment ?? {}),
            },
            ok: true,
            message: 'Settings saved.',
          });
        },
        // Statistics (v0.5.0): seed real-looking events via `window.__statsEvents`.
        getStats: () => {
          const w = window as unknown as { __statsEvents?: unknown[] };
          return Promise.resolve(w.__statsEvents ?? []);
        },
        exportStats: () => Promise.resolve({ success: true, message: 'Exported 0 event(s).' }),
        // Background updater: inactive by default.
        getUpdateStatus: () =>
          Promise.resolve({ state: 'idle', version: null, percent: null, message: null }),
        checkForUpdatesNow: () =>
          Promise.resolve({ state: 'checking', version: null, percent: null, message: null }),
        downloadUpdateNow: () =>
          Promise.resolve({ state: 'downloading', version: '9.9.9', percent: 50, message: null }),
        installUpdateNow: () => Promise.resolve({ success: true, message: 'Installing.' }),
        onUpdateStatus: (callback: (status: unknown) => void) => {
          const w = window as unknown as {
            __updateStatusListeners?: Array<(status: unknown) => void>;
          };
          w.__updateStatusListeners = w.__updateStatusListeners ?? [];
          w.__updateStatusListeners.push(callback);
          return () => {
            w.__updateStatusListeners = (w.__updateStatusListeners ?? []).filter(
              (l) => l !== callback
            );
          };
        },
        // Windows utilities (v0.5.0): report success by default; tests can flip
        // `window.__toolLaunchResult` to assert the failure path.
        launchTool: (id: string) => {
          const w = window as unknown as { __toolLaunchResult?: unknown };
          return Promise.resolve(
            w.__toolLaunchResult ?? { success: true, message: `Opened ${id}.` }
          );
        },
        // Quick "Free RAM" (P1.1): success by default; E2E can override through
        // `window.__freeMemoryResult` to assert the failure path.
        freeMemory: () => {
          const w = window as unknown as { __freeMemoryResult?: unknown };
          return Promise.resolve(
            w.__freeMemoryResult ?? {
              success: true,
              freedMb: 42,
              rssBeforeMb: 1024,
              rssAfterMb: 982,
            }
          );
        },
      };

      (window as unknown as { electronAPI: typeof mockAPI }).electronAPI = mockAPI;

      // Test hook: broadcast a global operation status to all subscribers.
      (
        window as unknown as { __emitOperationStatus: (status: unknown) => void }
      ).__emitOperationStatus = (status) => {
        const w = window as unknown as { __opStatusListeners?: Array<(status: unknown) => void> };
        (w.__opStatusListeners ?? []).forEach((listener) => listener(status));
      };

      // Advanced feature pages use the `winoptimizer` namespace.
      const mockWinoptimizer = {
        drivers: {
          scan: () =>
            Promise.resolve({
              drivers: [],
              totalDevices: 0,
              outdatedCount: 0,
              upToDateCount: 0,
              scanDate: new Date(),
            }),
          createRestorePoint: () => Promise.resolve({ success: true, message: 'ok' }),
          install: () =>
            Promise.resolve({
              success: false,
              status: 'manual-action-required',
              url: 'https://example.com/driver',
              driverId: 'mock-driver',
              message:
                'Manual action required: the manufacturer download page was opened (https://example.com/driver).',
            }),
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
            Promise.resolve({
              isMonitoring: false,
              lastCheck: new Date(),
              driftEvents: [],
              tweaksAtRisk: 0,
            }),
          startMonitoring: () => Promise.resolve({ success: true }),
          stopMonitoring: () => Promise.resolve({ success: true }),
        },
        audit: {
          run: () => {
            const w = window as unknown as { __auditReport?: unknown };
            return Promise.resolve(
              w.__auditReport ?? {
                checks: [],
                totalChecks: 0,
                passedCount: 0,
                warningCount: 0,
                criticalCount: 0,
                score: 100,
                timestamp: new Date(),
              }
            );
          },
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
          // Live scanner mock (v0.6.0). Tests can seed `window.__securityReport`.
          scan: () => {
            const w = window as unknown as { __securityReport?: unknown };
            return Promise.resolve(
              w.__securityReport ?? {
                checks: [
                  {
                    id: 'antivirus',
                    status: 'pass',
                    evidence: 'Acme AV: real-time on, signatures up to date',
                    reason: 'Real-time protection is active.',
                  },
                  {
                    id: 'firewall',
                    status: 'pass',
                    evidence: 'Domain: on, Private: on, Public: on',
                    reason: 'Firewall is enabled.',
                  },
                  { id: 'uac', status: 'pass', evidence: 'EnableLUA=1', reason: 'UAC is enabled.' },
                  {
                    id: 'smb1',
                    status: 'pass',
                    evidence: 'EnableSMB1Protocol=False',
                    reason: 'SMBv1 is disabled.',
                  },
                  {
                    id: 'secure-boot',
                    status: 'pass',
                    evidence: 'Confirm-SecureBootUEFI = True',
                    reason: 'Secure Boot is enabled.',
                  },
                  { id: 'tpm', status: 'pass', evidence: 'TPM 2.0', reason: 'TPM is ready.' },
                  {
                    id: 'bitlocker',
                    status: 'pass',
                    evidence: 'ProtectionStatus=On',
                    reason: 'Drive encrypted.',
                  },
                  {
                    id: 'windows-update',
                    status: 'warn',
                    evidence: 'Last installed update: 100 days ago',
                    reason: 'The last update is old.',
                  },
                  {
                    id: 'guest-account',
                    status: 'pass',
                    evidence: 'Guest disabled',
                    reason: 'Guest is disabled.',
                  },
                  {
                    id: 'remote-desktop',
                    status: 'pass',
                    evidence: 'fDenyTSConnections=1',
                    reason: 'RDP disabled.',
                  },
                ],
                summary: {
                  pass: 8,
                  warn: 1,
                  fail: 0,
                  unknown: 1,
                  'not-applicable': 0,
                  'requires-admin': 0,
                },
                score: 93,
                scoredChecks: 9,
                excludedChecks: 1,
                totalChecks: 10,
                machine: {
                  osCaption: 'Microsoft Windows 11 Pro',
                  osVersion: '10.0.22631',
                  osBuild: '22631',
                  edition: 'Professional',
                  displayVersion: '23H2',
                  isAdmin: true,
                  collectedAt: new Date().toISOString(),
                },
                timestamp: new Date().toISOString(),
              }
            );
          },
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
          runNow: () =>
            Promise.resolve({ success: true, message: 'ok', filesDeleted: 0, spaceFreed: 0 }),
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
        tweaks: {
          get: () =>
            Promise.resolve([
              {
                id: 'show-file-extensions',
                name: 'Show file extensions',
                description: 'Shows known file extensions in File Explorer.',
                category: 'explorer' as const,
                safety: 'safe' as const,
                reversible: true as const,
                impact: 'low' as const,
                requiresAdmin: false,
                applied: false,
                apply: [
                  {
                    kind: 'registry' as const,
                    hive: 'HKCU' as const,
                    path: 'Software\\Explorer\\Advanced',
                    name: 'HideFileExt',
                    type: 'DWORD' as const,
                    value: 0,
                  },
                ],
                revert: [
                  {
                    kind: 'registry' as const,
                    hive: 'HKCU' as const,
                    path: 'Software\\Explorer\\Advanced',
                    name: 'HideFileExt',
                    type: 'DWORD' as const,
                    value: 1,
                  },
                ],
              },
            ]),
          preview: (id: string) =>
            Promise.resolve({
              id,
              name: id,
              reversible: true,
              applyOperations: [],
              revertOperations: [],
            }),
          apply: (id: string) => Promise.resolve({ id, success: true, message: 'ok' }),
          restore: (id: string) => Promise.resolve({ id, success: true, message: 'ok' }),
          applyMany: (ids: string[]) =>
            Promise.resolve(ids.map((id) => ({ id, success: true, message: 'ok' }))),
          restoreMany: (ids: string[]) =>
            Promise.resolve(ids.map((id) => ({ id, success: true, message: 'ok' }))),
        },
      };

      (window as unknown as { winoptimizer: typeof mockWinoptimizer }).winoptimizer =
        mockWinoptimizer;
    },
    {
      systemInfo: mockSystemInfo,
      junkFiles: mockJunkFiles,
      startupApps: mockStartupApps,
      installedApps: mockInstalledApps,
      systemServices: mockSystemServices,
      updateInfo: mockUpdateInfo,
    }
  );
}
