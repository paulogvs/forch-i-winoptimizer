import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scanDrivers,
  installDriver,
  cancelDriverOperation,
  parseDriverVersionFromTitle,
  isDriversExcludedFromWu,
  matchUpdateToDevice,
  classifyDriver,
} from './driver-updater';
import type { DriverInstallRequest } from '@shared/driver-update';

// ---- PowerShell boundary (scan path) ----
vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  runPowerShellScript: vi.fn(),
  runPowerShellWithTimeout: vi.fn(),
  parsePowerShellJson: vi.fn((data: string) => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }),
}));

// ---- Installer / downloader boundaries ----
vi.mock('./driver-installer', () => ({
  createRestorePoint: vi.fn(),
  installSilent: vi.fn(),
  installWindowsUpdateDriver: vi.fn(),
  verifyDriverInstalled: vi.fn(),
  getDeviceDriverInf: vi.fn(),
  saveDriverReceipt: vi.fn(),
  clearDriverReceipt: vi.fn(),
  loadDriverReceipt: vi.fn(),
  rollbackInstalledDriver: vi.fn(),
}));
vi.mock('./driver-downloader', () => ({
  downloadDriver: vi.fn(),
}));

import { runPowerShellScript } from './powershell';
import {
  createRestorePoint,
  installWindowsUpdateDriver,
  verifyDriverInstalled,
  getDeviceDriverInf,
  saveDriverReceipt,
  rollbackInstalledDriver,
} from './driver-installer';

function scanPayload(payload: Record<string, unknown>): void {
  vi.mocked(runPowerShellScript).mockResolvedValue({
    success: true,
    stdout: JSON.stringify(payload),
    stderr: '',
    exitCode: 0,
  });
}

const nvidiaDevice = {
  DeviceID: 'PCI\\VEN_10DE&DEV_2206',
  Name: 'NVIDIA GeForce RTX 3080',
  Manufacturer: 'NVIDIA',
  DriverVersion: '551.86',
  DriverDate: '2025-03-15',
  DeviceClass: 'Display',
  HardwareID: 'PCI\\VEN_10DE&DEV_2206',
};

describe('driver-updater: pure helpers', () => {
  it('parses a version from a Windows Update driver title', () => {
    expect(parseDriverVersionFromTitle('NVIDIA - Display - 31.0.15.4620')).toBe('31.0.15.4620');
    expect(parseDriverVersionFromTitle('Intel Corporation - Display - 27.20.100.8681')).toBe(
      '27.20.100.8681'
    );
    expect(parseDriverVersionFromTitle('no version here')).toBe('');
    expect(parseDriverVersionFromTitle(undefined)).toBe('');
  });

  it('honours the "Do not include drivers" GPO and the search-order key', () => {
    expect(isDriversExcludedFromWu(1, 1)).toBe(true);
    expect(isDriversExcludedFromWu('1', null)).toBe(true);
    expect(isDriversExcludedFromWu(null, 0)).toBe(true);
    expect(isDriversExcludedFromWu('0', 0)).toBe(true);
    expect(isDriversExcludedFromWu(null, 1)).toBe(false);
    expect(isDriversExcludedFromWu(null, null)).toBe(false);
  });

  it('matches an update to a device by hardware id', () => {
    const update = {
      Title: 'NVIDIA - Display - 31.0.15.4620',
      DriverHardwareID: 'PCI\\VEN_10DE&DEV_2206&SUBSYS_0000',
    };
    expect(matchUpdateToDevice(nvidiaDevice, [update])).toBe(update);
  });

  it('matches an update to a device by name when ids do not line up', () => {
    const update = { Title: 'NVIDIA GeForce RTX 3080 driver', DriverHardwareID: '' };
    expect(matchUpdateToDevice(nvidiaDevice, [update])).toBe(update);
  });

  it('never claims up-to-date when Windows Update did not answer', () => {
    const info = classifyDriver(nvidiaDevice, null, { excluded: false, wuResponded: false });
    expect(info.status).toBe('unknown');
    expect(info.isUpToDate).toBe(false);
  });

  it('never claims up-to-date when drivers are excluded by policy', () => {
    const info = classifyDriver(nvidiaDevice, null, { excluded: true, wuResponded: false });
    expect(info.status).toBe('unknown');
    expect(info.automatic).toBe(false);
  });

  it('marks up-to-date only when WU answered with nothing for the device', () => {
    const info = classifyDriver(nvidiaDevice, null, { excluded: false, wuResponded: true });
    expect(info.status).toBe('up-to-date');
    expect(info.isUpToDate).toBe(true);
  });

  it('marks an offered update as update-available with the WU source', () => {
    const update = {
      Title: 'NVIDIA - Display - 31.0.15.4620',
      DriverHardwareID: nvidiaDevice.HardwareID,
    };
    const info = classifyDriver(nvidiaDevice, update, { excluded: false, wuResponded: true });
    expect(info.status).toBe('update-available');
    expect(info.latestVersion).toBe('31.0.15.4620');
    expect(info.source).toBe('windows-update');
    expect(info.automatic).toBe(true);
    expect(info.updateTitle).toBe(update.Title);
  });
});

