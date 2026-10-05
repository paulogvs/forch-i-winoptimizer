/**
 * Cooperative scheduler (Fase 4.2, adopted from Kudu's `CooperativeScheduler`
 * pattern — design only, no code copied).
 *
 * Long CPU-bound loops in the Electron main process starve the event loop: the
 * renderer's IPC replies, timers and repaints freeze ("UI congelada") while a
 * scanner walks thousands of files. The fix is cooperative: yield to the event
 * loop with `setImmediate` every ~12 ms so pending I/O and timers get a turn,
 * then resume the loop.
 *
 * The yield interval is deliberately short: 12 ms keeps the loop well under a
 * frame budget (16 ms) while keeping the per-yield overhead negligible.
 */

export const DEFAULT_YIELD_INTERVAL_MS = 12;

/** Yield to the event loop as a macrotask (lets timers/I/O run). */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

export interface CooperativeSchedulerOptions {
  /** Minimum ms between yields (0 = yield on every call). */
  intervalMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Injectable yield primitive (tests). */
  yieldFn?: () => Promise<void>;
}

/**
 * Tracks when the loop last yielded and decides when it is due again. Pure
 * except for the injected `now`/`yieldFn`, so it is fully unit-testable.
 */
export class CooperativeScheduler {
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly yieldFn: () => Promise<void>;
  private lastYieldAt: number;

  constructor(options: CooperativeSchedulerOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_YIELD_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
    this.yieldFn = options.yieldFn ?? yieldToEventLoop;
    this.lastYieldAt = this.now();
  }

  /** True when a yield is due (or the interval is disabled with <= 0). */
  shouldYield(): boolean {
    return this.intervalMs <= 0 || this.now() - this.lastYieldAt >= this.intervalMs;
  }

  /**
   * Yield only when the interval elapsed. Returns whether it actually yielded,
   * so callers can piggyback throttled work (e.g. a progress report).
   */
  async yieldIfNeeded(): Promise<boolean> {
    if (!this.shouldYield()) return false;
    await this.yieldFn();
    this.lastYieldAt = this.now();
    return true;
  }

  /** Force a yield, resetting the interval clock. */
  async yieldNow(): Promise<void> {
    await this.yieldFn();
    this.lastYieldAt = this.now();
  }
}
