import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runPowerShell, runPowerShellWithTimeout, parsePowerShellJson } from './powershell';
import { getSilentInstallArgs } from './driver-catalog';

/**
 * Driver installer (Fase 2.4) + real rollback (Fase 2.5).
 *
 * Golden rule: never report success without verifying the real effect. This
 * module re-reads `Win32_PnPSignedDriver.DriverVersion` and
 * `Get-PnpDevice Status` after install, and a rollback is only offered when a
 * receipt (oem .inf + previous version) was captured for what the app installed.
 *
 * What is deliberately NOT automated (see `catalogs/driver-catalog.json`
 * `notAutomated`): BIOS/firmware, DDU/cleanup, unsigned drivers, forced reboot,
 * disabling signature enforcement, parallel installs.
 */

export interface SilentInstallOptions {
  driverId: string;
  installerPath: string;
  manufacturer: string;
  /** Extra args from the caller (vendor-specific manifest). */
  extraArgs?: string[];
  timeoutMs?: number;
  logDir?: string;
}

export interface SilentInstallResult {
  success: boolean;
  message: string;
  exitCode: number | null;
  rebootRequired: boolean;
  logPath?: string;
}

/**
 * Append `/norestart` unless the vendor args already carry an explicit
 * no-restart flag (NVIDIA `-noreboot`, AMD `-NOREBOOT`, Intel `--noreboot`).
 * Guarantees "always no forced reboot" without duplicating vendor flags.
 */
export function ensureNoRestart(args: string[]): string[] {
  const hasNoRestart = args.some((a) => /norestart|noreboot/i.test(a));
  return hasNoRestart ? [...args] : [...args, '/norestart'];
}

/** Build the arg list for a manufacturer installer, data-driven + no-restart. */
export function buildInstallArgs(manufacturer: string, extraArgs: string[] = []): string[] {
  return ensureNoRestart([...getSilentInstallArgs(manufacturer), ...extraArgs]);
}

/** Pure: does the re-read version satisfy the expected one? */
export function versionMatches(actual: string, expected: string): boolean {
  if (!expected) return actual.trim().length > 0;
  const parse = (v: string): number[] => v.split(/[.\s]/).map((n) => parseInt(n, 10) || 0);
  const a = parse(actual);
  const b = parse(expected);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return false;
  }
  return true;
}

