import { describe, it, expect, vi } from 'vitest';
import {
  parsePnputilEnumDrivers,
  parseDriverVersion,
  compareDriverVersions,
  driverIdentityKey,
  isVirtualDriver,
  isOemInfName,
  sumPackageSize,
  selectSupersededPackages,
  previewDriverStoreCleanup,
  applyDriverStoreCleanup,
  buildDriverStoreScanScript,
} from './driver-store-cleanup';
import type { DriverStoreCandidate } from '@shared/driver-store';
import type { PowerShellResult } from './powershell';

/**
 * Fixtures mirror the REAL `pnputil /enum-drivers` output captured on a
 * Spanish-locale Windows 11 machine (localized labels, non-ASCII accents), so
 * the parser is exercised against what Windows actually prints.
 */

interface BlockSpec {
  pub: string;
  orig: string;
  prov: string;
  cls: string;
  date: string;
  ver: string;
  signer: string;
}

function block(o: BlockSpec): string {
  return [
    `Nombre publicado:     ${o.pub}`,
    `Nombre original:      ${o.orig}`,
    `Nombre del proveedor:      ${o.prov}`,
    `Nombre de clase:         ${o.cls}`,
    `GUID de clase:         {4d36e978-e325-11ce-bfc1-08002be10318}`,
    `Versión del controlador:     ${o.date} ${o.ver}`,
    `Nombre del firmante:        ${o.signer}`,
    `Atributos:         Legacy`,
    `Versión de WHCP:       Desconocido`,
  ].join('\n');
}

const HECI_NEW: BlockSpec = {
  pub: 'oem9.inf',
  orig: 'heci.inf',
  prov: 'Intel',
  cls: 'System',
  date: '04/03/2018',
  ver: '11.7.0.1057',
  signer: 'Microsoft Windows Hardware Compatibility Publisher',
};
const HECI_OLD: BlockSpec = {
  pub: 'oem28.inf',
  orig: 'heci.inf',
  prov: 'INTEL',
  cls: 'System',
  date: '07/18/2017',
  ver: '11.7.0.1040',
  signer: 'Microsoft Windows Hardware Compatibility Publisher',
};
const AUDIO_OLD: BlockSpec = {
  pub: 'oem10.inf',
  orig: 'intcdaud.inf',
  prov: 'Intel(R) Corporation',
  cls: 'MEDIA',
  date: '04/26/2018',
  ver: '6.16.0.3208',
  signer: 'Microsoft Windows Hardware Compatibility Publisher',
};
const AUDIO_NEW: BlockSpec = {
  pub: 'oem17.inf',
  orig: 'intcdaud.inf',
  prov: 'Intel(R) Corporation',
  cls: 'MEDIA',
  date: '06/27/2016',
  ver: '8.20.0.950',
  signer: 'Microsoft Windows Hardware Compatibility Publisher',
};
const WINTUN: BlockSpec = {
  pub: 'oem15.inf',
  orig: 'wintun.inf',
  prov: 'WireGuard LLC',
  cls: 'Net',
  date: '10/13/2021',
  ver: '0.14.0.0',
  signer: 'Microsoft Windows Hardware Compatibility Publisher',
};
const WIREGUARD: BlockSpec = {
  pub: 'oem3.inf',
  orig: 'wireguard.inf',
  prov: 'WireGuard LLC',
  cls: 'Net',
  date: '10/12/2021',
  ver: '0.10.0.0',
  signer: 'Microsoft Windows Hardware Compatibility Publisher',
};
const ARDUINO_ORG: BlockSpec = {
  pub: 'oem37.inf',
  orig: 'arduino-org.inf',
  prov: 'Arduino Srl (www.arduino.org)',
  cls: 'Ports',
  date: '03/19/2015',
  ver: '1.1.1.0',
  signer: 'Arduino srl',
};
const ARDUINO_LLC: BlockSpec = {
  pub: 'oem25.inf',
  orig: 'arduino.inf',
  prov: 'Arduino LLC (www.arduino.cc)',
  cls: 'Ports',
  date: '11/24/2015',
  ver: '1.2.3.0',
  signer: 'Arduino SA',
};
const GENUINO: BlockSpec = {
  pub: 'oem36.inf',
  orig: 'genuino.inf',
  prov: 'Arduino LLC (www.arduino.cc)',
  cls: 'Ports',
  date: '01/07/2016',
  ver: '1.0.3.0',
  signer: 'Arduino LLC',
};

const FIXTURE =
  'Utilidad PnP de Microsoft\n\n' +
  [HECI_NEW, HECI_OLD, AUDIO_OLD, AUDIO_NEW, WINTUN, WIREGUARD, ARDUINO_ORG, ARDUINO_LLC, GENUINO]
    .map(block)
    .join('\n\n') +
  '\n';

