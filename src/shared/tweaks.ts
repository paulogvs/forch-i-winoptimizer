// Safe tweaks contract (P2).
//
// Every tweak is *reversible* and *previewable*. Only `safe` tweaks are enabled
// by default; `advanced` tweaks must be opted into explicitly by the user.

export type TweakCategory = 'performance' | 'privacy' | 'explorer' | 'accessibility';
export type TweakSafety = 'safe' | 'advanced';
export type TweakImpact = 'low' | 'medium' | 'high';

export type RegistryHive = 'HKCU' | 'HKLM';
export type RegistryValueType = 'DWORD' | 'String';

/** A single reversible action performed by a tweak. */
export type TweakOperation =
  | {
      kind: 'registry';
      hive: RegistryHive;
      path: string;
      name: string;
      type: RegistryValueType;
      value: number | string;
      /** When true the value is deleted on revert instead of restored. */
      removeOnRevert?: boolean;
    }
  | {
      kind: 'service';
      serviceName: string;
      startType?: 'automatic' | 'manual' | 'disabled';
      state?: 'running' | 'stopped';
    }
  | {
      kind: 'scheduled-task';
      taskPath: string;
      taskName: string;
      disable: boolean;
    }
  | {
      kind: 'info';
      /** Informational only: shown in preview, never executed. */
      detail: string;
    };

export interface TweakDefinition {
  id: string;
  name: string;
  /** Short, plain-language description (1-2 lines). */
  description: string;
  category: TweakCategory;
  safety: TweakSafety;
  /** Every tweak in this catalog is reversible by design. */
  reversible: true;
  impact: TweakImpact;
  requiresAdmin: boolean;
  /**
   * Minimum Windows build required to APPLY this tweak (e.g. 22000 for
   * Windows 11, 22631 for 23H2). Restore is never gated.
   */
  requiresBuild?: number;
  /** Optional guidance shown in the UI (e.g. "detect and suggest, don't force"). */
  note?: string;
  apply: TweakOperation[];
  revert: TweakOperation[];
}

/** Full tweak definition plus its persisted applied state (what the UI renders). */
export interface TweakView extends TweakDefinition {
  applied: boolean;
}

export interface TweakPreview {
  id: string;
  name: string;
  reversible: true;
  applyOperations: TweakOperation[];
  revertOperations: TweakOperation[];
}

export interface TweakApplyResult {
  id: string;
  success: boolean;
  message: string;
}
