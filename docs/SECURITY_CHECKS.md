# Security Checks Catalog

> **FORCH.iA WinOptimizer v0.7.0** — live security scanner reference (read-only scan + three reversible auto-fixes).
>
> Built with FORCH.i by Paulo Velasco.

This document is the auditable catalog of every check the Security tab runs.
It is generated from **one source of truth** in code, `src/shared/security-scan.ts`
(`SECURITY_CHECK_CATALOG`), and mirrored here for humans. There is no parallel
list in the renderer — main and renderer both read the shared module.

## How the scan works

- **One PowerShell process** serves every check (the per-spawn cost is ~1.8 s,
  so 11 spawns would be ~20 s). This mirrors `system-audit.ts`.
- Each check is wrapped in its own `try/catch` and emits a marker
  (`@@FSEC_n@@`), so **one failing check cannot abort the scan**: it degrades to
  `unknown`/`requires-admin`.
- The whole run has a **global 60 s timeout** (`runPowerShell`). Per-check
  timeouts inside a single PowerShell 5.1 process are not available; a check
  that emits no output is reported as `unknown` (reason: no data) rather than
  invented. This is the honest trade-off: one process, no fabricated results.
- Results are cached for **30 s** (`withCache('security')`). The UI "Run
  Security Scan" button passes `force: true` so an explicit user action always
  re-reads the machine.
- **The scan is READ-ONLY.** It never changes system state. Any repair is a
  separate, explicit action and is never triggered by the scan.

## Status vocabulary

| Status | Meaning |
|--------|---------|
| `pass` | The machine meets the check. |
| `warn` | Partially met / non-ideal, not broken. |
| `fail` | The machine demonstrably does not meet the check. |
| `unknown` | The datum could not be read and the failure is not a permission error. **Never invented, never reported as `fail`.** |
| `not-applicable` | The check does not apply to this machine (e.g. Secure Boot on legacy BIOS). |
| `requires-admin` | The datum needs elevation; the observable error is an access-denied. |

**Golden rule:** if a value could not be read, the check is `unknown` or
`requires-admin` (with the real reason) — never `fail`. A green board over
unmeasured checks is exactly the dishonest behaviour this scanner replaces.

## Scoring (transparent, documented, and shown in the UI tooltip)

```
score = round(100 × Σ(weight(check) × statusScore) / Σ(weight(check)))
```

- Summed only over checks whose status is **`pass` / `warn` / `fail`**.
- `unknown`, `not-applicable` and `requires-admin` are **excluded from both the
  numerator and the denominator**: we do not penalise what does not apply or what
  could not be measured.
- `severity` weights: **critical = 4, high = 3, medium = 2, low = 1**.
- `statusScore`: **pass = 1.0, warn = 0.5, fail = 0**.
- If the denominator is zero, the score is **`null`** ("not scored") — never a
  magic number.

## Auto-fix policy (v0.7.0)

Exactly **three** checks ship a real, reversible self-repair:

| Check | Apply does | Revert restores |
|-------|------------|-----------------|
| `smb1` | `Set-SmbServerConfiguration -EnableSMB1Protocol $false` (registry fallback `LanmanServer\Parameters\SMB1=0`) | the **exact previous value** captured before the change (`enabled` / `disabled`) |
| `guest-account` | disables the account whose SID ends in **RID 501** (`Disable-LocalUser`; `net user <name> /active:no` fallback) | re-enables it **only if it was enabled before** |
| `remote-desktop` | sets `fDenyTSConnections = 1` | the **exact previous numeric value** of `fDenyTSConnections` |

Rules enforced by code and tests (`src/main/services/security-fix.test.ts`):

1. **Preview is mandatory.** Nothing changes until the user sees the observed
   `current` value and the `target`, then confirms. The preview is a separate,
   read-only IPC call (`security:fix-preview`).
2. **Requires admin.** Without elevation the action is returned as `blocked` with
   reason `requires-admin` and a message (plus a "Restart as administrator"
   button, `Start-Process -Verb RunAs`). It never runs and never fails silently.
3. **Real previous value.** The value is read and persisted *before* the write; the
   revert restores that captured value, never a hard-coded default.
4. **Honest state.** After apply/revert the value is **re-read** from the machine;
   the returned `after` is measured, not assumed, and the UI re-runs the scan.
