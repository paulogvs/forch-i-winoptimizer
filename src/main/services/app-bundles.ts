import { runPowerShell, runPowerShellScript } from './powershell';
import type { AppBundle, BundleApp } from '@shared/types';
import { readBundledCatalog } from './catalog-data';

/**
 * App bundles (P1.3 / Phase A).
 *
 * The curated product list lives in DATA (`catalogs/app-bundles-catalog.json`),
 * never in code: the renderer sends bundle/app ids, and every winget id is
 * still validated against a strict grammar before it can reach a PowerShell
 * command line. See `docs/CATALOGS.md`.
 */

/**
 * winget package ids are dot-separated identifiers (e.g. `Google.Chrome`,
 * `7zip.7zip`, GUID-like ids such as `clsid2227a280-...`). Anything outside
 * this grammar is rejected BEFORE the id is interpolated into a PowerShell
 * script, which closes the command-injection gap.
 */
const WINGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

const BUNDLE_CATEGORIES = new Set<AppBundle['category']>([
  'browsers',
  'media',
  'devtools',
  'utilities',
  'games',
  'productivity',
  'communication',
  'security',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidBundleApp(raw: unknown): raw is Omit<BundleApp, 'isInstalled' | 'isSelected'> {
  if (!isRecord(raw)) return false;
  return (
    typeof raw.id === 'string' &&
    raw.id.length > 0 &&
    typeof raw.name === 'string' &&
    raw.name.length > 0 &&
    typeof raw.description === 'string' &&
    raw.description.length > 0 &&
    typeof raw.wingetId === 'string' &&
    WINGET_ID_PATTERN.test(raw.wingetId) &&
    typeof raw.size === 'number'
  );
}

function toBundleApp(raw: Omit<BundleApp, 'isInstalled' | 'isSelected'>): BundleApp {
  return {
    id: raw.id,
    name: raw.name,
    wingetId: raw.wingetId,
    description: raw.description,
    size: raw.size,
    isInstalled: false,
    isSelected: false,
  };
}

/**
 * Read and validate the bundled app-bundle catalog. Invalid bundles/apps are
 * dropped (never surfaced); a missing/corrupt file yields [].
 */
export function loadAppBundleCatalog(): AppBundle[] {
  const envelope = readBundledCatalog<{ bundles?: unknown }>('app-bundles-catalog.json');
  if (!envelope || !Array.isArray(envelope.bundles)) return [];

  const bundles: AppBundle[] = [];
  for (const raw of envelope.bundles) {
    if (!isRecord(raw)) continue;
    if (
      typeof raw.id !== 'string' ||
      raw.id.length === 0 ||
      typeof raw.name !== 'string' ||
      raw.name.length === 0 ||
      typeof raw.description !== 'string' ||
      raw.description.length === 0 ||
      typeof raw.icon !== 'string' ||
      raw.icon.length === 0 ||
      typeof raw.category !== 'string' ||
      !BUNDLE_CATEGORIES.has(raw.category as AppBundle['category']) ||
      !Array.isArray(raw.apps)
    ) {
      continue;
    }
    const apps = raw.apps.filter(isValidBundleApp).map(toBundleApp);
    if (apps.length === 0) continue;
    bundles.push({
      id: raw.id,
      name: raw.name,
      description: raw.description,
      category: raw.category as AppBundle['category'],
      icon: raw.icon,
      apps,
    });
  }
  return bundles;
}

const APP_BUNDLES: AppBundle[] = loadAppBundleCatalog();

export function getAppBundles(): AppBundle[] {
  return APP_BUNDLES;
}

// ===== P0.2: winget exit-code handling + package id validation =====

/**
 * Result of a single winget action.
 *
 * `state` and `verified` make a timeout honest and distinguishable from a
 * plain failure (v0.10.1, BUG B): when winget is killed by the runner's
 * timeout we re-read the real package state and say so, instead of returning
 * a generic failure that hides the fact the package may already be installed.
 */
export interface BundleActionResult {
  success: boolean;
  message: string;
  state?: 'ok' | 'failed' | 'timeout';
  /** True when a post-timeout `winget list` re-read confirmed the state. */
  verified?: boolean;
}

/**
 * `execFile` is killed by Node on timeout (`killed: true`), which
 * `powershell.ts` maps to exit code 124.
 */
const TIMEOUT_EXIT_CODE = 124;

function invalidIdResult(action: 'install' | 'uninstall'): BundleActionResult {
  return { success: false, state: 'failed', message: `Invalid package id: refusing to ${action}` };
}

/**
 * winget reports failures via exit code and stderr, NOT via exceptions, so a
 * surrounding `try/catch` can never see them. The script captures the output
 * and derives the verdict from `$LASTEXITCODE` (plus winget's "already
 * installed" case, which exits non-zero on some versions).
 */
function wingetScript(action: 'install' | 'uninstall', wingetId: string): string {
  const flags =
    action === 'install'
      ? 'install --id ' +
        wingetId +
        ' --silent --accept-package-agreements --accept-source-agreements'
      : 'uninstall --id ' + wingetId + ' --silent';
  return `
    $out = winget ${flags} 2>&1 | Out-String;
    if ($LASTEXITCODE -eq 0) { Write-Output 'SUCCESS' }
    else { Write-Output "FAILED: winget exit code $LASTEXITCODE"; Write-Output $out }
  `;
}

function failureMessage(
  action: 'install' | 'uninstall',
  wingetId: string,
  result: { stdout: string; stderr: string }
): string {
  const combined = `${result.stdout}\n${result.stderr}`;
  const marker = combined.indexOf('FAILED:');
  const detail = (marker >= 0 ? combined.slice(marker) : combined).trim();
  return `Failed to ${action} ${wingetId}${detail ? `: ${detail}` : ''}`;
}

/**
 * Authoritative post-hoc check, used only after a timeout. `winget list`
 * exits 0 when the (already validated) package id is present.
 */
async function isPackageInstalled(wingetId: string): Promise<boolean> {
  const result = await runPowerShell(`
    $id = '${wingetId}';
    $out = winget list --id $id --exact 2>&1 | Out-String;
    if ($LASTEXITCODE -eq 0 -and $out -match [regex]::Escape($id)) { Write-Output 'INSTALLED' }
    else { Write-Output 'NOT_INSTALLED' }
  `);
  return result.success && result.stdout.trim() === 'INSTALLED';
}

/**
 * Build an honest timeout result once the real state has been re-read.
 * A timed-out install that is present is a success; a timed-out uninstall
 * that is gone is a success. Everything else is reported as `timeout` (not a
 * generic `failed`) so callers can distinguish "may still be running".
 */
function timeoutResult(
  action: 'install' | 'uninstall',
  wingetId: string,
  installed: boolean
): BundleActionResult {
  if (action === 'install') {
    return installed
      ? {
          success: true,
          state: 'timeout',
          verified: true,
          message: `Installing ${wingetId} timed out after 120s, but it was verified as installed`,
        }
      : {
          success: false,
          state: 'timeout',
          verified: true,
          message: `Installing ${wingetId} timed out after 120s and it was not detected as installed; it may still be finishing, re-check before retrying`,
        };
  }
  return installed
    ? {
        success: false,
        state: 'timeout',
        verified: true,
        message: `Uninstalling ${wingetId} timed out after 120s and the package is still present`,
      }
    : {
        success: true,
        state: 'timeout',
        verified: true,
        message: `Uninstalling ${wingetId} timed out after 120s, but the package is no longer present`,
      };
}

export async function checkInstalledApps(): Promise<Map<string, boolean>> {
  const installed = new Map<string, boolean>();

  const result = await runPowerShell(`
    $apps = Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*", "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" -ErrorAction SilentlyContinue;
    $names = $apps | ForEach-Object { $_.DisplayName } | Where-Object { $_ };
    $names | ConvertTo-Json -Compress
  `);

  if (result.success && result.stdout) {
    try {
      // `ConvertTo-Json` collapses a one-element pipeline into a bare string,
      // so `installedNames.some(...)` used to throw on that string and the
      // catch swallowed it -> every app reported as "not installed".
      const parsed: unknown = JSON.parse(result.stdout);
      const installedNames = (Array.isArray(parsed) ? parsed : [parsed]).map((name) =>
        String(name)
      );
      for (const bundle of APP_BUNDLES) {
        for (const app of bundle.apps) {
          const isInstalled = installedNames.some((name) =>
            name.toLowerCase().includes(app.name.toLowerCase())
          );
          installed.set(app.id, isInstalled);
        }
      }
    } catch {
      /* ignore */
    }
  }

  return installed;
}

export async function installApp(wingetId: string): Promise<BundleActionResult> {
  if (!WINGET_ID_PATTERN.test(wingetId)) {
    return invalidIdResult('install');
  }

  // BUG B fix: winget installs routinely exceed 60s. The long runner gives
  // them 120s instead of killing the process mid-install.
  const result = await runPowerShellScript(wingetScript('install', wingetId));

  if (result.success && result.stdout.includes('SUCCESS')) {
    return { success: true, state: 'ok', message: `Successfully installed ${wingetId}` };
  }

  // A killed process can still have finished the install — never report a
  // plain failure without re-reading the real state.
  if (result.exitCode === TIMEOUT_EXIT_CODE) {
    return timeoutResult('install', wingetId, await isPackageInstalled(wingetId));
  }

  return {
    success: false,
    state: 'failed',
    message: failureMessage('install', wingetId, result),
  };
}

export async function installApps(wingetIds: string[]): Promise<{
  success: boolean;
  message: string;
  installed: number;
  failed: number;
}> {
  let installed = 0;
  let failed = 0;

  for (const id of wingetIds) {
    const result = await installApp(id);
    if (result.success) installed++;
    else failed++;
  }

  return {
    success: failed === 0,
    message: `Installed ${installed} apps, ${failed} failed`,
    installed,
    failed,
  };
}

export async function uninstallApp(wingetId: string): Promise<BundleActionResult> {
  if (!WINGET_ID_PATTERN.test(wingetId)) {
    return invalidIdResult('uninstall');
  }

  // Same long-runner rationale as installApp.
  const result = await runPowerShellScript(wingetScript('uninstall', wingetId));

  if (result.success && result.stdout.includes('SUCCESS')) {
    return { success: true, state: 'ok', message: `Successfully uninstalled ${wingetId}` };
  }

  if (result.exitCode === TIMEOUT_EXIT_CODE) {
    return timeoutResult('uninstall', wingetId, await isPackageInstalled(wingetId));
  }

  return {
    success: false,
    state: 'failed',
    message: failureMessage('uninstall', wingetId, result),
  };
}
