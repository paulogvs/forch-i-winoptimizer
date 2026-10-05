/**
 * Usage statistics contract (shared by main + renderer).
 *
 * Every event is a real observation recorded by the main process:
 *  - `scan`        : junk found by a cleaner scan (bytes/files)
 *  - `clean`       : files actually deleted (bytes/files)
 *  - `audit`       : system audit score (score)
 *  - `boost`       : memory trimmed by "Free RAM" (bytes)
 *  - `maintenance` : a 1-click maintenance action ran (Flush DNS, restore
 *                    point, driver scan); `files` = 1, no bytes/score.
 *
 * No synthetic/placeholder data is ever produced. Charts must show an empty
 * state when a series has too few points instead of inventing values.
 */

export type StatsEventType = 'scan' | 'clean' | 'audit' | 'boost' | 'maintenance';

export interface StatsEvent {
  id: string;
  type: StatsEventType;
  /** ISO timestamp. */
  timestamp: string;
  /** Files involved (0 when not applicable). */
  files: number;
  /** Bytes involved (0 when not applicable). */
  bytes: number;
  /** Audit score 0-100 (null when not applicable). */
  score: number | null;
}

export const STATS_EVENT_LIMIT = 500;

export interface StatsExportResult {
  success: boolean;
  message: string;
  path?: string;
  rows?: number;
}

const CSV_COLUMNS = ['timestamp', 'type', 'files', 'bytes', 'score'] as const;

/** Escape a CSV field per RFC 4180. */
function csvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Build a CSV document from real stats events (ascending by time). */
export function statsToCsv(events: readonly StatsEvent[]): string {
  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const lines = [CSV_COLUMNS.join(',')];
  for (const event of sorted) {
    lines.push(
      [
        csvField(event.timestamp),
        csvField(event.type),
        csvField(event.files),
        csvField(event.bytes),
        csvField(event.score),
      ].join(',')
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