describe('driver-updater: scanDrivers (real Windows Update contract)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports "unknown" (never up-to-date) when WU did not answer', async () => {
    scanPayload({
      gpoExclude: null,
      searchOrder: 1,
      wuResponded: false,
      wuError: 'timeout',
      updates: [],
      devices: [nvidiaDevice],
    });
    const result = await scanDrivers();
    expect(result.wuStatus).toBe('unavailable');
    expect(result.unknownCount).toBe(1);
    expect(result.upToDateCount).toBe(0);
    expect(result.drivers[0]?.isUpToDate).toBe(false);
  });

  it('reports excluded by policy without claiming up-to-date', async () => {
    scanPayload({
      gpoExclude: 1,
      searchOrder: 1,
      wuResponded: false,
      updates: [],
      devices: [nvidiaDevice],
    });
    const result = await scanDrivers();
    expect(result.wuStatus).toBe('excluded');
    expect(result.drivers.every((d) => d.status === 'unknown')).toBe(true);
  });

  it('reports up-to-date when WU answered with no matching update', async () => {
    scanPayload({
      gpoExclude: null,
      searchOrder: 1,
      wuResponded: true,
      updates: [],
      devices: [nvidiaDevice],
    });
    const result = await scanDrivers();
    expect(result.wuStatus).toBe('ok');
    expect(result.upToDateCount).toBe(1);
    expect(result.outdatedCount).toBe(0);
  });

  it('reports an update when WU offers a driver for the device', async () => {
    scanPayload({
      gpoExclude: null,
      searchOrder: 1,
      wuResponded: true,
      updates: [
        {
          Title: 'NVIDIA - Display - 31.0.15.4620',
          DriverHardwareID: nvidiaDevice.HardwareID,
          MaxDownloadSize: 650000000,
        },
      ],
      devices: [nvidiaDevice],
    });
    const result = await scanDrivers();
    expect(result.outdatedCount).toBe(1);
    expect(result.drivers[0]?.latestVersion).toBe('31.0.15.4620');
    expect(result.drivers[0]?.source).toBe('windows-update');
  });

  it('degrades to unavailable when the scan process fails', async () => {
    vi.mocked(runPowerShellScript).mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'boom',
      exitCode: 1,
    });
    const result = await scanDrivers();
    expect(result.wuStatus).toBe('unavailable');
    expect(result.drivers).toEqual([]);
  });
});

