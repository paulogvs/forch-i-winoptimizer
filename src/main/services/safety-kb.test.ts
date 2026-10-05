import { describe, it, expect } from 'vitest';
import {
  parseServiceSafety,
  parseTweakSafety,
  buildSafetyKb,
  loadSafetyKb,
  getServiceSafety,
  getTweakSafety,
  resetSafetyKbCache,
} from './safety-kb';
import { safetyWarning, isRisky } from '@shared/safety';

const VALID_SERVICES = {
  services: [
    {
      id: 'diagtrack',
      serviceName: 'DiagTrack',
      safety: 'caution',
      risk: 'medium',
      safetyNote: 'Telemetry service.',
      protection: 'caution',
      impact: 'medium',
    },
  ],
};

const VALID_TWEAKS = {
  tweaks: [
    {
      id: 'sysmain-toggle',
      safety: 'safe',
      risk: 'medium',
      safetyNote: 'Careful on HDDs.',
      impact: 'medium',
    },
  ],
};

describe('parseServiceSafety', () => {
  it('accepts a valid entry and indexes both keys', () => {
    const [entry] = parseServiceSafety(VALID_SERVICES);
    expect(entry).toBeDefined();
    expect(entry!.serviceName).toBe('DiagTrack');
    expect(entry!.safety).toBe('caution');
    expect(entry!.risk).toBe('medium');
  });

  it('drops entries with an invalid safety/risk or missing note', () => {
    expect(
      parseServiceSafety({
        services: [
          { id: 'a', serviceName: 'A', safety: 'bogus', risk: 'low', safetyNote: 'x' },
          { id: 'b', serviceName: 'B', safety: 'safe', risk: 'nope', safetyNote: 'x' },
          { id: 'c', serviceName: 'C', safety: 'safe', risk: 'low', safetyNote: '' },
          { id: 'd', safety: 'safe', risk: 'low', safetyNote: 'x' },
        ],
      })
    ).toEqual([]);
  });
});

describe('parseTweakSafety', () => {
  it('accepts the safe/advanced vocabulary', () => {
    const [entry] = parseTweakSafety(VALID_TWEAKS);
    expect(entry!.id).toBe('sysmain-toggle');
    expect(entry!.safety).toBe('safe');
    expect(entry!.risk).toBe('medium');
  });
});

describe('buildSafetyKb', () => {
  it('indexes services by lower-cased service name and tweaks by id', () => {
    const kb = buildSafetyKb(VALID_SERVICES, VALID_TWEAKS);
    expect(kb.services.get('diagtrack')!.risk).toBe('medium');
    expect(kb.tweaks.get('sysmain-toggle')!.safetyNote).toBe('Careful on HDDs.');
  });
});

describe('bundled catalogs satisfy the safety KB contract (Fase 4.8)', () => {
  it('every service entry carries a valid safety + risk + note', () => {
    resetSafetyKbCache();
    const kb = loadSafetyKb();
    expect(kb.services.size).toBeGreaterThanOrEqual(8);
    for (const entry of kb.services.values()) {
      expect(['safe', 'caution', 'protected']).toContain(entry.safety);
      expect(['low', 'medium', 'high', 'critical']).toContain(entry.risk);
      expect(entry.safetyNote.length).toBeGreaterThan(0);
    }
  });

  it('every tweak entry carries a valid safety + risk + note', () => {
    const kb = loadSafetyKb();
    expect(kb.tweaks.size).toBeGreaterThanOrEqual(19);
    for (const entry of kb.tweaks.values()) {
      expect(['safe', 'advanced']).toContain(entry.safety);
      expect(['low', 'medium', 'high', 'critical']).toContain(entry.risk);
      expect(entry.safetyNote.length).toBeGreaterThan(0);
    }
  });

  it('exposes lookups used by the UI', () => {
    expect(getServiceSafety('DiagTrack')!.safety).toBe('caution');
    expect(getTweakSafety('sysmain-toggle')!.risk).toBe('medium');
    expect(getServiceSafety('does-not-exist')).toBeNull();
  });
});

describe('safetyWarning', () => {
  it('returns the note for risky entries and null for safe ones', () => {
    expect(safetyWarning({ safety: 'caution', risk: 'medium', safetyNote: 'Careful.' })).toBe(
      'Careful.'
    );
    expect(safetyWarning({ safety: 'safe', risk: 'low', safetyNote: 'Careful.' })).toBeNull();
    expect(isRisky({ safety: 'protected', risk: 'low' })).toBe(true);
    expect(isRisky({ safety: 'advanced', risk: 'low' })).toBe(true);
  });
});
