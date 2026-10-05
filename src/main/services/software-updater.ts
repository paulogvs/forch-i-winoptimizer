import { runPowerShellScript, runPowerShellWithTimeout, type PowerShellResult } from './powershell';
import type { SoftwareUpdate, SoftwareUpdateReport, UpdateSeverity } from '@shared/software-update';

/**
 * Software updater (Fase 4.7).
 *
 * `winget upgrade` is the ONLY source — there is no hardcoded app list. The
 * call is read-only: it lists available updates and never installs. Patterns
 * adopted from Kudu's software-updater:
 *
 *  - `cleanOutput`   — strip ANSI/spinners/CR-overwrites before parsing;
 *  - `computeSeverity` — numeric major/minor/patch from version difference;
 *  - `emptyResult`   — an empty output is NEVER reported as "up to date".
 *
 * The parser is locale-independent (this machine reports Spanish headers):
 * column boundaries are taken from the header row, and fields are positional
 * because `winget upgrade` always emits [Name, Id, Version, Available, Source].
 */

/** ANSI escape (U+001B) built at runtime so `no-control-regex` stays happy. */
const ESC = String.fromCharCode(27);
const ANSI_CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const ANSI_OTHER = new RegExp(`${ESC}[@-Z\\\\-_]`, 'g');

/** Remove ANSI escapes, CR-overwrites and spinner glyphs from winget output. */
export function cleanOutput(raw: string): string {
  let text = raw;
  // ANSI escape sequences (CSI + 2-char).
  text = text.replace(ANSI_CSI, '');
  text = text.replace(ANSI_OTHER, '');
  // CR-overwrites: keep only what is after the last carriage return of a line.
  text = text
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.lastIndexOf('\r');
      return idx >= 0 ? line.slice(idx + 1) : line;
    })
    .join('\n');
  // Braille spinners / box drawing.
  text = text.replace(/[\u2800-\u28ff\u2500-\u257f]/g, '');
  // Trailing whitespace per line.
  text = text.replace(/[ \t]+$/gm, '');
  return text.trim();
}

/** Parse a dotted version into numbers, or null when not fully numeric. */
export function parseNumericVersion(version: string): number[] | null {
  const trimmed = version.trim();
  if (!/^\d+(?:\.\d+)*$/.test(trimmed)) return null;
  return trimmed.split('.').map((p) => Number(p));
}

/** Severity of an upgrade from its versions. Non-numeric → 'unknown'. */
export function computeSeverity(current: string, available: string): UpdateSeverity {
  const c = parseNumericVersion(current);
  const a = parseNumericVersion(available);
  if (!c || !a) return 'unknown';
  const len = Math.max(c.length, a.length);
  for (let i = 0; i < len; i++) {
    const cv = c[i] ?? 0;
    const av = a[i] ?? 0;
    if (av > cv) return i === 0 ? 'major' : i === 1 ? 'minor' : 'patch';
    if (av < cv) return 'patch';
  }
  return 'patch';
}

/** A winget id must be a safe, shell-free token. */
export function isValidWingetId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._+~-]*$/.test(id.trim());
}

interface Column {
  label: string;
  start: number;
}

function headerColumns(header: string): Column[] {
  const columns: Column[] = [];
  const regex = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(header)) !== null) {
    columns.push({ label: match[0], start: match.index });
  }
  return columns;
}

function sliceColumns(line: string, columns: Column[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < columns.length; i++) {
    const start = columns[i]!.start;
    const end = i + 1 < columns.length ? columns[i + 1]!.start : line.length;
    values.push(line.slice(start, end).trim());
  }
  return values;
}

/**
 * Parse the `winget upgrade` table into updates. Locale-independent: the
 * columns are located from the header row, and their meaning is positional.
 * Returns [] when there is no table.
 */
export function parseWingetUpgrade(output: string): SoftwareUpdate[] {
  const cleaned = cleanOutput(output);
  if (!cleaned) return [];
  const lines = cleaned.split('\n');

  const separatorIndex = lines.findIndex((line) => /^-{3,}(\s+-{2,})*$/.test(line.trim()));
  if (separatorIndex <= 0) return [];

  const columns = headerColumns(lines[separatorIndex - 1]!);
  if (columns.length < 4) return [];

  const updates: SoftwareUpdate[] = [];
  for (let i = separatorIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const values = sliceColumns(line, columns);
    const id = values[1] ?? '';
    const name = values[0] ?? '';
    const current = values[2] ?? '';
    const available = values[3] ?? '';
    const source = values[4] ?? '';
    // Summary/message rows do not carry a valid id + available column.
    if (!isValidWingetId(id) || available.length === 0) continue;
    updates.push({
      id,
      name,
      currentVersion: current,
      availableVersion: available,
      source,
      severity: computeSeverity(current, available),
    });
  }
  return updates;
}

function buildCommand(): string {
  return (
    'winget upgrade --include-unknown --accept-source-agreements ' +
    '--disable-interactivity 2>&1 | Out-String'
  );
}

