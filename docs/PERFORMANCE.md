# FORCH.iA WinOptimizer — Performance

Mediciones de la optimización de rendimiento: **v0.3.0** (fases P0–P3) y la ronda de
diagnóstico de latencia UI sobre **v0.4.0 → v0.4.1** (§ _Ronda de diagnóstico UI_ al final:
canales IPC, batching de la auditoría y métricas de UI/navegación, con tablas antes/después).

> Método: se ejecutó el código **compilado real** del proceso Main (`dist/main/services/*`)
> contra **PowerShell real** mediante `scripts/measure-system-info.mjs`, contando procesos
> spawned y wall-clock. Media de 3 ejecuciones salvo donde se indica. Cada valor incluye la
> varianza típica de arrancar `powershell.exe` en frío.

Reproducir:

```bash
npm run build
node scripts/measure-system-info.mjs
```

## System Info — 4 sondas → 1 (P1.1)

| Métrica                      | Antes (v0.2.3) | Después (v0.3.0)     |
| ---------------------------- | -------------- | -------------------- |
| Procesos PowerShell por scan | **4**          | **1**                |
| Tiempo (media, medido)       | **8.34 s**     | **3.31 s**           |
| Primera ejecución en frío    | 20.19 s        | 5.81 s               |
| Mejora                       | —              | **~60 % más rápido** |

Muestras (ms) medidas:

- Batch (1 spawn): `5813, 1944, 2174` → media **3310 ms**
- Legacy (4 spawns): `20192, 2450, 2384` → media **8342 ms**

El baseline informado para v0.2.3 era **~14.0–14.6 s con 4 spawns**; la mejora determinista
y verificable es **4 → 1 procesos** y el recorte del coste de arranque en frío.

## System Info — CPU sin Win32_Processor (P0.4)

`Get-CimInstance Win32_Processor` medido aislado costaba **1087–1172 ms** y sólo aportaba
`LoadPercentage`. El lote de PowerShell ya no lo consulta (tampoco el path legacy de sondas):
el uso de CPU se calcula en Node muestreando `os.cpus()` en una ventana de **200 ms**
(`computeCpuUsage`, pura y testeada), disparada **en paralelo** al proceso de PowerShell para
que la ventana no añada latencia.

| Métrica                    | Antes (P0.1–P0.3) | Después (P0.4)       |
| -------------------------- | ----------------- | -------------------- |
| Sistema cálido (media)     | **~1750 ms**      | **615 ms**           |
| Primera ejecución en frío  | 7276 ms           | 4031 ms              |
| Spawns PowerShell (legacy) | 4                 | 3                    |
| Mejora (cálido)            | —                 | **~65 % más rápido** |

Muestras (ms) medidas con `node scripts/measure-system-info.mjs`:

- Batch (1 spawn): `4031, 616, 614` → media **1754 ms**
- Legacy (3 spawns): `5812, 945, 956` → media **2571 ms**

El delta cálido (~1135 ms) coincide con el coste medido del propio `Win32_Processor`, validando
el diagnóstico. CPU usage antes = `LoadPercentage` de CIM (instantánea); ahora = promedio de
uso sobre la ventana de 200 ms (más preciso y sin coste).

## Drivers / Junk — motor sin cambios + caché (P1.2)

El motor de escaneo no cambió (sigue siendo 1 spawn cada uno); la mejora es la **caché TTL**:

| Scan           | Primera pasada        | Repetición dentro del TTL     |
| -------------- | --------------------- | ----------------------------- |
| Drivers        | ~4.4–10.8 s (1 spawn) | **≈ instantáneo** (TTL 5 min) |
| Junk / Cleaner | ~6.2 s (1 spawn)      | **≈ instantáneo** (TTL 30 s)  |
| System Info    | ~2.0–5.8 s (1 spawn)  | **≈ instantáneo** (TTL 60 s)  |

La caché se invalida explícitamente tras Clean, Apply, toggle de servicios/startup y `Refresh`.

## Virtualización y render (P0.4 / P3)

