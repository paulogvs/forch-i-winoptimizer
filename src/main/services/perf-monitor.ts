/**
 * Performance telemetry primitives (Fase 4.5, adopted from Kudu's `perf-monitor`
 * pattern — design only).
 *
 * Two problems this solves:
 *
 *  1. Dashboard/Boost poll system information, and a naive implementation
 *     spawns a PowerShell process on every call. `ThrottledSampler` coalesces
 *     calls inside a window (~5 s) and, crucially, never starts a second query
 *     while one is still in flight (`isRunning` guard).
 *  2. Cheap data (CPU/memory from Node) and expensive data (disk/GPU/OS via
 *     PowerShell) should not share a cadence. `PerfMonitor` runs two separate
 *     timers: a fast one for cheap samples and a slow, throttled one for the
 *     expensive probes.
 */

/** Cheap sample cadence (CPU/memory from `os`). */
export const FAST_SAMPLE_INTERVAL_MS = 1_000;
/** Expensive sample cadence (PowerShell-backed telemetry). */
export const SLOW_SAMPLE_INTERVAL_MS = 5_000;
/** Network/telemetry throttle window. */
export const NETWORK_THROTTLE_MS = 5_000;

export interface SampleOptions {
  /** Skip the throttle window (explicit user refresh). */
  force?: boolean;
}

/**
 * Throttled, single-flight sampler. `sample(loader)` returns the cached value
 * inside the window, and joins the in-flight promise instead of spawning a
 * second loader while one is running.
 */
export class ThrottledSampler<T> {
  private cached: T | null = null;
  private lastAt = 0;
  private running = false;
  private inflight: Promise<T> | null = null;

  constructor(
    private readonly minIntervalMs: number = NETWORK_THROTTLE_MS,
    private readonly now: () => number = () => Date.now()
  ) {}

  get last(): T | null {
    return this.cached;
  }

  /** True while a loader is in flight (overlap guard). */
  get isRunning(): boolean {
    return this.running;
  }

  async sample(loader: () => Promise<T>, options: SampleOptions = {}): Promise<T> {
    // Overlap guard: coalesce concurrent callers onto the in-flight query.
    if (this.running && this.inflight) return this.inflight;

    if (!options.force && this.cached !== null && this.now() - this.lastAt < this.minIntervalMs) {
      return this.cached;
    }

    this.running = true;
    const query = loader()
      .then((value) => {
        this.cached = value;
        this.lastAt = this.now();
        return value;
      })
      .finally(() => {
        this.running = false;
        this.inflight = null;
      });
    this.inflight = query;
    return query;
  }

  reset(): void {
    this.cached = null;
    this.lastAt = 0;
    this.running = false;
    this.inflight = null;
  }
}

export interface PerfMonitorOptions<TFast, TSlow> {
  sampleFast: () => TFast | Promise<TFast>;
  sampleSlow: () => TSlow | Promise<TSlow>;
  onFast?: (value: TFast) => void;
  onSlow?: (value: TSlow) => void;
  fastIntervalMs?: number;
  slowIntervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

/**
 * Dual-timer monitor: fast cadence for cheap samples, slow cadence for
 * expensive ones. The slow tick is re-entrancy guarded, so a slow probe that
 * takes longer than its interval never overlaps with itself.
 */
export class PerfMonitor<TFast = unknown, TSlow = unknown> {
  private fastTimer: ReturnType<typeof setInterval> | null = null;
  private slowTimer: ReturnType<typeof setInterval> | null = null;
  private slowRunning = false;
  private readonly fastIntervalMs: number;
  private readonly slowIntervalMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  constructor(private readonly options: PerfMonitorOptions<TFast, TSlow>) {
    this.fastIntervalMs = options.fastIntervalMs ?? FAST_SAMPLE_INTERVAL_MS;
    this.slowIntervalMs = options.slowIntervalMs ?? SLOW_SAMPLE_INTERVAL_MS;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  get isRunning(): boolean {
    return this.fastTimer !== null || this.slowTimer !== null;
  }

  start(): void {
    if (this.isRunning) return;
    void this.tickFast();
    void this.tickSlow();
    this.fastTimer = this.setIntervalFn(() => void this.tickFast(), this.fastIntervalMs);
    this.slowTimer = this.setIntervalFn(() => void this.tickSlow(), this.slowIntervalMs);
  }

  stop(): void {
    if (this.fastTimer !== null) this.clearIntervalFn(this.fastTimer);
    if (this.slowTimer !== null) this.clearIntervalFn(this.slowTimer);
    this.fastTimer = null;
    this.slowTimer = null;
  }

  async tickFast(): Promise<void> {
    try {
      const value = await this.options.sampleFast();
      this.options.onFast?.(value);
    } catch {
      // Telemetry must never crash the caller.
    }
  }

  async tickSlow(): Promise<void> {
    if (this.slowRunning) return;
    this.slowRunning = true;
    try {
      const value = await this.options.sampleSlow();
      this.options.onSlow?.(value);
    } catch {
      // Telemetry must never crash the caller.
    } finally {
      this.slowRunning = false;
    }
  }
}
