import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dashboard } from './Dashboard';
import { ToastProvider } from '../components/ui/Toast';

const systemInfo = {
  platform: 'win32',
  release: '10.0.22631',
  arch: 'x64',
  hostname: 'TEST-PC',
  username: 'tester',
  uptime: 3600,
  cpu: { model: 'Test CPU', cores: 8, usage: 12 },
  memory: { total: 16 * 1024 ** 3, free: 8 * 1024 ** 3, used: 8 * 1024 ** 3, usagePercent: 50 },
  disk: { total: 512 * 1024 ** 3, free: 256 * 1024 ** 3, used: 256 * 1024 ** 3, usagePercent: 50 },
  gpu: { name: 'Test GPU', vram: 8 * 1024 ** 3, driverVersion: '1.0.0' },
  windowsVersion: 'Windows 11',
  windowsBuild: '22631',
  lastBootTime: new Date(),
};

function installBridge() {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    getSystemInfo: () => Promise.resolve(systemInfo),
    clearCache: () => Promise.resolve({ success: true }),
    getOperationStatus: () =>
      Promise.resolve({ busy: false, current: null, queued: 0, startedAt: null }),
    onOperationStatus: () => () => {},
    quickFixes: {
      freeRam: vi.fn(),
      cleanTemp: vi.fn(),
      flushDns: vi.fn(),
      createRestorePoint: vi.fn(),
      scanDrivers: vi.fn(),
    },
  };
}

describe('Dashboard quick actions (Fase 3.1)', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('shows the visible Quick fixes bar with all five actions', async () => {
    installBridge();
    render(
      <ToastProvider>
        <Dashboard onNavigate={vi.fn()} />
      </ToastProvider>
    );

    expect(await screen.findByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('Quick fixes')).toBeInTheDocument();

    for (const id of ['free-ram', 'clean-temp', 'flush-dns', 'restore-point', 'scan-drivers']) {
      expect(screen.getByTestId(`quickfix-${id}`)).toBeInTheDocument();
    }
  });
});
