# PLAN_MEJORAS v0.4.0 — forch-i-winoptimizer

Fecha: 2026-10-01 · Estado: **en ejecución**
Baseline verificado (fresco): `tsc --noEmit` 0 · `lint` 0 · `vitest` 234/234 · `playwright` 62/62 · `build` OK.

## Diagnóstico (mediciones reales, no suposiciones)

| Métrica | Valor |
|---|---|
| Spawn PowerShell (fijo) | cold 1097 ms · warm 738 ms |
| Batch `system-info` (frío) | 7276 ms · repetido ~1750 ms |
| `Win32_Processor` (clase CIM) | **~1100 ms ← cuello de botella** |
| Resto de clases (OS/Disk/GPU) | 24–55 ms |
| `Get-AppxPackage` completo | 758 ms |
| Bundle renderer | index.js 238.50 kB (gzip 69.83 kB) · CSS 37.87 kB |

Bugs detectados:
1. `catalogs/apps-catalog.json` línea 51: falta la comilla de apertura → JSON inválido (rompe `source-updater`).
2. `installApp`/`installApps`/`uninstallApp` imprimen `SUCCESS` sin chequear `$LASTEXITCODE` de winget → falsos positivos; `wingetId` se inyecta sin validar en el script PS.
3. **Sin mutex**: handlers IPC mutables (`tweaks:apply*`, `bundles:install*`, `cleaner:delete`, `services:toggle`, `apps:uninstall`, `drivers:*`, `privacy:*`, `security:*`, `dns:set`, `cleaning:run-now`) corren en paralelo si la UI dispara dos operaciones.
4. Doble fuente de verdad de catálogos: `catalogs/*.json` vs `src/shared/catalogs/*.json`.

## Fases

### P0 — Correcciones críticas + Mutex + Perf
- **P0.1** Fix `catalogs/apps-catalog.json` + test de integridad de TODOS los JSON de catálogos (RED→GREEN).
- **P0.2** winget: chequear `$LASTEXITCODE` (+ "already installed"), validar `wingetId` (`^[A-Za-z0-9][A-Za-z0-9._-]*$`), fallbacks. TDD en `app-bundles.test.ts`.
- **P0.3** Mutex global: `src/main/services/operation-lock.ts` (cola FIFO + estado), envolver handlers mutables, IPC `system:op-status`, UI (overlay/botones disabled) + E2E.
- **P0.4** Perf `system-info`: eliminar `Win32_Processor` del batch (≈ −1.1 s) y calcular CPU% con muestreo `os.cpus()` en Node. Medición antes/después.

### P1 — Features pedidas
- **P1.1** Botón **Liberar RAM**: `memory:free` (EmptyWorkingSet vía Add-Type/psapi + fallback), IPC + botón en Header, medición RAM antes/después, unit + E2E.
- **P1.2** **+10 tweaks** seguros y reversibles (fuentes: Win11Debloat/CTT/Sophia, con `requiresBuild` 26200 donde aplique): animaciones, mouse acceleration, taskbar align left, sticky keys, spotlight, copilot/taskbar search, etc. TDD en `tweaks.test.ts`.
- **P1.3** **Catálogo winget ampliado** (IDs validados 2026: `Microsoft.PowerToys`, `voidtools.Everything`, `Python.Python.3.13`, `OpenJS.NodeJS.LTS`, `Microsoft.WindowsTerminal`, `Microsoft.PowerShell`, `Gyan.FFmpeg`, `Obsidian.Obsidian`, `Notion.Notion`, `JustinFinebel.HandBrake`…) en `APP_BUNDLES` + bundles nuevos (Productividad, Comunicación, Seguridad/Privacidad).
- **P1.4** **Debloat**: catálogo curado de bloatware UWP removible (protección `safe/caution/protected`, ya parcial en `catalogs/apps-catalog.json`) + UI en Tools con confirmación y guardas de protección.

### P2 — Consolidación + Perf renderer + Docs
- **P2.1** Single source of truth de catálogos (unificar `catalogs/` y `src/shared/catalogs/`).
- **P2.2** Code-splitting (`React.lazy` por ruta) — medir bundle antes/después; sin remontaje innecesario.
- **P2.3** Docs (`USER_GUIDE`, `TROUBLESHOOTING`, `FAQ`, `README`, `CHANGELOG`) + gates completos + tag `v0.4.0` + release.

## Gates (Ley de Hierro) — al cierre de CADA fase
`npx tsc --noEmit` · `npm run lint` · `npx vitest run` · `npx playwright test` · `npm run build`
Final: `npm run electron:build` + tag `v0.4.0` + `gh release create`. Sin "done" sin salida fresca.
