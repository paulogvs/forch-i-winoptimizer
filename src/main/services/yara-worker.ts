import * as path from 'node:path';
import { parentPort } from 'node:worker_threads';
import type { YaraProtocolRuleMatch, WorkerRequest, WorkerResponse } from './yara-protocol';

/**
 * YARA worker entry (Fase 4.4).
 *
 * This is the ONLY production file that loads `@litko/yara-x`. It runs in a
 * `worker_thread` spawned by `yara-engine.ts`, so compiling rules and
 * scanning files/buffers NEVER blocks the Electron main thread. The
 * thread-isolation test in `yara-engine.test.ts` fails the build if the
 * native import leaks into any other main-process module.
 *
 * Loading (`loadNative`): in dev the worker resolves the package from
 * `node_modules` by walking up from `dist/`. The packaged worker boots from
 * `app.asar.unpacked` — whose ancestors hold no `node_modules` — so it falls
 * back to resolving through the archive (`app.asar/.../node_modules/...`).
 * Reading JS from the archive works; the `.node` binary is unpacked next to
 * it (see `build.asarUnpack`) and Electron redirects the load transparently.
 *
 * Protocol: exactly one response per request, matched by `id`. `init`
 * compiles all rule sources once; `scan-buffer` / `scan-file` reuse the
 * compiled scanner. Timeouts, size limits and cancellation are owned by the
 * engine side (it recycles this worker when a scan hangs).
 */

interface YaraRuleHit {
  ruleIdentifier: string;
  namespace: string;
  tags: Array<string>;
  meta: object;
}

interface YaraScanner {
  addRuleSources(sources: Array<{ source: string; namespace?: string }>): void;
  scan(data: Buffer): YaraRuleHit[];
  scanFile(filePath: string): YaraRuleHit[];
}

function resolveYaraDir(): string {
  try {
    // Dev (and vitest): node_modules is reachable by walking up.
    // (`require.resolve` is not flagged by no-require-imports.)
    return path.dirname(require.resolve('@litko/yara-x/package.json'));
  } catch {
    // Packaged: this file lives in app.asar.unpacked, the module in app.asar.
    const marker = `${path.sep}dist${path.sep}`;
    const cut = __dirname.indexOf(marker);
    const root =
      cut >= 0
        ? __dirname.slice(0, cut).replace('app.asar.unpacked', 'app.asar')
        : __dirname.replace('app.asar.unpacked', 'app.asar');
    return path.join(root, 'node_modules', '@litko', 'yara-x');
  }
}

const YARA_DIR = resolveYaraDir();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NATIVE = require(YARA_DIR) as { create(): YaraScanner };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ENGINE_VERSION: string = (require(path.join(YARA_DIR, 'package.json')) as { version: string })
  .version;

let scanner: YaraScanner | null = null;

function describeMatch(match: YaraRuleHit): YaraProtocolRuleMatch {
  const meta = match.meta as Record<string, unknown>;
  const description = meta['description'];
  return {
    rule: match.ruleIdentifier,
    namespace: match.namespace,
    tags: [...match.tags],
    description: typeof description === 'string' ? description : null,
  };
}

function countRules(sources: readonly string[]): number {
  let count = 0;
  for (const source of sources) {
    const matches = source.match(/^\s*rule\s+[A-Za-z_][A-Za-z0-9_]*/gm);
    count += matches?.length ?? 0;
  }
  return count;
}

function handle(request: WorkerRequest): WorkerResponse {
  if (request.kind === 'init') {
    try {
      const next = NATIVE.create();
      next.addRuleSources(
        request.rules.map((entry) => ({ source: entry.source, namespace: entry.namespace }))
      );
      scanner = next;
      return {
        id: request.id,
        kind: 'init',
        ok: true,
        ruleCount: countRules(request.rules.map((entry) => entry.source)),
        engineVersion: ENGINE_VERSION,
      };
    } catch (error) {
      scanner = null;
      return { id: request.id, kind: 'init', ok: false, error: String(error) };
    }
  }

  const active = scanner;
  if (!active) {
    return {
      id: request.id,
      kind: 'scan',
      ok: false,
      error: 'YARA rules are not compiled: send init first.',
    };
  }

  try {
    if (request.kind === 'scan-buffer') {
      const data = Buffer.from(request.dataBase64, 'base64');
      const matches = active.scan(data);
      return { id: request.id, kind: 'scan', ok: true, matches: matches.map(describeMatch) };
    }
    const matches = active.scanFile(request.path);
    return { id: request.id, kind: 'scan', ok: true, matches: matches.map(describeMatch) };
  } catch (error) {
    return { id: request.id, kind: 'scan', ok: false, error: String(error) };
  }
}

if (parentPort) {
  parentPort.on('message', (request: WorkerRequest) => {
    const response = handle(request);
    parentPort?.postMessage(response);
  });
}
