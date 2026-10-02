# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.2] - 2026-10-02

Auditoría funcional + cierre de pendientes de rendimiento: **3 bugs de "lista que degrada a
0" en servicios Main corregidos**, la única vista con *jank* (Tools → Apps) virtualizada, el
flake de E2E identificado y endurecido, y el FPS medido bajo carga real. Sin capacidad nueva
visible al usuario → **0.4.2** (patch).

### Fixed

- **`bundles:check-installed`: `JSON.parse` sin proteger reventaba con un solo elemento.**
  `ConvertTo-Json` colapsa un pipeline de un elemento en un **string suelto** (no un array);
  `installedNames.some(...)` lanzaba `TypeError` sobre ese string y el `catch` lo tragaba, así
  que **toda app del catálogo se reportaba como "no instalada"**. Ahora el payload se
  normaliza a array antes de iterar. Test: `app-bundles.test.ts` (un `"Google Chrome"` suelto
  ⇒ `chrome` instalada) — familia del bug de `startup-apps`.
- **`cleaning:get-schedules` / `cleaning:get-history`: fechas que quedaban como strings.**
  El archivo JSON devolvía `nextRun`/`lastRun`/`timestamp` como ISO strings y el renderer
  llama `.toLocaleDateString()` sobre ellas ⇒ `TypeError: ... is not a function` al abrir
  *Scheduled Cleaning*. Ahora se reviven a `Date` al parsear. Tests: `scheduled-cleaning.test.ts`
  (instancias de `Date`, y tolerancia a payload no-array).
- **`cleaning:get-schedules`: un archivo corrupto envenenaba el estado del módulo.** Un
  payload no-array se asignaba tal cual a `schedules` (estado de módulo), y luego
  `schedules.findIndex(...)` lanzaba en `updateSchedule`/`deleteSchedule`. Ahora un payload
  inválido devuelve `[]` y nunca sustituye el estado por un valor no-array.

### Changed

- **Tools → Apps virtualizada con el mismo `VirtualList` que Drivers** (sin una segunda forma
  de virtualizar): **1 866 → 331 nodos DOM** (48 apps reales) y **2 → 0 frames perdidos** en
  scroll; peor frame **50,2 → 17,0 ms**. Umbral 50 filas, idéntico a Drivers. Fila extraída a
  `AppRow` memoizado. Test nuevo en `e2e/performance.spec.ts` (500 apps ⇒ filas DOM < 120).
- **Acciones muertas endurecidas** (botones que no hacían nada): *Dashboard* → *Clean Junk* /
  *Optimize* ahora navegan a Cleaner/Boost; *Tools → Utilities* abre Network/System Info donde
  existe y marca el resto **"Not available yet"** (deshabilitado); los *Fix* de Audit/Security
  y *Export CSV* de Statistics quedan deshabilitados con tooltip; los toggles/inputs no
  implementados de Settings quedan deshabilitados (el toggle de tema sigue vivo).
- **`scripts/measure-ui-perf.mjs`: nuevo `--load <audit|services|system|drivers>`** que
  mantiene un canal IPC pesado en vuelo durante todo el scroll y reporta `loadMs`, para medir
  FPS bajo contención real de CPU.

### Added

- **`docs/CODE_SIGNING.md`**: pasos, coste y wiring (`CSC_LINK`/`CSC_KEY_PASSWORD` o Azure
  Trusted Signing) para firmar los binarios. El build sin firmar de hoy **no** cambia; el
  aviso de SmartScreen **no** se puede eliminar sin certificado de pago (reportado como tal).
- **`e2e/helpers.ts`**: `gotoApp()` con retry acotado sólo para fallos transitorios de red de
  Chromium (`ERR_NO_BUFFER_SPACE`, `ERR_CONNECTION_*`), aplicado a toda la suite.

### Fixed (tests)

- **Flake de E2E nombrado y endurecido:** `settings.spec.ts › should display updates section`
  fallaba ~1/5 corridas con `page.goto: net::ERR_NO_BUFFER_SPACE` (capa de red de Chromium
  bajo contención). Reemplazado el `page.goto` directo por `gotoApp()` en los 13 specs.
  **Verificado: 6/6 corridas consecutivas limpias, 76/76 tests.**

Verificado con gates frescos: `tsc --noEmit` 0 · `eslint --max-warnings 0` 0 · `vitest` 332/332 ·
`playwright` 76/76 · `build` y `electron:build` exit 0.

## [0.4.1] - 2026-10-02

Ronda de diagnóstico de latencia UI: la lentitud percibida no era el render, eran
**canales IPC de 30–70 s que bloqueaban páginas enteras**.

### Changed

