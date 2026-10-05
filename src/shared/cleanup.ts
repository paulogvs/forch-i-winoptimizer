/**
 * Cleanup receipts contract (shared by main + renderer, Fase 4.6).
 *
 * Every deleted/attempted file gets a receipt so the UI can show WHY a delete
 * failed (not just "failed") and offer a retry of only the failed paths.
 */

/** Classified reason for a failed delete (from the real OS error). */
export type DeleteFailureReason =
  'in-use' | 'permissions' | 'not-found' | 'not-empty' | 'still-present' | 'unknown';

export interface DeleteReceipt {
  path: string;
  deleted: boolean;
  reason: DeleteFailureReason | null;
  message: string;
  at: string;
}

export interface RetryFailedResult {
  /** Failed paths that were retried. */
  attempted: number;
  deleted: number;
  failed: number;
  receipts: DeleteReceipt[];
}
