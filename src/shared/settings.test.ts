import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  formatExcludePaths,
  isValidAccentColor,
  normalizeSettings,
  parseExcludePaths,
} from './settings';

describe('shared/settings', () => {
  describe('isValidAccentColor', () => {
    it('accepts a 6-digit hex colour', () => {
      expect(isValidAccentColor('#06B6D4')).toBe(true);
      expect(isValidAccentColor('#abcdef')).toBe(true);
    });

    it('rejects malformed colours and non-strings', () => {
      expect(isValidAccentColor('#06B6D')).toBe(false);
      expect(isValidAccentColor('06B6D4')).toBe(false);
      expect(isValidAccentColor('red')).toBe(false);
      expect(isValidAccentColor(null)).toBe(false);
      expect(isValidAccentColor(123)).toBe(false);
    });
  });

  describe('normalizeSettings', () => {
    it('returns complete defaults for non-object input', () => {
      expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    });

    it('keeps valid fields and falls back for invalid ones', () => {
      const result = normalizeSettings({
        accentColor: 'not-a-colour',
        enableNotifications: false,
        scanRecycleBin: 'yes',
      });
      expect(result.accentColor).toBe(DEFAULT_SETTINGS.accentColor);
      expect(result.enableNotifications).toBe(false);
      expect(result.scanRecycleBin).toBe(DEFAULT_SETTINGS.scanRecycleBin);
    });

    it('sanitises, trims and caps exclude paths', () => {
      const result = normalizeSettings({
        excludePaths: ['  C:\\keep  ', '', 42, 'D:\\keep'],
      });
      expect(result.excludePaths).toEqual(['C:\\keep', 'D:\\keep']);
    });
  });

  describe('parseExcludePaths', () => {
    it('splits on commas, semicolons and newlines', () => {
      expect(parseExcludePaths('C:\\a, D:\\b;E:\\c\nF:\\d')).toEqual([
        'C:\\a',
        'D:\\b',
        'E:\\c',
        'F:\\d',
      ]);
    });

    it('drops blanks and caps at 100 entries', () => {
      expect(parseExcludePaths(' , ; \n')).toEqual([]);
      const many = Array.from({ length: 150 }, (_, i) => `C:\\p${i}`).join(',');
      expect(parseExcludePaths(many)).toHaveLength(100);
    });
  });

  describe('formatExcludePaths', () => {
    it('joins with commas', () => {
      expect(formatExcludePaths(['C:\\a', 'D:\\b'])).toBe('C:\\a, D:\\b');
    });
  });
});
