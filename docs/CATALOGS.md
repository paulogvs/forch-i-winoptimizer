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

| File                                | Key               | Contents                                                                                           |
| ----------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `catalogs/apps-catalog.json`        | `apps`            | Removable UWP bloatware (RID/package guarded, `protected` refused server-side)                     |
| `catalogs/services-catalog.json`    | `services`        | Windows services metadata                                                                          |
| `catalogs/cleaners-rules.json`      | `rules`           | Cleaner targets                                                                                    |
| `catalogs/tweaks-catalog.json`      | `tweaks`          | **19** reversible, previewable tweaks                                                              |
| `catalogs/app-bundles-catalog.json` | `bundles`         | **8** winget bundles / **48** apps                                                                 |
| `catalogs/driver-catalog.json`      | `manufacturers`   | Driver vendors: silent install flags, vendor/name patterns, trusted signers, WU GPO keys (v0.12.0) |
| `catalogs/driver-store-rules.json`  | `virtualPatterns` | Driver Store cleanup safety rules: virtual/shim drivers never removed (v0.15.0)                    |

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
- `driver-catalog.ts` (v0.12.0) — validates + loads the driver catalog; a corrupt file
  degrades to `null` (callers decide). Consumed by `driver-updater.ts` /
  `driver-installer.ts` for silent flags, manufacturer detection and signer trust.
- `safety-kb.ts` (v0.15.0) — reads the `safety`/`risk`/`safetyNote` metadata from
  `services-catalog.json` and `tweaks-catalog.json`; an entry failing validation is
  dropped so the UI falls back to its own signals instead of an invented warning.
- `driver-store-cleanup.ts` (v0.15.0) — reads `driver-store-rules.json` for the
  `virtualPatterns` that must never be removed (Tailscale/Wintun/WireGuard/Hyper-V…).

## Safety metadata (v0.15.0)

Every service and tweak entry carries a small safety knowledge base used by the UI
to warn **before** applying anything:

- `safety` — services: `safe | caution | protected`; tweaks: `safe | advanced`.
- `risk` — `low | medium | high | critical`.
- `safetyNote` — a short, user-facing explanation shown as a warning.

`safety-kb.test.ts` asserts that **every** entry in both catalogs has a valid
`safety` + `risk` + non-empty `safetyNote`, and the renderer tests prove the
warning is rendered for risky entries (Boost and Tweaks).

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
