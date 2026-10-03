import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runPowerShell, parsePowerShellJson, type PowerShellResult } from './powershell';
import { getStorageDir } from '../source-updater/paths';
import { loadTweakCatalog } from './tweak-catalog';
import type {
  TweakApplyResult,
  TweakDefinition,
  TweakOperation,
  TweakPreview,
  TweakView,
} from '@shared/tweaks';

/**
 * Safe, reversible tweaks (P2).
 *
 * Design rules:
 *  - the curated list is DATA: `catalogs/tweaks-catalog.json` (this module is
 *    the engine; see `tweak-catalog.ts` for loading + validation);
 *  - only a curated SAFE subset ships enabled;
 *  - every tweak declares explicit `apply` and `revert` operations;
 *  - before applying we CAPTURE the current values so Restore puts the machine
 *    back exactly where it was (falling back to documented defaults if capture
 *    is unavailable);
 *  - scripts are composed in TypeScript, run through the shared `-EncodedCommand`
 *    runner (never `-Command`), and use literal/escaped quoting only.
 */

export const TWEAKS: TweakDefinition[] = loadTweakCatalog();

// ===================== Engine =====================

export type TweakRunner = (script: string) => Promise<PowerShellResult>;

let runner: TweakRunner = runPowerShell;

/** Test seam: override the PowerShell runner. */
export function setTweakRunner(next: TweakRunner): void {
  runner = next;
}

export function resetTweakRunner(): void {
  runner = runPowerShell;
}

let statePathOverride: string | null = null;

/** Test seam: point the persisted state file somewhere isolated. */
export function setTweakStatePath(filePath: string | null): void {
  statePathOverride = filePath;
}

function stateFilePath(): string {
  if (statePathOverride) return statePathOverride;
  return path.join(getStorageDir(), 'tweaks-state.json');
}

interface TweakStateEntry {
  appliedAt: string;
  revert: TweakOperation[];
}

interface TweakStateFile {
  version: number;
  applied: Record<string, TweakStateEntry>;
}

const EMPTY_STATE: TweakStateFile = { version: 1, applied: {} };

