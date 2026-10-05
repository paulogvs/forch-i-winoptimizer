import { describe, it, expect, vi } from 'vitest';
import {
  cleanOutput,
  computeSeverity,
  parseWingetUpgrade,
  interpretWingetUpgrade,
  isValidWingetId,
  getSoftwareUpdates,
  updateSoftwareApp,
} from './software-updater';
import type { PowerShellResult } from './powershell';

/** REAL `winget upgrade --include-unknown` output captured on Spanish Windows. */
const REAL_OUTPUT = [
  'Nombre Id                        Versión Disponible Origen',
  '----------------------------------------------------------',
  'OpenAL CreativeTechnology.OpenAL Unknown 1.1        winget',
  '1 actualizaciones disponibles.',
].join('\n');

const NO_UPGRADES = [
  'No se encontró ningún paquete que coincida con los criterios de entrada.',
  '1 paquete(s) tienen números de versión que no se pueden determinar. Use --include-unknown para ver todos los resultados.',
].join('\n');

function ps(overrides: Partial<PowerShellResult>): PowerShellResult {
  return { success: true, stdout: '', stderr: '', exitCode: 0, ...overrides };
}

describe('cleanOutput', () => {
  it('strips ANSI, spinners and CR-overwrites', () => {
    const raw = '\u001b[32mLoading\u001b[0m\r\u001b[K-\r\u001b[K\\\rDone\n';
    expect(cleanOutput(raw)).toBe('Done');
  });
});

describe('computeSeverity', () => {
  it('classifies major/minor/patch numerically', () => {
    expect(computeSeverity('1.0.0', '2.0.0')).toBe('major');
    expect(computeSeverity('1.0.0', '1.2.0')).toBe('minor');
    expect(computeSeverity('1.0.0', '1.0.5')).toBe('patch');
    // Numeric, not lexicographic: 1.10 > 1.9.
    expect(computeSeverity('1.9.0', '1.10.0')).toBe('minor');
  });

  it('returns unknown for non-numeric versions', () => {
    expect(computeSeverity('Unknown', '1.1')).toBe('unknown');
  });
});

describe('isValidWingetId', () => {
  it('accepts real ids and rejects shell metacharacters', () => {
    expect(isValidWingetId('CreativeTechnology.OpenAL')).toBe(true);
    expect(isValidWingetId('Microsoft.VisualStudioCode')).toBe(true);
    expect(isValidWingetId('a; rm -rf /')).toBe(false);
    expect(isValidWingetId("x' --exact")).toBe(false);
  });
});

describe('parseWingetUpgrade (real Spanish output)', () => {
  it('parses the table positionally from the localized header', () => {
    const updates = parseWingetUpgrade(REAL_OUTPUT);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      id: 'CreativeTechnology.OpenAL',
      name: 'OpenAL',
      currentVersion: 'Unknown',
      availableVersion: '1.1',
      source: 'winget',
      severity: 'unknown',
    });
  });

  it('returns [] when there is no table', () => {
    expect(parseWingetUpgrade(NO_UPGRADES)).toEqual([]);
    expect(parseWingetUpgrade('')).toEqual([]);
  });
});

describe('interpretWingetUpgrade (never "up to date" on a non-answer)', () => {
  it('is `ok` with the real update list', () => {
    const { status, updates } = interpretWingetUpgrade(REAL_OUTPUT);
    expect(status).toBe('ok');
    expect(updates).toHaveLength(1);
  });

  it('is `up-to-date` on the explicit Spanish no-match answer', () => {
    expect(interpretWingetUpgrade(NO_UPGRADES).status).toBe('up-to-date');
  });

  it('is `up-to-date` on the English no-match answer', () => {
    expect(
      interpretWingetUpgrade('No installed package found matching input criteria.').status
    ).toBe('up-to-date');
  });

  it('is `unavailable` on empty or unrecognized output', () => {
    expect(interpretWingetUpgrade('').status).toBe('unavailable');
    expect(interpretWingetUpgrade('something unrelated').status).toBe('unavailable');
  });
});

describe('getSoftwareUpdates', () => {
  it('reports the real updates from winget', async () => {
    const run = vi.fn().mockResolvedValue(ps({ stdout: REAL_OUTPUT }));
    const report = await getSoftwareUpdates({ run });
    expect(report.status).toBe('ok');
    expect(report.count).toBe(1);
    expect(report.success).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toMatch(/winget upgrade/);
  });

  it('never reports up-to-date on an empty answer', async () => {
    const run = vi.fn().mockResolvedValue(ps({ stdout: '' }));
    const report = await getSoftwareUpdates({ run });
    expect(report.status).toBe('unavailable');
    expect(report.success).toBe(false);
  });

  it('reports up-to-date on the explicit no-match answer', async () => {
    const run = vi.fn().mockResolvedValue(ps({ stdout: NO_UPGRADES }));
    const report = await getSoftwareUpdates({ run });
    expect(report.status).toBe('up-to-date');
    expect(report.success).toBe(true);
  });
});

describe('updateSoftwareApp', () => {
  it('refuses an unsafe id before running anything', async () => {
    const runLong = vi.fn();
    const result = await updateSoftwareApp('OpenAL; rm -rf /', { runLong });
    expect(result.success).toBe(false);
    expect(runLong).not.toHaveBeenCalled();
  });

  it('updates and re-verifies that the app left the update list', async () => {
    const runLong = vi.fn().mockResolvedValue(ps({ stdout: 'Successfully installed' }));
    const run = vi.fn().mockResolvedValue(ps({ stdout: NO_UPGRADES }));
    const result = await updateSoftwareApp('CreativeTechnology.OpenAL', { runLong, run });
    expect(result.success).toBe(true);
  });

  it('does not claim success when the app is still listed after the update', async () => {
    const runLong = vi.fn().mockResolvedValue(ps({ stdout: 'Successfully installed' }));
    const run = vi.fn().mockResolvedValue(ps({ stdout: REAL_OUTPUT }));
    const result = await updateSoftwareApp('CreativeTechnology.OpenAL', { runLong, run });
    expect(result.success).toBe(false);
  });
});
