/**
 * Software updater contract (Fase 4.7, adopted from Kudu's software-updater
 * design — patterns only, no code copied).
 *
 * `winget upgrade` is used as a READ-ONLY detection source. Severity comes from
 * a numeric version comparison; an empty output is NEVER reported as
 * "up to date" (Kudu's `emptyResult` pattern).
 */

export type UpdateSeverity = 'major' | 'minor' | 'patch' | 'unknown';

/**
 * - `ok`          — winget answered with zero or more upgrades.
 * - `up-to-date`  — winget answered explicitly that nothing matches.
 * - `unavailable` — winget did NOT answer (empty/unrecognized output/no winget).
 */
export type SoftwareUpdateStatus = 'ok' | 'up-to-date' | 'unavailable';

export interface SoftwareUpdate {
  id: string;
  name: string;
  currentVersion: string;
  availableVersion: string;
  source: string;
  severity: UpdateSeverity;
}

export interface SoftwareUpdateReport {
  success: boolean;
  status: SoftwareUpdateStatus;
  updates: SoftwareUpdate[];
  count: number;
  message: string;
  scannedAt: string;
}