| Métrica                                    | Antes           | Después                                        |
| ------------------------------------------ | --------------- | ---------------------------------------------- |
| Filas en DOM para una lista de 500 drivers | 500             | **< 120** (virtualizado + chunked reveal)      |
| Render inicial                             | todas las filas | **30 filas** y crecimiento progresivo          |
| Trabajo fuera de viewport                  | completo        | `content-visibility: auto` en secciones largas |

Verificado en navegador real por `e2e/performance.spec.ts`.

## Correcciones de fluidez (P0.2 / P0.3)

- Estados `loading / empty / error` coherentes por sección (sin spinners infinitos).
- Progreso por etapas con throttle de 180 ms (evita spam de eventos IPC).
- Animaciones decorativas pausadas durante scans (`data-scanning`).

## Huella de la app (portable v0.3.0, en reposo)

Medido con `Get-Process` sobre el portable elevado, ~35 s después del arranque:

| Métrica                          | Valor                                   |
| -------------------------------- | --------------------------------------- |
| Procesos Electron                | 4 (main + renderer + GPU + utility)     |
| RAM en reposo (WorkingSet total) | **≈ 330 MB**                            |
| CPU acumulada en ~35 s           | ≈ 3.5 s (pico en startup, luego ocioso) |

## Free RAM (P1.1)

Acción rápida en el header (`memory:free`, serializada por el mutex global): recorta el
working set del proceso principal + hijos con `EmptyWorkingSet` (psapi.dll vía
`Add-Type`), con fallback a GC de .NET si psapi no está disponible. El `freedMb`
reportado es la diferencia de `process.memoryUsage().rss` medida en Node.

**Medido con `node scripts/measure-free-memory.mjs`** (proceso con ~266 MB de RSS):

| Muestra | RSS antes | RSS después | RAM liberada | Wall-clock |
| ------- | --------- | ----------- | ------------ | ---------- |
| 1       | 266.3 MB  | 12.8 MB     | **253 MB**   | 3125 ms    |
| 2       | 266.2 MB  | 12.7 MB     | **254 MB**   | 3028 ms    |

- Resultado consistente: **~253 MB liberados en ~3 s** (frío: 1 spawn de PowerShell + compilación de `Add-Type`; en caliente la app reutiliza el mismo patrón de 1 spawn).
- Si `EmptyWorkingSet` no está disponible, el script cae a `[System.GC]::Collect()` (`freedMb` puede ser 0 y aún así `success: true`).
- `freedMb` nunca es negativo (si el RSS crece entre mediciones se reporta 0).

## Ronda de diagnóstico UI sobre v0.4.0 (canales IPC + auditoría)

### Cómo se midió

- Equipo: Intel i3-4170 @3.70 GHz (4 hilos lógicos) — la contención entre procesos es real.
- **Baseline**: worktree limpio en `3dd9ec5` (= `origin/main`, v0.4.0) con `node_modules`
  enlazado y `dist/` propio, medido con la misma sonda.
- **Después**: árbol de trabajo actual (estos cambios), proceso limpio y `audit:run`
  primero (`PROBE_AUDIT_FIRST=1`) para que la caché `health` no envenene la medición.
- Sondas aisladas fuera del repo (sin navegación en paralelo): un canal por invocación,
  wall-clock en el renderer. Artefactos: `docs/perf/ui-metrics-baseline.json`,
  `docs/perf/ui-metrics-after.json`, `docs/perf/ui-metrics-after-warm.json`.

### Tabla antes / después

| Canal IPC                         | Antes (v0.4.0)                    | Después       | Δ         |
| --------------------------------- | --------------------------------- | ------------- | --------- |
| `audit:run` (1ª llamada, en frío) | **72 991 ms**                     | **7 789 ms**  | **−89 %** |
| `services:get-all`                | 61 687 ms (timeout a 60 s → `[]`) | **2 779 ms**  | −95 %     |
| `privacy:get-settings`            | 35 696 ms                         | **2 276 ms**  | −94 %     |
| `dns:benchmark`                   | 27 204 ms                         | **12 754 ms** | −53 %     |

