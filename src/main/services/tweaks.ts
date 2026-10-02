import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runPowerShell, parsePowerShellJson, type PowerShellResult } from './powershell';
import { getStorageDir } from '../source-updater/paths';
import type {
  RegistryHive,
  RegistryValueType,
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
 *  - only a curated SAFE subset ships enabled;
 *  - every tweak declares explicit `apply` and `revert` operations;
 *  - before applying we CAPTURE the current values so Restore puts the machine
 *    back exactly where it was (falling back to documented defaults if capture
 *    is unavailable);
 *  - scripts are composed in TypeScript, run through the shared `-EncodedCommand`
 *    runner (never `-Command`), and use literal/escaped quoting only.
 */

const HKLM = 'HKLM';
const HKCU = 'HKCU';

const CONTENT_DELIVERY = 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager';
const EXPLORER_ADVANCED = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';
const EXPLORER = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer';

function reg(
  hive: RegistryHive,
  regPath: string,
  name: string,
  value: number | string,
  type: RegistryValueType = 'DWORD'
): TweakOperation {
  return { kind: 'registry', hive, path: regPath, name, type, value };
}

export const TWEAKS: TweakDefinition[] = [
  // ===================== PERFORMANCE =====================
  {
    id: 'sysmain-toggle',
    name: 'SysMain (Superfetch)',
    description:
      'Disables the SysMain/Superfetch service, which pre-loads apps into RAM. Recommended only on SSDs if you notice high disk or CPU usage.',
    category: 'performance',
    safety: 'safe',
    reversible: true,
    impact: 'medium',
    requiresAdmin: true,
    note: 'Not recommended on mechanical (HDD) systems. You can restore it at any time.',
    apply: [{ kind: 'service', serviceName: 'SysMain', startType: 'disabled', state: 'stopped' }],
    revert: [{ kind: 'service', serviceName: 'SysMain', startType: 'automatic', state: 'running' }],
  },
  {
    id: 'prefetch-conservative',
    name: 'Prefetch / Superfetch (conservative)',
    description:
      'Ensures Prefetch and Superfetch use the Windows-recommended values (enabled/app-aware) instead of being disabled. Safe, low impact.',
    category: 'performance',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: true,
    note: 'This does NOT disable prefetch: it restores the conservative defaults.',
    apply: [
      reg(HKLM, 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters', 'EnablePrefetcher', 3),
      reg(HKLM, 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters', 'EnableSuperfetch', 3),
    ],
    revert: [
      { kind: 'registry', hive: HKLM, path: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters', name: 'EnablePrefetcher', type: 'DWORD', value: null as unknown as number, removeOnRevert: true },
      { kind: 'registry', hive: HKLM, path: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters', name: 'EnableSuperfetch', type: 'DWORD', value: null as unknown as number, removeOnRevert: true },
    ],
  },
  {
    id: 'background-apps',
    name: 'Background Apps (current user)',
    description:
      'Stops Store/UWP apps from running in the background for the current user. Does not affect desktop apps or system services.',
    category: 'performance',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    apply: [reg(HKCU, 'Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications', 'GlobalUserDisabled', 1)],
    revert: [reg(HKCU, 'Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications', 'GlobalUserDisabled', 0)],
  },
  {
    id: 'game-mode-hags',
    name: 'Game Mode / HAGS',
    description:
      'Informational only: Game Mode and Hardware-Accelerated GPU Scheduling depend on your GPU/driver. WinOptimizer detects and suggests, it never forces them.',
    category: 'performance',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    note: 'Detect-and-suggest only. Enable from Settings > System > Display > Graphics if your hardware supports it.',
    apply: [{ kind: 'info', detail: 'Detect Game Mode (HKCU GameBar) and HAGS (GPU Scheduler) and surface recommendations; no change is written.' }],
    revert: [{ kind: 'info', detail: 'Nothing to undo: this tweak never writes to the system.' }],
  },

  // ===================== PRIVACY =====================
  {
    id: 'telemetry-diagtrack',
    name: 'Telemetry & DiagTrack',
    description:
      'Disables the DiagTrack (Connected User Experiences) service, sets the telemetry policy to the minimum, and turns off the main CEIP/feedback tasks.',
    category: 'privacy',
    safety: 'safe',
    reversible: true,
    impact: 'medium',
    requiresAdmin: true,
    apply: [
      { kind: 'service', serviceName: 'DiagTrack', startType: 'disabled', state: 'stopped' },
      reg(HKLM, 'SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry', 0),
      { kind: 'scheduled-task', taskPath: '\\Microsoft\\Windows\\Application Experience\\', taskName: 'Microsoft Compatibility Appraiser', disable: true },
      { kind: 'scheduled-task', taskPath: '\\Microsoft\\Windows\\Customer Experience Improvement Program\\', taskName: 'Consolidator', disable: true },
      { kind: 'scheduled-task', taskPath: '\\Microsoft\\Windows\\Customer Experience Improvement Program\\', taskName: 'UsbCeip', disable: true },
      { kind: 'scheduled-task', taskPath: '\\Microsoft\\Windows\\Feedback\\Siuf\\', taskName: 'DmClient', disable: true },
      { kind: 'scheduled-task', taskPath: '\\Microsoft\\Windows\\Feedback\\Siuf\\', taskName: 'DmClientOnScenarioDownload', disable: true },
    ],
    revert: [
      { kind: 'service', serviceName: 'DiagTrack', startType: 'automatic', state: 'running' },
      reg(HKLM, 'SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry', 1),
      { kind: 'scheduled-task', taskPath: '\\Microsoft\\Windows\\Application Experience\\', taskName: 'Microsoft Compatibility Appraiser', disable: false },
      { kind: 'scheduled-task', taskPath: '\\Microsoft\\Windows\\Customer Experience Improvement Program\\', taskName: 'Consolidator', disable: false },
      { kind: 'scheduled-task', taskPath: '\\Microsoft\\Windows\\Customer Experience Improvement Program\\', taskName: 'UsbCeip', disable: false },
      { kind: 'scheduled-task', taskPath: '\\Microsoft\\Windows\\Feedback\\Siuf\\', taskName: 'DmClient', disable: false },
      { kind: 'scheduled-task', taskPath: '\\Microsoft\\Windows\\Feedback\\Siuf\\', taskName: 'DmClientOnScenarioDownload', disable: false },
    ],
  },
  {
    id: 'suggested-content',
    name: 'Suggested Content & Ads',
    description:
      'Turns off Windows 11 tips, suggestions, ads and silent app installs in Start, Settings and the lock screen.',
    category: 'privacy',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    apply: [
      reg(HKCU, CONTENT_DELIVERY, 'SubscribedContent-338388Enabled', 0),
      reg(HKCU, CONTENT_DELIVERY, 'SubscribedContent-338389Enabled', 0),
      reg(HKCU, CONTENT_DELIVERY, 'SubscribedContent-353694Enabled', 0),
      reg(HKCU, CONTENT_DELIVERY, 'SubscribedContent-353696Enabled', 0),
      reg(HKCU, CONTENT_DELIVERY, 'SystemPaneSuggestionsEnabled', 0),
      reg(HKCU, CONTENT_DELIVERY, 'SilentInstalledAppsEnabled', 0),
      reg(HKCU, CONTENT_DELIVERY, 'RotatingLockScreenOverlayEnabled', 0),
    ],
    revert: [
      reg(HKCU, CONTENT_DELIVERY, 'SubscribedContent-338388Enabled', 1),
      reg(HKCU, CONTENT_DELIVERY, 'SubscribedContent-338389Enabled', 1),
      reg(HKCU, CONTENT_DELIVERY, 'SubscribedContent-353694Enabled', 1),
      reg(HKCU, CONTENT_DELIVERY, 'SubscribedContent-353696Enabled', 1),
      reg(HKCU, CONTENT_DELIVERY, 'SystemPaneSuggestionsEnabled', 1),
      reg(HKCU, CONTENT_DELIVERY, 'SilentInstalledAppsEnabled', 1),
      reg(HKCU, CONTENT_DELIVERY, 'RotatingLockScreenOverlayEnabled', 1),
    ],
  },

  // ===================== EXPLORER =====================
  {
    id: 'show-file-extensions',
    name: 'Show file extensions',
    description: 'Shows known file extensions in File Explorer. Useful for spotting double-extension malware.',
    category: 'explorer',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    apply: [reg(HKCU, EXPLORER_ADVANCED, 'HideFileExt', 0)],
    revert: [reg(HKCU, EXPLORER_ADVANCED, 'HideFileExt', 1)],
  },
  {
    id: 'hide-recent-files',
    name: 'Hide recent & frequent items',
    description: 'Stops File Explorer Quick Access from showing recently used and frequently used files.',
    category: 'explorer',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    apply: [reg(HKCU, EXPLORER, 'ShowRecent', 0), reg(HKCU, EXPLORER, 'ShowFrequent', 0)],
    revert: [reg(HKCU, EXPLORER, 'ShowRecent', 1), reg(HKCU, EXPLORER, 'ShowFrequent', 1)],
  },
  {
    id: 'classic-context-menu',
    name: 'Classic context menu (compact)',
    description:
      'Restores the compact Windows 10-style right-click menu in Windows 11 (no "Show more options").',
    category: 'explorer',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    apply: [
      {
        kind: 'registry',
        hive: HKCU,
        path: 'Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32',
        name: '(default)',
        type: 'String',
        value: '',
      },
    ],
    revert: [
      {
        kind: 'registry',
        hive: HKCU,
        path: 'Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32',
        name: '(default)',
        type: 'String',
        value: null as unknown as string,
        removeOnRevert: true,
      },
    ],
  },

  // ===================== P1.2 (+10 safe tweaks, v0.4.0) =====================
  // PERFORMANCE
  {
    id: 'snappier-animations',
    name: 'Snappier animations',
    description:
      'Sets the menu show delay to 0 ms and disables the minimize/maximize animation so the shell feels faster.',
    category: 'performance',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    note: 'Sign out/in or restart Explorer to see the full effect.',
    apply: [
      reg(HKCU, 'Control Panel\\Desktop', 'MenuShowDelay', '0', 'String'),
      reg(HKCU, 'Control Panel\\Desktop\\WindowMetrics', 'MinAnimate', '0', 'String'),
    ],
    revert: [
      reg(HKCU, 'Control Panel\\Desktop', 'MenuShowDelay', '400', 'String'),
      reg(HKCU, 'Control Panel\\Desktop\\WindowMetrics', 'MinAnimate', '1', 'String'),
    ],
  },
  {
    id: 'mouse-acceleration-off',
    name: 'Mouse acceleration (pointer precision)',
    description:
      'Turns off pointer precision so mouse movement is 1:1 with raw input — preferred by gamers and CAD users.',
    category: 'performance',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    note: 'Restore puts back your captured values (Windows defaults: speed 1, thresholds 6/10).',
    apply: [
      reg(HKCU, 'Control Panel\\Mouse', 'MouseSpeed', '0', 'String'),
      reg(HKCU, 'Control Panel\\Mouse', 'MouseThreshold1', '0', 'String'),
      reg(HKCU, 'Control Panel\\Mouse', 'MouseThreshold2', '0', 'String'),
    ],
    revert: [
      reg(HKCU, 'Control Panel\\Mouse', 'MouseSpeed', '1', 'String'),
      reg(HKCU, 'Control Panel\\Mouse', 'MouseThreshold1', '6', 'String'),
      reg(HKCU, 'Control Panel\\Mouse', 'MouseThreshold2', '10', 'String'),
    ],
  },
  {
    id: 'startup-delay-zero',
    name: 'No delay for startup apps',
    description:
      'Removes the artificial delay Windows adds before launching startup apps, so they start right after sign-in.',
    category: 'performance',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    apply: [
      reg(HKCU, 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize', 'StartupDelayInMSec', 0),
    ],
    revert: [
      {
        kind: 'registry',
        hive: HKCU,
        path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize',
        name: 'StartupDelayInMSec',
        type: 'DWORD',
        value: null as unknown as number,
        removeOnRevert: true,
      },
    ],
  },

  // ===================== EXPLORER (taskbar / shell) =====================
  {
    id: 'taskbar-align-left',
    name: 'Taskbar aligned left',
    description: 'Moves the Windows 11 taskbar from centered to left-aligned (classic layout).',
    category: 'explorer',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    requiresBuild: 22000,
    note: 'Windows 11 only (build 22000+).',
    apply: [reg(HKCU, EXPLORER_ADVANCED, 'TaskbarAl', 0)],
    revert: [reg(HKCU, EXPLORER_ADVANCED, 'TaskbarAl', 1)],
  },
  {
    id: 'taskbar-search-hidden',
    name: 'Hide taskbar search box',
    description: 'Removes the search box/icon from the taskbar; search stays available from Start.',
    category: 'explorer',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    requiresBuild: 22000,
    note: 'Windows 11 only (build 22000+).',
    apply: [reg(HKCU, EXPLORER_ADVANCED, 'SearchboxTaskbarMode', 0)],
    revert: [reg(HKCU, EXPLORER_ADVANCED, 'SearchboxTaskbarMode', 1)],
  },
  {
    id: 'hide-task-view-button',
    name: 'Hide Task View button',
    description: 'Hides the Task View button from the taskbar (Win+Tab keeps working).',
    category: 'explorer',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    requiresBuild: 22000,
    note: 'Windows 11 only (build 22000+).',
    apply: [reg(HKCU, EXPLORER_ADVANCED, 'ShowTaskViewButton', 0)],
    revert: [reg(HKCU, EXPLORER_ADVANCED, 'ShowTaskViewButton', 1)],
  },
  {
    id: 'hide-widgets',
    name: 'Hide Widgets button',
    description:
      'Hides the Widgets (news/weather) button from the taskbar. Registry-only: the Widgets service is not touched.',
    category: 'explorer',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    requiresBuild: 22000,
    note: 'Windows 11 only (build 22000+).',
    apply: [reg(HKCU, EXPLORER_ADVANCED, 'TaskbarDa', 0)],
    revert: [reg(HKCU, EXPLORER_ADVANCED, 'TaskbarDa', 1)],
  },

  // ===================== PRIVACY =====================
  {
    id: 'hide-copilot',
    name: 'Turn off Copilot',
    description: 'Hides the Copilot button and disables Windows Copilot via policy for the current user.',
    category: 'privacy',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    requiresBuild: 22631,
    note: 'Windows 11 23H2+ (build 22631+). Does not uninstall the app.',
    apply: [
      reg(HKCU, EXPLORER_ADVANCED, 'ShowCopilotButton', 0),
      reg(HKCU, 'Software\\Policies\\Microsoft\\Windows\\WindowsCopilot', 'TurnOffWindowsCopilot', 1),
    ],
    revert: [
      reg(HKCU, EXPLORER_ADVANCED, 'ShowCopilotButton', 1),
      {
        kind: 'registry',
        hive: HKCU,
        path: 'Software\\Policies\\Microsoft\\Windows\\WindowsCopilot',
        name: 'TurnOffWindowsCopilot',
        type: 'DWORD',
        value: null as unknown as number,
        removeOnRevert: true,
      },
    ],
  },
  {
    id: 'windows-spotlight-off',
    name: 'Turn off Windows Spotlight',
    description:
      'Disables Windows Spotlight (lock screen pictures and suggestions) via user and machine policy.',
    category: 'privacy',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: true,
    note: 'Re-enable anytime in Settings > Personalization > Lock screen.',
    apply: [
      reg(HKCU, 'Software\\Policies\\Microsoft\\Windows\\CloudContent', 'DisableWindowsSpotlightFeatures', 1),
      reg(HKLM, 'SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent', 'DisableWindowsSpotlightFeatures', 1),
    ],
    revert: [
      {
        kind: 'registry',
        hive: HKCU,
        path: 'Software\\Policies\\Microsoft\\Windows\\CloudContent',
        name: 'DisableWindowsSpotlightFeatures',
        type: 'DWORD',
        value: null as unknown as number,
        removeOnRevert: true,
      },
      {
        kind: 'registry',
        hive: HKLM,
        path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent',
        name: 'DisableWindowsSpotlightFeatures',
        type: 'DWORD',
        value: null as unknown as number,
        removeOnRevert: true,
      },
    ],
  },

  // ===================== ACCESSIBILITY =====================
  {
    id: 'sticky-keys-off',
    name: 'Disable Sticky Keys prompts',
    description:
      'Stops the "press Shift five times" Sticky Keys prompt and turns the feature off for the current user.',
    category: 'accessibility',
    safety: 'safe',
    reversible: true,
    impact: 'low',
    requiresAdmin: false,
    note: 'Re-enable anytime in Settings > Accessibility > Keyboard.',
    apply: [
      reg(HKCU, 'Control Panel\\Accessibility\\StickyKeys', 'Flags', '506', 'String'),
      reg(HKCU, 'Control Panel\\Accessibility\\StickyKeys', 'KeyboardPreference', 'On', 'String'),
    ],
    revert: [
      reg(HKCU, 'Control Panel\\Accessibility\\StickyKeys', 'Flags', '510', 'String'),
      {
        kind: 'registry',
        hive: HKCU,
        path: 'Control Panel\\Accessibility\\StickyKeys',
        name: 'KeyboardPreference',
        type: 'String',
        value: null as unknown as string,
        removeOnRevert: true,
      },
    ],
  },
];

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
  const value = op.type === 'String' ? psString(String(op.value ?? '')) : String(Number(op.value) || 0);
  return `New-Item -Path ${psString(p)} -Force | Out-Null; Set-ItemProperty -Path ${psString(p)} -Name ${psString(op.name)} -Type ${type} -Value ${value}`;
}

function registryRemoveLine(op: Extract<TweakOperation, { kind: 'registry' }>): string {
  return `Remove-ItemProperty -Path ${psString(regPath(op))} -Name ${psString(op.name)} -ErrorAction SilentlyContinue`;
}

function serviceLine(op: Extract<TweakOperation, { kind: 'service' }>): string {
  const lines: string[] = [];
  const svc = psString(op.serviceName);
  if (op.state === 'stopped') {
    lines.push(`Stop-Service -Name ${svc} -Force -ErrorAction SilentlyContinue`);
    lines.push(`Set-Service -Name ${svc} -StartupType Disabled`);
  } else {
    if (op.startType) {
      const type = op.startType.charAt(0).toUpperCase() + op.startType.slice(1);
      lines.push(`Set-Service -Name ${svc} -StartupType ${type}`);
    }
    if (op.state === 'running') {
      lines.push(`Start-Service -Name ${svc} -ErrorAction SilentlyContinue`);
    }
  }
  return lines.join('; ');
}

function taskLine(op: Extract<TweakOperation, { kind: 'scheduled-task' }>): string {
  const cmd = op.disable ? 'Disable-ScheduledTask' : 'Enable-ScheduledTask';
  return `${cmd} -TaskPath ${psString(op.taskPath)} -TaskName ${psString(op.taskName)} -ErrorAction SilentlyContinue | Out-Null`;
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

// ---- Capture previous state ----

async function captureRevertOperations(tweak: TweakDefinition): Promise<TweakOperation[] | null> {
  const ops = tweak.apply;
  const registryOps = ops.filter((op): op is Extract<TweakOperation, { kind: 'registry' }> => op.kind === 'registry');
  const serviceOps = ops.filter((op): op is Extract<TweakOperation, { kind: 'service' }> => op.kind === 'service');
  const taskOps = ops.filter((op): op is Extract<TweakOperation, { kind: 'scheduled-task' }> => op.kind === 'scheduled-task');

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
      startType: (['automatic', 'manual', 'disabled'].includes(startType) ? startType : 'automatic') as 'automatic' | 'manual' | 'disabled',
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

  const state = readState();
  state.applied[id] = { appliedAt: new Date().toISOString(), revert: revertOps };
  try {
    writeState(state);
  } catch {
    return { id, success: false, message: 'Applied, but failed to persist state (Restore may use defaults).' };
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
