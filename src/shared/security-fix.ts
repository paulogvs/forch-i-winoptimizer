/**
 * Reversible auto-fix contract (v0.7.0, extended in v0.10.0 and v0.18.0).
 *
 * Four security checks ship a self-repair: `smb1`, `guest-account`,
 * `remote-desktop` and `smb-signing`. v0.18.0 adds OS hardening toggles:
 * UAC in 5 levels (`uac-always`, `uac-credentials`, `uac-default`,
 * `uac-nodim`, `uac-never`), Smart App Control enforce
 * (`smart-app-control`) and the PowerShell execution policy
 * (`powershell-exec-policy`). Every one of them has a standard,
 * well-known remediation that can be captured BEFORE the change and restored
 * EXACTLY afterwards.
 *
 * BitLocker-guard is deliberately NOT a fix: it is a read-only advisory
 * check. This app never encrypts anything.
 *
 * This module is shared by the main process (which performs the change) and the
 * renderer (which shows the preview and the confirmation). It contains only
 * types and pure constants — no PowerShell and no I/O — so the renderer bundle
 * stays small and the main engine remains unit-testable.
 */

export const SECURITY_FIX_IDS = [
  'smb1',
  'guest-account',
  'remote-desktop',
  'smb-signing',
  'uac-always',
  'uac-credentials',
  'uac-default',
  'uac-nodim',
  'uac-never',
  'smart-app-control',
  'powershell-exec-policy',
] as const;

export type SecurityFixId = (typeof SECURITY_FIX_IDS)[number];

export function isSecurityFixId(value: string): value is SecurityFixId {
  return (SECURITY_FIX_IDS as readonly string[]).includes(value);
}

/** Why a fix cannot be applied right now. */
export type SecurityFixBlockedReason =
  'requires-admin' | 'not-applicable' | 'already-applied' | 'unavailable';

/**
 * What the user is shown before approving a change. Every value is OBSERVED,
 * never assumed: `current` comes from a live read of the machine and `original`
 * is the exact value a revert would restore.
 */
export interface SecurityFixPreview {
  checkId: SecurityFixId;
  title: string;
  /** Plain-language description of the change. */
  description: string;
  /** The value observed on the machine right now. */
  current: string;
  /** The value that applying the fix will write. */
  target: string;
  /** The captured value a revert would restore (null when nothing is stored). */
  original: string | null;
  reversible: true;
  requiresAdmin: boolean;
  /** Whether the apply action may run right now. */
  canApply: boolean;
  /** Whether a revert is available (an original value is stored). */
  canRevert: boolean;
  /** Set when `canApply` is false; explains exactly why. */
  blockedReason: SecurityFixBlockedReason | null;
  /** Human-readable explanation of the block. */
  blockedMessage: string | null;
}

export type SecurityFixAction = 'apply' | 'revert';

export interface SecurityFixOutcome {
  checkId: SecurityFixId;
  action: SecurityFixAction;
  success: boolean;
  status: 'applied' | 'reverted' | 'failed' | 'blocked';
  message: string;
  /** Observed value before the change. */
  before: string;
  /** Observed value after the change (re-measured, never assumed). */
  after: string;
}

/** Human-readable title per fix, shared by main and renderer. */
export const SECURITY_FIX_TITLES: Readonly<Record<SecurityFixId, string>> = {
  smb1: 'Disable SMBv1',
  'guest-account': 'Disable the built-in Guest account',
  'remote-desktop': 'Deny Remote Desktop (RDP)',
  'smb-signing': 'Require SMB signing',
  'uac-always': 'UAC: Always notify',
  'uac-credentials': 'UAC: Always notify + require credentials',
  'uac-default': 'UAC: Default level',
  'uac-nodim': 'UAC: Notify without dimming',
  'uac-never': 'UAC: Never notify (not recommended)',
  'smart-app-control': 'Enforce Smart App Control',
  'powershell-exec-policy': 'Set PowerShell execution policy to RemoteSigned',
};

/** Short explanation per fix, shared by main and renderer. */
export const SECURITY_FIX_DESCRIPTIONS: Readonly<Record<SecurityFixId, string>> = {
  smb1: 'Disables the legacy SMBv1 file-sharing protocol on this server.',
  'guest-account': 'Disables the built-in Guest account (RID 501).',
  'remote-desktop': 'Sets fDenyTSConnections = 1 so Remote Desktop connections are refused.',
  'smb-signing':
    'Requires SMB signing on the server and enables it on the client (RequireSecuritySignature and EnableSecuritySignature = $true).',
  'uac-always':
    'Sets UAC to Always notify (ConsentPromptBehaviorAdmin=2, secure desktop on): every elevation asks for consent. Takes effect after sign-out/in.',
  'uac-credentials':
    'Sets UAC to Always notify and require credentials (ConsentPromptBehaviorAdmin=1): every elevation asks for an administrator password. Takes effect after sign-out/in.',
  'uac-default':
    'Sets UAC to the Windows default (ConsentPromptBehaviorAdmin=5, secure desktop on): only non-Windows apps trigger a consent prompt. Takes effect after sign-out/in.',
  'uac-nodim':
    'Sets UAC to notify without dimming the desktop (PromptOnSecureDesktop=0). Less secure than the default because other programs can interact with the prompt. Takes effect after sign-out/in.',
  'uac-never':
    'Sets UAC to Never notify (ConsentPromptBehaviorAdmin=0). WARNING: this is the least secure setting — programs can make changes to the computer without asking, and standard users get elevation silently denied. Only use it if you understand the risk. Takes effect after restart.',
  'smart-app-control':
    'Enforces Smart App Control (VerifiedAndReputablePolicyState=1) so only signed or reputable apps run. Best on a clean install; run CiTool.exe -r or reboot afterwards, then confirm in Windows Security.',
  'powershell-exec-policy':
    'Sets the machine PowerShell execution policy to RemoteSigned: local scripts run, downloaded scripts must be signed. Verify afterwards with `Get-ExecutionPolicy -List` (a Group Policy can override this value).',
};

/**
 * Documented UAC level triples (EnableLUA, ConsentPromptBehaviorAdmin,
 * PromptOnSecureDesktop) per the Windows security baseline. Shared by the
 * engine and the renderer so both sides agree on what each level writes.
 */
export interface UacTriple {
  lua: number;
  consent: number;
  secure: number;
}

export const UAC_LEVEL_TRIPLES: Readonly<Record<UacFixId, UacTriple>> = {
  'uac-always': { lua: 1, consent: 2, secure: 1 },
  'uac-credentials': { lua: 1, consent: 1, secure: 1 },
  'uac-default': { lua: 1, consent: 5, secure: 1 },
  'uac-nodim': { lua: 1, consent: 5, secure: 0 },
  'uac-never': { lua: 1, consent: 0, secure: 0 },
};

export type UacFixId = Extract<SecurityFixId, `uac-${string}`>;

/** UAC level fixes in slider order (most to least secure). */
export const UAC_LEVEL_FIX_IDS: readonly UacFixId[] = [
  'uac-always',
  'uac-credentials',
  'uac-default',
  'uac-nodim',
  'uac-never',
];

/** Short label per UAC level for the renderer buttons. */
export const UAC_LEVEL_LABELS: Readonly<Record<UacFixId, string>> = {
  'uac-always': 'Always notify',
  'uac-credentials': 'Always + credentials',
  'uac-default': 'Default',
  'uac-nodim': 'No dimming',
  'uac-never': 'Never notify',
};
