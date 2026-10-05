import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { QuickFixBar } from './QuickFixBar';
import { ToastProvider } from './ui/Toast';
import type { OperationStatus } from '@shared/electron-api';

type Listener = (status: OperationStatus) => void;
const IDLE: OperationStatus = { busy: false, current: null, queued: 0, startedAt: null };

interface QuickFixMocks {
  freeRam: ReturnType<typeof vi.fn>;
  cleanTemp: ReturnType<typeof vi.fn>;
  flushDns: ReturnType<typeof vi.fn>;
  createRestorePoint: ReturnType<typeof vi.fn>;
  scanDrivers: ReturnType<typeof vi.fn>;
}

function installBridge() {
  const listeners: Listener[] = [];
  const quickFixes: QuickFixMocks = {
    freeRam: vi.fn(),
    cleanTemp: vi.fn(),
    flushDns: vi.fn(),
    createRestorePoint: vi.fn(),
    scanDrivers: vi.fn(),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    getOperationStatus: vi.fn(() => Promise.resolve(IDLE)),
    onOperationStatus: vi.fn((cb: Listener) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
    quickFixes,
  };
  return { listeners, quickFixes };
}

function renderBar(onNavigate = vi.fn()) {
  return render(
    <ToastProvider>
      <QuickFixBar onNavigate={onNavigate} />
    </ToastProvider>
  );
}

const driverScan = {
  drivers: [],
  totalDevices: 3,
  outdatedCount: 1,
  upToDateCount: 2,
  unknownCount: 0,
  wuStatus: 'ok' as const,
  wuMessage: '1 driver update(s) offered by Windows Update.',
  scanDate: new Date(),
};

describe('QuickFixBar (Fase 3.1-3.5)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('renders all five 1-click actions', () => {
    installBridge();
    renderBar();

    for (const id of ['free-ram', 'clean-temp', 'flush-dns', 'restore-point', 'scan-drivers']) {
      expect(screen.getByTestId(`quickfix-${id}`)).toBeInTheDocument();
    }
  });

  it('Free RAM is a pure 1-click and reports the real before→after scope', async () => {
    const { quickFixes } = installBridge();
    quickFixes.freeRam.mockResolvedValue({
      success: true,
      freedMb: 42,
      rssBeforeMb: 1024,
      rssAfterMb: 982,
    });
    const onNavigate = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderBar(onNavigate);
    fireEvent.click(screen.getByTestId('quickfix-free-ram'));

    await waitFor(() => expect(screen.getByTestId('toast')).toBeInTheDocument());
    const toast = within(screen.getByTestId('toast'));
    expect(toast.getByText(/Freed 42 MB/)).toBeInTheDocument();
    expect(toast.getByText(/1024 → 982 MB/)).toBeInTheDocument();
    expect(toast.getByText(/not system RAM/)).toBeInTheDocument();
    // One-click pure: no dialog for Free RAM.
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'View in Statistics' }));
    expect(onNavigate).toHaveBeenCalledWith('statistics');
  });

  it('Flush DNS runs in one click and surfaces the verified result', async () => {
    const { quickFixes } = installBridge();
    quickFixes.flushDns.mockResolvedValue({
      success: true,
      entriesBefore: 20,
      entriesAfter: 0,
      message: 'DNS cache flushed (20 → 0 entries).',
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderBar();
    fireEvent.click(screen.getByTestId('quickfix-flush-dns'));

    await waitFor(() => expect(screen.getByTestId('toast')).toBeInTheDocument());
    expect(within(screen.getByTestId('toast')).getByText(/DNS cache flushed/)).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('Clean Temp asks for confirmation and only then deletes', async () => {
    const { quickFixes } = installBridge();
    quickFixes.cleanTemp.mockResolvedValue({
      success: true,
      scanned: 3,
      scannedBytes: 3072,
      deleted: 3,
      freedBytes: 3072,
      failed: 0,
      errors: [],
      message: 'Cleaned 3 file(s), freed 0.00 MB.',
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderBar();
    fireEvent.click(screen.getByTestId('quickfix-clean-temp'));
    expect(quickFixes.cleanTemp).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('quickfix-clean-temp'));
    await waitFor(() => expect(quickFixes.cleanTemp).toHaveBeenCalledTimes(1));
  });

  it('never hides a Clean Temp failure (error toast + visible status)', async () => {
    const { quickFixes } = installBridge();
    quickFixes.cleanTemp.mockResolvedValue({
      success: false,
      scanned: 2,
      scannedBytes: 2048,
      deleted: 1,
      freedBytes: 1024,
      failed: 1,
      errors: ['Failed to delete: C:\\Temp\\locked.tmp (in use)'],
      message: 'Cleaned 1 file(s), freed 0.00 MB — 1 could not be deleted.',
    });

    renderBar();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByTestId('quickfix-clean-temp'));

    await waitFor(() => expect(screen.getByTestId('toast')).toBeInTheDocument());
    expect(
      within(screen.getByTestId('toast')).getByText(/could not be deleted/)
    ).toBeInTheDocument();
    expect(screen.getByTestId('toast')).toHaveAttribute('data-variant', 'error');
    expect(screen.getByTestId('quickfix-status')).toHaveTextContent(/could not be deleted/);
  });

  it('Scan Drivers reports the real scan outcome', async () => {
    const { quickFixes } = installBridge();
    quickFixes.scanDrivers.mockResolvedValue(driverScan);

    renderBar();
    fireEvent.click(screen.getByTestId('quickfix-scan-drivers'));

    await waitFor(() => expect(screen.getByTestId('toast')).toBeInTheDocument());
    expect(
      within(screen.getByTestId('toast')).getByText(
        /Scanned 3 device\(s\): 1 update\(s\) available/
      )
    ).toBeInTheDocument();
  });

  it('disables every action while another operation owns the lock', async () => {
    const { listeners } = installBridge();
    renderBar();

    await waitFor(() => expect(screen.getByTestId('quickfix-free-ram')).not.toBeDisabled());

    act(() => {
      listeners.forEach((cb) =>
        cb({ busy: true, current: 'tweaks:apply', queued: 0, startedAt: Date.now() })
      );
    });

    expect(screen.getByTestId('quickfix-free-ram')).toBeDisabled();
    expect(screen.getByTestId('quickfix-clean-temp')).toBeDisabled();
  });
});
