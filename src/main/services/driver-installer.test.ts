import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ensureNoRestart,
  buildInstallArgs,
  versionMatches,
  createRestorePoint,
  verifyDriverInstalled,
  installSilent,
  installWindowsUpdateDriver,
  rollbackInstalledDriver,
  saveDriverReceipt,
  loadDriverReceipt,
  setDriverInstallStoreDir,
  type DriverReceipt,
} from './driver-installer';

vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  runPowerShellWithTimeout: vi.fn(),
  parsePowerShellJson: vi.fn((data: string) => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }),
}));

import { runPowerShell, runPowerShellWithTimeout } from './powershell';

const DRIVER_ID = 'PCI\\VEN_10DE&DEV_2206';

function ps(stdout: unknown) {
  return {
    success: true,
    stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
    stderr: '',
    exitCode: 0,
  };
}

describe('driver-installer: pure helpers', () => {
  it('always enforces no-restart without duplicating vendor flags', () => {
    expect(ensureNoRestart(['-s', '-clean'])).toEqual(['-s', '-clean', '/norestart']);
    expect(ensureNoRestart(['-s', '-noreboot', '-clean'])).toEqual(['-s', '-noreboot', '-clean']);
    expect(ensureNoRestart(['-INSTALL', '-SILENT', '-NOREBOOT'])).toEqual([
      '-INSTALL',
      '-SILENT',
      '-NOREBOOT',
    ]);
    expect(ensureNoRestart(['-s', '--noreboot'])).toEqual(['-s', '--noreboot']);
  });

  it('builds catalog-driven silent args per manufacturer', () => {
    expect(buildInstallArgs('NVIDIA')).toEqual(['-s', '-noreboot', '-clean']);
    expect(buildInstallArgs('AMD')).toEqual(['-INSTALL', '-SILENT', '-NOREBOOT']);
    expect(buildInstallArgs('Intel')).toEqual(['-s', '--noreboot']);
    expect(buildInstallArgs('Generic')).toEqual(['/norestart']);
  });

  it('matches versions numerically', () => {
    expect(versionMatches('31.0.15.4620', '31.0.15.4620')).toBe(true);
    expect(versionMatches('31.0.15.4621', '31.0.15.4620')).toBe(false);
    expect(versionMatches('1.2.3', '1.2.3.0')).toBe(true);
    expect(versionMatches('anything', '')).toBe(true);
    expect(versionMatches('', '31.0.15.4620')).toBe(false);
  });
});

describe('driver-installer: restore point + verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('proves the restore point exists before claiming success', async () => {
    vi.mocked(runPowerShell).mockResolvedValue(ps({ verified: true, error: '', sequence: 7 }));
    const result = await createRestorePoint('before driver');
    expect(result.success).toBe(true);
  });

  it('reports failure when no restore point is re-read', async () => {
    vi.mocked(runPowerShell).mockResolvedValue(ps({ verified: false, error: 'disabled' }));
    const result = await createRestorePoint('before driver');
    expect(result.success).toBe(false);
    expect(result.message).toContain('disabled');
  });

  it('verifies only when version matches AND the device status is OK', async () => {
    vi.mocked(runPowerShell).mockResolvedValue(ps({ version: '31.0.15.4620', status: 'OK' }));
    const ok = await verifyDriverInstalled(DRIVER_ID, '31.0.15.4620');
    expect(ok.verified).toBe(true);

    vi.mocked(runPowerShell).mockResolvedValue(ps({ version: '551.86', status: 'OK' }));
    const stale = await verifyDriverInstalled(DRIVER_ID, '31.0.15.4620');
    expect(stale.verified).toBe(false);

    vi.mocked(runPowerShell).mockResolvedValue(ps({ version: '31.0.15.4620', status: 'Error' }));
    const badStatus = await verifyDriverInstalled(DRIVER_ID, '31.0.15.4620');
    expect(badStatus.verified).toBe(false);
  });
});

