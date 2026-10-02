import Module from 'node:module';
import path from 'node:path';

/**
 * Runtime resolver for the `@shared/*` TypeScript path alias (v0.7.0).
 *
 * Why this exists
 * ---------------
 * The main/preload processes are compiled with `tsc -p tsconfig.main.json` to
 * CommonJS. TypeScript's `paths` mapping (`@shared/* -> src/shared/*`) is a
 * COMPILE-TIME-only feature: `tsc` does NOT rewrite emitted `require()` calls.
 * So `import { X } from '@shared/security-scan'` emits
 * `require("@shared/security-scan")`, and Node would fail to resolve it at
 * runtime unless something maps it back to `dist/shared/*`.
 *
 * The previous workaround hand-created ~10 shim packages inside
 * `node_modules/@shared/`. `node_modules` is gitignored, so a fresh install
 * (or `npm ci`) deleted them and the real-Electron E2E stopped resolving
 * `@shared/*`. That is the build-reproducibility bug this module fixes.
 *
 * Fix: patch Node's CommonJS resolver once, from the compiled main process
 * itself, mapping `@shared/<x>` to `dist/shared/<x>`. Nothing is written to
 * `node_modules`; the mapping ships in the committed source and survives any
 * reinstall. The preload uses relative imports and needs no mapping.
 *
 * This file MUST be imported before any module that requires `@shared/*`
 * (it is the first import in `src/main/index.ts`).
 */

const SHARED_PREFIX = '@shared/';

type ResolveFilename = (
  request: string,
  parent?: NodeModule,
  isMain?: boolean,
  options?: { paths?: string[] }
) => string;

interface ResolverModule {
  _resolveFilename: ResolveFilename;
}

const resolver = Module as unknown as ResolverModule;

// Guard so re-imports (or test harnesses) never double-wrap the resolver.
const MARKER = '__forchiSharedAliasInstalled__';
if (!(resolver as unknown as Record<string, unknown>)[MARKER]) {
  const originalResolveFilename = resolver._resolveFilename;

  resolver._resolveFilename = function resolveFilename(
    this: unknown,
    request: string,
    parent?: NodeModule,
    isMain?: boolean,
    options?: { paths?: string[] }
  ): string {
    if (typeof request === 'string' && request.startsWith(SHARED_PREFIX)) {
      const target = request.slice(SHARED_PREFIX.length);
      // `__dirname` is dist/main at runtime, so this resolves dist/shared/<x>.
      return originalResolveFilename.call(
        this,
        path.join(__dirname, '..', 'shared', target),
        parent,
        isMain,
        options
      );
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  (resolver as unknown as Record<string, unknown>)[MARKER] = true;
}