/**
 * Detection result from a raw `winget upgrade` output. Distinguishes a definite
 * "nothing to upgrade" from "winget did not answer" (emptyResult pattern).
 */
export function interpretWingetUpgrade(output: string): {
  status: SoftwareUpdateReport['status'];
  updates: SoftwareUpdate[];
} {
  const cleaned = cleanOutput(output);
  const updates = parseWingetUpgrade(cleaned);
  if (updates.length > 0) return { status: 'ok', updates };

  const hasTable = /^-{3,}(\s+-{2,})*$/m.test(cleaned);
  if (hasTable) return { status: 'ok', updates: [] };

  // Definite "no upgrades" answers (English + Spanish prefix, accent-safe).
  if (
    /no installed package found matching|no applicable upgrade|no available upgrade|no se encontr[oó] ning[uú]n paquete que coincida|no hay actualizaciones/i.test(
      cleaned
    )
  ) {
    return { status: 'up-to-date', updates: [] };
  }

  if (/actualizaciones disponibles|upgrades available/i.test(cleaned)) {
    // Summary present but no parseable row: treat as an answer with 0 rows.
    return { status: 'up-to-date', updates: [] };
  }

  // Empty or unrecognized: never claim "up to date".
  return { status: 'unavailable', updates: [] };
}

export interface SoftwareUpdateDeps {
  /** Test seam: short/long runner. Defaults to `runPowerShellScript` (120s). */
  run?: (script: string) => Promise<PowerShellResult>;
  now?: () => number;
}

/** Read-only detection of available software updates via winget. */
export async function getSoftwareUpdates(
  deps: SoftwareUpdateDeps = {}
): Promise<SoftwareUpdateReport> {
  const run = deps.run ?? runPowerShellScript;
  const scannedAt = new Date(deps.now ? deps.now() : Date.now()).toISOString();

  let result: PowerShellResult;
  try {
    result = await run(buildCommand());
  } catch (error) {
    return {
      success: false,
      status: 'unavailable',
      updates: [],
      count: 0,
      message: `Windows Package Manager (winget) could not run: ${
        error instanceof Error ? error.message : String(error)
      }`,
      scannedAt,
    };
  }

  const combined = `${result.stdout}\n${result.stderr}`;
  const { status, updates } = interpretWingetUpgrade(combined);

  if (status === 'unavailable') {
    return {
      success: false,
      status,
      updates: [],
      count: 0,
      message:
        'winget returned no usable output; the update list cannot be confirmed (not the same as "up to date").',
      scannedAt,
    };
  }

  return {
    success: true,
    status,
    updates,
    count: updates.length,
    message:
      status === 'up-to-date'
        ? 'Everything is up to date: winget reported no available upgrades.'
        : `${updates.length} update(s) available.`,
    scannedAt,
  };
}

export interface SoftwareUpdateActionDeps extends SoftwareUpdateDeps {
  /** Long-runner for the actual install (defaults to 600s). */
  runLong?: (script: string) => Promise<PowerShellResult>;
}

/**
 * Update a single app by winget id. Mutating: installs and then RE-CHECKS the
 * update list to confirm the app no longer reports an available upgrade.
 * A success is only reported when the re-check confirms it.
 */
export async function updateSoftwareApp(
  id: string,
  deps: SoftwareUpdateActionDeps = {}
): Promise<{ success: boolean; message: string }> {
  if (!isValidWingetId(id)) {
    return { success: false, message: `Refused: unsafe winget id "${id}".` };
  }
  const runLong: (script: string) => Promise<PowerShellResult> =
    deps.runLong ?? ((script) => runPowerShellWithTimeout(script, 600_000));
  const run = deps.run ?? runPowerShellScript;

  const command =
    `winget upgrade --id '${id.trim()}' --exact --silent ` +
    '--accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 | Out-String';
  const result = await runLong(command);
  const output = `${result.stdout}\n${result.stderr}`;
  if (
    !result.success &&
    !/successfully installed|instalado correctamente|no applicable/i.test(output)
  ) {
    return {
      success: false,
      message: `winget could not update ${id}: ${cleanOutput(output) || result.stderr || 'no output'}`,
    };
  }

  // Re-verify: ask winget again and confirm the id is gone from the list.
  const recheckDeps: SoftwareUpdateDeps = { run };
  if (deps.now) recheckDeps.now = deps.now;
  const recheck = await getSoftwareUpdates(recheckDeps);
  if (recheck.status === 'unavailable') {
    return {
      success: false,
      message: `winget ran but the update list could not be re-checked; not claiming success.`,
    };
  }
  const stillListed = recheck.updates.some((u) => u.id.toLowerCase() === id.trim().toLowerCase());
  if (stillListed) {
    return {
      success: false,
      message: `${id} still reports an available upgrade after the update.`,
    };
  }
  return { success: true, message: `${id} updated and no longer reports an available upgrade.` };
}
