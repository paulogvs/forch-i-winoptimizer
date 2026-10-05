# PLAN_MEJORAS.md — FORCH.iA WinOptimizer

> **Origen:** 3 auditorías en modo **solo-lectura** (rendimiento, utilidades+drivers, repo base Kudu), v0.10.1, 2026-10-03.
> **Estado actual verificado:** `tsc` 0 · `lint` 0 · `format:check` PASA · `vitest` 588/588 · `playwright` 88/88 · E2E Electron 1/1 · releases hasta v0.10.1.
> **Principio rector (pedido del usuario):** funcional y veloz como Kudu — nada hardcodeado, todo dinámico, y **ninguna operación reporta éxito sin haber verificado el efecto real**.

## Diagnóstico en una página

| Dimensión   | Veredicto                                  | Lo más grave                                                                                                                                                                 |
| ----------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendimiento | Lenta en frío y en navegación              | `dns:benchmark` sin caché (~12 s por visita a Security); `benchmark:run` ~19 spawns seriales; `apps:get-installed` 3 spawns; tiempos fríos +54–311% vs `docs/PERFORMANCE.md` |
| Utilidades  | Casi todo funciona, con mentiras parciales | Drivers "Update" abre página web y devuelve `success:true`; botón ⚙️ muerto; Rollback solo reinicia; Cleaner oculta archivos al fallar; progresos cosméticos                 |
| Drivers     | Manual, con base de datos simulada         | `LATEST_DRIVERS` hardcodeado (2025-03); sin descarga ni instalación en app                                                                                                   |
| Kudu (base) | Más completo y más rápido en main-process  | WU COM real para drivers, `pnputil` cleanup seguro, scheduler cooperativo, scan-cache, workers, receipts                                                                     |

---

## Fase 0 — Honestidad funcional (quick wins, 1–2 días)

> Nada de esto cambia arquitectura. Todo con TDD y test del caso de fallo.

| #   | Qué                                                                                                                                            | Evidencia                                                                                | Aceptación                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0.1 | Cablear el botón ⚙️ del header a la vista Settings (existe: `App.tsx:86`)                                                                      | `Header.tsx:138-140` sin `onClick`                                                       | Clic → abre Settings                                         |
| 0.2 | Drivers "Update": no devolver `success:true` al abrir una página                                                                               | `driver-updater.ts:199-216`                                                              | Estado honesto `manual-action-required`, sin `success` falso |
| 0.3 | Cleaner: no ocultar archivos cuando falla la limpieza                                                                                          | `Cleaner.tsx:55-58` (ambas ramas filtran)                                                | Al fallar, los archivos siguen visibles + reintento          |
| 0.4 | Rollback: renombrar a "Reiniciar dispositivo" **o** implementar rollback real (`pnputil /delete-driver <oem#.inf> /uninstall` + restore point) | `driver-updater.ts:247` solo `/restart-device`                                           | Etiqueta veraz o rollback real con verificación              |
| 0.5 | Progresos reales o indeterminados (quitar barras cosméticas `+10/100ms`)                                                                       | `Tools.tsx:163`, `Bundles.tsx:69`, `Cleaning.tsx:40`, `Network.tsx:18`, `Drivers.tsx:50` | Progreso = bytes/pasos reales o spinner honesto              |
| 0.6 | Free RAM: aclarar alcance (solo proceso propio) en UI/tooltip                                                                                  | `memory-free.ts`, `USER_GUIDE.md:47` (266→13 MB propios)                                 | Usuario entiende qué libera                                  |

## Fase 1 — Rendimiento: que deje de sentirse lenta (días–1 semana)

