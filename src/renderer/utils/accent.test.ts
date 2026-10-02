import { describe, it, expect, beforeEach } from 'vitest';
import {
  accentTokens,
  applyAccentColor,
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
