# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — v0.4.0 (en progreso)

### Added

- **Mutex global de operaciones (P0.3):** cola FIFO `withOperationLock` en Main que serializa los 24 canales IPC que mutan el sistema (tweaks, winget install/uninstall, servicios, cleaner, debloat, DNS, drivers, red, startup, drift…). Dos operaciones conflictivas **nunca** corren a la vez; el lock se libera aunque la operación falle. Nuevo canal `system:op-status` + evento `system:op-changed`
- **Indicador global de ocupación en la UI (P0.3):** badge "Applying tweak / Installing apps / …" con punto pulsante en el header (`data-testid="op-status"`), hook `useOperationStatus`, y botones de acción (Tweaks: Apply/Restore single y selected; Bundles: Install/Install Selected) deshabilitados mientras el lock está ocupado
- **Test de integridad de catálogos (P0.1):** valida el JSON de `catalogs/*.json` y `src/shared/catalogs/*.json`
- **Tests nuevos:** operation-lock (FIFO, liberación en error, status), wiring IPC (canales mutados → lock; lecturas sin lock), hook `useOperationStatus`, y suite E2E `global-mutex.spec.ts` (5 specs)

### Fixed

- **JSON inválido en `catalogs/apps-catalog.json`** (comilla faltante en la línea 51) que rompía la importación de actualizaciones de fuentes
- **winget sin verificación de exit code (P0.2):** los scripts de install/uninstall ahora evalúan `$LASTEXITCODE` (con tolerancia a "already installed") en lugar de un `try/catch` que winget nunca dispara — antes un fallo de winget se reportaba como éxito
- **Validación de `wingetId` (P0.2):** el id se valida contra `^[A-Za-z0-9][A-Za-z0-9._+-]*$` antes de interpolarlo en el script PowerShell (cierra un hueco de inyección de comandos); id inválido → fallo sin invocar PowerShell

## [0.3.0] - 2026-10-01

Fase P0 → P3 completa: UX crítico, rendimiento medible, tweaks seguros reversibles y pulido Electron.

### Added

- **Controles de ventana (P0.1):** Minimizar / Maximizar-Restaurar / Cerrar en la titlebar frameless, con estilo Windows 11, estados hover, focus-visible, `-webkit-app-region` (drag en la barra, `no-drag` en los controles) y sincronización del ícono Maximize↔Restore vía eventos IPC `window:maximized` / `window:unmaximized`
- **Progreso por etapas (P0.3):** contrato `ScanProgressEvent` (module, stage, percent, message, etaMs) emitido desde Main con **throttle de 180 ms** y sólo si cambia etapa o percent (±1). Barra + stepper por módulo en la UI. El contrato de respuesta final no cambió (el progreso es adicional)
- **Skeletons reutilizables (P0.2):** tabla, lista, cards y texto, usados en Dashboard/Cleaner/Drivers para estados `loading` coherentes
- **Virtualización + chunked reveal (P0.4):** `@tanstack/react-virtual` para listas > 50 filas (Drivers), `React.memo` por fila, `useMemo`/`useCallback`, y reveal progresivo (30 filas iniciales, +60 por tick)
- **Cache TTL en memoria (P1.2):** System Info 60 s · Drivers 5 m · Junk 30 s · Apps/Startup/Services 60 s · Health/Optimize 30 s. Invalidación explícita tras Clean / Apply / Toggle / Refresh, y `clearCache()` manual
- **Feature flag reversible (P1.1):** `useSystemInfoBatch` (por defecto batch; desactivable) para volver a las 4 sondas si hiciera falta
- **Sección Tweaks (P2):** 9 tweaks seguros (Performance / Privacy / Explorer), cada uno con descripción, badge Safe/Advanced, **Reversible: Sí**, Preview de las claves/servicios exactos, Apply/Restore individual y por grupo. Estado previo capturado antes de aplicar y persistido para restaurar el valor original
- `docs/PERFORMANCE.md` con mediciones antes/después y `scripts/measure-system-info.mjs`
- Tests nuevos: ventana (IPC/componente), progreso (throttle/estado), cache TTL, batch System Info, tweaks (apply/restore con mocks), skeletons, virtualización (E2E real)

### Changed

- **System Info en 1 proceso PowerShell (P1.1):** las 4 sondas (CPU/Disco/GPU/OS) se agrupan en un único script `-EncodedCommand` que devuelve JSON anidado. **4 spawns → 1** y ~60 % más rápido en medición real (ver `docs/PERFORMANCE.md`). Fallback automático a las sondas si el batch falla
- Búsqueda de drivers con `useDeferredValue` (sin lag al escribir) y filtro memoizado
- Páginas de scan migradas a los nuevos estados (skeleton + progreso + error explícito) en lugar de spinners infinitos
- **Electron/Pulido (P3):** `content-visibility: auto` en secciones largas, pausa de animaciones decorativas durante scans (`data-scanning`), defaults de `backgroundThrottling` sin cambios, y auditoría de listeners/timers (todos con cleanup)

### Fixed

- **Script de lint roto:** `eslint . --ext ts,tsx` fallaba con la config flat de ESLint 8. Ahora es `eslint .` y se instaló `typescript-eslint` (faltaba). Lint pasa con **0 errores y 0 warnings**
- Eliminados los `any` restantes en IPC/Security/electron-api; `winoptimizer` ahora está tipado por completo (`WinOptimizerAPI`)
- Fuga potencial de listeners de IPC en el renderer resuelta con unsubscribe garantizado (`onMaximized/onUnmaximized/onScanProgress`)
- El `Refresh` del Dashboard ahora invalida la caché (no devuelve datos cacheados)

## [0.2.3] - 2026-10-01

### Fixed

- **PowerShell engine (crítico):** los scripts ahora se ejecutan con `execFile` + `-EncodedCommand` (Base64/UTF-16LE). Antes se usaba `-Command "..."` con escapado `\"`, que **truncaba silenciosamente** cualquier script multilínea o con comillas — esto rompía casi todos los escaneos (System Info, Cleaner, Driver Updater, Services, Audit, Benchmark, Network, Privacy)
- Salida forzada a **UTF-8** (adiós acentos rotos en Windows en español) y stream de progreso silenciado (sin ruido CLIXML en `stderr`)
- Resultados únicos de `ConvertTo-Json` (objeto suelto) se normalizan a array — arregla listas de apps/servicios/inicio y scans con un solo ítem
- Rutas `C:\$Recycle.Bin` ya no se interpretan como variable `$Recycle` (la papelera no se escaneaba) en Cleaner, Scheduled Cleaning y System Audit
- El scan de drivers une `Win32_PnPSignedDriver` en una sola pasada (antes 1 consulta por dispositivo): más rápido y con versiones reales
- `releaseDate` de drivers normalizado de `/Date(ms)/` a `YYYY-MM-DD`
- System Info ejecuta sus sondas en **paralelo** (~30s → ~15s) y el test de conectividad es más rápido
- `parsePowerShellJson` recupera JSON precedido por ruido/BOM

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