| #   | Qué                                                                                                      | Ahorro esperado                 | Notas                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| 1.1 | TTL a `dns:benchmark` (60–120 s) + cargar tab DNS bajo demanda                                           | **~12 s** por visita a Security | Hoy `ipc/index.ts:436` sin caché y `Security.tsx:81-85` lo pide en `loadData()` inicial |
| 1.2 | SWR: pintar caché primero, revalidar en fondo (Dashboard/Audit/Boost/Tools)                              | Primera pintura ~instantánea    | `Audit.tsx:52` y `Security.tsx:102` fuerzan frío hoy                                    |
| 1.3 | `apps:get-installed` 3→1 spawn (HKLM+HKCU+UWP en un script)                                              | Frío ~17 s → ~10 s              | Patrón `startup-apps.ts`                                                                |
| 1.4 | `benchmark:run` 19→1–2 spawns (o paralelizar ×2) + TTL 60 s                                              | Decenas de segundos → segundos  | `benchmark.ts` ~19 `runPowerShell` seriales                                             |
| 1.5 | Virtualizar/paginar Cleaner (tope 200 + "mostrar más"); revisar Startup/Debloat                          | Evita miles de nodos DOM        | `MAX_FILES_PER_TARGET=5000` sin `VirtualList`                                           |
| 1.6 | `cleaner:delete` en 1 spawn (lista de paths, re-verificación por path)                                   | N spawns → 1                    | Mantener verificación honesta v0.9.1                                                    |
| 1.7 | Timeouts por servidor en `dns:benchmark` + cachear `resolveActiveAdapter()`                              | Sin colgados del más lento      | Hoy `Test-Connection -Count 4` sin timeout                                              |
| 1.8 | Re-publicar `docs/PERFORMANCE.md` con números v0.10.x (scans de 22 checks, re-reads, startup con firmas) | Doc veraz                       | Los citables hoy son de v0.4.x                                                          |

## Fase 2 — Descargas AUTOMÁTICAS de drivers (el pedido explícito)

> Reemplaza `LATEST_DRIVERS` simulado + `shell.openExternal(url)` por un pipeline real.

**Fuentes (orden):** A) Windows Update / PnP — `pnputil /scan-devices`, WU COM API (`IsInstalled=0 AND Type='Driver'`), respeta GPO; B) winget donde exista; C) fabricante solo con manifest versionado + hash + firma (nunca scraping ciego).

**Pipeline obligatorio:** restore point **verificado** (o abortar) → BITS con progreso real en bytes → verificar hash+tamaño+firma → instalador silencioso (`-s/-SILENT`, siempre `/norestart` + flag `rebootRequired`) con timeout 600 s + log → **re-verificar** (`DriverVersion==latest`, `Status OK`) → rollback real disponible.

**Archivos nuevos:** `src/main/services/driver-downloader.ts` (BITS+hash+firma+progreso) + `driver-installer.ts` (flags+timeout+logs) + `src/shared/catalogs/driver-catalog.json` (formato `app-bundles-catalog.json`, vía `catalog-data.ts` + sourceUpdater); extender `driver-updater.ts:199 installDriver()` como orquestador; nuevos IPC `drivers:download/progress/cancel/install-silent`; UI en `Drivers.tsx` con progreso real + Cancel + prompt de reboot + auto-check de restore point.

**Qué NO automatizar:** BIOS/firmware, DDU agresivo, drivers sin firma, reboot forzado, deshabilitar signature-enforcement, instalaciones paralelas (respetar mutex FIFO).

**Aceptación:** driver desactualizado → 1 clic → descarga con % real → instalado → versión re-leída == latest → rollback funcional.

## Fase 3 — Botones rápidos: RAM + utilidades 1-clic

- Ampliar `Dashboard Quick Actions` a barra visible + mantener header + sección `Quick fixes` en Tools.
- `⚡ Free RAM` con `antes→después MB` real (releer working set, como v0.9.1).
- `🧹 Clean Temp` 1-clic (solo `safeToDelete`), `🌐 Flush DNS`, `🛡️ Create Restore Point`, `🔍 Scan Drivers` — 1 clic → `operation-lock` FIFO → toast con resultado + link a Statistics → `disabled+queued` si busy.
- **Reemplazar los 4 `alert()`** (Drivers/Bundles/Cleaning/Network) por toast con `aria-live`.
- **Aceptación:** cada botón ejecuta, reporta el resultado real y queda registrado en Statistics.

## Fase 4 — Adopciones Kudu (de `adventdevinc/kudu` v3.6.0, vía API sin clonar)

> Regla: analizar → extraer → crear NATIVO → registrar. Solo patrones, nada de código copiado.

