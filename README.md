# FORCH.iA WinOptimizer

> **Built with FORCH.i by Paulo Velasco**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![electron](https://img.shields.io/badge/Electron-31-47848F.svg)](https://www.electronjs.org/)
[![react](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)
[![typescript](https://img.shields.io/badge/TypeScript-5.5-3178C6.svg)](https://www.typescriptlang.org/)
[![vite](https://img.shields.io/badge/Vite-5-646CFF.svg)](https://vitejs.dev/)
[![tailwind](https://img.shields.io/badge/Tailwind_CSS-4-38BDF8.svg)](https://tailwindcss.com/)

A modern, fast, and beautiful Windows optimizer built with the FORCH.iA ecosystem. Clean junk files, boost performance, manage startup apps, and keep your system running at its best.

---

## Features

- **Dashboard** — Real-time system metrics (CPU, RAM, Disk) with quick actions
- **Cleaner** — Scan and remove junk files, temp files, caches, and more
- **Boost** — One-click optimizations for startup apps, services, and memory
- **Drivers** — Driver Updater: hardware scan, manufacturer detection, restore point, install & rollback
- **Network** — Network Fixer: TCP/IP + Winsock + firewall reset, SMBv1 / `0x00000709` fix, connectivity test
- **Audit** — System Audit: 33 checks across 6 categories with a health score
- **Benchmark** — Performance metrics with before/after comparison and Markdown export
- **Bundles** — Bulk app installation by category via `winget`: 8 bundles, 48 apps
- **Cleaning** — Scheduled cleaning (daily/weekly/monthly) with history
- **Tools** — App Manager + Startup Manager + **Debloat** (30 preinstalled UWP packages, 19 safe / 7 caution / 4 protected — protected is never removed) + Utilities
- **Tweaks** — 19 safe tweaks (Performance, Privacy, Explorer, Accessibility) with preview and one-click restore
- **Free RAM** — Header ⚡ button trims the app's own working set (~253 MB freed in ~3 s, measured)
- **Global operation mutex** — System-mutating actions run one at a time (FIFO) with a header status badge and queued counter
- **Statistics** — Historical charts and trends with CSV export
- **Security** — Real read-only scanner: **22 checks**, each with the observed **evidence**; the 6 admin-gated hardening controls (LSASS, Credential Guard, BitLocker key protectors, local admins, inbound firewall rules, WinRM) report `requires-admin` when not elevated and stay out of the score. Three checks also have a **reversible auto-fix** (SMBv1, Guest account, Remote Desktop): preview → confirm → apply → revert to the real captured value. Plus privacy hardening and a DNS benchmark
- **Updates** — Background auto-updater (`electron-updater`) with in-app status and a manual "Check now"; releases ship with SHA-256 checksums. Binaries are **not code-signed** yet (see [docs/CODE_SIGNING.md](docs/CODE_SIGNING.md))
- **Catalogs as data** — tweaks, removable apps, services, cleaner rules and bundles live in `catalogs/` + `src/shared/catalogs/*.json`, never as hardcoded lists in code
- **Settings** — Full customization with dark/light mode
- **Source Monitor** — Pull new tweaks/apps/services from the 4 base repositories (`@forchi` → "vamos a buscar actualizaciones")

## Tech Stack

| Layer           | Technology                                  |
| --------------- | ------------------------------------------- |
| Runtime         | Electron 31                                 |
| Frontend        | React 18                                    |
| Language        | TypeScript 5.5 (strict)                     |
| Styling         | Tailwind CSS 4 + CSS Variables              |
| State           | Zustand                                     |
| Build           | Vite 5                                      |
| Package Manager | npm                                         |
| Testing         | Vitest + Testing Library + Playwright (E2E) |
| Linting         | ESLint + Prettier                           |

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm 9+ (bundled with Node.js; the committed lockfile is `package-lock.json`)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/paulogvs/forch-i-winoptimizer.git
cd forch-i-winoptimizer

# Install dependencies
npm install

# Start development server
npm run electron:dev
```

## Distribution (Windows)

The app ships in **two formats**, both produced by `electron-builder`:

| Format        | Target            | Best for                                                     |
| ------------- | ----------------- | ------------------------------------------------------------ |
| **Installer** | NSIS (`.exe`)     | Everyday use — Start Menu/Desktop shortcuts, clean uninstall |
| **Portable**  | Portable (`.exe`) | USB drives, shared PCs, no-install use                       |

```bash
# Build the renderer + main process, then package installer + portable
npm run electron:build
```

Artifacts are written to `release/`.

Prebuilt artifacts are published on the [Releases page](https://github.com/paulogvs/forch-i-winoptimizer/releases) (with SHA-256 checksums).

The binaries are **not code-signed**, so Windows SmartScreen may warn on first run. For
**internal use** you can clear that warning for free after downloading, by removing the
"mark of the web":

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\unblock-release.ps1
```

Or right-click the downloaded `.exe` → _Properties_ → _Unblock_. A **paid** code-signing
certificate is only required to distribute to third parties — see
[docs/CODE_SIGNING.md](docs/CODE_SIGNING.md).

> Building on a fresh Windows machine may hit a `winCodeSign` symbolic-link error — see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) §11.

### Build for Production

```bash
# Build the app
npm run electron:build

# Output will be in release/
```

## Development

### Available Scripts

| Command              | Description                |
| -------------------- | -------------------------- |
| `npm dev`            | Start Vite dev server      |
| `npm build`          | Build for production       |
| `npm lint`           | Run ESLint                 |
| `npm format`         | Format with Prettier       |
| `npm typecheck`      | Run TypeScript type check  |
| `npm test`           | Run tests                  |
| `npm test:coverage`  | Run tests with coverage    |
| `npm electron:dev`   | Start Electron in dev mode |
| `npm electron:build` | Build Electron app         |

### Project Structure

```
forch-i-winoptimizer/
├── src/
│   ├── main/              # Electron main process
│   │   ├── ipc/           # IPC handlers
│   │   └── services/      # System services
│   ├── preload/           # Preload scripts
│   ├── renderer/          # React app
│   │   ├── components/    # UI + layout components
│   │   ├── pages/         # Page components
│   │   ├── hooks/         # Custom hooks
│   │   ├── stores/        # Zustand stores
│   │   ├── styles/        # Global styles + tokens
│   │   └── App.tsx        # Root component
│   └── shared/            # Shared types
├── assets/                # Icons, images
├── scripts/               # Dev/ops/CI scripts
└── .github/               # GitHub templates + workflows
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) © Paulo Velasco

---

<div align="center">

**Built with FORCH.i by Paulo Velasco**

[FORCH.iA Ecosystem](https://github.com/forchia-ecosystem)

</div>
