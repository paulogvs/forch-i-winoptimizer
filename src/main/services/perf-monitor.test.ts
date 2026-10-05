import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ThrottledSampler,
  PerfMonitor,
  NETWORK_THROTTLE_MS,
  FAST_SAMPLE_INTERVAL_MS,
  SLOW_SAMPLE_INTERVAL_MS,
} from './perf-monitor';

describe('ThrottledSampler (Fase 4.5)', () => {
  it('uses a ~5 s network throttle by default', () => {
    expect(NETWORK_THROTTLE_MS).toBe(5_000);
  });

  it('two calls within the throttle produce exactly one query', async () => {
    let now = 1_000;
    const sampler = new ThrottledSampler<number>(5_000, () => now);
    const loader = vi.fn().mockResolvedValue(42);

    expect(await sampler.sample(loader)).toBe(42);
    now += 1_000; // still inside the 5 s window
    expect(await sampler.sample(loader)).toBe(42);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('re-queries once the throttle window elapsed', async () => {
    let now = 1_000;
    const sampler = new ThrottledSampler<number>(5_000, () => now);
    const loader = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await sampler.sample(loader)).toBe(1);
    now += 5_001;
    expect(await sampler.sample(loader)).toBe(2);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('force bypasses the throttle window', async () => {
    const sampler = new ThrottledSampler<number>(5_000, () => 1_000);
    const loader = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await sampler.sample(loader);
    expect(await sampler.sample(loader, { force: true })).toBe(2);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('is single-flight: concurrent calls share one query', async () => {
    const sampler = new ThrottledSampler<number>(5_000);
    let release!: (value: number) => void;
    const loader = vi.fn().mockReturnValue(
      new Promise<number>((resolve) => {
        release = resolve;
      })
    );

    const first = sampler.sample(loader);
    const second = sampler.sample(loader);
    expect(sampler.isRunning).toBe(true);

    release(7);
    expect(await first).toBe(7);
    expect(await second).toBe(7);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(sampler.isRunning).toBe(false);
  });

  it('reset clears the cached value', async () => {
    const sampler = new ThrottledSampler<number>(5_000, () => 1_000);
    const loader = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await sampler.sample(loader);
    sampler.reset();
    expect(sampler.last).toBeNull();
    expect(await sampler.sample(loader)).toBe(2);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('PerfMonitor (Fase 4.5)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes distinct fast and slow cadences', () => {
    expect(FAST_SAMPLE_INTERVAL_MS).toBeLessThan(SLOW_SAMPLE_INTERVAL_MS);
  });

  it('samples fast more often than slow', async () => {
    vi.useFakeTimers();
    const fast = vi.fn().mockReturnValue(1);
    const slow = vi.fn().mockReturnValue(2);
    const monitor = new PerfMonitor<number, number>({
      sampleFast: fast,
      sampleSlow: slow,
      fastIntervalMs: 100,
      slowIntervalMs: 500,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(1_000);
    monitor.stop();

    expect(fast.mock.calls.length).toBeGreaterThan(slow.mock.calls.length);
    expect(slow.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not overlap slow samples', async () => {
    const slow = vi.fn();
    let release!: (value: number) => void;
    slow.mockReturnValue(
      new Promise<number>((resolve) => {
        release = resolve;
      })
    );
    const monitor = new PerfMonitor<number, number>({
      sampleFast: () => 1,
      sampleSlow: slow,
    });

    const first = monitor.tickSlow();
    const second = monitor.tickSlow(); // must be a no-op while running
    release(9);
    await first;
    await second;

    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('stop clears both timers', async () => {
    vi.useFakeTimers();
    const fast = vi.fn();
    const slow = vi.fn();
    const monitor = new PerfMonitor({ sampleFast: fast, sampleSlow: slow });
    monitor.start();
    expect(monitor.isRunning).toBe(true);
    monitor.stop();
    expect(monitor.isRunning).toBe(false);
    const fastCalls = fast.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fast.mock.calls.length).toBe(fastCalls);
  });
});
