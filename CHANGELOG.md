# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
