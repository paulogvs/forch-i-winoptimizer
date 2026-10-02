# Catalogs — single source of truth (v0.8.0)

> FORCH.iA WinOptimizer keeps every curated product/tweak/security list in
> **DATA** (`catalogs/*.json`), never in TypeScript. This document describes the
> format, how the paths resolve in dev and in the packaged app, and how the
> source-updater refreshes them.
>
> Built with FORCH.i by Paulo Velasco.

## Why

Before v0.8.0 the tweak list lived in `tweaks.ts` (19 entries) while
`catalogs/tweaks-catalog.json` carried a stale, **disjoint** 10-entry import from
winutil. Two sources of truth that silently diverged. v0.8.0 makes the JSON
authoritative and adds a test that fails if a product list ever returns to code.

## Files

| File | Key | Contents |
|------|-----|----------|
| `catalogs/apps-catalog.json` | `apps` | Removable UWP bloatware (RID/package guarded, `protected` refused server-side) |
| `catalogs/services-catalog.json` | `services` | Windows services metadata |
| `catalogs/cleaners-rules.json` | `rules` | Cleaner targets |
| `catalogs/tweaks-catalog.json` | `tweaks` | **19** reversible, previewable tweaks |
| `catalogs/app-bundles-catalog.json` | `bundles` | **8** winget bundles / **48** apps |

Every catalog is a JSON object with `version`, `lastUpdated` and one array under
a stable key. The reader picks the first array-valued key it finds.

## Loading

- `src/main/services/catalog-data.ts` — the single JSON reader. It resolves the
  file with `resolveBundledPath('catalogs', name)` (the **same** resolver
  `debloat.ts` and the source-updater use, so there is exactly one strategy) and
  returns `null` on a missing/corrupt file instead of throwing.
- `src/main/services/tweak-catalog.ts` — validates + loads the tweak catalog;
  malformed or duplicate entries are dropped (never executed).
- `app-bundles.ts` — validates + loads the bundle catalog; invalid bundles/apps
  are dropped.
- `debloat.ts` — consumes `apps-catalog.json` directly (unchanged behaviour).

## Path resolution (dev / packaged / CLI)

`resolveBundledPath` tries, in order:

1. `app.getAppPath()` — the packaged app's asar root (Electron only).
2. `process.cwd()` — dev / the `winoptimizer-updates` CLI.
3. `<__dirname>/../../..` and `<__dirname>/../..` — the compiled layout.

`src/main/source-updater/paths.test.ts` pins the dev case (every catalog
resolves) and runs a **real child process** with an `electron` stub to prove the
packaged case loads `catalogs/` through `app.getAppPath()`.

## Electron `files` whitelist

`package.json` → `build.files` includes `catalogs/**/*`, so every catalog is
shipped inside the package. Adding a file there is enough for it to ship.

## Updating from sources

`sources/sources.json` lists the upstream repos and the catalogs each one
provides. The source-updater (`src/main/source-updater/`) can fetch a catalog
from a repo's `catalogs/<name>.json` and store it under
`<userData>/forch-i-winoptimizer/catalogs/`. `diff-catalogs.ts` seeds the local
copy from the bundled file on first use, then `mergeCatalogs` applies only
items the user marked `imported`.

To change a curated list by hand, edit the JSON in `catalogs/` and update
`lastUpdated`; there is nothing to change in TypeScript.

## Guardrails (tests)

- `catalog-single-source.test.ts` — the tweak/bundle catalogs load from data
  (count === data count); no `wingetId`/`id` data literals or inline registry
  operations remain in the service `.ts` files; exactly one
  `tweaks-catalog.json` exists in the repo.
- `source-updater/catalogs.test.ts` — every `catalogs/*.json` parses and has a
  non-empty top-level object.
- `paths.test.ts` — dev + packaged resolution.
