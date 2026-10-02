import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\Users\\test\\AppData\\Local\\forch-i-winoptimizer' },
}));

import {
  clearStats,
  defaultStatsFileName,
  exportStatsCsv,
  getStatsEvents,
  loadStats,
  recordStatsEvent,
  setStatsDir,
} from './stats';
import { STATS_EVENT_LIMIT } from '@shared/stats';

describe('main/services/stats', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forchi-stats-'));
    setStatsDir(dir);
  });

  afterEach(() => {
    setStatsDir(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty when no file exists', () => {
    expect(loadStats()).toEqual([]);
    expect(getStatsEvents()).toEqual([]);
  });

  it('records a real observation and persists it', () => {
    const event = recordStatsEvent({ type: 'scan', files: 3, bytes: 2048 });
    expect(event.type).toBe('scan');
    expect(event.files).toBe(3);
    expect(event.bytes).toBe(2048);
    expect(event.score).toBeNull();
    expect(event.id).toBeTruthy();

    setStatsDir(dir);
    expect(loadStats()).toHaveLength(1);
  });

  it('rounds and clamps negative numbers to zero', () => {
    const event = recordStatsEvent({ type: 'boost', bytes: -5, files: 1.6 });
    expect(event.bytes).toBe(0);
    expect(event.files).toBe(2);
  });

  it('caps the history to the most recent events', () => {
    for (let i = 0; i < STATS_EVENT_LIMIT + 5; i++) {
      recordStatsEvent({ type: 'audit', score: i, timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString() });
    }
    const events = loadStats();
    expect(events).toHaveLength(STATS_EVENT_LIMIT);
    // The oldest five were dropped.
    expect(events[0]?.score).toBe(5);
  });

  it('sorts events ascending by timestamp on read', () => {
    recordStatsEvent({ type: 'scan', timestamp: '2026-01-03T00:00:00.000Z' });
    recordStatsEvent({ type: 'scan', timestamp: '2026-01-01T00:00:00.000Z' });
    const events = getStatsEvents();
    expect(events[0]?.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(events[1]?.timestamp).toBe('2026-01-03T00:00:00.000Z');
  });

  it('clears all events', () => {
    recordStatsEvent({ type: 'clean', files: 1, bytes: 10 });
    clearStats();
    expect(loadStats()).toEqual([]);
  });

  it('formats a dated default file name', () => {
    const name = defaultStatsFileName(new Date('2026-03-04T12:00:00.000Z'));
    expect(name).toBe('FORCH.iA-WinOptimizer-stats-2026-03-04.csv');
  });

  it('exports a CSV file with the recorded rows', () => {
    recordStatsEvent({ type: 'scan', files: 2, bytes: 512 });
    const target = path.join(dir, 'out.csv');
    const result = exportStatsCsv(target);
    expect(result.success).toBe(true);
    expect(result.rows).toBe(1);
    const content = fs.readFileSync(target, 'utf8');
    expect(content).toContain('timestamp,type,files,bytes,score');
    expect(content).toContain('scan');
  });

  it('reports failure instead of throwing for an unwritable path', () => {
    const result = exportStatsCsv(path.join(dir, 'missing-subdir', 'out.csv'));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Could not write CSV/);
  });
});
