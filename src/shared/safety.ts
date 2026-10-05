/**
 * Safety knowledge base types (Fase 4.8).
 *
 * Every curated catalog entry (services, tweaks) carries a `safety` level, a
 * `risk` level and a short `safetyNote` so the UI can warn the user BEFORE
 * anything is applied. Purely declarative — no execution logic here.
 */

/** Service safety vocabulary (mirrors the legacy `protection` values). */
export type SafetyLevel = 'safe' | 'caution' | 'protected';

/** Tweak safety vocabulary (safe by default; advanced must be opted into). */
export type TweakSafetyLevel = 'safe' | 'advanced';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SafetyMetadata {
  safety: SafetyLevel | TweakSafetyLevel;
  risk: RiskLevel;
  /** Short, user-facing explanation shown as a warning. */
  safetyNote: string;
}

/** True when a level warrants an upfront warning. */
export function isRisky(meta: Pick<SafetyMetadata, 'safety' | 'risk'>): boolean {
  return (
    meta.risk === 'medium' ||
    meta.risk === 'high' ||
    meta.risk === 'critical' ||
    meta.safety === 'caution' ||
    meta.safety === 'protected' ||
    meta.safety === 'advanced'
  );
}

/** The warning to display before applying an entry, or null when safe. */
export function safetyWarning(
  meta: Pick<SafetyMetadata, 'safety' | 'risk' | 'safetyNote'>
): string | null {
  if (!isRisky(meta)) return null;
  const note = meta.safetyNote?.trim();
  return note && note.length > 0 ? note : null;
}