function readState(): TweakStateFile {
  try {
    const raw = fs.readFileSync(stateFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as TweakStateFile;
    if (parsed && typeof parsed === 'object' && parsed.applied) return parsed;
  } catch {
    /* no state yet */
  }
  return { ...EMPTY_STATE, applied: {} };
}

function writeState(state: TweakStateFile): void {
  const file = stateFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
}

function findTweak(id: string): TweakDefinition {
  const tweak = TWEAKS.find((t) => t.id === id);
  if (!tweak) throw new Error(`Unknown tweak: ${id}`);
  return tweak;
}

// ---- Windows build gate (requiresBuild) ----

let windowsBuildOverride: number | null = null;

/** Test hook: override the detected Windows build (null → detect from os.release()). */
export function setWindowsBuild(build: number | null): void {
  windowsBuildOverride = build;
}

function getWindowsBuild(): number {
  if (windowsBuildOverride !== null) return windowsBuildOverride;
  const release = os.release(); // e.g. "10.0.26200"
  const build = Number.parseInt(release.split('.')[2] ?? '', 10);
  return Number.isFinite(build) ? build : 0;
}

function isInfoOnly(tweak: TweakDefinition): boolean {
  return tweak.apply.every((op) => op.kind === 'info');
}

// ---- PowerShell composition ----

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function regPath(op: Extract<TweakOperation, { kind: 'registry' }>): string {
  return `${op.hive === 'HKLM' ? 'HKLM:' : 'HKCU:'}\\${op.path}`;
}

function registryApplyLine(op: Extract<TweakOperation, { kind: 'registry' }>): string {
  const p = regPath(op);
  const type = op.type === 'String' ? 'String' : 'DWORD';
  const value =
    op.type === 'String' ? psString(String(op.value ?? '')) : String(Number(op.value) || 0);
  return `New-Item -Path ${psString(p)} -Force | Out-Null; Set-ItemProperty -Path ${psString(p)} -Name ${psString(op.name)} -Type ${type} -Value ${value}`;
}

function registryRemoveLine(op: Extract<TweakOperation, { kind: 'registry' }>): string {
  return `Remove-ItemProperty -Path ${psString(regPath(op))} -Name ${psString(op.name)} -ErrorAction SilentlyContinue`;
}

function serviceLine(op: Extract<TweakOperation, { kind: 'service' }>): string {
  const lines: string[] = [];
  const svc = psString(op.serviceName);
  if (op.state === 'stopped') {
    lines.push(`Stop-Service -Name ${svc} -Force -ErrorAction Stop`);
    lines.push(`Set-Service -Name ${svc} -StartupType Disabled`);
  } else {
    if (op.startType) {
      const type = op.startType.charAt(0).toUpperCase() + op.startType.slice(1);
      lines.push(`Set-Service -Name ${svc} -StartupType ${type}`);
    }
    if (op.state === 'running') {
      lines.push(`Start-Service -Name ${svc} -ErrorAction Stop`);
    }
  }
  return lines.join('; ');
}

function taskLine(op: Extract<TweakOperation, { kind: 'scheduled-task' }>): string {
  const cmd = op.disable ? 'Disable-ScheduledTask' : 'Enable-ScheduledTask';
  return `${cmd} -TaskPath ${psString(op.taskPath)} -TaskName ${psString(op.taskName)} -ErrorAction Stop | Out-Null`;
}

function operationLine(op: TweakOperation): string | null {
  switch (op.kind) {
    case 'registry':
      return op.removeOnRevert ? registryRemoveLine(op) : registryApplyLine(op);
    case 'service':
      return serviceLine(op);
    case 'scheduled-task':
      return taskLine(op);
    case 'info':
      return null;
    default:
      return null;
  }
}

function buildScript(ops: TweakOperation[]): string | null {
  const lines = ops.map(operationLine).filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return [
    "$ErrorActionPreference='Stop';",
    'try {',
    lines.join(';\n'),
    "; Write-Output 'OK'",
    '} catch { Write-Output ("FAILED: " + $_.Exception.Message) }',
  ].join('\n');
}

// ---- Verify the change actually landed ----

function psBool(value: boolean): string {
  return value ? '$true' : '$false';
}

/** Build the check that proves one operation reached its intended end state. */
function verificationLine(op: TweakOperation): string | null {
  switch (op.kind) {
    case 'registry': {
      const p = psString(regPath(op));
      const access = propertyAccess(op.name);
      if (op.removeOnRevert) {
        return `if ($null -ne (Get-ItemProperty -LiteralPath ${p} -Name ${psString(op.name)} -ErrorAction SilentlyContinue).${access}) { $ok = $false; if (-not $reason) { $reason = 'registry value ${op.name} is still present' } }`;
      }
      const expected =
        op.type === 'String' ? String(op.value ?? '') : String(Number(op.value) || 0);
      return `$v = (Get-ItemProperty -LiteralPath ${p} -Name ${psString(op.name)} -ErrorAction SilentlyContinue).${access}; if ($null -eq $v -or [string]$v -ne ${psString(expected)}) { $ok = $false; if (-not $reason) { $reason = 'registry value ${op.name} did not change' } }`;
    }
    case 'service': {
      const name = psString(op.serviceName);
      const expectedType =
        op.state === 'stopped'
          ? 'Disabled'
          : op.startType
            ? op.startType.charAt(0).toUpperCase() + op.startType.slice(1)
            : '';
      const expectedStatus =
        op.state === 'running' ? 'Running' : op.state === 'stopped' ? 'Stopped' : '';
      const parts: string[] = [
        `$s = Get-Service -Name ${name} -ErrorAction SilentlyContinue;`,
        `if (-not $s) { $ok = $false; if (-not $reason) { $reason = 'service ${op.serviceName} not found' } } else {`,
      ];
      if (expectedStatus) {
        parts.push(
          `if ($s.Status.ToString() -ne '${expectedStatus}') { $ok = $false; if (-not $reason) { $reason = 'service ${op.serviceName} status is ' + $s.Status.ToString() } }`
        );
      }
      if (expectedType) {
        parts.push(
          `if ($s.StartType.ToString() -ne '${expectedType}') { $ok = $false; if (-not $reason) { $reason = 'service ${op.serviceName} start type is ' + $s.StartType.ToString() } }`
        );
      }
      parts.push('}');
      return parts.join(' ');
    }
    case 'scheduled-task': {
      const path = psString(op.taskPath);
      const name = psString(op.taskName);
      return `$t = Get-ScheduledTask -TaskPath ${path} -TaskName ${name} -ErrorAction SilentlyContinue; if (-not $t) { $ok = $false; if (-not $reason) { $reason = 'scheduled task ${op.taskName} not found' } } elseif (($t.State.ToString() -eq 'Disabled') -ne ${psBool(op.disable)}) { $ok = $false; if (-not $reason) { $reason = 'scheduled task ${op.taskName} state is ' + $t.State.ToString() } }`;
    }
    case 'info':
      return null;
    default:
      return null;
  }
}

function buildVerifyScript(ops: TweakOperation[]): string | null {
  const lines = ops.map(verificationLine).filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return [
    '# FORCHI_VERIFY',
    "$ErrorActionPreference = 'SilentlyContinue';",
    '$ok = $true; $reason = "";',
    lines.join(';\n'),
    '@{ verified = $ok; reason = $reason } | ConvertTo-Json -Compress',
  ].join('\n');
}

/**
 * Re-read the machine and confirm every operation reached its intended state.
 * Returns null when the change is confirmed, or a human-readable error when it
 * is not. This is what stops a swallowed error from being reported as success.
 */
async function verifyTweakState(ops: TweakOperation[]): Promise<string | null> {
  const script = buildVerifyScript(ops);
  if (!script) return null;

  const result = await runner(script).catch(() => null);
  if (!result?.success) return 'Could not read back the state to verify the change.';

  const parsed = parsePowerShellJson<{ verified?: boolean; reason?: string }>(result.stdout);
  if (!parsed) return 'Could not read back the state to verify the change.';
  if (parsed.verified) return null;

  return `Change not confirmed: ${parsed.reason || 'value did not change'}`;
}

// ---- Capture previous state ----

async function captureRevertOperations(tweak: TweakDefinition): Promise<TweakOperation[] | null> {
  const ops = tweak.apply;
  const registryOps = ops.filter(
    (op): op is Extract<TweakOperation, { kind: 'registry' }> => op.kind === 'registry'
  );
  const serviceOps = ops.filter(
    (op): op is Extract<TweakOperation, { kind: 'service' }> => op.kind === 'service'
  );
  const taskOps = ops.filter(
    (op): op is Extract<TweakOperation, { kind: 'scheduled-task' }> => op.kind === 'scheduled-task'
  );

  if (registryOps.length === 0 && serviceOps.length === 0 && taskOps.length === 0) {
    return [];
  }

  const readLines: string[] = ['$r = @{};'];
  registryOps.forEach((op, i) => {
    const p = regPath(op);
    readLines.push(
      `if (Test-Path -LiteralPath ${psString(p)}) { $v = (Get-ItemProperty -LiteralPath ${psString(p)} -Name ${psString(op.name)} -ErrorAction SilentlyContinue).${propertyAccess(op.name)}; $r['r${i}'] = if ($null -eq $v) { $null } else { [string]$v } } else { $r['r${i}'] = $null }`
    );
  });
  serviceOps.forEach((op, i) => {
    readLines.push(
      `$s = Get-Service -Name ${psString(op.serviceName)} -ErrorAction SilentlyContinue; $r['s${i}'] = if ($s) { $s.StartType.ToString() + '|' + $s.Status.ToString() } else { $null }`
    );
  });
  taskOps.forEach((op, i) => {
    readLines.push(
      `$t = Get-ScheduledTask -TaskPath ${psString(op.taskPath)} -TaskName ${psString(op.taskName)} -ErrorAction SilentlyContinue; $r['t${i}'] = if ($t) { $t.State.ToString() } else { $null }`
    );
  });
  readLines.push('$r | ConvertTo-Json -Compress');

  const result = await runner(readLines.join('\n')).catch(() => null);
  if (!result?.success || !result.stdout) return null;

  const parsed = parsePowerShellJson<Record<string, string | null>>(result.stdout);
  if (!parsed) return null;

  const revert: TweakOperation[] = [];

  registryOps.forEach((op, i) => {
    const raw = parsed[`r${i}`];
    if (raw === null || raw === undefined) {
      revert.push({ ...op, removeOnRevert: true });
    } else if (op.type === 'DWORD') {
      revert.push({ ...op, value: Number(raw) || 0, removeOnRevert: false });
    } else {
      revert.push({ ...op, value: raw, removeOnRevert: false });
    }
  });

  serviceOps.forEach((op, i) => {
    const raw = parsed[`s${i}`];
    if (!raw) {
      revert.push({ ...tweak.revert.find((r) => r.kind === 'service') } as TweakOperation);
      return;
    }
    const [startTypeRaw = '', statusRaw = ''] = raw.split('|');
    const startType = startTypeRaw.toLowerCase();
    const state = statusRaw.toLowerCase() === 'running' ? 'running' : 'stopped';
    revert.push({
      kind: 'service',
      serviceName: op.serviceName,
      startType: (['automatic', 'manual', 'disabled'].includes(startType)
        ? startType
        : 'automatic') as 'automatic' | 'manual' | 'disabled',
      state,
    });
  });

  taskOps.forEach((op, i) => {
    const raw = parsed[`t${i}`];
    revert.push({ ...op, disable: raw === 'Disabled' });
  });

  return revert;
}

function propertyAccess(name: string): string {
  // Registry property names may contain '-' (e.g. SubscribedContent-338388Enabled).
  return name === '(default)' ? "'(default)'" : `'${name.replace(/'/g, "''")}'`;
}

// ---- Public API ----

export async function getTweaks(): Promise<TweakView[]> {
  const state = readState();
  return TWEAKS.map((tweak) => ({
    ...tweak,
    applied: Boolean(state.applied[tweak.id]),
  }));
}

export async function previewTweak(id: string): Promise<TweakPreview> {
  const tweak = findTweak(id);
  return {
    id: tweak.id,
    name: tweak.name,
    reversible: true,
    applyOperations: tweak.apply,
    revertOperations: tweak.revert,
  };
}

async function runOperations(ops: TweakOperation[]): Promise<string> {
  const script = buildScript(ops);
  if (!script) return '';
  const result = await runner(script);
  if (!result.success) {
    return `FAILED: ${result.stderr || 'PowerShell error'}`;
  }
  if (!result.stdout.includes('OK')) {
    return result.stdout.trim() || 'FAILED: unknown error';
  }
  return '';
}

export async function applyTweak(id: string): Promise<TweakApplyResult> {
  const tweak = findTweak(id);

  // Gate before ANY side effect (capture reads the registry too).
  if (tweak.requiresBuild) {
    const build = getWindowsBuild();
    if (build < tweak.requiresBuild) {
      return {
        id,
        success: false,
        message: `Requires Windows build ${tweak.requiresBuild}+ (current build: ${build}).`,
      };
    }
  }

  if (isInfoOnly(tweak)) {
    return { id, success: true, message: 'Informational tweak: nothing was changed.' };
  }

  const captured = await captureRevertOperations(tweak);
  const revertOps = captured && captured.length > 0 ? captured : tweak.revert;

  const error = await runOperations(tweak.apply);
  if (error) {
    return { id, success: false, message: error };
  }

  const verifyError = await verifyTweakState(tweak.apply);
  if (verifyError) {
    return { id, success: false, message: verifyError };
  }

  const state = readState();
  state.applied[id] = { appliedAt: new Date().toISOString(), revert: revertOps };
  try {
    writeState(state);
  } catch {
    return {
      id,
      success: false,
      message: 'Applied, but failed to persist state (Restore may use defaults).',
    };
  }

  return { id, success: true, message: 'Applied. You can restore it from the Tweaks page.' };
}

export async function restoreTweak(id: string): Promise<TweakApplyResult> {
  const tweak = findTweak(id);

  if (isInfoOnly(tweak)) {
    return { id, success: true, message: 'Informational tweak: nothing to restore.' };
  }

  const state = readState();
  const entry = state.applied[id];
  const ops = entry?.revert ?? tweak.revert;

  const error = await runOperations(ops);
  if (error) {
    return { id, success: false, message: error };
  }

  const verifyError = await verifyTweakState(ops);
  if (verifyError) {
    return { id, success: false, message: verifyError };
  }

  delete state.applied[id];
  try {
    writeState(state);
  } catch {
    /* non-fatal */
  }

  return { id, success: true, message: 'Restored to the previous state.' };
}

export async function applyTweaks(ids: string[]): Promise<TweakApplyResult[]> {
  const results: TweakApplyResult[] = [];
  for (const id of ids) {
    results.push(await applyTweak(id));
  }
  return results;
}

export async function restoreTweaks(ids: string[]): Promise<TweakApplyResult[]> {
  const results: TweakApplyResult[] = [];
  for (const id of ids) {
    results.push(await restoreTweak(id));
  }
  return results;
}
