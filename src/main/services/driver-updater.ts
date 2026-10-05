import { runPowerShellScript, parsePowerShellJson } from './powershell';
import { createNoopReporter, type ScanProgressReporter } from './scan-progress';
import { loadDriverCatalog, detectManufacturer, getManufacturerSpec } from './driver-catalog';
import {
  createRestorePoint,
  installSilent,
  installWindowsUpdateDriver,
  verifyDriverInstalled,
  getDeviceDriverInf,
  saveDriverReceipt,
  rollbackInstalledDriver,
} from './driver-installer';
import { downloadDriver } from './driver-downloader';
import type { DriverInfo, DriverScanResult } from '@shared/types';
import type {
  DriverDownloadOutcome,
  DriverInstallOutcome,
  DriverInstallRequest,
  DriverProgressEvent,
} from '@shared/driver-update';
import type { DriverInstallResult } from '@shared/electron-api';

/**
 * Driver detection (Fase 2.1) + orchestrator (Fase 2.6).
 *
 * LATEST_DRIVERS (a hardcoded, simulated March-2025 database) is GONE. The
 * offered updates now come from the real Windows Update COM API
 * (`IsInstalled=0 AND Type='Driver'`), queried in a SINGLE PowerShell process
 * together with the device enumeration, and the "Do not include drivers" GPO is
 * respected.
 *
 * Honest states: `up-to-date` only when Windows Update ANSWERED with nothing;
 * `unknown` when the search was blocked/silent (never show "up to date" on an
 * empty result from a non-answer, ref. Kudu's `emptyResult`).
 */

// ===== Windows Update scan (raw IPC) =====

export interface RawWuUpdate {
  Title?: string;
  DriverModel?: string;
  DriverHardwareID?: string;
  DriverProvider?: string;
  DriverClass?: string;
  DriverVerDate?: string;
  MaxDownloadSize?: number;
}

interface RawDevice {
  DeviceID?: string;
  Name?: string;
  Manufacturer?: string;
  DriverVersion?: string;
  DriverDate?: string;
  DeviceClass?: string;
  HardwareID?: string;
}

export interface RawWuScan {
  gpoExclude?: unknown;
  searchOrder?: unknown;
  wuResponded?: boolean;
  wuError?: string;
  updates?: RawWuUpdate[];
  devices?: RawDevice[];
}

/** GPO: drivers must not be searched/installed from Windows Update. */
export function isDriversExcludedFromWu(policyValue: unknown, searchOrderValue: unknown): boolean {
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  return num(policyValue) === 1 || num(searchOrderValue) === 0;
}

/** Extract a version-like token from a WU driver title. */
export function parseDriverVersionFromTitle(title: string | undefined): string {
  if (!title) return '';
  const dotted = /(\d+\.\d+\.\d+\.\d+|\d+\.\d+\.\d+|\d+\.\d+)/.exec(title);
  return dotted?.[1] ?? '';
}

function normalizeHwid(value: string | undefined): string {
  return (value ?? '').toUpperCase().replace(/\s+/g, '');
}

/** Match a WU driver update to a device by hardware id, then by name/model. */
export function matchUpdateToDevice(device: RawDevice, updates: RawWuUpdate[]): RawWuUpdate | null {
  const hwid = normalizeHwid(device.HardwareID);
  if (hwid.length >= 8) {
    for (const update of updates) {
      const ids = (update.DriverHardwareID ?? '')
        .split(/[;,]/)
        .map((id) => normalizeHwid(id))
        .filter((id) => id.length >= 8);
      if (ids.some((id) => id === hwid || id.includes(hwid) || hwid.includes(id))) return update;
    }
  }
  const name = (device.Name ?? '').toLowerCase();
  if (!name) return null;
  for (const update of updates) {
    const title = (update.Title ?? '').toLowerCase();
    const model = (update.DriverModel ?? '').toLowerCase();
    if (title.includes(name) || (model.length > 0 && name.includes(model))) return update;
  }
  return null;
}