| #   | Patrón Kudu                                                                                                                                                        | Destino nuestro                                                                                                               | Impacto                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 4.1 | Driver updates vía **WU COM API** + cleanup `pnputil` seguro (`driver-manager.ipc.ts`, `driverIdentityKey`, `compareVersions`, respeta virtuales Tailscale/Wintun) | `driver-updater.ts` + nuevo `driver-store-cleanup.ts`                                                                         | **Máximo**: elimina la DB simulada                                                                 |
| 4.2 | `CooperativeScheduler.yieldIfNeeded()` cada 12 ms                                                                                                                  | `junk-scanner.ts`, loops grandes                                                                                              | No congela UI en scans de miles de archivos                                                        |
| 4.3 | `scan-cache.ts` por categoría (`Map`, `clearCachedCategory`)                                                                                                       | `cache.ts` (extender TTL genérico)                                                                                            | Re-clean sin re-scan                                                                               |
| 4.4 | YARA en `worker_thread` (nunca en main)                                                                                                                            | `security-scan.ts` (hoy heurístico)                                                                                           | **BLOQUEADO (npm sin red):** requiere el paquete `@litko/yara-x` + reglas; retomar cuando haya red |
| 4.5 | `perf-monitor` dual + throttle de red 5 s                                                                                                                          | `system-info.ts` + Dashboard/Boost                                                                                            | Menos spam de telemetría                                                                           |
| 4.6 | `file-utils`: borrado granular (`EBUSY/EPERM`→in-use) + `cleanup-receipts` + `recovery`                                                                            | `junk-scanner.ts` + `Cleaning.tsx`                                                                                            | Menos "falló" opacos                                                                               |
| 4.7 | `software-updater` vía winget real (`cleanOutput`, `computeSeverity`, `emptyResult` #462)                                                                          | `installed-apps.ts` + `catalog-data.ts`                                                                                       | Quita simulación en apps                                                                           |
| 4.8 | Safety KBs por entrada (`service-safety-kb`)                                                                                                                       | `services.json`/`tweaks.json` (`safety`/`risk`)                                                                               | Decisiones informadas                                                                              |
| 4.9 | Disk repair 1-clic (`SFC/DISM/CHKDSK/TRIM`)                                                                                                                        | `tool-launcher.ts` + `Tools.tsx`                                                                                              | Nueva utilidad real                                                                                |
| —   | NO adoptar                                                                                                                                                         | `daemon.ts`/telemetría Pusher, `framer-motion`/`recharts` pesados (ya tenemos charts propios), `better-sqlite3` si JSON basta | —                                                                                                  |

## Fase 5 — Estructural (cuando las fases 0–2 estén verdes)

1. **Pool de proceso PowerShell** (runspace persistente o worker con cola): el frío 5–8 s es arranque del proceso, no trabajo útil; el batching 31→1 ya se exprimió.
2. **Diferir** `setupAutoUpdater`/tray/window-behavior hasta después del first-contentful-paint (`main/index.ts`).
3. **Scans perezosos por tab**: `audit:run` (31) + `security:scan` (22) = 53 payloads creciendo; cargar por categoría en vez de todo-en-mount.
4. Medir arranque real v0.10.x con `measure-ui-perf.mjs --cycles 3` y republicar números.

---

## Orden de ejecución sugerido

**Fase 0 → Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5.**
Versiones sugeridas: v0.11.0 (Fase 0+1), v0.12.0 (Fase 2), v0.13.0 (Fase 3), v0.14.0+ (Fase 4 por bloques), estructural cuando aplique.
Cada fase: TDD → gates frescos → release con `checksums.sha256` + `latest.yml` → push `main`+`develop` → registro en ecosistema.

## Apéndice — evidencia de las auditorías (solo lectura, 0 archivos tocados)

- Rendimiento: 12 hallazgos con `archivo:línea` + mediciones frescas (`measure-system-info.mjs`, `measure-ipc-channels.mjs --runs 3`): degradación +54–311% vs doc; `dns:benchmark` sin caché; 19 y 3 spawns seriales; Cleaner sin virtualizar (tope 5000).
- Utilidades: inventario de ~19 acciones; drivers = `openExternal(URL genérica)` + `success:true`; ⚙️ sin `onClick`; Rollback = solo restart; Cleaner oculta fallos; progresos cosméticos.
- Kudu v3.6.0 (3748 ⭐, MIT, Electron 44 + React 19): sin liberador de RAM (solo monitor + game-mode); drivers vía WU COM + `pnputil` seguro; ~20 cleaners scan→clean con receipts; `CooperativeScheduler`, `scan-cache`, workers, `perf-monitor`, `file-utils`, `software-updater`, safety KBs, disk repair.
