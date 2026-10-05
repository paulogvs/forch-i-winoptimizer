import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseDriverCatalog,
  loadDriverCatalog,
  detectManufacturer,
  getSilentInstallArgs,
  isTrustedSigner,
  resetDriverCatalogCache,
} from './driver-catalog';

/**
 * Fase 2.2: manufacturer facts live in DATA (`catalogs/driver-catalog.json`).
 * These tests prove the loader validates/degrades honestly and that detection
 * is driven by the data (vendor ids + name patterns), never by hardcoded lists.
 */
describe('driver catalog (data-driven)', () => {
  beforeEach(() => {
    resetDriverCatalogCache();
  });

  it('loads the bundled catalog with the expected manufacturers', () => {
    const catalog = loadDriverCatalog();
    expect(catalog).not.toBeNull();
    const ids = catalog!.manufacturers.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['NVIDIA', 'AMD', 'Intel', 'Generic']));
    expect(catalog!.windowsUpdate.searchQuery).toContain("Type='Driver'");
    expect(catalog!.notAutomated.length).toBeGreaterThan(0);
  });

  it('parses the exact silent-install flags for each manufacturer', () => {
    expect(getSilentInstallArgs('NVIDIA')).toEqual(['-s', '-noreboot', '-clean']);
    expect(getSilentInstallArgs('AMD')).toEqual(['-INSTALL', '-SILENT', '-NOREBOOT']);
    expect(getSilentInstallArgs('Intel')).toEqual(['-s', '--noreboot']);
  });

  it('degrades to null on a malformed payload instead of throwing', () => {
    expect(parseDriverCatalog(null)).toBeNull();
    expect(parseDriverCatalog({ manufacturers: 'nope' })).toBeNull();
    expect(parseDriverCatalog({ manufacturers: [] })).toBeNull();
  });

  it('detects the manufacturer from a PCI vendor id (data-driven)', () => {
    // PCI\VEN_10DE... is NVIDIA in the catalog.
    expect(detectManufacturer('Some GPU', '', 'PCI\\VEN_10DE&DEV_2206')).toBe('NVIDIA');
    expect(detectManufacturer('Some GPU', '', 'PCI\\VEN_1002&DEV_0001')).toBe('AMD');
    expect(detectManufacturer('Some GPU', '', 'PCI\\VEN_8086&DEV_3E9B')).toBe('Intel');
  });

  it('detects the manufacturer from name patterns', () => {
    expect(detectManufacturer('NVIDIA GeForce RTX 3080', 'NVIDIA')).toBe('NVIDIA');
    expect(detectManufacturer('AMD Radeon RX 7900', 'Advanced Micro Devices')).toBe('AMD');
    expect(detectManufacturer('Intel(R) UHD Graphics 630', 'Intel Corporation')).toBe('Intel');
    expect(detectManufacturer('Realtek Audio', 'Realtek')).toBe('Generic');
  });

  it('accepts a vendor-signed Authenticode subject and rejects foreign signers', () => {
    expect(isTrustedSigner('NVIDIA', 'CN=NVIDIA Corporation, O=NVIDIA Corporation')).toBe(true);
    expect(isTrustedSigner('Intel', 'CN=Intel(R) Corporation')).toBe(true);
    expect(isTrustedSigner('NVIDIA', 'CN=Evil Corp')).toBe(false);
    // Generic has no trusted signer: auto-install must be refused.
    expect(isTrustedSigner('Generic', 'CN=Whatever')).toBe(false);
  });
});
