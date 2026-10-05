# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.13.0] - 2026-10-05

Fase 3 del `PLAN_MEJORAS.md`: **botones rápidos de RAM y utilidades 1-clic**
(minor: nueva capacidad visible). Trae una barra _Quick fixes_ visible en el
Dashboard y en Tools, cinco acciones que ejecutan de verdad y reportan el
resultado real, un sistema de **toast** (adiós `alert()`) y el registro de cada
acción en Statistics.

### Added

- **3.1 — Barra de Quick fixes visible.** El Dashboard amplía sus _Quick
  Actions_ (`Dashboard.tsx`) con la sección **Quick fixes**; se mantiene el
  botón **Free RAM** del header y se agrega la misma sección en la pestaña
  **Utilities** de Tools. Componente reutilizable `QuickFixBar`.
- **3.2 — Cinco acciones 1-clic, con resultado verificado:**
  - `⚡ Free RAM` — recorta el _working set_ **de la propia app** y muestra
    **MB antes → después reales** (`Freed N MB (this app: A → B MB)`); no toca la
    RAM del sistema.
  - `🧹 Clean Temp` — borra **solo** archivos con `safeToDelete` (temp, caché,
    logs, miniaturas, caché de navegador). Nunca toca Windows Update ni la
    Papelera. Reporta archivos + MB reales y **no oculta fallos**.
  - `🌐 Flush DNS` — ejecuta `ipconfig /flushdns` y **verifica** el efecto
    midiendo la caché del resolver antes/después.
  - `🛡️ Create Restore Point` — reutiliza `Checkpoint-Computer` verificado.
  - `🔍 Scan Drivers` — reutiliza el escaneo real de v0.12.0 (Windows Update).
- **3.3 — Comportamiento uniforme:** 1 clic → `operation-lock` FIFO → **toast**
  con el resultado real + enlace **"View in Statistics"** → botones
  **deshabilitados** mientras corre otra operación → evento registrado en
  `stats.ts` → `aria-live="polite"`.
- **3.4 — Sistema de toast** (`components/ui/Toast.tsx` + `toast-context.ts`):
  reemplaza los `alert()` de Benchmark y Security. Sin `alert()` nuevos.
- **3.5 — Confirmación solo donde corresponde:** `Clean Temp` y
  `Create Restore Point` piden confirmación; `Free RAM`, `Flush DNS` y
  `Scan Drivers` son 1 clic puro.

### Changed

- `deleteJunkFiles` devuelve `removed: string[]` (rutas confirmadas borradas)
  para contabilizar los bytes liberados con evidencia real.
- `StatsEventType` suma `maintenance`; Statistics muestra "Maintenance actions".
- Nuevos canales IPC: `quickfix:clean-temp`, `network:flush-dns`,
  `quickfix:restore-point` y `quickfix:scan-drivers` (serializados por el mutex
  global).

### Fixed

- No queda ningún `alert()` en el renderer.

## [0.12.0] - 2026-10-05

Fase 2 del `PLAN_MEJORAS.md`: **descargas automáticas de drivers** (minor: nueva
capacidad visible). Reemplaza la base simulada `LATEST_DRIVERS` (NVIDIA 551.86 /
AMD 25.3.1 / Intel 31..., fecha 2025-03) y el `shell.openExternal` a una página
genérica por un pipeline real: **detección vía Windows Update COM**, descarga
verificada, instalación silenciosa y rollback real.

### Added

- **2.1 - Detección REAL de drivers** (`driver-updater.ts`): se eliminó
  `LATEST_DRIVERS`. La búsqueda usa la **API COM de Windows Update**
  (`IsInstalled=0 AND Type='Driver'`) en **un solo proceso PowerShell** junto con la
  enumeración de dispositivos. Respeta la GPO "Do not include drivers"
  (`ExcludeWUDriversInQualityUpdate` / `SearchOrderConfig`). Estados honestos:
  `up-to-date` (WU respondió sin ofertas), `update-available`, `unknown` (WU no
  respondió o está bloqueado por política) — **nunca** "al día" por resultado vacío
  (ref. `emptyResult` de Kudu). Verificado en la máquina: WU respondió, 0 updates.
- **2.2 - Catálogo de drivers como DATOS** (`catalogs/driver-catalog.json` +
  `driver-catalog.ts`): flags silenciosos por fabricante (`setup.exe -s -noreboot
-clean`, `-INSTALL -SILENT -NOREBOOT`, `-s --noreboot`), vendor/name patterns,
  firmantes confiables y claves de la GPO. Sin listas hardcodeadas en `.ts`.
- **2.3 - Descarga real** (`driver-downloader.ts`): descarga con progreso **real en
  bytes**, reintentos con backoff (3: 5/15/45 s), verificación de **tamaño + SHA-256
  - firma Authenticode** (`Get-AuthenticodeSignature`). Si algo no coincide →
    **aborta y borra el archivo** (nunca se instala algo no verificado).
- **2.4 - Instalación silenciosa + verificación post** (`driver-installer.ts`):
  punto de restauración **verificado** (o aborta), flags del catálogo, **siempre
  `/norestart`**, timeout **600 s**, log a archivo y **re-lectura** de
  `Win32_PnPSignedDriver.DriverVersion` + `Get-PnpDevice Status == OK`. Si no
  confirma → **fallo real**. Flag `rebootRequired` (exit 3010/1641) a la UI.