- **`audit:run`: 31 procesos PowerShell → 1 (batching).** Los 31 checks de la auditoría se
  ejecutaban en **31 spawns separados**; ahora un único `-EncodedCommand` ejecuta todos los
  scripts y devuelve payloads separados por marcadores `@@FCHK_<i>@@` que `splitAuditOutput`
  reparte a cada check respetando el orden (31 nombres → 6 grupos de script). Test de
  regresión: 1 sola llamada `runPowerShell`, 31 marcadores, comando < 12 000 caracteres
  (límite real de CreateProcess: 32 767 chars UTF-16 antes del base64). **Medido:**
  `audit:run` **72 991 → 7 789 ms (−89 %)** (sonda aislada en frío); **76 635 → 9 273 ms
  (−88 %)** desde el harness de UI.
- **`services:get-all`: un proceso por servicio → lote CIM bulk** en un solo proceso.
  **Medido: 61 687 ms (timeout a 60 s → devolvía `[]`) → 2 779 ms (−95 %)**;
  68 036 → 3 935 ms en el harness.
- **`privacy:get-settings`: 17 lookups de registro en 17 procesos → 1 proceso.**
  **Medido: 35 696 → 2 276 ms (−94 %)**.
- **`dns:benchmark`: sondeo en serie → `Promise.all`.**
  **Medido: 27 204 → 12 754 ms (−53 %)**; 35 470 → 13 472 ms en el harness.
- **Long task máxima 144 → 65 ms**; navegaciones sin errores (0/42); `settledMs` máximo de
  una navegación 7 359 → 87 ms; arranque hasta primera ventana 915 → 772 ms (p50 de 3
  arranques) y FCP 800 → 629 ms.
- **Documentación:** método, tablas antes/después, desglose de los 5 854 ms de trabajo
  PowerShell puro y gates en `docs/PERFORMANCE.md`; artefactos crudos (baseline / después /
  final) en `docs/perf/*.json`.

### Added

- **`scripts/measure-ui-perf.mjs`: harness de UI** (Playwright sobre `dist/main/index.js`,
  sin tocar código de producción): arranque (ventana → DCL → FCP), navegación por sidebar
  (14 páginas × 3 ciclos = 42), round-trip de **cada** invocación IPC (instrumentando
  `ipcMain._invokeHandlers`, lectura de una estructura interna de Electron),
  `PerformanceObserver('longtask')`, interacciones (refresh del dashboard, modal, scroll) y
  retención (heap / nodos DOM / listeners). Salida: `docs/perf/*.json`. Uso:
  `npm run build && node scripts/measure-ui-perf.mjs [--out archivo] [--cycles N]`

### Fixed

- **Bug preexistente (v0.4.0): un payload no-JSON en el bloque de startup hacía que
  `JSON.parse` lanzara y rechazara TODA la auditoría** (`audit:run` fallaba entera por un
  solo check). Ahora `countFromJson` degrada a 0 sin tocar a los otros 30 checks —
  detectado por el test nuevo del batching.

Verificado con gates frescos: `tsc --noEmit` 0 · `eslint` 0 warnings · `vitest` 328/328 ·
`playwright` 75/75 · `build` y `electron:build` exit 0.

## [0.4.0] - 2026-10-01

### Added