describe('driver-updater: installDriver orchestration', () => {
  const request: DriverInstallRequest = {
    driverId: 'PCI\\VEN_10DE&DEV_2206',
    name: 'NVIDIA GeForce RTX 3080',
    manufacturer: 'NVIDIA',
    currentVersion: '551.86',
    expectedVersion: '31.0.15.4620',
    source: 'windows-update',
    updateTitle: 'NVIDIA - Display - 31.0.15.4620',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays honest for a manual source (never success, opens the page)', async () => {
    const openExternal = vi.fn(async () => undefined);
    const result = await installDriver(
      { ...request, source: null, updateTitle: '' },
      { openExternal }
    );
    expect(result.success).toBe(false);
    expect(result.status).toBe('manual-action-required');
    expect(openExternal).toHaveBeenCalledWith('https://www.nvidia.com/download/index.aspx');
  });

  it('aborts (never success) when the restore point cannot be verified', async () => {
    vi.mocked(createRestorePoint).mockResolvedValue({ success: false, message: 'no checkpoint' });
    const result = await installDriver(request);
    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.restorePointCreated).toBe(false);
    expect(vi.mocked(installWindowsUpdateDriver)).not.toHaveBeenCalled();
  });

  it('finishes only when the version is re-read and the device is OK', async () => {
    vi.mocked(createRestorePoint).mockResolvedValue({ success: true, message: 'ok' });
    vi.mocked(installWindowsUpdateDriver).mockResolvedValue({
      success: true,
      rebootRequired: true,
      message: 'installed',
    });
    vi.mocked(verifyDriverInstalled).mockResolvedValue({
      verified: true,
      actualVersion: '31.0.15.4620',
      deviceStatus: 'OK',
      message: 'ok',
    });
    vi.mocked(getDeviceDriverInf).mockResolvedValue('oem42.inf');

    const result = await installDriver(request);
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.verified).toBe(true);
    expect(result.rebootRequired).toBe(true);
    expect(result.rollbackAvailable).toBe(true);
    expect(vi.mocked(saveDriverReceipt)).toHaveBeenCalledTimes(1);
  });

  it('reports a real failure when the re-read does not confirm the install', async () => {
    vi.mocked(createRestorePoint).mockResolvedValue({ success: true, message: 'ok' });
    vi.mocked(installWindowsUpdateDriver).mockResolvedValue({
      success: true,
      rebootRequired: false,
      message: 'installed',
    });
    vi.mocked(verifyDriverInstalled).mockResolvedValue({
      verified: false,
      actualVersion: '551.86',
      deviceStatus: 'OK',
      message: 'still old',
    });
    const result = await installDriver(request);
    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.verified).toBe(false);
  });

  it('cancels an in-flight operation on request', async () => {
    let resolveInstall: (value: {
      success: boolean;
      rebootRequired: boolean;
      message: string;
    }) => void = () => {};
    vi.mocked(createRestorePoint).mockResolvedValue({ success: true, message: 'ok' });
    vi.mocked(installWindowsUpdateDriver).mockImplementation(
      () => new Promise((resolve) => (resolveInstall = resolve))
    );
    vi.mocked(verifyDriverInstalled).mockResolvedValue({
      verified: false,
      actualVersion: '551.86',
      deviceStatus: 'OK',
      message: 'cancelled',
    });

    const inFlight = installDriver(request);
    // Wait until the pipeline is actually inside the install step, then cancel.
    while (vi.mocked(installWindowsUpdateDriver).mock.calls.length === 0) {
      await Promise.resolve();
    }
    expect(cancelDriverOperation(request.driverId)).toBe(true);
    resolveInstall({ success: false, rebootRequired: false, message: 'cancelled' });
    const result = await inFlight;
    expect(result.success).toBe(false);
  });

  it('delegates rollback to the real installer', async () => {
    vi.mocked(rollbackInstalledDriver).mockResolvedValue({
      success: true,
      message: 'reverted',
      rollbackAvailable: false,
    });
    const { rollbackDriver } = await import('./driver-updater');
    const result = await rollbackDriver('PCI\\VEN_10DE&DEV_2206');
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
  });
});