function quote(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Restore point creation (verified). Errors terminate; the newest restore point
 * is re-read to prove the checkpoint really exists before reporting success.
 * Aborting the driver pipeline when this fails is the orchestrator's job.
 */
export async function createRestorePoint(
  description: string
): Promise<{ success: boolean; message: string }> {
  const result = await runPowerShell(`
    $ErrorActionPreference = 'Stop';
    $err = '';
    try {
      Enable-ComputerRestore -Drive "C:\\" -ErrorAction Stop;
      Checkpoint-Computer -Description "${quote(description)}" -RestorePointType "MODIFY_SETTINGS" -ErrorAction Stop;
    } catch { $err = $_.Exception.Message }
    $rp = Get-ComputerRestorePoint -ErrorAction SilentlyContinue | Sort-Object -Property SequenceNumber -Descending | Select-Object -First 1;
    $verified = ($err -eq '') -and ($null -ne $rp);
    @{ verified = $verified; error = $err; sequence = $(if ($rp) { $rp.SequenceNumber } else { $null }) } | ConvertTo-Json -Compress
  `);

  const payload = result.success
    ? parsePowerShellJson<{ verified?: boolean; error?: string }>(result.stdout)
    : null;
  const verified = payload?.verified === true;

  return {
    success: verified,
    message: verified
      ? 'Restore point created successfully'
      : `Failed to create restore point: ${
          payload?.error || result.stderr || 'the checkpoint was not confirmed'
        }`,
  };
}

interface PnpDriverRead {
  version?: string;
  status?: string;
}

/**
 * Re-read the live device/driver state. The returned values are MEASURED, not
 * assumed: install success is decided from this output alone.
 */
export async function verifyDriverInstalled(
  driverId: string,
  expectedVersion: string
): Promise<{ verified: boolean; actualVersion: string; deviceStatus: string; message: string }> {
  const id = quote(driverId);
  const result = await runPowerShell(`
    $drv = Get-CimInstance -ClassName Win32_PnPSignedDriver -Filter "DeviceID='${id}'" -ErrorAction SilentlyContinue | Select-Object -First 1;
    $dev = Get-PnpDevice -InstanceId '${id}' -ErrorAction SilentlyContinue | Select-Object -First 1;
    $version = $(if ($drv) { [string]$drv.DriverVersion } else { '' });
    $status = $(if ($dev) { [string]$dev.Status } else { '' });
    @{ version = $version; status = $status } | ConvertTo-Json -Compress
  `);

  const payload = result.success ? parsePowerShellJson<PnpDriverRead>(result.stdout) : null;
  const actualVersion = payload?.version ?? '';
  const deviceStatus = payload?.status ?? '';
  const versionOk = versionMatches(actualVersion, expectedVersion);
  const statusOk = deviceStatus.toLowerCase() === 'ok';
  const verified = versionOk && statusOk;

  return {
    verified,
    actualVersion,
    deviceStatus,
    message: verified
      ? `DriverVersion ${actualVersion} confirmed, device status OK`
      : `Verification failed (version="${actualVersion}", status="${deviceStatus}")`,
  };
}

/** Read the oem .inf currently bound to a device (used by rollback). */
export async function getDeviceDriverInf(driverId: string): Promise<string | null> {
  const id = quote(driverId);
  const result = await runPowerShell(`
    $value = '';
    try {
      $value = [string](Get-PnpDeviceProperty -InstanceId '${id}' -KeyName 'DEVPKEY_Device_DriverInfPath' -ErrorAction Stop).Data;
    } catch { $value = '' }
    @{ inf = $value } | ConvertTo-Json -Compress
  `);
  const payload = result.success ? parsePowerShellJson<{ inf?: string }>(result.stdout) : null;
  const inf = payload?.inf?.trim();
  return inf && inf.length > 0 ? inf : null;
}

/** Run a silent installer with a real log and a 600s timeout. */
export async function installSilent(options: SilentInstallOptions): Promise<SilentInstallResult> {
  const args = buildInstallArgs(options.manufacturer, options.extraArgs ?? []);
  const logDir = options.logDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'forchi-driver-log-'));
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(
    logDir,
    `install-${options.driverId.replace(/[^A-Za-z0-9._-]/g, '_')}.log`
  );
  const timeoutMs = options.timeoutMs ?? 600_000;
  const argList = args.map((a) => `'${quote(a)}'`).join(',');

  const result = await runPowerShellWithTimeout(
    `
    $logPath = '${quote(logPath)}';
    "Starting install at $(Get-Date -Format o)" | Out-File -FilePath $logPath -Encoding utf8;
    $args = @(${argList});
    $p = Start-Process -FilePath '${quote(options.installerPath)}' -ArgumentList $args -Wait -PassThru -NoNewWindow;
    $code = $p.ExitCode;
    "ExitCode=$code" | Out-File -FilePath $logPath -Append -Encoding utf8;
    @{ code = $code } | ConvertTo-Json -Compress
  `,
    timeoutMs
  );

  const payload = result.success ? parsePowerShellJson<{ code?: number }>(result.stdout) : null;
  const exitCode = typeof payload?.code === 'number' ? payload.code : null;
  const rebootRequired = exitCode === 3010 || exitCode === 1641;
  // 0 = success, 3010 = success but reboot required, 1641 = reboot initiated.
  const success = exitCode === 0 || exitCode === 3010;

  return {
    success,
    exitCode,
    rebootRequired,
    logPath,
    message: success
      ? rebootRequired
        ? 'Installer finished; a reboot is required.'
        : 'Installer finished successfully.'
      : `Installer failed (exit code ${exitCode ?? 'unknown'}).`,
  };
}

interface WuInstallPayload {
  ok?: boolean;
  code?: number;
  reboot?: boolean;
  error?: string;
}

/**
 * Install a specific Windows Update driver by title (source A). Downloads and
 * installs through the WU COM API, never forcing a reboot.
 */
export async function installWindowsUpdateDriver(
  updateTitle: string,
  timeoutMs = 600_000
): Promise<{ success: boolean; rebootRequired: boolean; message: string }> {
  const result = await runPowerShellWithTimeout(
    `
    $title = '${quote(updateTitle)}';
    try {
      $session = New-Object -ComObject Microsoft.Update.Session;
      $searcher = $session.CreateUpdateSearcher();
      $res = $searcher.Search("IsInstalled=0 AND Type='Driver'");
      $u = $null;
      foreach ($cand in $res.Updates) { if ($cand.Title -eq $title) { $u = $cand; break } }
      if (-not $u) {
        @{ ok = $false; code = $null; reboot = $false; error = 'update-not-found' } | ConvertTo-Json -Compress;
      } else {
        $dl = $session.CreateUpdateDownloader(); $dl.Updates.Add($u) | Out-Null; $dl.Download() | Out-Null;
        $inst = $session.CreateUpdateInstaller(); $inst.Updates.Add($u) | Out-Null; $inst.IsForced = $false;
        $r = $inst.Install();
        @{ ok = ([int]$r.ResultCode -eq 2); code = [int]$r.ResultCode; reboot = [bool]$r.RebootRequired; error = [string]$r.HResult } | ConvertTo-Json -Compress
      }
    } catch {
      @{ ok = $false; code = $null; reboot = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
  `,
    timeoutMs
  );

  const payload = result.success ? parsePowerShellJson<WuInstallPayload>(result.stdout) : null;
  return {
    success: payload?.ok === true,
    rebootRequired: payload?.reboot === true,
    message: payload?.ok
      ? 'Windows Update driver installed.'
      : `Windows Update driver install failed: ${payload?.error || result.stderr || 'unknown error'}`,
  };
}

