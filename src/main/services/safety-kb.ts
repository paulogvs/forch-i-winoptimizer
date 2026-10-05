import { readBundledCatalog } from './catalog-data';
import { safetyWarning } from '@shared/safety';
import type { RiskLevel, SafetyLevel, TweakSafetyLevel } from '@shared/safety';

/**
 * Safety knowledge base loader (Fase 4.8).
 *
 * Reads the `safety`/`risk`/`safetyNote` metadata from the curated catalogs so
 * the UI can warn before applying a service/tweak. An entry that fails
 * validation is dropped (the UI then falls back to its own `protection`/impact
 * signals rather than showing an invented warning).
 */

export interface ServiceSafetyEntry {
  id: string;
  serviceName: string;
  safety: SafetyLevel;
  risk: RiskLevel;
  safetyNote: string;
}

export interface TweakSafetyEntry {
  id: string;
  safety: TweakSafetyLevel;
  risk: RiskLevel;
  safetyNote: string;
}

export interface SafetyKb {
  /** Keyed by lower-cased service name. */
  services: Map<string, ServiceSafetyEntry>;
  /** Keyed by tweak id. */
  tweaks: Map<string, TweakSafetyEntry>;
}

const SERVICE_SAFETIES = new Set<SafetyLevel>(['safe', 'caution', 'protected']);
const TWEAK_SAFETIES = new Set<TweakSafetyLevel>(['safe', 'advanced']);
const RISKS = new Set<RiskLevel>(['low', 'medium', 'high', 'critical']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asRisk(value: unknown): RiskLevel | null {
  return typeof value === 'string' && RISKS.has(value as RiskLevel) ? (value as RiskLevel) : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Validate + index the service safety metadata from the raw catalog envelope. */
export function parseServiceSafety(raw: unknown): ServiceSafetyEntry[] {
  const envelope = isRecord(raw) ? raw.services : null;
  if (!Array.isArray(envelope)) return [];
  const entries: ServiceSafetyEntry[] = [];
  for (const item of envelope) {
    if (!isRecord(item)) continue;
    const id = nonEmptyString(item.id);
    const serviceName = nonEmptyString(item.serviceName) ?? nonEmptyString(item.name);
    const safety = typeof item.safety === 'string' ? item.safety : '';
    const risk = asRisk(item.risk);
    const safetyNote = nonEmptyString(item.safetyNote);
    if (
      !id ||
      !serviceName ||
      !SERVICE_SAFETIES.has(safety as SafetyLevel) ||
      !risk ||
      !safetyNote
    ) {
      continue;
    }
    entries.push({ id, serviceName, safety: safety as SafetyLevel, risk, safetyNote });
  }
  return entries;
}

/** Validate + index the tweak safety metadata from the raw catalog envelope. */
export function parseTweakSafety(raw: unknown): TweakSafetyEntry[] {
  const envelope = isRecord(raw) ? raw.tweaks : null;
  if (!Array.isArray(envelope)) return [];
  const entries: TweakSafetyEntry[] = [];
  for (const item of envelope) {
    if (!isRecord(item)) continue;
    const id = nonEmptyString(item.id);
    const safety = typeof item.safety === 'string' ? item.safety : '';
    const risk = asRisk(item.risk);
    const safetyNote = nonEmptyString(item.safetyNote);
    if (!id || !TWEAK_SAFETIES.has(safety as TweakSafetyLevel) || !risk || !safetyNote) continue;
    entries.push({ id, safety: safety as TweakSafetyLevel, risk, safetyNote });
  }
  return entries;
}

/** Build the KB from the two already-read catalog envelopes (pure). */
export function buildSafetyKb(servicesRaw: unknown, tweaksRaw: unknown): SafetyKb {
  const services = new Map<string, ServiceSafetyEntry>();
  for (const entry of parseServiceSafety(servicesRaw)) {
    services.set(entry.serviceName.toLowerCase(), entry);
  }
  const tweaks = new Map<string, TweakSafetyEntry>();
  for (const entry of parseTweakSafety(tweaksRaw)) tweaks.set(entry.id, entry);
  return { services, tweaks };
}

let cached: SafetyKb | undefined;

/** Load and cache the safety KB from the bundled catalogs. */
export function loadSafetyKb(): SafetyKb {
  if (cached) return cached;
  cached = buildSafetyKb(
    readBundledCatalog<unknown>('services-catalog.json'),
    readBundledCatalog<unknown>('tweaks-catalog.json')
  );
  return cached;
}

/** Test seam: drop the cached KB so fresh data is re-read. */
export function resetSafetyKbCache(): void {
  cached = undefined;
}

export function getServiceSafety(serviceName: string): ServiceSafetyEntry | null {
  return loadSafetyKb().services.get(serviceName.trim().toLowerCase()) ?? null;
}

export function getTweakSafety(tweakId: string): TweakSafetyEntry | null {
  return loadSafetyKb().tweaks.get(tweakId) ?? null;
}

export { safetyWarning };
