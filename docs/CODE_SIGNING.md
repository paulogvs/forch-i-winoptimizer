# Code signing & SmartScreen — FORCH.iA WinOptimizer

> **TL;DR — honest status:** the Windows SmartScreen warning **cannot be removed
> without a real, paid code-signing certificate**. It is **not** a build bug and
> there is no free/local workaround. This document lists exactly what is needed,
> what it costs, and how the build is already wired to use a certificate the day
> one exists.

## Why the warning appears

Every `.exe` we ship today (Setup + Portable) is **unsigned**. When Windows sees
an unsigned/DL'd executable from the internet it consults SmartScreen reputation.
With no Authenticode signature and no accrued download reputation, it shows:

> _Windows protected your PC — Microsoft Defender SmartScreen prevented an
> unrecognized app from starting. Running this app might put your PC at risk._

An **EV** code-signing certificate (or Microsoft **Trusted Signing**, see below)
establishes publisher reputation with SmartScreen so the warning is suppressed
**immediately**. An **OV** certificate also removes it, but only after reputation
accrues (typically weeks and enough downloads).

### What does NOT work (do not ship these)

- **Self-signed certificates.** They are not trusted by any machine except the
  ones that manually installed the root. SmartScreen still warns; users get a
  false sense of security. We deliberately do **not** ship one.
- Renaming / re-uploading the binary: reputation resets.
- Repro builds: reproducibility does not substitute for a signature.

## Options and cost (2026)

| Option                    | Type              | Typical cost             | SmartScreen                 | Notes                                                                                                                          |
| ------------------------- | ----------------- | ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Azure Trusted Signing** | Microsoft-managed | ~**$9.99/month** (Basic) | ✅ immediate (EV-backed)    | Lowest friction; identity validation 1–3 business days; integrates with `signtool` via `dlib`. Best fit for a solo maintainer. |
| **EV certificate**        | Token/HSM (USB)   | **$300–$600 / year**     | ✅ immediate                | Requires a hardware token (or cloud HSM); CI signing needs a cloud signer.                                                     |
| **OV certificate**        | File-based        | **$150–$400 / year**     | ⚠️ after reputation accrues | Cheaper, but the warning persists until enough clean downloads.                                                                |

Prices are indicative and vary by CA (DigiCert, Sectigo, SSL.com, GlobalSign…).
Trusted Signing has the lowest entry cost and no hardware token, which is why it
is the recommended path for this project.

## Wiring the build (already in place — no change needed on a normal build)

`electron-builder` signs automatically when it finds a certificate **and** does
nothing when it doesn't, so the current unsigned build keeps working unchanged.

### Option A — File / token certificate (CSC_*)

Set these environment variables (locally or as CI secrets) and run the normal
build:

```powershell
$env:CSC_LINK = 'C:\certs\forch-ia.pfx'        # or a base64 string
$env:CSC_KEY_PASSWORD = '<password>'
npm run electron:build
```

`electron-builder` detects `CSC_LINK`/`CSC_KEY_PASSWORD` and signs every
executable (app, installer, uninstaller). With no variables set the build is
unsigned exactly as today.

### Option B — Azure Trusted Signing (`signtool` + `dlib`)

1. Create a Trusted Signing account + certificate profile (identity validation
   first).
2. Sign the produced artifacts in a post-build step:

```powershell
signtool sign /v /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
  /dlib "C:\Program Files\Windows Kits\10\bin\10.0.22621.0\x64\Azure.CodeSigning.Dlib.dll" `
  /dm "C:\path\metadata.json" `
  "release\FORCH.iA-WinOptimizer-Setup-0.9.0.exe" `
  "release\FORCH.iA-WinOptimizer-Portable-0.9.0.exe"
```

For CI, expose the Trusted Signing credentials as GitHub Actions secrets and add
a signing step to `.github/workflows/release.yml` **after** the
`Build Electron app` step and **before** `Upload artifacts`.

### Verify a signature

```powershell
Get-AuthenticodeSignature "release\FORCH.iA-WinOptimizer-Portable-0.9.0.exe" |
  Format-List Status, SignerCertificate, TimeStamperCertificate
```

`Status` must be `Valid` and a timestamp must be present (so signatures survive
certificate expiry).

## What this repository does today

- Ships **unsigned** binaries plus `checksums.sha256`; the Release page states
  this explicitly.
- Keeps `electron-builder`’s default signing hook enabled, so **setting
  `CSC_LINK`/`CSC_KEY_PASSWORD` is the only change** required to produce signed
  builds. No source change, no config change.
- Does **not** generate or distribute a self-signed certificate.

## Status in the deliverables

**SmartScreen warning remains until a paid certificate is provisioned.** This is
the only item of the performance/quality backlog that is _not_ resolvable with
code — it is a purchasing/identity decision, not an engineering one.
