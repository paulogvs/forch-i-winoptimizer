import { describe, it, expect } from 'vitest';
import { nextRevealCount } from './useChunkedReveal';

describe('nextRevealCount', () => {
  it('grows by one step', () => {
    expect(nextRevealCount(200, 30, 60)).toBe(90);
  });

  it('never exceeds the total', () => {
    expect(nextRevealCount(100, 90, 60)).toBe(100);
  });

  it('returns total when already fully revealed', () => {
    expect(nextRevealCount(50, 50, 60)).toBe(50);
  });
});