// ---------------------------------------------------------------------------
// Receipts: what the app installed, so a real rollback is possible.
// ---------------------------------------------------------------------------

export interface DriverReceipt {
  driverId: string;
  name: string;
  manufacturer: string;
  previousVersion: string;
  installedVersion: string;
  oemInf: string | null;
  restoreSequence: number | null;
  installedAt: string;
  source: 'windows-update' | 'manual';
}

const STORE_FILE = 'driver-receipts.json';
let storeDirOverride: string | null = null;

/** Test seam: override the directory that holds `driver-receipts.json`. */
export function setDriverInstallStoreDir(dir: string | null): void {
  storeDirOverride = dir;
}

async function storeDir(): Promise<string> {
  if (storeDirOverride) return storeDirOverride;
  try {
    const { app } = await import('electron');
    return app.getPath('userData');
  } catch {
    return process.cwd();
  }
}

async function readReceipts(): Promise<Record<string, DriverReceipt>> {
  try {
    const dir = await storeDir();
    const raw = fs.readFileSync(path.join(dir, STORE_FILE), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, DriverReceipt>)
      : {};
  } catch {
    return {};
  }
}

async function writeReceipts(store: Record<string, DriverReceipt>): Promise<void> {
  try {
    const dir = await storeDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, STORE_FILE), JSON.stringify(store, null, 2), 'utf8');
  } catch {
    /* persistence failure must never crash the app */
  }
}

export async function saveDriverReceipt(receipt: DriverReceipt): Promise<void> {
  const store = await readReceipts();
  store[receipt.driverId] = receipt;
  await writeReceipts(store);
}

export async function loadDriverReceipt(driverId: string): Promise<DriverReceipt | null> {
  const store = await readReceipts();
  return store[driverId] ?? null;
}

export async function clearDriverReceipt(driverId: string): Promise<void> {
  const store = await readReceipts();
  delete store[driverId];
  await writeReceipts(store);
}

/**
 * Real rollback (Fase 2.5): create a restore point, remove the driver the app
 * installed via `pnputil /delete-driver <oem#.inf> /uninstall`, then RE-READ the
 * version to prove the original came back.
 *
 * Honest by design: when no receipt (or no oem .inf) is available the rollback
 * is refused and disabled, rather than pretending to have reverted anything.
 */
export async function rollbackInstalledDriver(
  driverId: string
): Promise<{ success: boolean; message: string; rollbackAvailable: boolean }> {
  const receipt = await loadDriverReceipt(driverId);
  if (!receipt) {
    return {
      success: false,
      rollbackAvailable: false,
      message:
        'No receipt for this driver: the app did not install it, so an exact revert is not possible.',
    };
  }
  if (!receipt.oemInf) {
    return {
      success: false,
      rollbackAvailable: false,
      message:
        'The oem .inf for this install was not captured, so a confident rollback is not possible.',
    };
  }

  const restore = await createRestorePoint(`Before driver rollback: ${receipt.name}`);
  if (!restore.success) {
    return {
      success: false,
      rollbackAvailable: true,
      message: `Aborted: ${restore.message}`,
    };
  }

  const result = await runPowerShellWithTimeout(
    `
    $out = & pnputil.exe /delete-driver '${quote(receipt.oemInf!)}' /uninstall 2>&1 | Out-String;
    $code = $LASTEXITCODE;
    @{ code = $code; out = $out } | ConvertTo-Json -Compress
  `,
    300_000
  );
  const payload = result.success ? parsePowerShellJson<{ code?: number }>(result.stdout) : null;
  if (payload?.code !== 0) {
    return {
      success: false,
      rollbackAvailable: true,
      message: `pnputil could not remove ${receipt.oemInf} (exit ${payload?.code ?? 'unknown'}).`,
    };
  }

  // Prove the previous version is back.
  const verify = await verifyDriverInstalled(driverId, receipt.previousVersion);
  if (!verify.verified) {
    return {
      success: false,
      rollbackAvailable: true,
      message: `Rollback ran but the previous version was not confirmed: ${verify.message}`,
    };
  }

  await clearDriverReceipt(driverId);
  return {
    success: true,
    rollbackAvailable: false,
    message: `Rolled back to ${verify.actualVersion}.`,
  };
}
