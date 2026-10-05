/**
 * Driver auto-update contract (Fase 2).
 *
 * Honest states: a driver is never "up to date" just because a search returned
 * nothing. `unknown` means Windows Update did not answer (or drivers are
 * excluded by policy), and must never be shown as "up to date".
 */

export type DriverStatus = 'up-to-date' | 'update-available' | 'unknown';

export type DriverUpdateSource = 'windows-update' | 'manual';

/** Whether Windows Update answered the driver search. */
export type DriverWuStatus = 'ok' | 'unavailable' | 'excluded';

export type DriverOperationStage =
  'restore-point' | 'download' | 'verify' | 'install' | 'reverify' | 'done' | 'error';

/** Progress streamed to the renderer while a driver operation runs. */
export interface DriverProgressEvent {
  driverId: string;
  stage: DriverOperationStage;
  percent: number;
  bytesReceived?: number | undefined;
  bytesTotal?: number | undefined;
  message?: string | undefined;
}

/**
 * Honest outcome of a driver update.
 *
 * `success` is only true when the app itself verified a real effect (the new
 * version is re-read from the OS and the device reports OK). Opening a
 * manufacturer page is `manual-action-required`, never a success.
 */
export type DriverInstallStatus =
  'manual-action-required' | 'completed' | 'failed' | 'blocked' | 'cancelled';

export interface DriverInstallOutcome {
  success: boolean;
  status: DriverInstallStatus;
  message: string;
  driverId: string;
  url?: string | undefined;
  /** Set by the installer when Windows Update reports a pending reboot. */
  rebootRequired?: boolean | undefined;
  /** True when the new version was re-read from the OS after install. */
  verified?: boolean | undefined;
  /** True when a restore point was created AND re-read before installing. */
  restorePointCreated?: boolean | undefined;
  /** True when the app can revert this install (receipt captured). */
  rollbackAvailable?: boolean | undefined;
  downloadedBytes?: number | undefined;
  sha256?: string | undefined;
  signature?: string | undefined;
}

/** Outcome of a download-only step (Fase 2.3). */
export interface DriverDownloadOutcome {
  success: boolean;
  message: string;
  driverId: string;
  filePath?: string | undefined;
  bytes?: number | undefined;
  sha256?: string | undefined;
  signature?: string | undefined;
  verified?: boolean | undefined;
}

/** A request to install a specific driver update. */
export interface DriverInstallRequest {
  driverId: string;
  name: string;
  manufacturer: string;
  currentVersion: string;
  expectedVersion: string;
  source: DriverUpdateSource | null;
  /** Windows Update update title (source A). */
  updateTitle?: string | undefined;
  /** Direct manufacturer download URL (source C, with a versioned manifest). */
  downloadUrl?: string | undefined;
  /** Expected SHA-256 (hex) of the downloaded file (source C). */
  sha256?: string | undefined;
  /** Expected file size in bytes (source C). */
  size?: number | undefined;
}
