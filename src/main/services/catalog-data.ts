import * as fs from 'node:fs';
import { resolveBundledPath } from '../source-updater/paths';

/**
 * Curated catalog access (P2 / Phase A).
 *
 * All product/tweak/security lists live in DATA (`catalogs/*.json`), never in
 * code. This module is the single entry point that resolves a catalog across
 * dev, packaged (asar) and CLI contexts — it reuses `resolveBundledPath`, the
 * same path resolver `debloat.ts` uses, so there is exactly one resolution
 * strategy for every bundled JSON.
 *
 * Returns null when the file is missing or corrupt so callers can validate and
 * decide (never throws at import time).
 */
export function readBundledCatalog<T>(fileName: string): T | null {
  const file = resolveBundledPath('catalogs', fileName);
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}