describe('driver-installer: silent install', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs with catalog flags + no-restart and reads the exit code', async () => {
    vi.mocked(runPowerShellWithTimeout).mockResolvedValue(ps({ code: 0 }));
    const result = await installSilent({
      driverId: DRIVER_ID,
      installerPath: 'C:\\temp\\setup.exe',
      manufacturer: 'NVIDIA',
    });
    expect(result.success).toBe(true);
    expect(result.rebootRequired).toBe(false);
    const script = vi.mocked(runPowerShellWithTimeout).mock.calls[0]?.[0] ?? '';
    expect(script).toContain('-s');
    expect(script).toContain('-noreboot');
    // 600s timeout is passed to the runner.
    expect(vi.mocked(runPowerShellWithTimeout).mock.calls[0]?.[1]).toBe(600_000);
  });

  it('flags rebootRequired on exit code 3010 (success + reboot)', async () => {
    vi.mocked(runPowerShellWithTimeout).mockResolvedValue(ps({ code: 3010 }));
    const result = await installSilent({
      driverId: DRIVER_ID,
      installerPath: 'C:\\temp\\setup.exe',
      manufacturer: 'AMD',
    });
    expect(result.success).toBe(true);
    expect(result.rebootRequired).toBe(true);
  });

  it('reports failure on a non-zero (non-3010) exit code', async () => {
    vi.mocked(runPowerShellWithTimeout).mockResolvedValue(ps({ code: 1603 }));
    const result = await installSilent({
      driverId: DRIVER_ID,
      installerPath: 'C:\\temp\\setup.exe',
      manufacturer: 'Intel',
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1603);
  });

  it('installs a Windows Update driver and surfaces the reboot flag', async () => {
    vi.mocked(runPowerShellWithTimeout).mockResolvedValue(ps({ ok: true, code: 2, reboot: true }));
    const result = await installWindowsUpdateDriver('NVIDIA - Display - 31.0.15.4620');
    expect(result.success).toBe(true);
    expect(result.rebootRequired).toBe(true);
  });
});

describe('driver-installer: real rollback with receipts', () => {
  let storeDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forchi-receipts-'));
    setDriverInstallStoreDir(storeDir);
  });

  afterEach(() => {
    setDriverInstallStoreDir(null);
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('persists and loads a receipt', async () => {
    const receipt: DriverReceipt = {
      driverId: DRIVER_ID,
      name: 'NVIDIA GeForce RTX 3080',
      manufacturer: 'NVIDIA',
      previousVersion: '551.86',
      installedVersion: '31.0.15.4620',
      oemInf: 'oem42.inf',
      restoreSequence: 7,
      installedAt: '2026-10-05T00:00:00.000Z',
      source: 'windows-update',
    };
    await saveDriverReceipt(receipt);
    expect(await loadDriverReceipt(DRIVER_ID)).toEqual(receipt);
  });

  it('refuses to roll back a driver the app did not install (no receipt)', async () => {
    const result = await rollbackInstalledDriver(DRIVER_ID);
    expect(result.success).toBe(false);
    expect(result.rollbackAvailable).toBe(false);
    expect(result.message).toMatch(/did not install it/i);
  });

  it('refuses when no oem .inf was captured (cannot revert confidently)', async () => {
    await saveDriverReceipt({
      driverId: DRIVER_ID,
      name: 'X',
      manufacturer: 'NVIDIA',
      previousVersion: '1.0',
      installedVersion: '2.0',
      oemInf: null,
      restoreSequence: null,
      installedAt: '2026-10-05T00:00:00.000Z',
      source: 'manual',
    });
    const result = await rollbackInstalledDriver(DRIVER_ID);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/oem \.inf/i);
  });

  it('rolls back via pnputil and only succeeds when the old version is re-read', async () => {
    await saveDriverReceipt({
      driverId: DRIVER_ID,
      name: 'X',
      manufacturer: 'NVIDIA',
      previousVersion: '551.86',
      installedVersion: '31.0.15.4620',
      oemInf: 'oem42.inf',
      restoreSequence: 7,
      installedAt: '2026-10-05T00:00:00.000Z',
      source: 'windows-update',
    });
    // 1) restore point (runPowerShell), 2) pnputil (runPowerShellWithTimeout), 3) re-read (runPowerShell)
    vi.mocked(runPowerShell)
      .mockResolvedValueOnce(ps({ verified: true, error: '', sequence: 8 }))
      .mockResolvedValueOnce(ps({ version: '551.86', status: 'OK' }));
    vi.mocked(runPowerShellWithTimeout).mockResolvedValue(ps({ code: 0, out: '' }));

    const result = await rollbackInstalledDriver(DRIVER_ID);
    expect(result.success).toBe(true);
    const pnputilCall = vi.mocked(runPowerShellWithTimeout).mock.calls[0]?.[0] ?? '';
    expect(pnputilCall).toContain('/delete-driver');
    expect(pnputilCall).toContain('/uninstall');
    expect(await loadDriverReceipt(DRIVER_ID)).toBeNull();
  });

  it('does not claim success when the previous version is not confirmed', async () => {
    await saveDriverReceipt({
      driverId: DRIVER_ID,
      name: 'X',
      manufacturer: 'NVIDIA',
      previousVersion: '551.86',
      installedVersion: '31.0.15.4620',
      oemInf: 'oem42.inf',
      restoreSequence: 7,
      installedAt: '2026-10-05T00:00:00.000Z',
      source: 'windows-update',
    });
    vi.mocked(runPowerShell)
      .mockResolvedValueOnce(ps({ verified: true, error: '', sequence: 8 }))
      .mockResolvedValueOnce(ps({ version: '31.0.15.4620', status: 'OK' }));
    vi.mocked(runPowerShellWithTimeout).mockResolvedValue(ps({ code: 0, out: '' }));

    const result = await rollbackInstalledDriver(DRIVER_ID);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not confirmed/i);
  });
});