function psResult(overrides: Partial<PowerShellResult>): PowerShellResult {
  return { success: true, stdout: '', stderr: '', exitCode: 0, ...overrides };
}

function scanEnvelope(pnputil: string): string {
  return JSON.stringify({ pnputil, repository: [], boundInfs: [] });
}

describe('parsePnputilEnumDrivers (Spanish, localized labels)', () => {
  it('parses every real block with position-independent field labels', () => {
    const packages = parsePnputilEnumDrivers(FIXTURE);
    expect(packages).toHaveLength(9);

    const heciNew = packages.find((p) => p.publishedName === 'oem9.inf')!;
    expect(heciNew.originalName).toBe('heci.inf');
    expect(heciNew.provider).toBe('Intel');
    expect(heciNew.className).toBe('System');
    expect(heciNew.version).toBe('11.7.0.1057');
    expect(heciNew.date).toBe('04/03/2018');

    const audio = packages.find((p) => p.publishedName === 'oem17.inf')!;
    expect(audio.provider).toBe('Intel(R) Corporation');
    expect(audio.version).toBe('8.20.0.950');
  });

  it('ignores the header block and empty input', () => {
    expect(parsePnputilEnumDrivers('')).toEqual([]);
    expect(parsePnputilEnumDrivers('Utilidad PnP de Microsoft\n')).toEqual([]);
  });
});

describe('version handling', () => {
  it('parses dotted versions numerically, rejecting non-numeric', () => {
    expect(parseDriverVersion('11.7.0.1057')).toEqual([11, 7, 0, 1057]);
    expect(parseDriverVersion('Unknown')).toBeNull();
    expect(parseDriverVersion('')).toBeNull();
  });

  it('compares numerically, never lexicographically', () => {
    expect(compareDriverVersions('11.7.0.1057', '11.7.0.1040')).toBeGreaterThan(0);
    expect(compareDriverVersions('8.20.0.950', '6.16.0.3208')).toBeGreaterThan(0);
    // Lexicographically "9.4.0.1025" > "22.40.0.7"; numerically it is smaller.
    expect(compareDriverVersions('22.40.0.7', '9.4.0.1025')).toBeGreaterThan(0);
    expect(compareDriverVersions('1.0.0.0', '1.0.0.0')).toBe(0);
  });
});

describe('identity + virtual detection', () => {
  it('keys identity by original INF + provider, case-insensitively', () => {
    const a = parsePnputilEnumDrivers(block(HECI_NEW));
    const b = parsePnputilEnumDrivers(block(HECI_OLD));
    expect(driverIdentityKey(a[0]!)).toBe(driverIdentityKey(b[0]!));
    // Different INF from the same vendor must NOT share an identity.
    const org = parsePnputilEnumDrivers(block(ARDUINO_ORG))[0]!;
    const llc = parsePnputilEnumDrivers(block(ARDUINO_LLC))[0]!;
    expect(driverIdentityKey(org)).not.toBe(driverIdentityKey(llc));
  });

  it('flags virtual/shim drivers only', () => {
    const wintun = parsePnputilEnumDrivers(block(WINTUN))[0]!;
    const wireguard = parsePnputilEnumDrivers(block(WIREGUARD))[0]!;
    const heci = parsePnputilEnumDrivers(block(HECI_NEW))[0]!;
    expect(isVirtualDriver(wintun)).toBe(true);
    expect(isVirtualDriver(wireguard)).toBe(true);
    expect(isVirtualDriver(heci)).toBe(false);
  });

  it('accepts only oemNN.inf deletion handles', () => {
    expect(isOemInfName('oem28.inf')).toBe(true);
    expect(isOemInfName('netwtw10.inf')).toBe(false);
    expect(isOemInfName('oem28.inf /uninstall')).toBe(false);
  });

  it('sums real FileRepository folder sizes by original INF prefix', () => {
    const entries = [
      { name: 'heci.inf_amd64_abc', size: 100 },
      { name: 'heci.inf_amd64_def', size: 50 },
      { name: 'netwtw10.inf_amd64_xyz', size: 999 },
    ];
    expect(sumPackageSize('heci.inf', entries)).toBe(150);
    expect(sumPackageSize('nope.inf', entries)).toBe(0);
  });
});

