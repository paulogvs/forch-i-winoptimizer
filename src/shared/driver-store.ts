/**
 * Driver Store cleanup contract (Fase 4.1, adopted from Kudu's driver store
 * cleanup design — patterns only, no code copied).
 *
 * Honest states: a package is only offered for removal when it is provably
 * *superseded* (a strictly newer package exists for the SAME identity) and is
 * NOT currently bound to a device. Virtual/shim drivers are always excluded.
 */

export type DriverStorePreviewStatus = 'ok' | 'requires-admin' | 'unavailable';

/** Why a package was selected for removal. */
export type DriverStoreRemovalReason = 'superseded';

export interface DriverStorePackage {
  /** `oemNN.inf` — the published name used by pnputil (the deletion handle). */
  publishedName: string;
  /** The original vendor INF (e.g. `netwtw10.inf`). */
  originalName: string;
  provider: string;
  className: string;
  version: string;
  date: string;
  signer: string;
  /** Real on-disk size when measurable (sum of the matching FileRepository
   *  folders), otherwise null. Never invented. */
  sizeBytes: number | null;
}

export interface DriverStoreCandidate extends DriverStorePackage {
  identityKey: string;
  supersededBy: { publishedName: string; version: string };
  reason: DriverStoreRemovalReason;
}

export interface DriverStorePreview {
  success: boolean;
  status: DriverStorePreviewStatus;
  isAdmin: boolean;
  canApply: boolean;
  packages: DriverStorePackage[];
  candidates: DriverStoreCandidate[];
  totalPackages: number;
  reclaimableCount: number;
  reclaimableBytes: number;
  message: string;
  scannedAt: string;
}

export type DriverStorePackageStatus = 'removed' | 'failed' | 'skipped';

export interface DriverStorePackageResult {
  publishedName: string;
  originalName: string;
  status: DriverStorePackageStatus;
  /** True only when a post-clean re-scan confirmed the package is gone. */
  verified: boolean;
  message: string;
}

export interface DriverStoreCleanResult {
  success: boolean;
  status: 'completed' | 'failed' | 'requires-admin' | 'nothing-to-do';
  requested: number;
  removed: number;
  failed: number;
  message: string;
  results: DriverStorePackageResult[];
  cleanedAt: string;
}
