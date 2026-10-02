import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Catalog JSON integrity (P0.1).
 *
 * The bundled `catalogs/*.json` files are read at runtime by the source
 * updater; a single malformed file breaks catalog loading silently. This
 * suite fails loudly on any JSON that no longer parses.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CATALOG_DIRS = [
  path.join(REPO_ROOT, 'catalogs'),
  path.join(REPO_ROOT, 'src', 'shared', 'catalogs'),
];

function listCatalogFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.join(dir, file));
}

const catalogFiles = CATALOG_DIRS.flatMap(listCatalogFiles);
const relative = (file: string) => path.relative(REPO_ROOT, file).replace(/\\/g, '/');

describe('catalog JSON integrity', () => {
  it('finds catalog files to validate', () => {
    expect(catalogFiles.length).toBeGreaterThan(0);
  });

  it.each(catalogFiles.map((file) => [relative(file), file]))('parses %s', (_name, file) => {
    const raw = fs.readFileSync(file, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it.each(catalogFiles.map((file) => [relative(file), file]))(
    '%s exposes expected top-level shape',
    (_name, file) => {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(parsed).toBeTypeOf('object');
      expect(parsed).not.toBeNull();
      expect(Object.keys(parsed as Record<string, unknown>).length).toBeGreaterThan(0);
    }
  );
});