Integridad de la auditoría tras el batching (sonda de detalle): **31 checks**, 0 payloads
vacíos, 25 pass / 4 warning / 2 critical, score 50. Payload total 7 401 B → 7 402 B
(mismo contenido que el baseline).

Desde el harness de UI completo (`scripts/measure-ui-perf.mjs`, 3 ciclos × 14 páginas =
42 navegaciones, **máximo por canal** sobre `summary.worstIpc`):

| Canal IPC                           | Baseline (v0.4.0)                                            | Después       | Δ         |
| ----------------------------------- | ------------------------------------------------------------ | ------------- | --------- |
| `audit:run`                         | 76 635 ms (en baseline nunca terminaba dentro de la ventana) | **9 273 ms**  | **−88 %** |
| `services:get-all`                  | 68 036 ms                                                    | **3 935 ms**  | −94 %     |
| `dns:benchmark`                     | 35 470 ms                                                    | **13 472 ms** | −62 %     |
| `apps:get-installed`                | 17 087 ms                                                    | **10 572 ms** | −38 %     |
| `cleaning:get-history`              | 4 647 ms                                                     | **2 493 ms**  | −46 %     |
| `cleaning:get-schedules`            | 5 009 ms                                                     | **4 194 ms**  | −16 %     |
| Interacción _Refresh_ del dashboard | 1 688 ms                                                     | **744 ms**    | −56 %     |

Otras señales de fluidez (mismo harness):

| Métrica                            | Baseline   | Después       |
| ---------------------------------- | ---------- | ------------- |
| Errores de navegación              | 0          | **0**         |
| Long tasks > 50 ms (máx. duración) | 2 (144 ms) | 3 (**65 ms**) |

### Canales re-medidos (`drivers:scan`, `bundles:check-installed`, `system:get-info`)

Los tres canales que quedaron _no concluyentes_ en la ronda anterior se re-midieron con
**5 repeticiones cada uno** mediante `scripts/measure-ipc-channels.mjs`. Método idéntico a
`scripts/measure-system-info.mjs`: servicios compilados reales de `dist/main/services` contra
PowerShell real, **un canal por invocación y secuencial, sin navegación en paralelo**. Las
llamadas van directo al servicio, así que `withCache` no interviene y cada corrida paga el
coste en frío.

Equipo: Intel i3-4170 @3.70 GHz (el mismo de la ronda anterior). `dist/` ya llevaba horas
compilado, por lo que Defender había terminado de analizarlo.

| Canal IPC                 | Mediana      | Mín   | Máx   | Repeticiones (ms)            | Spawns |
| ------------------------- | ------------ | ----- | ----- | ---------------------------- | ------ |
| `system:get-info`         | **1 693 ms** | 1 202 | 7 949 | 7949, 1693, 2090, 1202, 1224 | 1      |
| `drivers:scan`            | **2 440 ms** | 1 917 | 7 037 | 7037, 2620, 2243, 2440, 1917 | 1      |
| `bundles:check-installed` | **1 024 ms** | 886   | 5 897 | 5897, 1024, 886, 950, 1475   | 1      |

**Decisión: confirmar** los tres canales con estos números. La varianza **no** era de Defender
sobre `dist/`: era el **arranque en frío de `powershell.exe`**. La primera corrida de cada
canal cuesta 5,9–7,9 s (arranque del proceso y perfil) y las siguientes caen a 0,9–2,6 s; por
eso la mediana es la cifra honesta y el máximo corresponde a la primera corrida. Se **retiran**
los números anteriores que no se podían defender (`11 641 ms`, `31 457 ms`/`4 838 ms`,
`5 768 → 6 500 ms` y `3 336 → 742 ms`): el `742 ms` de `system:get-info` era un acierto de
caché, no el coste del canal en frío. Integridad confirmada en las 15 corridas (15/15 ok:
`cpu`/`mem` presentes, 90 dispositivos, 48 apps con 6 instaladas).

