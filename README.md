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
- **Bundles** — Bulk app installation by category via `winget`
- **Cleaning** — Scheduled cleaning (daily/weekly/monthly) with history
- **Tools** — Registry cleaner, disk defragmenter, privacy eraser, and more
- **Statistics** — Historical charts and trends with CSV export
- **Security** — Security & Privacy scan, privacy hardening, and DNS benchmark
- **Settings** — Full customization with dark/light mode
- **Source Monitor** — Pull new tweaks/apps/services from the 4 base repositories (`@forchi` → "vamos a buscar actualizaciones")

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Electron 31 |
| Frontend | React 18 |
| Language | TypeScript 5.5 (strict) |
| Styling | Tailwind CSS 4 + CSS Variables |
| State | Zustand |
| Build | Vite 5 |
| Package Manager | pnpm |
| Testing | Vitest + Testing Library |
| Linting | ESLint + Prettier |

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 8+

### Quick Start

```bash
# Clone the repository
git clone https://github.com/paulogvs/forch-i-winoptimizer.git
cd forch-i-winoptimizer

# Install dependencies
pnpm install

# Start development server
pnpm run electron:dev
```

## Distribution (Windows)

The app ships in **two formats**, both produced by `electron-builder`:

| Format | Target | Best for |
|--------|--------|----------|
| **Installer** | NSIS (`.exe`) | Everyday use — Start Menu/Desktop shortcuts, clean uninstall |
| **Portable** | Portable (`.exe`) | USB drives, shared PCs, no-install use |

```bash
# Build the renderer + main process, then package installer + portable
pnpm run electron:build
```

Artifacts are written to `release/`.

### Build for Production

```bash
# Build the app
pnpm run electron:build

# Output will be in release/
```

## Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | Build for production |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Format with Prettier |
| `pnpm typecheck` | Run TypeScript type check |
| `pnpm test` | Run tests |
| `pnpm test:coverage` | Run tests with coverage |
| `pnpm electron:dev` | Start Electron in dev mode |
| `pnpm electron:build` | Build Electron app |

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