5. **Everything else stays read-only.** BitLocker, Secure Boot, TPM, UAC, and any
   account policy beyond Guest can lock a user out or are not reversible through a
   single value, so those checks offer `guidance` only.

The unit test `security-scan.test.ts` asserts that the set of `autoFixable` checks
is **exactly** `{smb1, guest-account, remote-desktop}` — adding a fourth fails CI.

## Check catalog

| id | Title | Severity | Live query | Possible statuses | Auto-fix? |
|----|-------|----------|------------|-------------------|-----------|
| `antivirus` | Antivirus protection | critical | `SecurityCenter2 => AntiVirusProduct` (live `productState` decode; **no product-name list**) | pass, warn, fail, unknown, requires-admin | no |
| `firewall` | Windows Firewall | critical | `Get-NetFirewallProfile => Enabled` (registry fallback `EnableFirewall`) | pass, warn, fail, requires-admin, unknown | no |
| `uac` | User Account Control (UAC) | high | Registry `HKLM\...\Policies\System` → `EnableLUA`, `ConsentPromptBehaviorAdmin`, `PromptOnSecureDesktop` | pass, warn, fail, unknown | no |
| `smb1` | SMBv1 protocol | high | `Get-SmbServerConfiguration => EnableSMB1Protocol` (registry fallback) | pass, fail, requires-admin, unknown | **yes** |
| `secure-boot` | Secure Boot | medium | `Confirm-SecureBootUEFI` + `$env:firmware_type` | pass, fail, not-applicable, requires-admin, unknown | no |
| `tpm` | TPM (Trusted Platform Module) | medium | `root\cimv2\security\microsofttpm => Win32_Tpm` | pass, warn, not-applicable, requires-admin, unknown | no |
| `bitlocker` | System drive encryption (BitLocker) | high | `Get-BitLockerVolume -MountPoint %SystemDrive%` + edition detection | pass, fail, not-applicable, requires-admin, unknown | no |
| `windows-update` | Windows updates | high | `Win32_QuickFixEngineering` (latest `InstalledOn`) + pending-reboot registry flags | pass, warn, fail, unknown | no |
| `guest-account` | Built-in Guest account | medium | `Win32_UserAccount` where `LocalAccount=True`, matched by **RID 501** (not name) | pass, fail, requires-admin, unknown | **yes** |
| `remote-desktop` | Remote Desktop (RDP) | medium | Registry `HKLM\SYSTEM\...\Terminal Server` → `fDenyTSConnections` | pass, warn, unknown | **yes** |

## Anti-hardcoding guarantees

1. **No product lists.** The antivirus check decodes `productState` live for
   whatever `SecurityCenter2` reports. A third-party AV is detected exactly the
   same way as Defender.
2. **No hardcoded results.** Every row above is produced by a live query at scan
   time.
3. **No hardcoded colors.** Severity/status badges use theme tokens
   (`--color-chart-primary` etc.) and the `Badge` variants, so the UI adapts to
   the user's accent color / theme. Information is never conveyed by color alone:
   every row shows the status label, an icon, and the observed evidence text.
4. **Single source of truth.** `SECURITY_CHECK_CATALOG` in
   `src/shared/security-scan.ts` is the only catalog. Main uses it to run and
   order queries; the renderer uses it to label them.

## Behavior across machine configurations

| Configuration | Expected result |
|---------------|-----------------|
| Windows 11 Pro, full | All checks scorable |
| Windows 10 Home, no BitLocker | `bitlocker` → `not-applicable` (edition), not `fail` |
| VM without TPM / Secure Boot | `tpm` and `secure-boot` → `not-applicable` |
| Third-party antivirus | `antivirus` → `pass` from live data (no list) |
| Running without admin | permission-denied reads → `requires-admin` |
| Corrupt / non-JSON payload | check → `unknown`, scan continues |

Every one of these has a dedicated unit test with a fixture
(`src/main/services/security-scan.test.ts`).

## Real-Electron end-to-end

The browser E2E mocks `window.electronAPI`, so the main process is never
exercised there. `e2e/security-real-electron.spec.ts` launches the **real**
Electron app and drives the scan through the UI, then re-reads it through the
preload bridge to prove the main-process pipeline produced data.

```bash
npm run test:e2e:electron
```

It needs a production build (`dist/`); the npm script builds first. Run it after
`npm run build`. It is excluded from the default `playwright.config.ts` suite so
the fast browser tests stay separate.
