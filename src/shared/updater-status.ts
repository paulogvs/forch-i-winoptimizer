/** Update lifecycle status emitted by the background electron-updater. */
export type UpdateStatusState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  state: UpdateStatusState;
  /** Version involved, when known. */
  version: string | null;
  /** Download percent (0-100) while downloading. */
  percent: number | null;
  /** Human-readable detail (error text, release info). */
  message: string | null;
}