Reproducir:

```bash
node scripts/measure-ipc-channels.mjs --runs 5 --out docs/perf/ipc-channels-2026-10-02.json
```

### Métricas de UI / navegación (arranque, render, interacción)

Todo medido con `scripts/measure-ui-perf.mjs` (Playwright sobre el binario real
`dist/main/index.js`, 3 ciclos × 14 páginas = **42 navegaciones**, artefactos
`docs/perf/ui-metrics-baseline.json` = v0.4.0 y `docs/perf/ui-metrics-final.json` = después).

**Arranque hasta primera ventana** (3 lanzamientos por corrida):

| Métrica                                   | Baseline (v0.4.0)   | Después                | Δ     |
| ----------------------------------------- | ------------------- | ---------------------- | ----- |
| Primera ventana visible (`windowMs`, p50) | 915 ms              | **772 ms**             | −16 % |
| Primera ventana (valores)                 | 915 / 915 / 1093 ms | **772 / 793 / 740 ms** | —     |
| First Contentful Paint (p50)              | 800 ms              | **629 ms**             | −21 % |
| `DOMContentLoaded` (p50)                  | 380 ms              | **259 ms**             | −32 % |

**Navegación entre páginas** (42 navs, clic en sidebar → título de la página objetivo):

| Métrica (ms)                                              | Baseline            | Después         |
| --------------------------------------------------------- | ------------------- | --------------- |
| `readyMs` p50 / p95 / máx.                                | 2 / 18 / **1 542**  | 2 / 7 / **11**  |
| `settledMs` (navegación + IPC asentados) p50 / p95 / máx. | 3 / 915 / **7 359** | 3 / 24 / **87** |
| IPC total por navegación, máx.                            | 103 507 ms          | **19 966 ms**   |
| IPC máximo por navegación, máx.                           | 68 036 ms           | **13 472 ms**   |
| Título de página (`titleMs`), máx.                        | 11 ms               | 7 ms            |
| Errores de navegación                                     | 0                   | **0**           |

_Significado:_ `readyMs` es clic → página marcada lista; `settledMs` es clic → sin
actividad IPC pendiente. El p95 de `settledMs` **915 → 24 ms** y el máximo **7 359 → 87 ms**
son la mejora que el usuario percibe: antes una página podía quedar "colgada" esperando un
canal IPC de 30–70 s.

**Long tasks** (`PerformanceObserver('longtask')` desde el inicio del documento):

| Corrida  | Long tasks > 50 ms | Duraciones              |
| -------- | ------------------ | ----------------------- |
| Baseline | 2                  | **144 ms**, 53 ms       |
| Después  | 3                  | **65 ms**, 61 ms, 50 ms |

La máxima baja de **144 → 65 ms** y ninguna supera los 100 ms.

**Otras mediciones del harness:** interacción _Refresh_ del dashboard 1 688 → **744 ms**;
retención estable a lo largo de los 3 ciclos (heap p50 **10 MB**, listeners p50 ≈ 162,
DOM p50 114/121 nodos); `pageIssues` sin regresiones.

Reproducir:

```bash
npm run build
node scripts/measure-ui-perf.mjs --cycles 3            # → docs/perf/ui-metrics-final.json
node scripts/measure-ui-perf.mjs --out docs/perf/x.json
```

### FPS / frame timing (scroll)

Lo único que la ronda anterior dejó **sin medir** y lo que la queja original percibía como
"lento". Se instrumentó con el **mismo harness** (`scripts/measure-ui-perf.mjs`, ampliado con
`requestAnimationFrame` y un modo `--fps-only`): un scroll programático **arriba→abajo** con
el mismo número de pasos y el mismo viewport por vista, muestreando el intervalo real entre
frames (`FPS = 1000 / Δframe`). _Frames perdidos_ = intervalos > 33,3 ms (2 frames a 60 Hz).
Toda la instrumentación vive **en el script de medición, no en `src/`** (verificado con
`git diff`).

