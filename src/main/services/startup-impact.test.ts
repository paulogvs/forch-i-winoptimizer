import { describe, it, expect } from 'vitest';
import {
  classifyStartupImpact,
  decodeExecutablePath,
  normalizeSignatureStatus,
  originFromLocation,
  type StartupSignals,
} from './startup-impact';

/**
 * Fixtures deliberately use a vendor that exists nowhere in the source tree.
 * Any passing assertion therefore proves the classifier works from observable
 * signals, never from a name lookup.
 */
function baseSignals(overrides: Partial<StartupSignals> = {}): StartupSignals {
  return {
    origin: 'hkcu-run',
    command: '"C:\\Vendor\\TotallyUnknownVendor\\tool.exe" --background',
    exePath: 'C:\\Vendor\\TotallyUnknownVendor\\tool.exe',
    binaryExists: true,
    signature: 'signed',
    signer: 'CN=Totally Unknown Vendor Ltd',
    underSystemPath: false,
    running: false,
    cpuSeconds: null,
    memoryMb: null,
    name: 'Totally Unknown Vendor Tool',
    ...overrides,
  };
}

describe('startup-impact classifier', () => {
  it('classifies an unknown vendor by signals, not by name', () => {
    const signedIdle = classifyStartupImpact(baseSignals());
    expect(signedIdle.impact).toBe('low');
    expect(signedIdle.publisher).toBe('CN=Totally Unknown Vendor Ltd');

    // Same unknown vendor, but now measured while actually consuming resources.
    const heavy = classifyStartupImpact(
      baseSignals({ running: true, cpuSeconds: 400, memoryMb: 500 })
    );
    expect(heavy.impact).toBe('high');
    expect(heavy.reasons.join(' ')).toMatch(/measured CPU time/);
    expect(heavy.reasons.join(' ')).toMatch(/measured working set/);
  });

  it('is name-agnostic: identical signals except the name give identical impact', () => {
    const a = classifyStartupImpact(baseSignals({ name: 'Totally Unknown Vendor Tool' }));
    const b = classifyStartupImpact(baseSignals({ name: 'Zzz Qqq Xyz' }));
    expect(a.impact).toBe(b.impact);
    expect(a.score).toBe(b.score);
  });

  it('raises impact when the binary is unsigned', () => {
    const signed = classifyStartupImpact(baseSignals());
    const unsigned = classifyStartupImpact(baseSignals({ signature: 'unsigned', signer: null }));
    expect(unsigned.score).toBeGreaterThan(signed.score);
    expect(unsigned.impact).toBe('medium');
    expect(unsigned.publisher).toBe('Unknown');
  });

  it('raises impact when the binary lives under a protected system location', () => {
    const vendor = classifyStartupImpact(baseSignals());
    const system = classifyStartupImpact(
      baseSignals({
        exePath: 'C:\\Windows\\System32\\plugin.exe',
        underSystemPath: true,
      })
    );
    expect(system.score).toBeGreaterThan(vendor.score);
  });

  it('treats machine-wide origins as heavier than per-user ones', () => {
    const user = classifyStartupImpact(baseSignals());
    const machine = classifyStartupImpact(baseSignals({ origin: 'hklm-run' }));
    const service = classifyStartupImpact(baseSignals({ origin: 'service' }));
    expect(machine.score).toBeGreaterThan(user.score);
    expect(service.score).toBeGreaterThan(machine.score);
  });

  it('recognises generic background grammar without any product list', () => {
    const plain = classifyStartupImpact(baseSignals({ name: 'Totally Unknown Vendor Tool' }));
    const updater = classifyStartupImpact(baseSignals({ name: 'Totally Unknown Vendor Updater' }));
    expect(updater.score).toBe(plain.score + 1);
    expect(updater.reasons.join(' ')).toMatch(/generic "update"/);
  });

  it('handles a missing binary honestly', () => {
    const assessment = classifyStartupImpact(
      baseSignals({ binaryExists: false, signature: 'unknown', signer: null })
    );
    expect(assessment.reasons.join(' ')).toMatch(/not found on disk/);
    expect(assessment.impact).toBe('low');
  });

  it('always returns at least one reason', () => {
    const assessment = classifyStartupImpact(baseSignals());
    expect(assessment.reasons.length).toBeGreaterThan(0);
  });
});

describe('normalizeSignatureStatus', () => {
  it('maps the real Get-AuthenticodeSignature statuses', () => {
    expect(normalizeSignatureStatus('Valid')).toBe('signed');
    expect(normalizeSignatureStatus('NotSigned')).toBe('unsigned');
    expect(normalizeSignatureStatus('UnknownError')).toBe('not-verifiable');
    expect(normalizeSignatureStatus('HashMismatch')).toBe('not-verifiable');
    expect(normalizeSignatureStatus('')).toBe('unknown');
    expect(normalizeSignatureStatus(null)).toBe('unknown');
  });
});

describe('originFromLocation', () => {
  it('derives the persistence scope from a Windows location string', () => {
    expect(originFromLocation('HKLM')).toBe('hklm-run');
    expect(originFromLocation('HKCU')).toBe('hkcu-run');
    expect(originFromLocation('C:\\Users\\x\\Startup')).toBe('startup-folder');
    expect(originFromLocation('ScheduledTask:\\')).toBe('scheduled-task');
    expect(originFromLocation('Service')).toBe('service');
    expect(originFromLocation(null)).toBe('unknown');
  });
});

describe('decodeExecutablePath', () => {
  it('parses quoted, bare and argument-suffixed commands', () => {
    expect(decodeExecutablePath('"C:\\Program Files\\App\\app.exe" --silent')).toBe(
      'C:\\Program Files\\App\\app.exe'
    );
    expect(decodeExecutablePath('C:\\App\\app.exe')).toBe('C:\\App\\app.exe');
    expect(decodeExecutablePath('C:\\App\\app.exe --flag')).toBe('C:\\App\\app.exe');
    expect(decodeExecutablePath('-background')).toBeNull();
    expect(decodeExecutablePath('')).toBeNull();
    expect(decodeExecutablePath(null)).toBeNull();
  });
});
