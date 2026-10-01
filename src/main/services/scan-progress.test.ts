import { describe, it, expect } from 'vitest';
import {
  ScanProgressReporter,
  clampPercent,
  shouldEmitProgress,
  PROGRESS_THROTTLE_MS,
} from './scan-progress';
import type { ScanProgressEvent } from '@shared/scan-progress';

const base = (over: Partial<ScanProgressEvent>): ScanProgressEvent => ({
  module: 'system',
  stage: 'query',
  percent: 10,
  ...over,
});

describe('clampPercent', () => {
  it('clamps and rounds', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(42.6)).toBe(43);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});

describe('shouldEmitProgress', () => {
  it('always emits the first event', () => {
    expect(shouldEmitProgress(null, base({}), 0)).toBe(true);
  });

  it('always emits on stage change', () => {
    const prev = base({ stage: 'query', percent: 10 });
    const next = base({ stage: 'parse', percent: 10 });
    expect(shouldEmitProgress(prev, next, 0)).toBe(true);
  });

  it('emits terminal stages regardless of throttle', () => {
    const prev = base({ stage: 'normalize', percent: 90 });
    expect(shouldEmitProgress(prev, base({ stage: 'done', percent: 100 }), 0)).toBe(true);
    expect(shouldEmitProgress(prev, base({ stage: 'error', percent: 100 }), 0)).toBe(true);
  });

  it('throttles percent-only updates inside the window', () => {
    const prev = base({ stage: 'query', percent: 10 });
    const next = base({ stage: 'query', percent: 20 });
    expect(shouldEmitProgress(prev, next, PROGRESS_THROTTLE_MS - 1)).toBe(false);
    expect(shouldEmitProgress(prev, next, PROGRESS_THROTTLE_MS)).toBe(true);
  });

  it('ignores sub-1% deltas', () => {
    const prev = base({ percent: 10 });
    const next = base({ percent: 10 });
    expect(shouldEmitProgress(prev, next, 10_000)).toBe(false);
  });
});

describe('ScanProgressReporter', () => {
  it('throttles rapid percent updates but keeps stage changes', () => {
    let now = 0;
    const sent: ScanProgressEvent[] = [];
    const reporter = new ScanProgressReporter('system', (e) => sent.push(e), () => now);

    reporter.report('query', 10);
    now += 50;
    reporter.report('query', 12); // throttled
    now += 200;
    reporter.report('query', 14); // allowed
    reporter.report('parse', 70); // stage change, allowed
    reporter.done();

    expect(sent.map((e) => e.stage)).toEqual(['query', 'query', 'parse', 'done']);
    expect(sent.at(-1)?.percent).toBe(100);
  });
});