Aclaración de la premisa: la vista de **500 filas** es la lista **virtualizada de Drivers**, no
Tweaks — el catálogo real de Tweaks tiene **19 entradas** (array `TWEAKS` en
`src/main/services/tweaks.ts`, servido por `tweaks:get`). Las 500 filas se inyectan en el
`ipcMain` del binario real en tiempo de medición (`drivers:scan` → payload sintético), sin tocar
código de producción. Apps y Bundles usan sus datos reales.

| Vista (filas)                           | Frames | p50 FPS  | p95 FPS | mín FPS  | Frames perdidos (>33,3 ms) | Peor frame | Nodos DOM |
| --------------------------------------- | ------ | -------- | ------- | -------- | -------------------------- | ---------- | --------- |
| **Drivers (500, virtualizada)**         | 100    | **59,9** | 59,5    | 59,2     | **0**                      | 16,9 ms    | 250       |
| **Tools → Apps (instaladas, 14471 px)** | 100    | **59,9** | 58,1    | **19,9** | **2**                      | 50,2 ms    | 1 866     |
| **Bundles (48 apps)**                   | 99     | **59,9** | 59,5    | 58,5     | **0**                      | 17,1 ms    | 495       |
| **Tweaks (19)**                         | 99     | **59,9** | 58,8    | 58,1     | **0**                      | 17,2 ms    | 413       |

**Lectura:** todas las vistas se mantienen a **~60 FPS (vsync)** durante el scroll. La
virtualización hace su trabajo donde importa: la lista de **500 filas** renderiza 250 nodos y
**no pierde ni un frame**. El único caso con _jank_ es **Tools → Apps** (lista no virtualizada,
1 866 nodos): 2 frames perdidos y un peor frame de 50,2 ms — un tirón puntual, no un problema
sostenido. Tweaks entra como referencia (19 filas): fluido. Es decir, el scroll **no** es el
cuello de botella que percibía la queja; lo eran los canales IPC (ya corregidos, § arriba).

Reproducir:

```bash
node scripts/measure-ui-perf.mjs --fps-only --rows 500 --out docs/perf/ui-scroll-fps-2026-10-02.json
```

### Qué se optimizó

1. **`services:get-all`** — un proceso PowerShell por servicio → un solo proceso con
   lote CIM bulk (`system-services.ts`).
2. **`privacy:get-settings`** — 17 lookups de registro en 17 procesos → un proceso
   (`security-privacy.ts`).
3. **`dns:benchmark`** — sondeo de servidores en serie → `Promise.all`.
4. **`audit:run`** — el grueso del coste: 31 `runPowerShell` (31 procesos) → **1 proceso**
   con marcadores `@@FCHK_<i>@@`; `splitAuditOutput` trocea la salida y reparte cada
   payload a su check respetando el orden. Test de regresión: 1 llamada, 31 marcadores,
   comando < 12 000 caracteres (el límite real de CreateProcess son 32 767 chars en
   UTF-16 antes del base64).

Por qué 1 proceso y no paralelismo: los 31 comandos cronometrados **dentro de un proceso**
suman **5 854 ms** (network 2 637 · startup 1 061 · storage 840 · performance 361 ·
privacy 167 · memory 154). El resto de los 7 789 ms medidos es arranque del proceso y
escritura: no queda overhead por recortar. Lanzar los 6 grupos en paralelo sólo pasó de
73 s a 63 s, porque 6 `powershell.exe` simultáneos se pelean por los mismos 4 hilos.

Corrección derivada del TDD: un payload no-JSON en el bloque de startup hacía
`JSON.parse` lanzara y **rechazaba toda la auditoría** (bug preexistente, v0.4.0). Ahora
`countFromJson` degrada a 0 sin tocar al resto de los 30 checks.

---

## Ronda v0.4.2 — virtualización de Tools·Apps y FPS bajo carga

### Virtualización de la lista de apps instaladas

