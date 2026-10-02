import { describe, it, expect } from 'vitest';
import { statsToCsv, type StatsEvent } from './stats';

function event(overrides: Partial<StatsEvent> = {}): StatsEvent {
  return {
    id: 'id',
    type: 'scan',
    timestamp: '2026-01-01T00:00:00.000Z',
    files: 0,
    bytes: 0,
    score: null,
    ...overrides,
  };
}

describe('shared/stats statsToCsv', () => {
  it('always emits a header row', () => {
    const csv = statsToCsv([]);
    expect(csv.trim()).toBe('timestamp,type,files,bytes,score');
  });

  it('sorts events ascending by timestamp', () => {
    const csv = statsToCsv([
      event({ id: 'b', timestamp: '2026-01-02T00:00:00.000Z', type: 'clean', files: 2 }),
      event({ id: 'a', timestamp: '2026-01-01T00:00:00.000Z', type: 'scan', files: 1 }),
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines[1]).toContain('scan');
    expect(lines[2]).toContain('clean');
  });

  it('renders null scores as empty fields', () => {
    const csv = statsToCsv([event({ score: null })]);
    const row = csv.trim().split('\r\n')[1] ?? '';
    expect(row.endsWith(',')).toBe(true);
  });

  it('escapes commas and quotes per RFC 4180', () => {
    const csv = statsToCsv([event({ type: 'scan' })]);
    expect(csv.includes('"')).toBe(false);
    // A value containing a comma must be quoted.
    const tricky = statsToCsv([event({ type: 'scan,weird' as unknown as StatsEvent['type'] })]);
    expect(tricky).toContain('"scan,weird"');
  });

  it('uses CRLF line endings and a trailing newline', () => {
    const csv = statsToCsv([event()]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).toContain('\r\n');
  });
});
