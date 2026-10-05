# Driver auto-update - design (v0.12.0, Fase 2)

> FORCH.iA WinOptimizer. Built with FORCH.i by Paulo Velasco.

This document describes how driver detection, download, silent install and rollback
work after Fase 2 of `PLAN_MEJORAS.md`, and - just as important - **what is
deliberately not automated**.

## Problem

Before v0.12.0 the Driver Updater was a simulation:

- `LATEST_DRIVERS` was a hardcoded database (NVIDIA 551.86 / AMD 25.3.1 / Intel
  31.0.101.5522, dated 2025-03).
- "Update" called `shell.openExternal(url)` to a **generic** manufacturer page (no
  deep link per model) and returned a state - never a real install.
- Rollback only restarted the device (`pnputil /restart-device`).

The user asked for **automatic downloads**, not to be sent to a website.

## Pipeline

```
detect (Windows Update COM)  ->  restore point (verified)  ->  download + verify
        ->  silent install (/norestart, 600s, log)  ->  re-verify (version + status)
        ->  receipt (for rollback)  ->  UI state (rebootRequired?)
```

Golden rule: **no operation reports success without verifying the real effect.**

### 2.1 Detection - Windows Update COM (source A)

`src/main/services/driver-updater.ts` runs **one** PowerShell process that:

1. reads the GPO "Do not include drivers" (`ExcludeWUDriversInQualityUpdate`) and
   `SearchOrderConfig`;
2. enumerates devices (`Win32_PnPSignedDriver` + `Win32_PnPEntity`);
3. unless excluded, queries Windows Update:
   `New-Object -ComObject Microsoft.Update.Session` -> `CreateUpdateSearcher()` ->
   `Search("IsInstalled=0 AND Type='Driver'")`.

`matchUpdateToDevice` maps a WU update to a device by hardware id first, then by
name/model. `classifyDriver` is the honest state machine:

| Condition                        | `status`           | Notes                                   |
| -------------------------------- | ------------------ | --------------------------------------- |
| GPO excludes drivers             | `unknown`          | never "up to date"                      |
| WU did not answer (error/silent) | `unknown`          | never "up to date" (Kudu `emptyResult`) |
| WU answered, no matching update  | `up-to-date`       |                                         |
| WU answered with a match         | `update-available` | `source: windows-update`, `automatic`   |

Verified on the authoring machine: `wuResponded=True`, `searchOrder=1`, GPO unset,
`updatesCount=0`, `devicesCount=95` (System 55, Net 11, USB 10, HIDClass 9, MEDIA 6,
SCSIAdapter 2, Display 2). An up-to-date machine legitimately offers zero updates.

### 2.2 Catalog as DATA

`catalogs/driver-catalog.json` (read via `catalog-data.ts`, same pattern as
`app-bundles-catalog.json`) holds every manufacturer fact:

- silent flags: NVIDIA `-s -noreboot -clean`, AMD `-INSTALL -SILENT -NOREBOOT`,
  Intel `-s --noreboot`;
- PCI vendor ids + name patterns for detection;
- trusted Authenticode signer substrings;
- the Windows Update GPO keys and search query.

`driver-catalog.ts` validates it and degrades to `null` on a corrupt file.

### 2.3 Download - real bytes + verification (source C)

`src/main/services/driver-downloader.ts`:

- streams the file over http/https with **real byte progress** (throttled ~4/s);
- retries with backoff `5s / 15s / 45s` (3 attempts) on transient failures;
- verifies **size**, **SHA-256** and **Authenticode** (`Get-AuthenticodeSignature`,
  status must be `Valid`, signer subject must match the vendor patterns);
- on ANY mismatch: **delete the file and abort** - an unverified file never reaches
  the installer.

The network primitive (`DownloadFetcher`) is injected, so the whole pipeline is
unit-tested without touching the network.

### 2.4 Silent install + post-verification

`src/main/services/driver-installer.ts`:

- `createRestorePoint` re-reads the newest checkpoint and only reports success if it
  really exists; the orchestrator **aborts** otherwise;
- `buildInstallArgs` uses the catalog flags and `ensureNoRestart` guarantees a
  no-restart flag (`/norestart` unless the vendor already provides one);
- `installSilent` runs the installer with a **600 s** timeout and a real log file;
  exit `3010`/`1641` sets `rebootRequired`;
- `verifyDriverInstalled` re-reads `Win32_PnPSignedDriver.DriverVersion` and
  `Get-PnpDevice Status`; the install only succeeds when the version matches AND the
  status is `OK`.

For source A the install is done through the WU COM API
(`CreateUpdateDownloader` + `CreateUpdateInstaller`, `IsForced=$false`), followed by
the same re-verification.

### 2.5 Rollback

A **receipt** is persisted (`%APPDATA%/forch-i-winoptimizer/driver-receipts.json`)
after a verified install: driver id, `oem#.inf`, previous version, source, timestamp.
Rollback creates a verified restore point, runs
`pnputil /delete-driver <oem#.inf> /uninstall`, then re-reads the version to prove the
previous one is back. Without a receipt - or without a captured `.inf` - the rollback
is **refused and disabled** rather than simulated.

### 2.6 IPC + UI (4 planes)

| Plane   | What                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| main    | `drivers:download`, `drivers:install`, `drivers:install-silent`, `drivers:cancel`, event `drivers:progress` |
| preload | `winoptimizer.drivers.{install,installSilent,download,cancel,rollback,onProgress}`                          |
| shared  | `DriverInstallRequest`, `DriverProgressEvent`, `DriverInstallResult`                                        |
| UI      | `Drivers.tsx`: real step/byte progress, Cancel, reboot notice, restore-point badge                          |

`drivers:cancel` is intentionally **not** in `MUTATING_CHANNELS`: it must run while the
install it targets holds the global operation lock.

## Security / admin

- The Windows Update **search** needs no admin.
- **Installing** requires admin. The flow reuses the existing `requires-admin` +
  `security:relaunch-elevated` pattern ("Restart as administrator") and never fails
  silently.

## Deliberately NOT automated

- BIOS / UEFI / firmware updates.
- DDU or any aggressive driver cleanup.
- Drivers without a valid WHQL/Authenticode signature.
- Forced reboots (the user decides).
- Disabling driver signature enforcement.
- Parallel driver installs (the FIFO operation lock is respected).

## Tests

- `driver-catalog.test.ts` - data-driven detection, flags, signer trust.
- `driver-updater.test.ts` - state machine (unknown vs up-to-date vs update) and
  install orchestration (abort, verify, cancel, honest manual).
- `driver-downloader.test.ts` - success + delete-on-mismatch (hash/size/signature) +
  retry/backoff + cancel.
- `driver-installer.test.ts` - no-restart enforcement, 600 s timeout, reboot flag,
  receipts and rollback refusal/confirmation.