La medición de scroll de v0.4.1 encontró un único foco de _jank_: **Tools → Apps**
(lista **no** virtualizada, 1 866 nodos, 2 frames perdidos, peor frame 50,2 ms). En
v0.4.2 se virtualiza con el **mismo** componente que ya usaba Drivers (`VirtualList` de
`@tanstack/react-virtual`, umbral de 50 filas, igual que Drivers), sin introducir una
segunda forma de virtualizar. La fila se extrajo a un `AppRow` memoizado.

| Métrica (Tools → Apps, 48 apps reales / 500 sintéticas) | v0.4.1      | v0.4.2          |
| ------------------------------------------------------- | ----------- | --------------- |
| Nodos DOM (48 apps instaladas reales)                   | **1 866**   | **331**         |
| Nodos DOM (lista sintética de 500)                      | 1 866+      | **< 120 filas** |
| Frames perdidos (scroll a 60 FPS)                       | **2**       | **0**           |
| Peor frame                                              | **50,2 ms** | 17,0 ms         |

Verificado por `e2e/performance.spec.ts` (nueva aserción: 500 apps → filas DOM < 120).

### FPS bajo carga real de CPU (pendiente #1)

Medido con el soporte nuevo `--load <canal>` de `scripts/measure-ui-perf.mjs`: mantiene
un canal IPC pesado **en vuelo durante todo el scroll** y muestrea el intervalo real
entre frames. `audit:run` tarda ~11,5 s y cubre toda la ventana de scroll (~1,5 s), así
que el solapamiento es real (el FPS con carga se mide mientras PowerShell compite por los
4 hilos). Equipo: Intel i3-4170 (4 hilos). Artefactos:
`docs/perf/ui-scroll-fps-at-rest-0.4.2.json`, `docs/perf/ui-scroll-fps-under-audit-0.4.2.json`,
`docs/perf/ui-scroll-fps-under-drivers-0.4.2.json`.

En **reposo** (dos corridas; la primera paga el arranque en frío de Chromium — 6 frames
perdidos en Drivers —, la segunda — ya caliente — no pierde ninguno):

| Vista                       | p50 FPS | p95  | mín  | Frames perdidos | Peor frame |
| --------------------------- | ------- | ---- | ---- | --------------- | ---------- |
| Drivers (500, virtualizada) | 59,9    | 59,5 | 58,8 | **0**           | 17,0 ms    |
| Tools → Apps (real)         | 59,9    | 59,5 | 59,5 | **0**           | 16,8 ms    |
| Bundles (48)                | 59,9    | 59,5 | 59,2 | **0**           | 16,9 ms    |
| Tweaks (19)                 | 59,9    | 59,5 | 59,2 | **0**           | 16,9 ms    |

**Bajo `audit:run` en vuelo** (11,5 s):

| Vista               | p50 FPS | p95  | mín  | Frames perdidos | Peor frame |
| ------------------- | ------- | ---- | ---- | --------------- | ---------- |
| Drivers (500)       | 59,9    | 59,5 | 59,2 | **0**           | 16,9 ms    |
| Tools → Apps (real) | 59,9    | 59,5 | 58,1 | **0**           | 17,2 ms    |
| Bundles (48)        | 59,9    | 59,5 | 59,2 | **0**           | 16,9 ms    |
| Tweaks (19)         | 59,9    | 59,2 | 58,5 | **0**           | 17,1 ms    |

**Bajo `drivers:scan` en vuelo** (~1,67 s): idéntico — 60 FPS, **0** frames perdidos en
las 4 vistas (peor frame 16,9 ms).

**Lectura:** con la lista de Apps ya virtualizada, **un `audit:run`/`drivers:scan` en
paralelo no degrada el scroll**. El _jank_ de Tools → Apps de v0.4.1 era **coste de
render** (1 866 nodos en el renderer), no contención de CPU del escaneo: al eliminarlo, la
carga de PowerShell deja de importar para los frames. La contención de CPU había sido la
hipótesis; la medición la refuta.

### Main thread del renderer vs compositor (pendiente #2)

