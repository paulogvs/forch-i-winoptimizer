# Debloat — curated UWP catalog + total-selection UI (v0.18.0)

> FORCH.iA WinOptimizer removes ONLY what the user ticks in Tools → Debloat.
> No background removal, no remote scripts, no `irm|iex` — ever.
>
> Built with FORCH.i by Paulo Velasco.

## Catalog (`catalogs/apps-catalog.json`, v0.3.0)

**62 apps (safe 39 / caution 17 / protected 6)** in 6 categories
(`entertainment`, `social`, `gaming`, `productivity`, `utilities`, `system`).
100% native data reimplementation of the coverage learned from the prior
analysis (Sycnex Windows10Debloater ≈ 33 base + ≈ 15 sponsored + ≈ 25
whitelist + NonRemovables; winutil `appx.json` = 34 AppX in 6 categories,
presets, tweaks-with-Undo): no foreign code was pasted — package base names
are facts, every description and every risk call is ours.

### Protection model

| Level       | Meaning                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `safe`      | Removable with no risk (sponsored AppX, MSN apps, games…​).                                                                                         |
| `caution`   | Removable, but the description spells out **what you lose** (Xbox overlay → no Win+G, Camera → no webcam capture, Outlook-new → no built-in mail…). |
| `protected` | **Never removed**: Store, Terminal, Copilot, winget, Edge, WebView2. Managed from Tweaks, never by package removal.                                 |

### Server-side guard (`src/main/services/debloat.ts:178-181`)

The renderer sends catalog **ids**, never package names. The main process:

1. Rejects unknown/injected ids (`failed`, no PowerShell).
2. Refuses `protected` entries outright (`protected`, no PowerShell).
3. Re-validates package names against `^[A-Za-z0-9][A-Za-z0-9._-]*$` before interpolation.
4. Collapses duplicate ids to a single removal.

`debloat.test.ts` pins this: every entry has a valid category + description,
and a bulk injection of **all** protected ids (+ one unknown id) is refused
with zero PowerShell spawns.

## UI flow (Tools → Debloat)

1. **Search** (name/id/description) + groups per category with **Select all /
   Clear** (only installed, non-protected rows are selectable).
2. Counters safe/caution/protected + per-group `selected/selectable`.
3. **Planned removal** summary with the caution warnings before confirming
   (`window.confirm` carries the final gate, with a caution count note).
4. Execution via `removeBloatware(ids)` under the global operation lock.
5. **Removal receipt** per app (`removed/skipped/failed/protected` + reason).
6. **Post-check**: the catalog is re-read from a fresh `Get-AppxPackage`
   query and the note shows `installed of cataloged` + timestamp.

Nothing reports success without that re-read (project Iron Law).

## Coverage notes

- Capabilities/Features-only components with no per-user AppX identity are
  NOT listed as removable: if it cannot be removed with `Remove-AppxPackage`
  for the current user, it does not belong in this catalog.
- Windows re-provisions some AppX on each major feature update — a removed
  `caution` app can come back; re-remove it from the same tab. User data is
  never touched.
