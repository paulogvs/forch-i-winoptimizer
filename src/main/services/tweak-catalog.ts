import { readBundledCatalog } from './catalog-data';
import type { TweakDefinition, TweakOperation } from '@shared/tweaks';

/**
 * Tweaks catalog loader (Phase A).
 *
 * The curated, reversible tweak list is DATA: `catalogs/tweaks-catalog.json`.
 * This file only validates and loads it. Any entry that does not match the
 * `TweakDefinition` contract is dropped, so a malformed catalog can never be
 * executed on the machine. Duplicate ids are collapsed (first wins).
 */

const TWEAK_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CATEGORIES = new Set(['performance', 'privacy', 'explorer', 'accessibility']);
const SAFETIES = new Set(['safe', 'advanced']);
const IMPACTS = new Set(['low', 'medium', 'high']);
const RISKS = new Set(['low', 'medium', 'high', 'critical']);
const HIVES = new Set(['HKCU', 'HKLM']);
const VALUE_TYPES = new Set(['DWORD', 'String']);
const SERVICE_START_TYPES = new Set(['automatic', 'manual', 'disabled']);
const SERVICE_STATES = new Set(['running', 'stopped']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidOperation(op: unknown): op is TweakOperation {
  if (!isRecord(op) || typeof op.kind !== 'string') return false;
  switch (op.kind) {
    case 'registry':
      return (
        typeof op.hive === 'string' &&
        HIVES.has(op.hive) &&
        typeof op.path === 'string' &&
        op.path.length > 0 &&
        typeof op.name === 'string' &&
        op.name.length > 0 &&
        typeof op.type === 'string' &&
        VALUE_TYPES.has(op.type) &&
        // `null` is valid for revert-time removals (removeOnRevert).
        (op.value === null ||
          typeof op.value === 'number' ||
          typeof op.value === 'string' ||
          typeof op.value === 'undefined') &&
        (op.removeOnRevert === undefined || typeof op.removeOnRevert === 'boolean')
      );
    case 'service':
      return (
        typeof op.serviceName === 'string' &&
        op.serviceName.length > 0 &&
        (op.startType === undefined ||
          (typeof op.startType === 'string' && SERVICE_START_TYPES.has(op.startType))) &&
        (op.state === undefined || (typeof op.state === 'string' && SERVICE_STATES.has(op.state)))
      );
    case 'scheduled-task':
      return (
        typeof op.taskPath === 'string' &&
        typeof op.taskName === 'string' &&
        typeof op.disable === 'boolean'
      );
    case 'info':
      return typeof op.detail === 'string';
    default:
      return false;
  }
}

function isValidTweak(raw: unknown): raw is TweakDefinition {
  if (!isRecord(raw)) return false;
  return (
    typeof raw.id === 'string' &&
    TWEAK_ID_PATTERN.test(raw.id) &&
    typeof raw.name === 'string' &&
    raw.name.length > 0 &&
    typeof raw.description === 'string' &&
    raw.description.length > 0 &&
    typeof raw.category === 'string' &&
    CATEGORIES.has(raw.category) &&
    typeof raw.safety === 'string' &&
    SAFETIES.has(raw.safety) &&
    raw.reversible === true &&
    typeof raw.impact === 'string' &&
    IMPACTS.has(raw.impact) &&
    typeof raw.requiresAdmin === 'boolean' &&
    (raw.requiresBuild === undefined || typeof raw.requiresBuild === 'number') &&
    (raw.note === undefined || typeof raw.note === 'string') &&
    (raw.risk === undefined || (typeof raw.risk === 'string' && RISKS.has(raw.risk))) &&
    (raw.safetyNote === undefined || typeof raw.safetyNote === 'string') &&
    Array.isArray(raw.apply) &&
    raw.apply.length > 0 &&
    raw.apply.every(isValidOperation) &&
    Array.isArray(raw.revert) &&
    raw.revert.length > 0 &&
    raw.revert.every(isValidOperation)
  );
}

/** Load and validate the bundled tweak catalog from data. */
export function loadTweakCatalog(): TweakDefinition[] {
  const envelope = readBundledCatalog<{ tweaks?: unknown }>('tweaks-catalog.json');
  if (!envelope || !Array.isArray(envelope.tweaks)) return [];
  const seen = new Set<string>();
  const tweaks: TweakDefinition[] = [];
  for (const raw of envelope.tweaks) {
    if (!isValidTweak(raw) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    tweaks.push(raw);
  }
  return tweaks;
}