**No se pudo separar, y se reporta como tal.** El harness mide el intervalo real entre
frames vía `requestAnimationFrame`, que es el presupuesto de **main thread del renderer**;
si el main thread se atasca, el frame se retrasa — pero esa señal no distingue el coste de
_layout/paint_ del renderer del de _rasterización/composición_ de la GPU. Las vías nativas
de Electron que habrían permitido separarlos (`--enable-logging` + trace de `viz`,
`app.getGPUFeatureStatus`, `gpu:info`) tendrían que ejecutarse contra el binario real y
limpiar el ruido de arranque; no se hizo dentro del alcance. Sin esa instrumentación, la
atribución renderer-vs-compositor sería especulación, así que **no se reporta un número**.

Lo que sí se puede afirmar con la evidencia actual: el peor frame bajo carga (17,2 ms) es
< 33,3 ms (2 frames a 60 Hz) ⇒ no hay long tasks que lleguen a perderse por **ninguno** de
los dos lados en las mediciones tomadas.

### Pendiente / no instrumentado

- **FPS de scroll / frame timing**: ✅ **medido** — ver § _FPS / frame timing (scroll)_.
- **`drivers:scan`, `bundles:check-installed`, `system:get-info`**: ✅ **re-medidos** con
  ≥5 repeticiones — ver § _Canales re-medidos_.
- **FPS bajo carga real de CPU** (scroll _mientras_ corre un `audit:run`/`drivers:scan`):
  ✅ **medido en v0.4.2** — ver § _Ronda v0.4.2 → FPS bajo carga real de CPU_; 60 FPS y 0
  frames perdidos con el scan en vuelo (la virtualización de Tools·Apps eliminó el único
  _jank_ que quedaba).
- **Coste de GPU / compositor** (separar renderer de compositing): ❌ **no se pudo**
  separar con la instrumentación disponible (`requestAnimationFrame` mide el main thread
  del renderer, no la GPU). Reportado explícitamente en § _Ronda v0.4.2 → Main thread del
  renderer vs compositor_; **no** se reporta un número inventado.
- `backgroundThrottling`: se mantuvo el default seguro de Electron (no se desactiva).

## Ronda v0.11.0 — Fase 1 del PLAN_MEJORAS (8 ítems)

> Método: mismo que las rondas anteriores — servicios **compilados reales**
> (`dist/main/services/*`) contra **PowerShell real**, spawns contados en el
> único `runPowerShell`, una repetición fría + cálidas donde se indica.
> Harness nuevo y reutilizable: `scripts/measure-fase1.mjs`
> (`--out docs/perf/fase1-v0.11.json`). El "antes" es el mismo harness contra
> un worktree limpio de `HEAD` v0.10.2 (`docs/perf/fase1-v0.10-baseline.json`).
> UI real vía `scripts/measure-ui-perf.mjs` (`docs/perf/ui-perf-v0.11.json`,
> `docs/perf/ui-fps-v0.11.json`). Nada de lo aquí citado es estimado: cada
> número tiene su muestra en `docs/perf/`.

### Tabla antes/después por ítem (1.1–1.7)

