import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { compile, type RuleMatch } from '@litko/yara-x';
import { resolveBundledPath } from '../source-updater/paths';

/**
 * Bundled YARA rules validation (Fase 4.4).
 *
 * NOTE on the "never in main thread" guarantee: this file is a TEST (excluded
 * from `tsconfig.main.json`, never shipped, never loaded by Electron). It
 * exercises the REAL native engine in-process so CI fails loudly when a rule
 * stops compiling or EICAR stops matching. Production code reaches YARA only
 * through `yara-worker.ts` (see the thread-isolation test in
 * `yara-engine.test.ts`).
 */

export const EICAR_STRING = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

function rulesDir(): string {
  const dir = resolveBundledPath('catalogs', 'yara-rules');
  if (!dir) throw new Error('catalogs/yara-rules did not resolve (dev or packaged)');
  return dir;
}

function readRuleSources(): Array<{ file: string; source: string }> {
  const dir = rulesDir();
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as {
    version: string;
    files: string[];
  };
  expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(manifest.files.length).toBeGreaterThan(0);
  return manifest.files.map((file) => ({
    file,
    source: fs.readFileSync(path.join(dir, file), 'utf8'),
  }));
}

describe('bundled yara rules', () => {
  it('resolves the packaged catalog directory in every context', () => {
    expect(fs.existsSync(rulesDir())).toBe(true);
  });

  it('compiles every bundled rule source with zero errors', () => {
    for (const { file, source } of readRuleSources()) {
      const scanner = compile(source);
      expect(scanner.getCompilationErrors(), file).toEqual([]);
    }
  });

  it('matches the 68-byte EICAR test string and nothing else', () => {
    const combined = readRuleSources()
      .map((entry) => entry.source)
      .join('\n');
    const scanner = compile(combined);
    expect(Buffer.byteLength(EICAR_STRING, 'utf8')).toBe(68);

    const hits = scanner.scan(Buffer.from(EICAR_STRING, 'utf8'));
    expect(hits.map((hit: RuleMatch) => hit.ruleIdentifier)).toContain('Forchi_Eicar_Test_File');

    const clean = scanner.scan(Buffer.from('Just a harmless readme file.\n', 'utf8'));
    expect(clean).toEqual([]);
  });

  it('keeps heuristic rules quiet on plain prose', () => {
    const combined = readRuleSources()
      .map((entry) => entry.source)
      .join('\n');
    const scanner = compile(combined);
    const prose = Buffer.from(
      'Meeting notes: certutil is a Windows tool. Visit http://example.com for docs.\n',
      'utf8'
    );
    const hits = scanner.scan(prose);
    expect(hits.map((hit: RuleMatch) => hit.ruleIdentifier)).toEqual([]);
  });
});
