import type { ScanModule, ScanProgressEvent, ScanStage } from '@shared/scan-progress';

/** Minimum gap between two percent-only updates. */
export const PROGRESS_THROTTLE_MS = 180;
/** Minimum percent delta that counts as a meaningful change. */
export const PERCENT_EPSILON = 1;

export type ProgressSender = (event: ScanProgressEvent) => void;

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Decide whether a progress event is worth emitting.
 *
 * Rules (avoids UI spam):
 *  - always emit the first event;
 *  - always emit when the stage changes (discover -> query -> parse ...);
 *  - always emit terminal stages (done / error);
 *  - otherwise emit only if percent moved by >= 1 AND the throttle window elapsed.
 */
export function shouldEmitProgress(
  previous: ScanProgressEvent | null,
  next: ScanProgressEvent,
  elapsedMs: number
): boolean {
  if (!previous) return true;
  if (next.stage !== previous.stage) return true;
  if (next.stage === 'done' || next.stage === 'error') return true;
  return (
    Math.abs(next.percent - previous.percent) >= PERCENT_EPSILON &&
    elapsedMs >= PROGRESS_THROTTLE_MS
  );
}

/** Throttled, per-module progress reporter. Pure enough to unit test. */
export class ScanProgressReporter {
  private last: ScanProgressEvent | null = null;
  private lastEmittedAt = 0;

  constructor(
    private readonly module: ScanModule,
    private readonly send: ProgressSender,
    private readonly now: () => number = () => Date.now()
  ) {}

  report(stage: ScanStage, percent: number, message?: string, etaMs?: number): void {
    const event: ScanProgressEvent = {
      module: this.module,
      stage,
      percent: clampPercent(percent),
    };
    if (message !== undefined) event.message = message;
    if (etaMs !== undefined) event.etaMs = etaMs;

    const now = this.now();
    if (shouldEmitProgress(this.last, event, now - this.lastEmittedAt)) {
      this.last = event;
      this.lastEmittedAt = now;
      this.send(event);
    }
  }

  done(message?: string): void {
    this.report('done', 100, message);
  }

  fail(message?: string): void {
    this.report('error', 100, message);
  }
}

let progressSender: ProgressSender | null = null;

/** Register the renderer-side sender (called once the main window exists). */
export function setProgressSender(sender: ProgressSender | null): void {
  progressSender = sender;
}

/** Reporter bound to the currently registered sender (late-bound, null-safe). */
export function createProgressReporter(module: ScanModule): ScanProgressReporter {
  return new ScanProgressReporter(module, (event) => progressSender?.(event));
}

/** No-op reporter used as a safe default (tests, CLI, headless). */
export function createNoopReporter(module: ScanModule): ScanProgressReporter {
  return new ScanProgressReporter(module, () => {});
}
