# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-10-01

### Changed

- Sidebar now shows the full **brand lockup** (mark + "WINOPTIMIZER"), theme-aware: white on dark, navy on light
- App version is injected at build time from `package.json` (`__APP_VERSION__`) — removed hardcoded `0.1.0` in `App.tsx` / `Settings.tsx`

### Added

- Transparent brand lockups (`lockup-dark`, `lockup-light`) generated from the source logo
- Brand assets served from `/brand` (packaged with the renderer)

## [0.2.1] - 2026-10-01

### Changed

- Replaced the placeholder icon with the **final FORCH.iA WinOptimizer logo** ("FORCH Core": the F-built-from-ascending-bars wrapped by a boost-sweep arc)
- Generated a multi-resolution `assets/icons/icon.ico` (16/24/32/48/64/128/256) plus `icon-256/512/1024.png` masters
- NSIS installer/uninstaller/header now use the app icon

## [0.2.0] - 2026-09-30

### Added

- **Driver Updater** — hardware scan (WMI/PnP), manufacturer detection (NVIDIA/AMD/Intel/Generic), restore point, install & rollback
- **Network Fixer** — TCP/IP + Winsock + firewall reset, SMBv1 / error `0x00000709` fix, post-fix connectivity test
- **Drift Guard** — detects tweaks reverted by Windows Update and re-applies them
- **System Audit** — 33 checks across 6 categories (privacy, performance, memory, storage, startup, network) with score
- **Benchmark** — performance metrics with before/after comparison and Markdown export
- **Security & Privacy** — privacy settings, security actions (Defender/Copilot/Recall), DNS benchmark + set DNS
- **App Bundles** — bulk app installation by category via `winget`
- **Scheduled Cleaning** — daily/weekly/monthly schedules backed by Windows Task Scheduler, plus history
- **Source Monitor** — watches the 4 base repositories (kudu, winrift, winscript, winutil), diffs catalogs and imports/rejects changes. Usable from the app (IPC) and from plain Node (skill/CLI)
- New pages: Drivers, Network, System Audit, Benchmark, App Bundles, Scheduled Cleaning, Security & Privacy
- i18n scaffold (ES/EN), keyboard shortcuts, desktop notifications, logging service
- E2E coverage for every advanced feature page
- Placeholder app icon (`assets/icons/icon.ico`, 256×256 — replace with the final logo)
- Windows artifacts for v0.2.0: NSIS installer + Portable, attached to the GitHub Release (+ SHA-256 checksums)

### Fixed

- Main-process build (`tsc -p tsconfig.main.json`) failed: relocated the source-monitor into `src/main/source-updater`, fixed `rootDir`/`@shared` path mapping and excluded test files
- Renderer build output aligned with runtime paths (`dist/renderer`) and added a cross-platform `clean` step
- Tailwind v4 utilities were never generated (added `styles/app.css` with `@import "tailwindcss"` + `@config`)
- Preload now exposes both the `electronAPI` and `winoptimizer` namespaces (advanced pages were previously unreachable at runtime)
- Unit tests corrected: PowerShell error shape, network connectivity dual call, scheduled-cleaning state reset
- `getSchedules()` / `getHistory()` now reset in-memory state when storage is empty

### Changed

- Colour tokens are the single source of truth — replaced raw Tailwind palette classes (`text-green-500`, …) with semantic tokens (`text-success`, `text-warning`, `text-error`, `border-info`)
- Native window background colour centralised in `src/shared/theme.ts`

### Removed

- Dead code: `src/main/main.ts`, `src/preload/preload.ts`, legacy `src/renderer/styles.css`, unused `src/renderer/themes/`

## [0.1.0] - 2026-09-30

### Added

- Initial project setup with Electron 31 + React 18 + TypeScript 5.5 + Vite 5
- Design token system with dark/light mode support
- Base UI components: Button, Card, Input, Toggle, Badge, Modal, Progress, EmptyState, Tooltip
- Layout system: Sidebar, Header, StatusBar
- Pages: Dashboard, Cleaner, Boost, Tools, Statistics, Security, Settings
- IPC handlers for system info, junk scanner, startup apps, installed apps, system services, updater
- TDD test suite with Vitest + Testing Library
- ESLint + Prettier configuration
- GitHub issue templates and PR template
- CI/CD workflow scaffold
- Full documentation: README, CONTRIBUTING, CHANGELOG, LICENSE

### Technical

- TypeScript strict mode with `noUncheckedIndexedAccess`, `noImplicitReturns`, `exactOptionalPropertyTypes`
- Tailwind CSS 4 with CSS variable integration
- Zustand for state management
- pnpm as package manager

---

**Built with FORCH.i by Paulo Velasco**
