import { describe, it, expect, beforeEach } from 'vitest';
import {
  accentTokens,
  applyAccentColor,
  contrastOn,
  contrastRatio,
  darken,
  hexToRgb,
  lighten,
  luminance,
  normalizeHex,
  rgba,
} from './accent';

describe('renderer/utils/accent', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
  });

  it('normalizes hex with or without the leading #', () => {
    expect(normalizeHex('#06b6d4')).toBe('#06B6D4');
    expect(normalizeHex('06B6D4')).toBe('#06B6D4');
    expect(normalizeHex('  #ABCDEF ')).toBe('#ABCDEF');
    expect(normalizeHex('nope')).toBeNull();
  });

  it('converts hex to rgb', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('bad')).toBeNull();
  });

  it('lightens and darkens toward the bounds', () => {
    expect(lighten('#000000', 1)).toBe('#FFFFFF');
    expect(darken('#FFFFFF', 1)).toBe('#000000');
    expect(lighten('#000000', 0)).toBe('#000000');
  });

  it('produces rgba strings', () => {
    expect(rgba('#FF0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('computes relative luminance ordering dark < light', () => {
    expect(luminance('#000000')).toBeLessThan(luminance('#FFFFFF'));
  });

  it('derives a hover colour that moves away from the accent', () => {
    // Dark accent brightens on hover.
    const dark = accentTokens('#101010');
    expect(dark.hover).not.toBe(dark.accent);
    // Light accent darkens on hover.
    const light = accentTokens('#EEEEEE');
    expect(light.hover).not.toBe(light.accent);
  });

  it('falls back to the brand colour for invalid input', () => {
    expect(accentTokens('bogus').accent).toBe('#06B6D4');
  });

  it('writes accent tokens onto the root element', () => {
    const ok = applyAccentColor('#FF0000');
    expect(ok).toBe(true);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--color-accent')).toBe('#FF0000');
    expect(style.getPropertyValue('--color-border-focus')).toBe('#FF0000');
    expect(style.getPropertyValue('--color-chart-primary')).toBe('#FF0000');
  });

  it('rejects invalid colours without mutating the root', () => {
    const ok = applyAccentColor('not-a-colour');
    expect(ok).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('');
  });
});

describe('renderer/utils/accent contrastOn (WCAG AA text on accent)', () => {
  it('computes the WCAG contrast ratio (white on black = 21)', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#06B6D4', '#FFFFFF')).toBeLessThan(4.5);
  });

  it('picks dark text on the default brand cyan (white fails AA)', () => {
    expect(contrastOn('#06B6D4')).toBe('#0A0E1A');
    expect(contrastRatio(contrastOn('#06B6D4'), '#06B6D4')).toBeGreaterThanOrEqual(4.5);
  });

  it('guarantees AA for the light-theme accent and a dark navy', () => {
    for (const bg of ['#0891B2', '#101010']) {
      expect(contrastRatio(contrastOn(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('guarantees AA for arbitrary user accents', () => {
    for (const bg of ['#8B5CF6', '#F59E0B', '#EF4444', '#10B981', '#3B82F6', '#EC4899']) {
      expect(contrastRatio(contrastOn(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('derives and applies the on-accent token with the accent set', () => {
    const tokens = accentTokens('#06B6D4');
    expect(tokens.onAccent).toBe('#0A0E1A');
    applyAccentColor('#06B6D4');
    expect(document.documentElement.style.getPropertyValue('--color-on-accent')).toBe('#0A0E1A');
  });
});