- **2.5 - Rollback real** (`driver-installer.ts`): recibo persistido (driver id,
  `oem#.inf`, versión previa), `pnputil /delete-driver <oem#.inf> /uninstall` +
  punto de restauración + re-verificación. Si no hay recibo o no se capturó el `.inf`
  → se **rechaza y deshabilita** (honesto).
- **2.6 - IPC + UI**: canales `drivers:download`, `drivers:install-silent`,
  `drivers:cancel` (no serializado, para poder cancelar lo que está en curso) y
  evento `drivers:progress`, en los 4 planos. UI en `Drivers.tsx` con progreso real
  (paso + bytes/total), **Cancel**, aviso de **reboot requerido** y marcado del
  **punto de restauración**.

### Changed

- `drivers:install` ahora recibe un `DriverInstallRequest` (orquestador real), no un
  `(driverId, downloadUrl)`.
- `DriverInfo`/`DriverScanResult` exponen `status`, `source`, `updateTitle`,
  `automatic`, `unknownCount`, `wuStatus`, `wuMessage`.
- `docs/CATALOGS.md`, `docs/USER_GUIDE.md`, `docs/TROUBLESHOOTING.md` y nuevo
  `docs/DRIVERS_AUTO_UPDATE_DESIGN.md`.

### Not automated (by design)

BIOS/UEFI/firmware, DDU/limpieza agresiva, drivers sin firma WHQL/Authenticode,
reinicio forzado, deshabilitar la exigencia de firma e instalaciones paralelas.

## [0.11.0] - 2026-10-05

Fase 1 del `PLAN_MEJORAS.md`: la app deja de sentirse lenta (minor: mejoras
de rendimiento visibles al usuario). Todo medido de verdad con
`scripts/measure-fase1.mjs` (nuevo) + los harnesses existentes; artefactos en
`docs/perf/` y tabla antes/después en `docs/PERFORMANCE.md` (ronda v0.11.0).
El "antes" es el mismo harness contra un worktree limpio de v0.10.2.

### Added

- **1.1 — TTL 90 s a `dns:benchmark` + tab DNS bajo demanda** (`cache.ts`,
  `ipc/index.ts`, `Security.tsx`): visitar Security ya no paga ~12 s; la 2.ª
  lectura en TTL cuesta **0 ms/0 spawns** (medido: 14171 ms → 0 ms, payload
  idéntico). La tab DNS mide solo al abrirse + botón Re-run con `force`.
- **1.2 — SWR en Dashboard/Audit/Boost/Tools** (`Audit/Dashboard/Boost/Tools.tsx`,
  tipos + preload con `CacheOptions`): primera pintura desde caché +
  revalidación `force:true` silenciosa. Navegación real medida: 2–4 ms/página
  con el IPC en fondo. Test: `Audit.test.tsx` (pinta caché, revalida con force).
- **1.3 — `apps:get-installed` 3→1 spawn** (`installed-apps.ts`, patrón
  `startup-apps.ts`): [9131, 3712] ms → **[5003, 2115] ms**, 221 apps en
  ambas (paridad). Test de paridad 1-spawn con las 3 fuentes.
- **1.4 — `benchmark:run` 20→1–2 spawns + TTL 60 s** (`benchmark.ts`, patrón
  `system-audit.ts` con marcadores `@@BENCH_n@@`): **128925 ms → 62005 ms**,
  15 resultados con la misma matemática de scores. Test de paridad numérica
  - conteo de spawns.
- **1.5 — Cleaner/Startup/Debloat virtualizados** (`Cleaner/Tools.tsx`): el
  mismo `VirtualList` (umbral 50) en las 3 listas que crecen con la máquina;
  5000 archivos → ventana montada <200 filas (test que lo exige). Scroll real
  500 filas: p50 **59,9 FPS**. Bundles-grid y Security-report revisados: no
  crecen con la máquina (catálogo curado / 22 checks fijos), sin cambios.
- **1.6 — `cleaner:delete` N→1 spawn** (`junk-scanner.ts`): 10 archivos
  scratch 24801 ms/10 spawns → **2157 ms/1 spawn**, 10/10 verificados,
  reporte por archivo intacto (re-verificación por path, `NOT_FOUND` honesto).
  Validado de verdad solo con scratch en `%TEMP%`, limpiado después.
- **1.7 — Timeouts por servidor + adaptador cacheado** (`security-privacy.ts`,
  `network-adapter.ts`): `-Count 4→2` + race 10 s (servidor colgado → latencia
  0, resto idéntico al baseline); `resolveActiveAdapter()` ×3: 3 spawns/8949 ms
  → **1 spawn**/4751 ms (caché 60 s, nunca cachea null).
- **1.8 — `docs/PERFORMANCE.md` ronda v0.11.0** con tabla antes/después por
  ítem + artefactos `docs/perf/fase1-v0.11.json`,
  `fase1-v0.10-baseline.json`, `ipc-channels-v0.11.json`, `ui-perf-v0.11.json`,
  `ui-fps-v0.11.json`. Cero números inventados.

### Tests

- Unit: `vitest` **606/606** (57 archivos; +13 netos: caché TTL, adaptador,
  timeout DNS, paridad installed-apps/benchmark, batch delete, virtualización
  Cleaner, SWR Audit).