describe('selectSupersededPackages', () => {
  const packages = parsePnputilEnumDrivers(FIXTURE);

  it('selects only strictly-older, non-virtual, non-bound packages', () => {
    const candidates = selectSupersededPackages(packages, []);
    const removed = candidates.map((c) => c.publishedName).sort();
    expect(removed).toContain('oem28.inf'); // heci old
    expect(removed).toContain('oem10.inf'); // audio old (8.20 > 6.16)
    // The newest of each identity is never removed.
    expect(removed).not.toContain('oem9.inf');
    expect(removed).not.toContain('oem17.inf');
    // Virtuals are excluded entirely.
    expect(removed).not.toContain('oem15.inf');
    expect(removed).not.toContain('oem3.inf');
    // Distinct Arduino INFs are not grouped.
    expect(removed).not.toContain('oem37.inf');
    expect(removed).not.toContain('oem25.inf');
  });

  it('never selects a package currently bound to a device', () => {
    const candidates = selectSupersededPackages(packages, ['oem28.inf']);
    expect(candidates.map((c) => c.publishedName)).not.toContain('oem28.inf');
  });

  it('reports the newer package as the superseder', () => {
    const candidates = selectSupersededPackages(packages, []);
    const old = candidates.find((c) => c.publishedName === 'oem28.inf')!;
    expect(old.supersededBy.publishedName).toBe('oem9.inf');
    expect(old.supersededBy.version).toBe('11.7.0.1057');
    expect(old.reason).toBe('superseded');
  });
});

describe('previewDriverStoreCleanup (read-only)', () => {
  it('reports requires-admin but still parses the read-only scan', async () => {
    const run = vi.fn().mockResolvedValue(psResult({ stdout: scanEnvelope(FIXTURE) }));
    const preview = await previewDriverStoreCleanup({
      run,
      isAdmin: async () => false,
      loadRules: () => ({ virtualPatterns: ['wintun', 'wireguard'] }),
    });
    expect(preview.status).toBe('requires-admin');
    expect(preview.isAdmin).toBe(false);
    expect(preview.canApply).toBe(false);
    expect(preview.totalPackages).toBe(9);
    expect(preview.reclaimableCount).toBeGreaterThan(0);
    expect(run).toHaveBeenCalledTimes(1);
    // It must never issue a deletion in preview.
    expect(run.mock.calls[0]![0]).not.toMatch(/delete-driver/);
  });

  it('is unavailable when the scan does not run', async () => {
    const run = vi
      .fn()
      .mockResolvedValue(psResult({ success: false, stdout: '', stderr: 'blocked' }));
    const preview = await previewDriverStoreCleanup({ run, isAdmin: async () => true });
    expect(preview.status).toBe('unavailable');
    expect(preview.success).toBe(false);
  });

  it('builds a read-only scan script (enum only, no delete)', () => {
    const script = buildDriverStoreScanScript();
    expect(script).toMatch(/enum-drivers/);
    expect(script).not.toMatch(/delete-driver/);
  });
});

describe('applyDriverStoreCleanup', () => {
  const candidates: DriverStoreCandidate[] = [
    {
      ...parsePnputilEnumDrivers(block(HECI_OLD))[0]!,
      identityKey: 'heci.inf|intel',
      supersededBy: { publishedName: 'oem9.inf', version: '11.7.0.1057' },
      reason: 'superseded',
    },
  ];

  it('refuses without admin', async () => {
    const run = vi.fn();
    const result = await applyDriverStoreCleanup(candidates, { run, isAdmin: async () => false });
    expect(result.status).toBe('requires-admin');
    expect(run).not.toHaveBeenCalled();
  });

  it('does nothing when the selection is empty', async () => {
    const result = await applyDriverStoreCleanup([], { isAdmin: async () => true });
    expect(result.status).toBe('nothing-to-do');
  });

  it('removes and VERIFIES via a post-clean re-scan', async () => {
    const after = FIXTURE.replace(block(HECI_OLD), '').replace('\n\n\n', '\n');
    const run = vi.fn(async (script: string) => {
      if (script.includes('/delete-driver')) {
        return psResult({ stdout: 'Driver package deleted successfully.' });
      }
      return psResult({ stdout: scanEnvelope(after) });
    });
    const result = await applyDriverStoreCleanup(candidates, { run, isAdmin: async () => true });
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.removed).toBe(1);
    expect(result.results[0]!.verified).toBe(true);
  });

  it('never claims success when the package is still present afterwards', async () => {
    const run = vi.fn(async (script: string) => {
      if (script.includes('/delete-driver')) {
        return psResult({ stdout: 'Driver package deleted successfully.' });
      }
      return psResult({ stdout: scanEnvelope(FIXTURE) }); // oem28 still there
    });
    const result = await applyDriverStoreCleanup(candidates, { run, isAdmin: async () => true });
    expect(result.success).toBe(false);
    expect(result.removed).toBe(0);
    expect(result.results[0]!.status).toBe('failed');
    expect(result.results[0]!.verified).toBe(false);
  });

  it('refuses a non-oem deletion handle', async () => {
    const bad: DriverStoreCandidate[] = [{ ...candidates[0]!, publishedName: 'evil.inf" /force' }];
    const run = vi.fn();
    const result = await applyDriverStoreCleanup(bad, { run, isAdmin: async () => true });
    expect(result.results[0]!.status).toBe('skipped');
    expect(run).not.toHaveBeenCalled();
  });
});
