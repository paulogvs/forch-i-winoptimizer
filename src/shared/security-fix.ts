/**
 * Reversible auto-fix contract (v0.7.0, extended in v0.10.0).
 *
 * Four security checks ship a self-repair: `smb1`, `guest-account`,
 * `remote-desktop` and `smb-signing`. Every one of them has a standard,
 * well-known remediation that can be captured BEFORE the change and restored
 * EXACTLY afterwards.
 *
 * This module is shared by the main process (which performs the change) and the
 * renderer (which shows the preview and the confirmation). It contains only
 * types and pure constants — no PowerShell and no I/O — so the renderer bundle
 * stays small and the main engine remains unit-testable.
 */

export const SECURITY_FIX_IDS = ['smb1', 'guest-account', 'remote-desktop', 'smb-signing'] as const;

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
};

/** Short explanation per fix, shared by main and renderer. */
export const SECURITY_FIX_DESCRIPTIONS: Readonly<Record<SecurityFixId, string>> = {
  smb1: 'Disables the legacy SMBv1 file-sharing protocol on this server.',
  'guest-account': 'Disables the built-in Guest account (RID 501).',
  'remote-desktop': 'Sets fDenyTSConnections = 1 so Remote Desktop connections are refused.',
  'smb-signing':
    'Requires SMB signing on the server and enables it on the client (RequireSecuritySignature and EnableSecuritySignature = $true).',
};