- E2E web + Electron: pendientes de corrida fresca (ver Gates).

## [0.10.2] - 2026-10-05

Fase 0 del `PLAN_MEJORAS.md`: seis arreglos de **honestidad funcional**, sin
capacidad nueva (patch). Ninguna operación vuelve a reportar éxito sin haber
verificado el efecto real.

### Fixed

- **0.1 — El botón ⚙️ del header abre Settings** (`Header.tsx`, `Layout.tsx`):
  el botón no tenía `onClick`; ahora navega a la vista Settings (que ya
  existía) vía `onNavigate`. Test: `Header.test.tsx` + E2E
  `navigation.spec.ts` ("header gear opens Settings").
- **0.2 — Drivers "Update" ya no miente `success:true`**
  (`driver-updater.ts`, `electron-api.ts`): abrir la página del fabricante
  devuelve `success:false` + `status:'manual-action-required'` con la URL que
  se abrió y lo que el usuario debe hacer (descargar, instalar, re-escanear).
  Si la página ni siquiera se abre, `status:'failed'` con el motivo. Tests:
  `driver-updater.test.ts` (manual → nunca success; fallo de apertura →
  failed) + E2E `drivers-honesty.spec.ts`.
- **0.3 — Cleaner: los archivos siguen visibles cuando falla la limpieza**
  (`Cleaner.tsx`): la rama de fallo ya no filtra los seleccionados; muestra el
  error con el conteo de fallos y un botón **Retry cleaning**. Test:
  `Cleaner.test.tsx` (fallo simulado → archivos presentes + error + reintento).
- **0.4 — "Rollback" renombrado a "Restart device" (opción b)**
  (`Drivers.tsx`, `driver-updater.ts`, `Header.tsx`): el botón y la confirmación
  dicen lo que realmente hace (`pnputil /restart-device`); el mensaje de fallo
  dice "Failed to restart device". **Justificación:** un rollback real
  (`pnputil /delete-driver <oem#.inf> /uninstall` + restore point verificado +
  re-verificación de versión) muta hardware real y no puede testearse sin
  riesgo en este entorno; publicarlo sin verificación violaría la regla de oro
  del proyecto. Queda para Fase 2 con el pipeline completo y documentado.
- **0.5 — Progresos reales o indeterminados, cero barras cosméticas**
  (`Progress.tsx`, `Tools/Bundles/Cleaning/Network/Drivers.tsx`): nuevo modo
  `indeterminate` en `Progress` (sin `aria-valuenow` fabricado); se eliminan los
  `setInterval(+10/90ms)` de Tools, Bundles, Cleaning y Network y el `value={50}`
  fijo de Drivers. Todos los `alert()` tocados migran a feedback inline con
  `role="status"` + `aria-live`. Tests: `Progress.test.tsx` (indeterminado) +
  E2E existentes.
- **0.6 — Free RAM aclara su alcance** (`Header.tsx`, `USER_GUIDE.md`): el
  botón tiene tooltip/aria-label ("solo la propia app") y el resultado muestra
  MB reales antes→después (`Freed N MB (this app: A→B MB)`). **Decisión
  explícita:** no hay trimming system-wide — Windows gestiona la RAM global y
  recortar otros procesos puede empeorar. Tests: `Header.test.tsx` +
  `free-ram.spec.ts` actualizada.

### Tests

- Unit: `vitest` **593/593** (5 nuevos: Header 2, Cleaner 1, Progress 1,
  driver-updater 1 neto).
- E2E web: `playwright` con 3 specs nuevas/actualizadas (gear→Settings,
  drivers-honesty 2, free-ram alcance); E2E Electron 1/1.

## [0.10.1] - 2026-10-03

Corrección de dos bugs reales confirmados al validar los canales de
`install`/`uninstall`: el parseo de `UninstallString` ahora acepta rutas entre
comillas (afectaba a ~1 de cada 5 apps reales) y las instalaciones de winget ya
no se matan a los 60 s reportando un fallo falso.

### Fixed

- **`bundles:install` / `bundles:uninstall` ya no se matan a los 60 s ni mienten
  en timeout** (`src/main/services/app-bundles.ts`): ambos canales pasan del
  runner corto (`runPowerShell`, 60 s) al largo (`runPowerShellScript`, 120 s).
  Si el proceso se mata por timeout, el resultado **relee el estado real** con
  `winget list --id <id> --exact` antes de concluir y devuelve
  `state: 'timeout'` + `verified: true`: un install que quedó instalado es
  éxito; un uninstall que ya no está es éxito; en caso contrario se informa el
  timeout en lugar de un fallo genérico que oculte el estado.
- **`apps:uninstall` acepta `UninstallString` entre comillas**
  (`src/main/services/installed-apps.ts`): el patrón exigía empezar por `X:\`,
  por lo que rechazaba con "Unsupported uninstall string" todos los registros
  con la ruta entre comillas (medido: 33/159 = 20,75% en esta máquina). El
  parser separa la ruta de los argumentos, admite `"C:\Program Files
(x86)\..."` (paréntesis) y rutas con espacios, y sigue rechazando comillas
  internas, backtick, `$`, sustitución y separadores de shell (`; | & > < * ?`).
  La ruta se interpola siempre entre comillas dobles en `Start-Process`; los
  argumentos se descartan (se ejecuta el `.exe` validado con `/S`).