| Ítem                                         | Antes (v0.10.2, medido)                                                                                   | Después (v0.11.0, medido)                                                                                                                                                             | Efecto                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1.1 `dns:benchmark` TTL + tab bajo demanda   | Sin caché; cada visita a Security pagaba el benchmark (~13,3 s frío, 5 spawns)                            | TTL 90 s: 1.ª 14,2 s/5 spawns → 2.ª **0 ms/0 spawns**, payload idéntico; la tab DNS solo mide al abrirse                                                                              | Visitar Security ya no espera ~12 s          |
| 1.2 SWR (Dashboard/Audit/Boost/Tools)        | Acción principal = lectura fría (Audit/Security forzaban frío)                                            | Primera pintura desde caché + revalidación `force:true` silenciosa; navegación medida 2–4 ms/página con el IPC en fondo                                                               | Pintura ~instantánea en cálido               |
| 1.3 `apps:get-installed` 3→1 spawn           | **3** spawns seriales, [9131, 3712] ms, 221 apps                                                          | **1** spawn, [5003, 2115] ms, **221 apps** (mismo conteo)                                                                                                                             | −2 arranques de proceso por lectura          |
| 1.4 `benchmark:run` 19→1–2 spawns + TTL 60 s | **20** spawns, **128925 ms** (~129 s), 15 resultados                                                      | **1** spawn (2 con adaptador frío), **62005 ms** (~62 s), 15 resultados, misma matemática de scores                                                                                   | ~2× más rápido; re-lecturas en TTL = 0 ms    |
| 1.5 Virtualizar Cleaner (+ Startup/Debloat)  | `MAX_FILES_PER_TARGET=5000` sin virtualizar → miles de nodos DOM                                          | Mismo `VirtualList` (umbral 50) en Cleaner/Startup/Debloat; 5000 archivos → ventana montada <200 filas (test); scroll real 500 filas: p50 **59,9 FPS**, p95 56,8                      | DOM acotado, 60 FPS                          |
| 1.6 `cleaner:delete` N→1 spawn               | **10** spawns, **24801 ms** para 10 archivos (scratch)                                                    | **1** spawn, **2157 ms**, 10/10 borrados verificados, 0 restantes                                                                                                                     | ~11× más rápido, reporte por archivo intacto |
| 1.7 Timeouts DNS + adaptador cacheado        | `Test-Connection -Count 4` sin cap; 1 spawn de adaptador **por llamada** (3 llamadas = 3 spawns, 8949 ms) | `-Count 2` + race 10 s por servidor (servidor colgado → latencia 0 honesta, resto idéntico al baseline: 25/33/105/118 vs 24/33/106/118); adaptador 3 llamadas = **1** spawn (4751 ms) | Ningún servidor cuelga el benchmark          |

Muestras (ms) — `apps:get-installed`: antes `[9131, 3712]` → después
`[5003, 2115]` (221 apps en ambas). `cleaner:delete` ×10 scratch: antes
`24801` (10 spawns) → después `2157` (1 spawn), `remaining=0` en ambas.
`benchmark:run`: antes `128925` (20 spawns) → después `62005` (1 spawn);
el trabajo útil (jobs CPU, loop 100 MB, I/O, ping) es el mismo método, el
ahorro es el overhead de 19 arranques de `powershell.exe`.
`dns:benchmark` frío con red sana ≈ 13 s en ambas versiones (5 pings
paralelos reales); con un servidor colgado el después degrada ese servidor
a 0 en ≤10 s en vez de arrastrar el total (medido: Cloudflare 0 con el
resto 25/33/105/118, casi idéntico al baseline 6/24/33/106/118).

### UI medida (app real, `measure-ui-perf.mjs --cycles 1`)

- Arranque: frío `windowMs` 9228 / FCP 5265 ms; cálido 880/800 ms.
- Navegación por las 14 páginas: **2–4 ms** por título con el IPC
  resolviéndose en fondo (p. ej. `audit` 8,3 s frío, `cleaning` 13,3 s) —
  la página pinta sin esperar al canal (efecto SWR 1.2).
- Scroll 500 filas (`--fps-only`): p50 **59,9 FPS**, p95 56,8, peor frame
  17,6 ms (< 2 frames a 60 Hz).

### Qué NO cambió (y por qué)

- `drivers:scan`, `bundles:check-installed`, `system:get-info` no los tocó
  la Fase 1; sus re-mediciones (`docs/perf/ipc-channels-v0.11.json`: medians
  1981/941/609 ms en máquina caliente vs 7059/2526/8098 ms del baseline en
  frío) reflejan estado térmico, no una mejora — se reportan como contexto,
  no como logro.
- El frío de `benchmark:run` sigue en ~60 s porque el método de medición
  (jobs CPU, 100 MB, I/O real) no cambió a propósito: la Fase 1 elimina
  overhead de procesos, no trabajo de medición. Cambiar el método sería
  Fase 5 (pool de PowerShell).

_Build. Learn. Evolve._