- **Bloatware Removal / Debloat (P1.4):** nueva pestaña **Debloat** en Tools con catálogo curado de **30 paquetes UWP** (`catalogs/apps-catalog.json`, fuente winutil: 19 safe / 7 caution / 4 protected). El renderer sólo envía **ids del catálogo** (gramática estricta `^[A-Za-z0-9][A-Za-z0-9._-]*$`), nunca nombres de paquete; las entradas **protected se rechazan server-side** aunque la UI se eluda, y las entradas inválidas se descartan sin llegar a PowerShell. Canales `debloat:get-catalog` (lectura sin caché para que los flags `installed` se mantengan frescos) y `debloat:remove` (**serializado por el mutex global**, etiqueta "Removing apps"). UI: checkboxes con guardas `disabled` (protected / not installed), confirmación con nota de riesgo para "caution", banner de resultado y refresco del catálogo tras remover. E2E: fixture con los 3 niveles de protección + 4 specs (catálogo, guards, remove con confirm, guards tras remover)
- **Endurecimiento de uninstall strings (P1.4):** `parseUninstallString` valida antes de invocar PowerShell: MSI debe ser exactamente `MsiExec /x {GUID}` con GUID bien formado (sin junk trailing); el exe debe ser ruta absoluta terminada en `.exe` sin metacaracteres de shell (`" $ \` ; | &`…); los **caracteres de control (U+0000–U+001F) se rechazan por código de punto** antes de cualquier regex (cumple `no-control-regex` con idéntico comportamiento); los argumentos trailing (`/S`, `/uninstall`…) se descartan y sólo se ejecuta la ruta validada con flag silencioso
- **Catálogo winget ampliado (P1.3):** 5 → 8 bundles y 33 → 48 apps, con **todos los IDs validados en vivo contra winget** (2026-10-01). Nuevos bundles: **Productivity** (PowerToys, Obsidian, Notion, Flow Launcher), **Communication** (Zoom, Telegram, WhatsApp vía msstore, Slack, Signal), **Security & Privacy** (Bitwarden, KeePassXC, Malwarebytes, Wireshark). Adds en bundles existentes: Windows Terminal + PowerShell (DevTools), FFmpeg (Media). Actualizados: Python 3.12 → **3.13**, Node → **LTS** (`OpenJS.NodeJS.LTS`). *Nota:* el plan sugería `JustinFinebel.HandBrake` pero **no existe en winget** (se mantiene el oficial `HandBrake.HandBrake`); IDs de WhatsApp/Signal/KeePassXC/Wireshark/Flow corregidos tras búsqueda real. Eliminado el duplicado `obs-gaming` (mismo `wingetId` que `obs`)
- **Test de integridad del catálogo de apps (P1.3):** bundles nuevos presentes (≥3 apps, icono, descripción), IDs plan presentes, `app.id` y `wingetId` **únicos** en todo el catálogo, y todo `wingetId` cumple la gramática P0.2 (`^[A-Za-z0-9][A-Za-z0-9._+-]*$`) — incluye el ID de Store `9NKSQGP7F2NH`
- **Catálogo de tweaks +10 (P1.2):** 9 → 19 tweaks seguros y reversibles, con fuentes verificadas (Win11Debloat, CTT winutil, Sophia, Microsoft Q&A). Performance: *Snappier animations* (`MenuShowDelay=0` + `MinAnimate=0`), *Mouse acceleration off* (raw input 1:1), *No delay for startup apps* (`StartupDelayInMSec=0`). Explorer/taskbar: *Taskbar aligned left*, *Hide taskbar search box*, *Hide Task View button*, *Hide Widgets* (todos registry-only, servicios intactos). Privacy: *Turn off Copilot* (botón + política `TurnOffWindowsCopilot`), *Turn off Windows Spotlight* (política HKCU+HKLM). Nueva categoría **Accessibility**: *Disable Sticky Keys prompts* (`Flags=506`)
- **Gate `requiresBuild` (P1.2):** los tweaks exclusivos de Windows 11 declaran `requiresBuild` (22000; Copilot 22631) y `applyTweak` los rechaza con un mensaje claro **antes** de invocar PowerShell en builds anteriores. `restoreTweak` **nunca** se gated (se puede deshacer tras un downgrade). Detección vía `os.release()` con test hook `setWindowsBuild()`
- **Botón "Free RAM" en el header (P1.1):** acción rápida que recorta el working set de la app (main + procesos hijos) vía `EmptyWorkingSet` (psapi.dll), con fallback a GC de .NET, y muestra la RAM liberada (`Freed N MB`, auto-reset a 3 s). Canal `memory:free` serializado por el mutex global. **Medido con `scripts/measure-free-memory.mjs`:** RSS **266 → 13 MB (−253 MB)**, ~3.0 s (spawn frío + Add-Type)
- **Mutex global de operaciones (P0.3):** cola FIFO `withOperationLock` en Main que serializa los 25 canales IPC que mutan el sistema (tweaks, winget install/uninstall, servicios, cleaner, debloat, DNS, drivers, red, startup, drift, free-ram… — **26 canales con `debloat:remove` en P1.4**). Dos operaciones conflictivas **nunca** corren a la vez; el lock se libera aunque la operación falle. Nuevo canal `system:op-status` + evento `system:op-changed`
- **Indicador global de ocupación en la UI (P0.3):** badge "Applying tweak / Installing apps / …" con punto pulsante en el header (`data-testid="op-status"`), hook `useOperationStatus`, y botones de acción (Tweaks: Apply/Restore single y selected; Bundles: Install/Install Selected) deshabilitados mientras el lock está ocupado
- **Test de integridad de catálogos (P0.1):** valida el JSON de `catalogs/*.json` y `src/shared/catalogs/*.json`
- **Tests nuevos:** operation-lock (FIFO, liberación en error, status), wiring IPC (canales mutados → lock; lecturas sin lock), hook `useOperationStatus`, memory-free (script, éxito, fallo, fallback, pid inválido, sin negativos), tweaks (catálogo P1.2 con ids únicos + ops válidos, gate `requiresBuild` sin PowerShell en build viejo, restore nunca gated, apply end-to-end de los 10 nuevos), y suites E2E `global-mutex.spec.ts` (5 specs) + `free-ram.spec.ts` (4 specs)

### Changed

- **System Info: CPU sin `Win32_Processor` (P0.4):** el lote PowerShell ya no consulta el CIM que costaba **1087–1172 ms** (medido) sólo para `LoadPercentage`, ni el path legacy de sondas (4 → 3 spawns). El uso de CPU se calcula en Node con `os.cpus()` en una ventana de 200 ms (`computeCpuUsage`) disparada en paralelo al proceso de PowerShell. **Medido con `scripts/measure-system-info.mjs`:** cálido **~1750 → 615 ms** (~65 % más rápido), frío **7276 → 4031 ms**. Ver `docs/PERFORMANCE.md`
- `scripts/measure-system-info.mjs`: etiqueta legacy 4 → 3 spawns

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