### Tests

- `installed-apps.test.ts`: 12 casos nuevos de rutas entre comillas (sin
  argumentos, con argumentos, argumentos con comillas propias, `(x86)`,
  metacharacters y sustitución en la ruta, ruta no absoluta, comilla sin
  cerrar, no-`.exe`, caracteres pegados tras la comilla, MSI).
- `app-bundles.test.ts`: casos nuevos de runner largo, instalación lenta que no
  debe reportarse como fallo, y timeout honesto para install/uninstall
  (relectura que confirma instalado / ausente y paquete que sigue presente).

## [0.10.0] - 2026-10-03

Cuarto **auto-fix reversible** del catálogo de seguridad: `smb-signing`. Requiere
firma SMB en servidor y cliente (`RequireSecuritySignature` /
`EnableSecuritySignature` = `$true`) con preview obligatorio, confirmación,
**revert exacto** y re-lectura de verificación (mismo patrón `isTargetObservation`
/ `isOriginalObservation`). Además, el portable de uso diario pasa a una carpeta
estable sin versión para que el acceso directo no se rompa en cada release.

### Added

- **`smb-signing` auto-fix** (`src/shared/security-fix.ts`,
  `src/main/services/security-fix.ts`): `SECURITY_FIX_IDS` incluye `smb-signing`.
  Apply: `Set-SmbServerConfiguration -RequireSecuritySignature $true
-EnableSecuritySignature $true -Force`, con **fallback por registro** que escribe
  ambos DWORD (`LanmanServer\Parameters`). El fix captura los valores **reales**
  de `RequireSecuritySignature` y `EnableSecuritySignature` **antes** de escribir
  (token `require=<absent|0|1>;enable=<absent|0|1>`); el **revert restaura ambos
  exactos** y **elimina** (`Remove-ItemProperty`) el valor que originalmente estaba
  ausente, sin asumir ningún default. `SECURITY_CHECK_CATALOG` marca
  `autoFixable: true` para `smb-signing`; el conjunto auto-fixable es ahora
  **exactamente** `{smb1, guest-account, remote-desktop, smb-signing}`.
- **Docs**: `docs/SECURITY_CHECKS.md`, `docs/USER_GUIDE.md`,
  `docs/TROUBLESHOOTING.md` y `docs/FAQ.md` documentan el cuarto auto-fix y el
  procedimiento del portable estable.

### Changed

