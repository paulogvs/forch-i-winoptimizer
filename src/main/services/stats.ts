import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  STATS_EVENT_LIMIT,
  statsToCsv,
  type StatsEvent,
  type StatsEventType,
  type StatsExportResult,
} from '@shared/stats';

const STATS_FILE = 'stats.json';

let cached: StatsEvent[] | null = null;
/** Test seam: override the directory that holds `stats.json`. */
let dirOverride: string | null = null;

export function setStatsDir(dir: string | null): void {
  dirOverride = dir;
  cached = null;
}

function statsFile(): string {
  const dir =
    dirOverride ??
    (() => {
      try {
        return app.getPath('userData');
      } catch {
        return process.cwd();
      }
    })();
  return path.join(dir, STATS_FILE);
}

function isStatsEvent(value: unknown): value is StatsEvent {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    typeof v['type'] === 'string' &&
    typeof v['timestamp'] === 'string' &&
    typeof v['files'] === 'number' &&
    typeof v['bytes'] === 'number' &&
    (v['score'] === null || typeof v['score'] === 'number')
  );
}

export function loadStats(): StatsEvent[] {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(statsFile(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    cached = Array.isArray(parsed) ? parsed.filter(isStatsEvent) : [];
  } catch {
    cached = [];
  }
  return cached;
}

function persist(events: StatsEvent[]): void {
  cached = events;
  try {
    const dir = dirOverride ?? app.getPath('userData');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, STATS_FILE), JSON.stringify(events, null, 2), 'utf8');
  } catch {
    // Best-effort: stats must never break a user operation.
  }
}

export interface StatsEventInput {
  type: StatsEventType;
  files?: number;
  bytes?: number;
  score?: number | null;
  timestamp?: string;
}

/** Append one real observation, capped to the most recent events. */
export function recordStatsEvent(input: StatsEventInput): StatsEvent {
  const event: StatsEvent = {
    id: randomUUID(),
    type: input.type,
    timestamp: input.timestamp ?? new Date().toISOString(),
    files: Math.max(0, Math.round(input.files ?? 0)),
    bytes: Math.max(0, Math.round(input.bytes ?? 0)),
    score: input.score ?? null,
  };
  const next = [...loadStats(), event].slice(-STATS_EVENT_LIMIT);
  persist(next);
  return event;
}

/** All events, ascending by timestamp (chart/CSV friendly). */
export function getStatsEvents(): StatsEvent[] {
  return [...loadStats()].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

export function clearStats(): void {
  persist([]);
}

export type { StatsExportResult } from '@shared/stats';

/** Default file name offered by the native save dialog. */
export function defaultStatsFileName(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `FORCH.iA-WinOptimizer-stats-${stamp}.csv`;
}

/**
 * Write the real recorded events to `filePath` as CSV. Returns the row count so
 * the UI can confirm what was exported; never throws.
 */
export function exportStatsCsv(filePath: string): StatsExportResult {
  const events = getStatsEvents();
  try {
    fs.writeFileSync(filePath, statsToCsv(events), 'utf8');
    return {
      success: true,
      message:
        events.length === 0
          ? 'Exported an empty statistics file.'
          : `Exported ${events.length} event(s).`,
      path: filePath,
      rows: events.length,
    };
  } catch (error) {
    return { success: false, message: `Could not write CSV: ${String(error)}` };
  }
}
