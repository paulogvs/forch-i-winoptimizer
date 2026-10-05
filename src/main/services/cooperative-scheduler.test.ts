import { describe, it, expect, vi } from 'vitest';
import { CooperativeScheduler, DEFAULT_YIELD_INTERVAL_MS } from './cooperative-scheduler';

describe('CooperativeScheduler (Fase 4.2)', () => {
  it('exposes a ~12 ms default yield interval', () => {
    expect(DEFAULT_YIELD_INTERVAL_MS).toBe(12);
  });

  it('does not yield before the interval elapses', async () => {
    let now = 1_000;
    const yieldFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new CooperativeScheduler({ intervalMs: 12, now: () => now, yieldFn });

    expect(await scheduler.yieldIfNeeded()).toBe(false);
    now += 11;
    expect(await scheduler.yieldIfNeeded()).toBe(false);
    expect(yieldFn).not.toHaveBeenCalled();
  });

  it('yields once the interval elapsed and resets the clock', async () => {
    let now = 1_000;
    const yieldFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new CooperativeScheduler({ intervalMs: 12, now: () => now, yieldFn });

    now += 12;
    expect(await scheduler.yieldIfNeeded()).toBe(true);
    expect(yieldFn).toHaveBeenCalledTimes(1);

    // The clock reset on the yield, so an immediate retry is a no-op.
    expect(await scheduler.yieldIfNeeded()).toBe(false);
    now += 12;
    expect(await scheduler.yieldIfNeeded()).toBe(true);
    expect(yieldFn).toHaveBeenCalledTimes(2);
  });

  it('yields on every call when the interval is disabled (0)', async () => {
    const yieldFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new CooperativeScheduler({ intervalMs: 0, yieldFn });

    await scheduler.yieldIfNeeded();
    await scheduler.yieldIfNeeded();
    expect(yieldFn).toHaveBeenCalledTimes(2);
  });

  it('yieldNow always yields', async () => {
    const yieldFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = new CooperativeScheduler({ intervalMs: 10_000, now: () => 0, yieldFn });

    await scheduler.yieldNow();
    expect(yieldFn).toHaveBeenCalledTimes(1);
  });

  // The real regression this feature fixes: a long loop must not starve timers.
  it('lets a scheduled timer run while a long loop is still in progress', async () => {
    const scheduler = new CooperativeScheduler({ intervalMs: 0 });
    const events: string[] = [];

    const timer = new Promise<void>((resolve) => {
      setTimeout(() => {
        events.push('timer');
        resolve();
      }, 0);
    });

    for (let i = 0; i < 50; i++) {
      await scheduler.yieldIfNeeded();
      events.push('loop');
    }

    await timer;

    expect(events).toContain('timer');
    // The timer fired DURING the loop, not only after it finished.
    expect(events.indexOf('timer')).toBeLessThan(events.length - 1);
  });
});
