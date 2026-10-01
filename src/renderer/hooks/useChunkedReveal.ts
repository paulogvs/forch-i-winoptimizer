import { useEffect, useState } from 'react';

/** Number of rows painted on first frame (perceived instant render). */
export const DEFAULT_INITIAL_REVEAL = 30;
/** How many additional rows are revealed per idle tick. */
export const DEFAULT_REVEAL_STEP = 60;
/** Delay between reveal ticks (ms). */
export const DEFAULT_REVEAL_DELAY_MS = 50;

/** Pure helper: how many rows should be visible after one more tick. */
export function nextRevealCount(total: number, current: number, step: number = DEFAULT_REVEAL_STEP): number {
  if (total <= current) return total;
  return Math.min(total, current + step);
}

/**
 * Progressive/chunked reveal (P0.4).
 *
 * Paints `initial` rows immediately and grows toward `total` on subsequent
 * ticks, so long tables feel instant and the main thread is never blocked by a
 * single huge render.
 */
export function useChunkedReveal(
  total: number,
  initial: number = DEFAULT_INITIAL_REVEAL,
  step: number = DEFAULT_REVEAL_STEP,
  delayMs: number = DEFAULT_REVEAL_DELAY_MS
): number {
  const [revealed, setRevealed] = useState(() => Math.min(total, initial));

  useEffect(() => {
    setRevealed((prev) => Math.min(total, Math.max(prev, initial)));
  }, [total, initial]);

  useEffect(() => {
    if (revealed >= total) return;
    const handle = window.setTimeout(() => {
      setRevealed((prev) => nextRevealCount(total, prev, step));
    }, delayMs);
    return () => window.clearTimeout(handle);
  }, [revealed, total, step, delayMs]);

  return revealed;
}