function formatDriverDate(value: string | null | undefined): string {
  if (!value) return '';
  const match = /\/Date\((\d+)/.exec(value);
  if (match && match[1]) {
    return new Date(parseInt(match[1], 10)).toISOString().slice(0, 10);
  }
  return value;
}

/**
 * Build the DriverInfo for one device from the raw scan. Pure and fully tested:
 * the state machine (excluded / unknown / update / up-to-date) is decided here.
 */
export function classifyDriver(
  device: RawDevice,
  update: RawWuUpdate | null,
  status: { excluded: boolean; wuResponded: boolean }
): DriverInfo {
  const manufacturer = detectManufacturer(
    device.Name ?? '',
    device.Manufacturer ?? '',
    device.HardwareID ?? ''
  ) as DriverInfo['manufacturer'];
  const currentVersion = device.DriverVersion ?? '';

  const base: DriverInfo = {
    id: device.DeviceID ?? '',
    name: device.Name ?? '',
    manufacturer,
    currentVersion,
    latestVersion: currentVersion,
    isUpToDate: false,
    status: 'unknown',
    deviceClass: device.DeviceClass ?? '',
    hardwareId: device.HardwareID ?? '',
    releaseDate: formatDriverDate(device.DriverDate),
    downloadUrl: '',
    size: 0,
    source: null,
    updateTitle: '',
    automatic: false,
    requiresAdmin: true,
  };

  if (status.excluded || !status.wuResponded) {
    return base; // unknown: never claim "up to date" without an answer
  }

  if (update) {
    const latestVersion = parseDriverVersionFromTitle(update.Title) || currentVersion;
    return {
      ...base,
      status: 'update-available',
      isUpToDate: false,
      latestVersion,
      releaseDate: update.DriverVerDate || base.releaseDate,
      size: typeof update.MaxDownloadSize === 'number' ? update.MaxDownloadSize : 0,
      source: 'windows-update',
      updateTitle: update.Title ?? '',
      automatic: true,
      requiresAdmin: true,
    };
  }

  return {
    ...base,
    status: 'up-to-date',
    isUpToDate: true,
    automatic: false,
    requiresAdmin: false,
  };
}

function buildScanScript(): string {
  const catalog = loadDriverCatalog();
  const wu = catalog?.windowsUpdate;
  const policyPath = (wu?.policyRegistryPath ?? '').replace(/'/g, "''");
  const policyName = (wu?.policyValueName ?? '').replace(/'/g, "''");
  const searchPath = (wu?.searchOrderRegistryPath ?? '').replace(/'/g, "''");
  const searchName = (wu?.searchOrderValueName ?? '').replace(/'/g, "''");
  const query = (wu?.searchQuery ?? "IsInstalled=0 AND Type='Driver'").replace(/"/g, '`"');

  return `
    $gpoExclude = $null;
    try { $gpoExclude = (Get-ItemProperty -Path '${policyPath}' -Name '${policyName}' -ErrorAction Stop).'${policyName}' } catch { $gpoExclude = $null }
    $searchOrder = $null;
    try { $searchOrder = (Get-ItemProperty -Path '${searchPath}' -Name '${searchName}' -ErrorAction SilentlyContinue).'${searchName}' } catch { $searchOrder = $null }

    $drivers = @{};
    Get-CimInstance -ClassName Win32_PnPSignedDriver -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.DeviceID) { $drivers[$_.DeviceID] = $_ }
    };
    $devices = Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction SilentlyContinue |
      Where-Object { $_.PNPClass -in @('Display', 'Net', 'Media', 'HIDClass', 'USB', 'SCSIAdapter', 'System') };
    $deviceOut = foreach ($d in $devices) {
      $drv = $drivers[$d.DeviceID];
      [pscustomobject]@{
        DeviceID = $d.DeviceID;
        Name = $d.Name;
        Manufacturer = $d.Manufacturer;
        DriverVersion = $(if ($drv) { $drv.DriverVersion } else { $null });
        DriverDate = $(if ($drv) { $drv.DriverDate } else { $null });
        DeviceClass = $d.PNPClass;
        HardwareID = @($d.HardwareID) | Select-Object -First 1
      }
    };

    $wuResponded = $false; $wuError = ''; $updates = @();
    $excluded = ($gpoExclude -eq 1) -or ($searchOrder -eq 0);
    if (-not $excluded) {
      try {
        $session = New-Object -ComObject Microsoft.Update.Session;
        $searcher = $session.CreateUpdateSearcher();
        $searcher.Online = $true;
        $res = $searcher.Search("${query}");
        $wuResponded = $true;
        $list = @();
        foreach ($u in $res.Updates) {
          $list += [pscustomobject]@{
            Title = [string]$u.Title;
            DriverModel = [string]$u.DriverModel;
            DriverHardwareID = [string]$u.DriverHardwareID;
            DriverProvider = [string]$u.DriverProvider;
            DriverClass = [string]$u.DriverClass;
            DriverVerDate = [string]$u.DriverVerDate;
            MaxDownloadSize = $u.MaxDownloadSize
          }
        }
        $updates = @($list);
      } catch { $wuError = $_.Exception.Message }
    }

    @{
      gpoExclude = $gpoExclude; searchOrder = $searchOrder; wuResponded = $wuResponded;
      wuError = $wuError; updates = @($updates); devices = @($deviceOut)
    } | ConvertTo-Json -Depth 6 -Compress
  `;
}

function emptyResult(wuStatus: DriverScanResult['wuStatus'], wuMessage: string): DriverScanResult {
  return {
    drivers: [],
    totalDevices: 0,
    outdatedCount: 0,
    upToDateCount: 0,
    unknownCount: 0,
    wuStatus,
    wuMessage,
    scanDate: new Date(),
  };
}

export async function scanDrivers(reporter?: ScanProgressReporter): Promise<DriverScanResult> {
  const progress = reporter ?? createNoopReporter('drivers');
  progress.report('query', 15, 'Enumerating devices and querying Windows Update...');

  // One process: device enumeration + the WU COM driver search. The WU search can
  // block on the network, so it gets the long runner (120s).
  const result = await runPowerShellScript(buildScanScript());

  if (!result.success || !result.stdout) {
    progress.fail('Driver scan failed');
    return emptyResult(
      'unavailable',
      `Windows Update did not answer: ${result.stderr || 'the scan could not run'}`
    );
  }

  progress.report('parse', 70, 'Parsing device list and updates...');
  const raw = parsePowerShellJson<RawWuScan>(result.stdout);
  if (!raw) {
    progress.fail('Could not parse the driver scan output');
    return emptyResult('unavailable', 'Windows Update did not answer (unparseable result).');
  }

  const excluded = isDriversExcludedFromWu(raw.gpoExclude, raw.searchOrder);
  const wuResponded = raw.wuResponded === true;
  const updates = Array.isArray(raw.updates) ? raw.updates : [];
  const devices = Array.isArray(raw.devices) ? raw.devices : [];

  const drivers: DriverInfo[] = [];
  let outdatedCount = 0;
  let upToDateCount = 0;
  let unknownCount = 0;

  for (const device of devices) {
    if (!device.Name || !device.DriverVersion) continue;
    const update = matchUpdateToDevice(device, updates);
    const info = classifyDriver(device, update, { excluded, wuResponded });
    if (info.status === 'update-available') outdatedCount++;
    else if (info.status === 'up-to-date') upToDateCount++;
    else unknownCount++;
    drivers.push(info);
  }

  progress.done('Driver scan complete');

  const wuStatus: DriverScanResult['wuStatus'] = excluded
    ? 'excluded'
    : wuResponded
      ? 'ok'
      : 'unavailable';
  const wuMessage = excluded
    ? 'Windows Update driver search is disabled by policy ("Do not include drivers").'
    : wuResponded
      ? `${updates.length} driver update(s) offered by Windows Update.`
      : `Windows Update did not answer: ${raw.wuError || 'no response'}`;

  return {
    drivers,
    totalDevices: drivers.length,
    outdatedCount,
    upToDateCount,
    unknownCount,
    wuStatus,
    wuMessage,
    scanDate: new Date(),
  };
}

// ===== Cancellation (Fase 2.6) =====

const aborts = new Map<string, AbortController>();

function beginOperation(driverId: string): AbortController {
  cancelDriverOperation(driverId);
  const controller = new AbortController();
  aborts.set(driverId, controller);
  return controller;
}

function endOperation(driverId: string, controller: AbortController): void {
  if (aborts.get(driverId) === controller) aborts.delete(driverId);
}

/** Cancel an in-flight download/install for a driver. Returns true if one was active. */
export function cancelDriverOperation(driverId: string): boolean {
  const controller = aborts.get(driverId);
  if (!controller) return false;
  controller.abort();
  aborts.delete(driverId);
  return true;
}

// ===== Install orchestration (Fase 2.3-2.5) =====

export interface InstallDeps {
  onProgress?: (event: DriverProgressEvent) => void;
  /** Test seam: open a URL instead of Electron's shell. */
  openExternal?: (url: string) => Promise<void>;
}

async function defaultOpenExternal(url: string): Promise<void> {
  const { shell } = await import('electron');
  await shell.openExternal(url);
}

function manualActionRequired(request: DriverInstallRequest, url: string): DriverInstallResult {
  return {
    success: false,
    status: 'manual-action-required',
    driverId: request.driverId,
    url,
    message:
      `Manual action required: no automatic source is available for ${request.name}. ` +
      `The download page was opened (${url}); download and install it manually.`,
  };
}

/**
 * Orchestrate a driver update end to end.
 *
 *  - windows-update  -> WU COM download+install, restore point, re-verify
 *  - manual + direct -> BITS/stream download + hash/sig verify + silent install
 *  - otherwise       -> honest `manual-action-required` (never a fake success)
 */
export async function installDriver(
  request: DriverInstallRequest,
  deps: InstallDeps = {},
  reporter?: ScanProgressReporter
): Promise<DriverInstallResult> {
  const progress = reporter ?? createNoopReporter('drivers');
  const emit = (event: Omit<DriverProgressEvent, 'driverId'>): void => {
    const full: DriverProgressEvent = { driverId: request.driverId, ...event };
    progress.report(
      event.stage === 'done' ? 'done' : event.stage === 'error' ? 'error' : 'normalize',
      event.percent,
      event.message
    );
    deps.onProgress?.(full);
  };
  const openExternal = deps.openExternal ?? defaultOpenExternal;

  if (request.source === 'windows-update') {
    if (!request.updateTitle) {
      return {
        success: false,
        status: 'failed',
        driverId: request.driverId,
        message: 'No Windows Update title was provided for this driver.',
      };
    }
    const controller = beginOperation(request.driverId);
    try {
      emit({ stage: 'restore-point', percent: 0, message: 'Creating a restore point...' });
      const restore = await createRestorePoint(`Before driver update: ${request.name}`);
      if (!restore.success) {
        return {
          success: false,
          status: 'failed',
          driverId: request.driverId,
          restorePointCreated: false,
          message: `Aborted: ${restore.message}`,
        };
      }
      emit({ stage: 'install', percent: 40, message: 'Installing via Windows Update...' });
      const install = await installWindowsUpdateDriver(request.updateTitle, 600_000);
      if (!install.success) {
        return {
          success: false,
          status: 'failed',
          driverId: request.driverId,
          restorePointCreated: true,
          rebootRequired: install.rebootRequired,
          message: install.message,
        };
      }
      emit({ stage: 'reverify', percent: 85, message: 'Re-reading the installed version...' });
      const verify = await verifyDriverInstalled(request.driverId, request.expectedVersion);
      if (!verify.verified) {
        return {
          success: false,
          status: 'failed',
          driverId: request.driverId,
          restorePointCreated: true,
          verified: false,
          rebootRequired: install.rebootRequired,
          message: `Install ran but was not confirmed: ${verify.message}`,
        };
      }
      const oemInf = await getDeviceDriverInf(request.driverId);
      await saveDriverReceipt({
        driverId: request.driverId,
        name: request.name,
        manufacturer: request.manufacturer,
        previousVersion: request.currentVersion,
        installedVersion: verify.actualVersion,
        oemInf,
        restoreSequence: null,
        installedAt: new Date().toISOString(),
        source: 'windows-update',
      });
      emit({ stage: 'done', percent: 100, message: 'Driver installed and verified.' });
      return {
        success: true,
        status: 'completed',
        driverId: request.driverId,
        verified: true,
        restorePointCreated: true,
        rebootRequired: install.rebootRequired,
        rollbackAvailable: oemInf !== null,
        message: `Installed ${verify.actualVersion} and verified (device OK).`,
      };
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        driverId: request.driverId,
        message: `Driver update failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      endOperation(request.driverId, controller);
    }
  }

  if (request.source === 'manual' && request.downloadUrl && request.sha256) {
    const spec = getManufacturerSpec(request.manufacturer);
    if (!spec || spec.sourceKind === 'none' || spec.signerPatterns.length === 0) {
      // Explicitly refuse unknown vendor signatures: no trusted signer list.
      emit({ stage: 'error', percent: 100, message: 'No trusted vendor signer for this driver.' });
      return {
        success: false,
        status: 'blocked',
        driverId: request.driverId,
        message:
          'Refusing to auto-install: no trusted signer patterns are defined for this manufacturer.',
      };
    }
    const controller = beginOperation(request.driverId);
    try {
      emit({ stage: 'restore-point', percent: 0, message: 'Creating a restore point...' });
      const restore = await createRestorePoint(`Before driver update: ${request.name}`);
      if (!restore.success) {
        return {
          success: false,
          status: 'failed',
          driverId: request.driverId,
          restorePointCreated: false,
          message: `Aborted: ${restore.message}`,
        };
      }

      const download = await downloadDriver({
        driverId: request.driverId,
        url: request.downloadUrl,
        expectedSha256: request.sha256,
        expectedSize: request.size,
        signerPatterns: spec.signerPatterns,
        signal: controller.signal,
        onProgress: (event) => deps.onProgress?.(event),
      });
      if (!download.success || !download.filePath) {
        return {
          success: false,
          status: /cancel/i.test(download.message) ? 'cancelled' : 'failed',
          driverId: request.driverId,
          restorePointCreated: true,
          message: download.message,
        };
      }

      emit({ stage: 'install', percent: 60, message: 'Running the silent installer...' });
      const install = await installSilent({
        driverId: request.driverId,
        installerPath: download.filePath,
        manufacturer: request.manufacturer,
      });
      if (!install.success) {
        return {
          success: false,
          status: 'failed',
          driverId: request.driverId,
          restorePointCreated: true,
          downloadedBytes: download.bytes,
          sha256: download.sha256,
          signature: download.signature,
          message: install.message,
        };
      }

      emit({ stage: 'reverify', percent: 85, message: 'Re-reading the installed version...' });
      const verify = await verifyDriverInstalled(request.driverId, request.expectedVersion);
      if (!verify.verified) {
        return {
          success: false,
          status: 'failed',
          driverId: request.driverId,
          restorePointCreated: true,
          verified: false,
          rebootRequired: install.rebootRequired,
          message: `Install ran but was not confirmed: ${verify.message}`,
        };
      }

      const oemInf = await getDeviceDriverInf(request.driverId);
      await saveDriverReceipt({
        driverId: request.driverId,
        name: request.name,
        manufacturer: request.manufacturer,
        previousVersion: request.currentVersion,
        installedVersion: verify.actualVersion,
        oemInf,
        restoreSequence: null,
        installedAt: new Date().toISOString(),
        source: 'manual',
      });

      emit({ stage: 'done', percent: 100, message: 'Driver installed and verified.' });
      return {
        success: true,
        status: 'completed',
        driverId: request.driverId,
        verified: true,
        restorePointCreated: true,
        rebootRequired: install.rebootRequired,
        rollbackAvailable: oemInf !== null,
        downloadedBytes: download.bytes,
        sha256: download.sha256,
        signature: download.signature,
        message: `Installed ${verify.actualVersion} and verified (device OK).`,
      };
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        driverId: request.driverId,
        message: `Driver update failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      endOperation(request.driverId, controller);
    }
  }

  // No automatic source: stay honest and open the manufacturer page when known.
  const url = request.downloadUrl || getManufacturerSpec(request.manufacturer)?.downloadPage || '';
  if (url) {
    try {
      await openExternal(url);
    } catch (error) {
      return {
        success: false,
        status: 'failed',
        driverId: request.driverId,
        url,
        message: `Could not open the manufacturer download page (${url}): ${String(error)}`,
      };
    }
    return manualActionRequired(request, url);
  }
  return {
    success: false,
    status: 'blocked',
    driverId: request.driverId,
    message: 'No automatic source and no download page is available for this driver.',
  };
}

/** Download-only entry point (Fase 2.3), used by the `drivers:download` channel. */
export async function downloadDriverUpdate(
  request: DriverInstallRequest
): Promise<DriverDownloadOutcome> {
  if (!request.downloadUrl || !request.sha256) {
    return {
      success: false,
      driverId: request.driverId,
      message: 'No direct download URL and hash are available (manual source).',
    };
  }
  const spec = getManufacturerSpec(request.manufacturer);
  const result = await downloadDriver({
    driverId: request.driverId,
    url: request.downloadUrl,
    expectedSha256: request.sha256,
    expectedSize: request.size,
    signerPatterns: spec?.signerPatterns ?? [],
  });
  return {
    success: result.success,
    driverId: request.driverId,
    filePath: result.filePath,
    bytes: result.bytes,
    sha256: result.sha256,
    signature: result.signature,
    verified: result.verified,
    message: result.message,
  };
}

/** Real rollback (Fase 2.5) for drivers the app installed. */
export async function rollbackDriver(driverId: string): Promise<DriverInstallResult> {
  const result = await rollbackInstalledDriver(driverId);
  return {
    success: result.success,
    status: result.success ? 'completed' : 'blocked',
    driverId,
    rollbackAvailable: result.rollbackAvailable,
    message: result.message,
  };
}

export { createRestorePoint } from './driver-installer';
export type { DriverInstallOutcome };