- **Portable estable + acceso directo**: la copia de uso diario vive en
  `C:\Users\paulo\Apps\FORCH.iA WinOptimizer\FORCH.iA WinOptimizer (Portable).exe`
  (nombre sin versión, `Unblock-File` aplicado) y el acceso directo del escritorio
  apunta ahí. El `release\` original se conserva. Procedimiento documentado en
  `docs/USER_GUIDE.md`.

### Tests

- `security-fix.test.ts`: preview (requires-admin / allow / already-applied /
  unavailable), apply/revert (incluido original `enable=absent` y caso de fallo
  `FAILED`), decode, formato y predicados `isTargetObservation` /
  `isOriginalObservation` para `smb-signing`.
- `security-scan.test.ts` (shared + engine): el conjunto `autoFixable` pasa a ser
  exactamente los cuatro checks.

## [0.9.1] - 2026-10-02

Honestidad de resultado en todos los canales mutantes: **ninguna operación
vuelve a reportar éxito sin haber releído el estado real después de actuar**.
Se corrige el bug confirmado de `dns:set` (elegía el adaptador equivocado y
reportaba `SUCCESS` ante un fallo real) y se auditan los 30 canales mutantes.

### Fixed

- **`dns:set` ya no miente** (`src/main/services/security-privacy.ts` +
  `network-adapter.ts`): antes tomaba el **primer adaptador `Up`** — en esta
  máquina **Tailscale (idx 24)**, no la Ethernet (idx 3) — y una `CimException`
  **no terminante** hacía que el script imprimiera `SUCCESS` sin cambiar nada.
  Ahora resuelve el adaptador por **ruta por defecto (`0.0.0.0/0`) prefiriendo
  el físico**, captura el DNS original, aplica, **relee y compara**, y si no
  coincide **revierte y reporta fallo real** con `before`/`after` observados.
  Validado en runtime: contra la máquina real devuelve `success:false` con el
  error CIM real y `before=after=["8.8.8.8","8.8.4.4"]` (la sesión no está
  elevada) — el código viejo lo habría reportado como éxito.
- **Resolvedor único de adaptador activo** (`network-adapter.ts`): reutilizado
  por DNS y por el benchmark (`benchmark.ts:363` ya no mide el NIC equivocado).
- **`memory:free` honesto** (`memory-free.ts`): el script mide el working set
  **antes/después en el SO** y sólo reporta éxito si **al menos un proceso fue
  recortado**; el fallback GC (que no recorta nada) ya no se acepta como éxito.
  Validado: 252 MB → 14 MB (working set OS), `freedMb:347` medido por el script.
- **Canales con "éxito falso" corregidos** (todos con test de caso de fallo):
  - `privacy:apply-setting` — relee y compara; fallo real si el valor no cambia.
  - `security:run-action` — errores terminantes; marker `FAILED` propagado.
  - `settings:update` — `persist()` verifica el read-back y reporta `ok:false`
    si el fichero no se pudo escribir.
  - `cleaner:delete` — `NOT_FOUND` ya no cuenta como borrado; `Remove-Item`
    confirma que el path desapareció.
  - `startup:toggle` — relee el Run key (HKCU/HKLM) para confirmar el cambio.
  - `services:toggle` / `services:set-start-type` — releen estado y tipo de
    arranque; `-ErrorAction Stop`; sin `SilentlyContinue` que oculte fallos.
  - `tweaks:apply` / `tweaks:restore` — verificación post-cambio real por
    operación (registro/servicio/tarea) antes de marcar como aplicado.
  - `network:fix` / `network:fix-0x00000709` — post-condiciones reales
    (SMBv1+LanmanWorkstation, adaptador arriba) y read-back del fix.
  - `security:fix-apply` / `security:fix-revert` — el veredicto sale del
    **re-read** (`isTargetObservation`/`isOriginalObservation`), no del marker.
  - `drift:reapply` — relee el valor esperado antes de marcar auto-fixed.
  - `bundles:install/uninstall` — winget ya no acepta `"already installed"`
    como éxito.
  - `drivers:create-restore-point` — relee el restore point (`-ErrorAction Stop`).
  - `apps:uninstall` — usa el **exit code** del uninstaller (0/3010).
  - `tools:launch` — confirma que el proceso arrancó antes de reportar éxito.
- **8 checks de seguridad admin-gated** siguen reportando `requires-admin` con
  evidencia cuando no hay elevación (nunca `fail`/`unknown` inventados).

### Added

- **`network-adapter.ts`**: resolvedor de adaptador activo (gateway por defecto,
  físico preferido, exclusión de túneles/VPN/Hyper-V/WSL) + 8 tests.
- **Tests nuevos de fallo** en `security-privacy`, `benchmark`, `memory-free`,
  `junk-scanner`, `settings`, `tweaks`, `system-services`, `network-fixer`,
  `security-fix`, `drift-guard`, `driver-updater`, `installed-apps`,
  `tool-launcher` (521 → **547** unit tests).

## [0.9.0] - 2026-10-02

El **catálogo de seguridad crece a 22 checks** con **6 controles de hardening
admin-gated** de sólo lectura, y todo el código queda normalizado con Prettier
(fin de línea LF fijado). Se validan en runtime real el auto-fix reversible y los
canales mutantes reversibles, sin ejecutar nada destructivo.

### Added

- **6 checks de seguridad nuevos, admin-gated y de sólo lectura**
  (`src/shared/security-scan.ts` + `src/main/services/security-scan.ts`):
  `lsass-protection` (`RunAsPPL`), `credential-guard` (VBS/Device Guard),
  `bitlocker-protectors` (protectores de clave), `admin-accounts` (cuentas de
  administrador local contadas por **SID `S-1-5-32-544`**, nunca por nombre),
  `firewall-inbound-rules` (reglas entrantes habilitadas) y `winrm-exposure`
  (servicio WinRM + listeners). Cada uno declara `requiresAdmin: true`: sin
  elevación reporta `requires-admin` con el valor observado y **queda excluido
  del denominador del score** — nunca `fail` ni `unknown`. El set `autoFixable`
  sigue siendo exactamente `{smb1, guest-account, remote-desktop}` (test).
- **`.gitattributes` (LF) + `.prettierignore`** y normalización completa del
  código con Prettier (`prettier --check .` pasa). Fin de línea LF fijado para
  todos los archivos de texto.

### Changed

- **`docs/SECURITY_CHECKS.md`** documenta los 6 checks nuevos (consulta en vivo,
  estados posibles, severidad, `requires-admin`, auto-reparable = no); el total
  pasa de 16 a **22**. `docs/USER_GUIDE.md` y `docs/TROUBLESHOOTING.md`
  alineados.
- Versión **0.9.0** (`package.json` + `package-lock.json`).

### Validated (runtime, no mocks)

- **Auto-fix `remote-desktop`**: sin sesiones RDP activas y con la máquina ya
  endurecida (`fDenyTSConnections=1`), el servicio devuelve `blocked` con motivo
  `already-applied` (`before == after`, sin mutar nada); con el proceso sin
  elevar, el gate `requires-admin` también está activo. **Sin cambio de estado.**
- **`cleaner:delete`**: basura scratch en `%TEMP%` → escaneada → borrada
  (3/3, `failed: 0`) → verificada ausente; directorio scratch eliminado.
- **`cleaning:run-now`**: schedule scratch creado → ejecutado → eliminado; la
  tarea programada de Windows queda `ABSENT`; `schedules.json`/`history.json`
  restaurados byte a byte.
- Estado final == inicial (`SMBv1 enabled, Guest enabled, RDP denied`).

## [0.8.0] - 2026-10-02

Los **catálogos curados pasan a DATOS**, se validan los 3 auto-fix **en runtime real**
(aplicar → revertir, sin tocar RDP) y el **scan de seguridad crece a 16 checks** reales
de sólo lectura. Incluye el arreglo de un fallo silencioso del runner de PowerShell.

### Added

- **Catálogos en DATOS, una sola fuente de verdad** (Fase A):
  - `catalogs/tweaks-catalog.json` — **19 tweaks** reversibles (antes en código).
  - `catalogs/app-bundles-catalog.json` — **8 bundles / 48 apps** winget.
  - `src/main/services/catalog-data.ts` (lector JSON único que reusa
    `resolveBundledPath`, la misma resolución que `debloat.ts`) y
    `src/main/services/tweak-catalog.ts` (valida y carga; descarta entradas inválidas).
  - `docs/CATALOGS.md`: formato, resolución dev/empaquetado y cómo actualizar vía
    el source-updater.
- **6 checks de seguridad nuevos** (`src/shared/security-scan.ts` + `security-scan.ts`),
  dinámicos y de **sólo lectura** (el auto-fix sigue siendo sólo los 3 de v0.7.0):
  `password-policy`, `autoplay`, `lm-hash`, `smb-signing`, `listening-ports` y
  `windows-update-service`. Cada uno puede degradar a `unknown` / `not-applicable` /
  `requires-admin` con la razón real y siempre lleva `evidence` observada.
- **Documentación**: `docs/SECURITY_CHECKS.md` (16 checks + fórmula de scoring),
  `USER_GUIDE.md`, `TROUBLESHOOTING.md` y `docs/CATALOGS.md`.

### Changed

- **Duplicación 10 vs 19 resuelta**: la lista nativa de 19 tweaks es la autoritativa;
  se descartó el import stale de 10 de winutil. Un test
  (`catalog-single-source.test.ts`) falla si vuelven a divergir o si reaparece una
  lista de productos en `.ts`.
- `app-bundles.ts` / `tweaks.ts` conservan sólo validación, motor y composición de
  PowerShell: **cero listas de productos** en código.
- El E2E con Electron real exige ahora **≥16 checks** y verifica que cada check nuevo
  devuelve un estado real de esta máquina.

### Fixed

- **Fallo silencioso del runner de PowerShell (crítico)**: al batchear 16 checks el
  script supera el límite de ~32767 caracteres de la línea de comandos de Windows una
  vez codificado en Base64/UTF-16LE (~36.7k), por lo que `-EncodedCommand` no
  arrancaba y **todos** los checks caían a `unknown` con salida vacía. `powershell.ts`
  ahora ejecuta los scripts grandes desde un `.ps1` temporal con `-File` (BOM UTF-8),
  sin ese límite. Cubierto por un test de regresión.

### Validated (runtime, no mocks)

- **Auto-fix real elevado**: `smb1` enabled→disabled→enabled y `guest-account`
  enabled→disabled→enabled, **restaurando el valor exacto**; `remote-desktop`
  **saltado** (2 sesiones activas). Estado final == inicial
  (`SMBv1 enabled, Guest enabled, RDP denied`). Con proceso sin elevar, los 3
  reportan `requires-admin` y no tocan nada.

## [0.7.0] - 2026-10-02

Sin listas hardcodeadas, build reproducible y **auto-fix real** (3 checks reversibles).

### Added

- **Auto-fix de seguridad reversible** (`src/main/services/security-fix.ts` +
  `src/shared/security-fix.ts`): sólo `smb1`, `guest-account` y `remote-desktop`, con
  **preview obligatorio** (valor actual observado + objetivo), confirmación y **revert**
  que restaura el **valor previo real** persistido antes del cambio (nunca un default).
  **Requiere admin**: sin elevación devuelve `blocked` con motivo `requires-admin` (nunca
  falla en silencio) y ofrece relanzar con `Start-Process -Verb RunAs`. Tras aplicar, el
  check **se vuelve a medir**. Nuevos canales IPC `security:fix-preview` / `fix-apply` /
  `fix-revert` / `relaunch-elevated` (4 planos) y UI (botón _Auto-fix_ + modal) en Security.
- **Clasificador dinámico de apps de arranque** (`src/main/services/startup-impact.ts`):
  el impacto se deriva de señales observables (origen/persistencia, existencia + firma
  del binario, ruta del sistema, **huella CPU/RAM medida en vivo** y gramática genérica
  del nombre). Documentado en `docs/STARTUP_APP_IMPACT.md`.
- **`docs/BUILD_REPRODUCIBILITY.md`**: causa y arreglo de la deuda `@shared/*`.

### Changed

- **Eliminadas las allowlists de ~90 apps** (`highImpactApps` / `mediumImpactApps`) de
  `startup-apps.ts`: prohibido cualquier listado de productos/AV/marcas. Ahora enumera
  Run HKCU/HKLM, carpeta Startup, tareas programadas y servicios auto en **un solo
  proceso PowerShell**, con firma, ruta y huella medida por entrada.
- **`SECURITY_CHECK_CATALOG`**: `autoFixable: true` sólo en `smb1`, `guest-account` y
  `remote-desktop`. El test pasó de "ninguno es auto-fixable" a afirmar **exactamente
  esos 3**.

### Fixed

- **Deuda de build `@shared/*`**: se eliminaron los 10 shims creados a mano en
  `node_modules/@shared/` (gitignoreado + rutas absolutas ⇒ build no reproducible). La
  resolución del alias se registra **en runtime** desde `src/main/register-shared-alias.ts`
  (importado primero en `main/index.ts`). Verificado borrando los 10 directorios: el E2E
  con Electron real sigue **1/1**.

### Release

- `checksums.sha256` ahora incluye también el **`.blockmap`** (además de Setup, Portable
  y `latest.yml`).

## [0.6.0] - 2026-10-02

El **Security Scan** deja de ser una lista de 8 chequeos hardcodeados y pasa a ser
un **escáner real**: cada resultado proviene de una consulta en vivo al sistema
(CIM/WMI, registro, `Get-*`). Sin listas de software, sin resultados ni colores
hardcodeados; catálogo único compartido entre main y renderer.

### Added

- **Escáner de seguridad real (`src/main/services/security-scan.ts`):** 10 chequeos
  de **sólo lectura** ejecutados en **una sola invocación de PowerShell** batcheada
  (patrón de `system-audit.ts`), con `try/catch` por check (un check que falla no
  rompe el scan) y **caché TTL 30 s** (`withCache('security')`).
- **Estados honestos y diferenciados:** `pass` / `warn` / `fail` / `unknown` /
  `not-applicable` / `requires-admin`, cada uno con la razón real y la **evidencia
  observada**. Regla de oro: si un dato no se pudo leer, es `unknown` o
  `requires-admin` — nunca `fail` ni un "todo verde" inventado.
- **Antivirus sin listas:** se resuelve leyendo `SecurityCenter2 => AntiVirusProduct`
  y decodificando `productState` en vivo. Un AV de terceros se detecta igual que
  Defender.
- **Scoring transparente:** fórmula explícita mostrada en la UI (tooltip) y en
  `docs/SECURITY_CHECKS.md`. Excluye del denominador los checks
  `unknown`/`not-applicable`/`requires-admin`; devuelve `null` ("not scored") si
  nada es medible.
- **Catálogo único (`src/shared/security-scan.ts`):** `SECURITY_CHECK_CATALOG` es la
  única fuente de verdad; main ejecuta y ordena las consultas, el renderer las
  etiqueta. Documentado en `docs/SECURITY_CHECKS.md`.
- **Canal IPC `security:scan`** respetando los 4 planos (handler + preload + tipos +
  consumidor), alineado y sin duplicar listas.
- **Real-Electron E2E** (`e2e/security-real-electron.spec.ts`): lanza el Electron
  **real** y ejercita el scanner de punta a punta (renderer → preload → IPC → main →
  PowerShell) contra la máquina. Antes los E2E mockeaban `window.electronAPI`, así
  que el proceso main nunca se probaba contra Windows.
- **Tests unitarios por check con fixtures** de configuraciones distintas (Win11 Pro
  completo, Win10 Home sin BitLocker, VM sin TPM/Secure Boot, AV de terceros, sin
  admin, payload corrupto/no-array): cobertura de **cada estado**.
- **`docs/SECURITY_CHECKS.md`:** catálogo auditable (check → consulta → estados →
  severidad → ¿auto-reparable?).

### Changed

- **UI de Security:** el reporte real muestra puntaje con tooltip de fórmula,
  resumen por estado, **evidencia observada** por check y guía concreta. Severidad y
  estado usan **tokens de tema** (`--color-chart-primary`, variantes de `Badge`); la
  información nunca depende sólo del color.
- **Auto-fix:** todos los chequeos de seguridad son de sólo lectura en v0.6.0; ninguno
  muta el sistema. La reparación es guía explícita o acción separada.

### Security

- Ninguna acción del escáner modifica el sistema. Sin acciones destructivas
  (debloat, cleaner, drivers, dns, servicios) ejecutadas durante el desarrollo.

## [0.5.0] - 2026-10-02

Todas las funciones que estaban como _stub deshabilitado_ pasan a ser reales: los 9
controles de **Settings**, el **Export CSV** y los **gráficos** de Statistics, los
**Fix** de Audit/Security y los lanzadores de **Tools → Utilities**. Sin dependencias
nuevas (red npm bloqueada): los gráficos son SVG/CSS a mano.

### Added

- **Settings — controles vivos (fin del `Not implemented yet`):**
  - **Accent color** real: deriva tokens `--color-accent`, `--color-accent-hover`,
    `--color-accent-muted`, `--color-border-focus`, `--color-chart-primary` desde un
    único `#RRGGBB` y los aplica en vivo (`renderer/utils/accent.ts`). Persistido y
    re-aplicado en el arranque. Sin colores hardcodeados en los componentes.
  - **Start with Windows**: `app.setLoginItemSettings` + lectura del estado **real** del
    SO (`app.getLoginItemSettings`) para que el toggle nunca mienta. En portable se
    muestra deshabilitado con explicación honesta.
  - **Minimize to tray on close**: intercepta el cierre, `Tray` con `assets/icons/icon.ico`
    y menú _Show_/_Quit_; desactivable para cerrar de verdad.
  - **Enable notifications**: `Notification` de Electron respeta el toggle (gate en el
    servicio de notificaciones).
  - **Automatic updates**: cablea el `electron-updater` existente (`updater.ts`) al toggle;
    UI de estado (idle/checking/available/not-available/downloading/downloaded/error) con
    _Check now_ / _Download_ / _Restart & install_. Nunca descarga/instala en tests.
  - **Scan browser cache / Scan Windows temp files / Scan recycle bin**: expuestos al
    motor de escaneo existente (`junk-scanner`) como categories; sin duplicar lógica.
  - **Exclude paths**: prefijos ignorados por el escáner (`isExcludedPath`).
  - Persistencia centralizada en `settings.json` (`app.getPath('userData')`), única
    fuente de verdad en el proceso main.
- **Statistics:** **Export CSV** real (datos reales, diálogo de guardado nativo) y
  **gráficos SVG/CSS** propios (`BarChart`, `LineChart`) con datos reales y empty states
  honestos; accesibles (rol `img` + lista espejo, no sólo color).
- **Audit / Security — Fix:** los botones ya no están muertos; abren el flujo reversible
  que resuelve el hallazgo (Audit → Security·Privacy / Tweaks / Cleaner / Network…;
  Security → Privacy) en lugar de mutar la máquina a ciegas. Tooltips actualizados.
- **Tools → Utilities:** lanzador real de utilidades de Windows (`taskmgr`, `cleanmgr`,
  `devmgmt.msc`, `services.msc`, `msinfo32`, `control`, `resmon`, `appwiz.cpl`, `ncpa.cpl`,
  `diskmgmt.msc`, `eventvwr.msc`, `perfmon.msc`) con validación del binario en `System32`
  y feedback de éxito/error (`tool-launcher.ts`).
- Servicios/host nuevos: `services/settings.ts`, `services/stats.ts`, `services/tool-launcher.ts`,
  `tray.ts`, `window-behavior.ts`, y contratos `shared/settings.ts`, `shared/stats.ts`,
  `shared/updater-status.ts`, `shared/windows-tools.ts`.
- Tests: **+63** unit/integration (395 total) y **+12** E2E (88 total).

### Changed

- `MUTATING_CHANNELS` incluye `settings:update` y `tools:launch` (serializados por el
  mutex global).
- El updater de fondo ya no abre un diálogo de descarga en `update-available`: la decisión
  vive en la UI de Updates (evita dobles descargas).
- Versión **0.5.0** (`package.json` + `package-lock.json`).

### Security

- Las features que escriben estado de máquina (login item) se prueban **encendiendo y
  apagando**, dejando el sistema igual; ningún canal mutante se ejecuta sobre la máquina real
  en tests.

## [0.4.2] - 2026-10-02

Auditoría funcional + cierre de pendientes de rendimiento: **3 bugs de "lista que degrada a
0" en servicios Main corregidos**, la única vista con _jank_ (Tools → Apps) virtualizada, el
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
  _Scheduled Cleaning_. Ahora se reviven a `Date` al parsear. Tests: `scheduled-cleaning.test.ts`
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
- **Acciones muertas endurecidas** (botones que no hacían nada): _Dashboard_ → _Clean Junk_ /
  _Optimize_ ahora navegan a Cleaner/Boost; _Tools → Utilities_ abre Network/System Info donde
  existe y marca el resto **"Not available yet"** (deshabilitado); los _Fix_ de Audit/Security
  y _Export CSV_ de Statistics quedan deshabilitados con tooltip; los toggles/inputs no
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
- **Catálogo winget ampliado (P1.3):** 5 → 8 bundles y 33 → 48 apps, con **todos los IDs validados en vivo contra winget** (2026-10-01). Nuevos bundles: **Productivity** (PowerToys, Obsidian, Notion, Flow Launcher), **Communication** (Zoom, Telegram, WhatsApp vía msstore, Slack, Signal), **Security & Privacy** (Bitwarden, KeePassXC, Malwarebytes, Wireshark). Adds en bundles existentes: Windows Terminal + PowerShell (DevTools), FFmpeg (Media). Actualizados: Python 3.12 → **3.13**, Node → **LTS** (`OpenJS.NodeJS.LTS`). _Nota:_ el plan sugería `JustinFinebel.HandBrake` pero **no existe en winget** (se mantiene el oficial `HandBrake.HandBrake`); IDs de WhatsApp/Signal/KeePassXC/Wireshark/Flow corregidos tras búsqueda real. Eliminado el duplicado `obs-gaming` (mismo `wingetId` que `obs`)
- **Test de integridad del catálogo de apps (P1.3):** bundles nuevos presentes (≥3 apps, icono, descripción), IDs plan presentes, `app.id` y `wingetId` **únicos** en todo el catálogo, y todo `wingetId` cumple la gramática P0.2 (`^[A-Za-z0-9][A-Za-z0-9._+-]*$`) — incluye el ID de Store `9NKSQGP7F2NH`
- **Catálogo de tweaks +10 (P1.2):** 9 → 19 tweaks seguros y reversibles, con fuentes verificadas (Win11Debloat, CTT winutil, Sophia, Microsoft Q&A). Performance: _Snappier animations_ (`MenuShowDelay=0` + `MinAnimate=0`), _Mouse acceleration off_ (raw input 1:1), _No delay for startup apps_ (`StartupDelayInMSec=0`). Explorer/taskbar: _Taskbar aligned left_, _Hide taskbar search box_, _Hide Task View button_, _Hide Widgets_ (todos registry-only, servicios intactos). Privacy: _Turn off Copilot_ (botón + política `TurnOffWindowsCopilot`), _Turn off Windows Spotlight_ (política HKCU+HKLM). Nueva categoría **Accessibility**: _Disable Sticky Keys prompts_ (`Flags=506`)
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
