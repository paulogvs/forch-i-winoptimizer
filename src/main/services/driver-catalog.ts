import { readBundledCatalog } from './catalog-data';

/**
 * Driver catalog (Fase 2.2).
 *
 * Every manufacturer-specific fact lives in DATA
 * (`catalogs/driver-catalog.json`), never in code: silent install flags,
 * vendor/name patterns, trusted signer patterns and the Windows Update GPO
 * keys. `driver-updater.ts` and `driver-installer.ts` consume this module.
 *
 * A missing or corrupt catalog degrades to `null` (never throws); callers must
 * decide what to do without the data instead of crashing.
 */

export interface DriverManufacturerSpec {
  id: string;
  name: string;
  /** PCI vendor ids (hex, uppercase) used to match a hardware id. */
  vendorIds: string[];
  /** Lower-case substrings used to detect the manufacturer from name fields. */
  namePatterns: string[];
  /** Silent install flags; `/norestart` is appended by the installer, not here. */
  installerArgs: string[];
  /** True when the download is a self-extracting wrapper needing silent run. */
  requiresExtract: boolean;
  /** Trusted Authenticode signer substrings for this vendor. */
  signerPatterns: string[];
  sourceKind: 'manual-page' | 'none';
  downloadPage: string;
  notes: string;
}

export interface DriverWindowsUpdateSpec {
  policyRegistryPath: string;
  policyValueName: string;
  searchOrderRegistryPath: string;
  searchOrderValueName: string;
  searchQuery: string;
}

export interface DriverCatalog {
  version: string;
  lastUpdated: string;
  manufacturers: DriverManufacturerSpec[];
  windowsUpdate: DriverWindowsUpdateSpec;
  notAutomated: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function parseManufacturer(raw: unknown): DriverManufacturerSpec | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  const sourceKind = raw.sourceKind === 'none' ? 'none' : 'manual-page';
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : raw.id,
    vendorIds: asStringArray(raw.vendorIds).map((v) => v.toUpperCase()),
    namePatterns: asStringArray(raw.namePatterns).map((v) => v.toLowerCase()),
    installerArgs: asStringArray(raw.installerArgs),
    requiresExtract: raw.requiresExtract === true,
    signerPatterns: asStringArray(raw.signerPatterns),
    sourceKind,
    downloadPage: typeof raw.downloadPage === 'string' ? raw.downloadPage : '',
    notes: typeof raw.notes === 'string' ? raw.notes : '',
  };
}

export function parseDriverCatalog(raw: unknown): DriverCatalog | null {
  if (!isRecord(raw) || !Array.isArray(raw.manufacturers)) return null;
  const manufacturers = raw.manufacturers
    .map(parseManufacturer)
    .filter((m): m is DriverManufacturerSpec => m !== null);
  if (manufacturers.length === 0) return null;

  const wuRaw = isRecord(raw.windowsUpdate) ? raw.windowsUpdate : {};
  const str = (key: string, fallback: string): string =>
    typeof wuRaw[key] === 'string' && (wuRaw[key] as string).length > 0
      ? (wuRaw[key] as string)
      : fallback;

  return {
    version: typeof raw.version === 'string' ? raw.version : '0.0.0',
    lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : '',
    manufacturers,
    windowsUpdate: {
      policyRegistryPath: str(
        'policyRegistryPath',
        'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate'
      ),
      policyValueName: str('policyValueName', 'ExcludeWUDriversInQualityUpdate'),
      searchOrderRegistryPath: str(
        'searchOrderRegistryPath',
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DriverSearching'
      ),
      searchOrderValueName: str('searchOrderValueName', 'SearchOrderConfig'),
      searchQuery: str('searchQuery', "IsInstalled=0 AND Type='Driver'"),
    },
    notAutomated: asStringArray(raw.notAutomated),
  };
}

let cached: DriverCatalog | null | undefined;

/** Load and validate the bundled driver catalog (cached per process). */
export function loadDriverCatalog(): DriverCatalog | null {
  if (cached !== undefined) return cached;
  cached = parseDriverCatalog(readBundledCatalog<unknown>('driver-catalog.json'));
  return cached;
}

/** Test seam: drop the cached catalog so a fresh file is re-read. */
export function resetDriverCatalogCache(): void {
  cached = undefined;
}

export function getManufacturerSpec(id: string): DriverManufacturerSpec | null {
  const catalog = loadDriverCatalog();
  if (!catalog) return null;
  return catalog.manufacturers.find((m) => m.id === id) ?? null;
}

/**
 * Detect the manufacturer from a device's name / manufacturer / hardware id.
 * Data-driven: the patterns come from the catalog, not from code.
 */
export function detectManufacturer(name: string, manufacturer: string, hardwareId = ''): string {
  const catalog = loadDriverCatalog();
  const hwid = hardwareId.toUpperCase();
  const combined = `${name} ${manufacturer}`.toLowerCase();

  if (catalog) {
    for (const spec of catalog.manufacturers) {
      if (spec.id === 'Generic') continue;
      if (spec.vendorIds.some((vid) => vid.length > 0 && hwid.includes(`VEN_${vid}`))) {
        return spec.id;
      }
    }
    for (const spec of catalog.manufacturers) {
      if (spec.id === 'Generic') continue;
      if (spec.namePatterns.some((p) => combined.includes(p))) return spec.id;
    }
  }
  return 'Generic';
}

/** Silent install flags for a manufacturer (empty when unknown/none). */
export function getSilentInstallArgs(manufacturerId: string): string[] {
  return getManufacturerSpec(manufacturerId)?.installerArgs ?? [];
}

/**
 * True when the Authenticode subject matches one of the vendor's trusted
 * signer patterns. An empty pattern list means "no vendor signature check"
 * (Generic), which callers must treat as "cannot auto-install".
 */
export function isTrustedSigner(manufacturerId: string, subject: string): boolean {
  const spec = getManufacturerSpec(manufacturerId);
  if (!spec || spec.signerPatterns.length === 0) return false;
  const s = subject.toLowerCase();
  return spec.signerPatterns.some((p) => s.includes(p.toLowerCase()));
}
