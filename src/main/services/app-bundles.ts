import { runPowerShell } from './powershell';
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

function invalidIdResult(action: 'install' | 'uninstall'): { success: false; message: string } {
  return { success: false, message: `Invalid package id: refusing to ${action}` };
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
    if ($LASTEXITCODE -eq 0 -or $out -match 'already installed') {
      Write-Output 'SUCCESS'
    } else {
      Write-Output "FAILED: winget exit code $LASTEXITCODE"
      Write-Output $out
    }
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

export async function installApp(wingetId: string): Promise<{
  success: boolean;
  message: string;
}> {
  if (!WINGET_ID_PATTERN.test(wingetId)) {
    return invalidIdResult('install');
  }

  const result = await runPowerShell(wingetScript('install', wingetId));
  const success = result.success && result.stdout.includes('SUCCESS');

  return {
    success,
    message: success
      ? `Successfully installed ${wingetId}`
      : failureMessage('install', wingetId, result),
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

export async function uninstallApp(wingetId: string): Promise<{
  success: boolean;
  message: string;
}> {
  if (!WINGET_ID_PATTERN.test(wingetId)) {
    return invalidIdResult('uninstall');
  }

  const result = await runPowerShell(wingetScript('uninstall', wingetId));
  const success = result.success && result.stdout.includes('SUCCESS');

  return {
    success,
    message: success
      ? `Successfully uninstalled ${wingetId}`
      : failureMessage('uninstall', wingetId, result),
  };
}
