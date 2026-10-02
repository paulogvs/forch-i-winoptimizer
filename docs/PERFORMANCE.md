# FORCH.iA WinOptimizer — Performance

Mediciones de la optimización de rendimiento: **v0.3.0** (fases P0–P3) y la ronda de
diagnóstico de latencia UI sobre **v0.4.0 → v0.4.1** (§ *Ronda de diagnóstico UI* al final:
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

| Métrica | Antes (v0.2.3) | Después (v0.3.0) |
|---|---|---|
| Procesos PowerShell por scan | **4** | **1** |
| Tiempo (media, medido) | **8.34 s** | **3.31 s** |
| Primera ejecución en frío | 20.19 s | 5.81 s |
| Mejora | — | **~60 % más rápido** |

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

| Métrica | Antes (P0.1–P0.3) | Después (P0.4) |
|---|---|---|
| Sistema cálido (media) | **~1750 ms** | **615 ms** |
| Primera ejecución en frío | 7276 ms | 4031 ms |
| Spawns PowerShell (legacy) | 4 | 3 |
| Mejora (cálido) | — | **~65 % más rápido** |

Muestras (ms) medidas con `node scripts/measure-system-info.mjs`:

- Batch (1 spawn): `4031, 616, 614` → media **1754 ms**
- Legacy (3 spawns): `5812, 945, 956` → media **2571 ms**

El delta cálido (~1135 ms) coincide con el coste medido del propio `Win32_Processor`, validando
el diagnóstico. CPU usage antes = `LoadPercentage` de CIM (instantánea); ahora = promedio de
uso sobre la ventana de 200 ms (más preciso y sin coste).

## Drivers / Junk — motor sin cambios + caché (P1.2)

El motor de escaneo no cambió (sigue siendo 1 spawn cada uno); la mejora es la **caché TTL**:

| Scan | Primera pasada | Repetición dentro del TTL |
|---|---|---|
| Drivers | ~4.4–10.8 s (1 spawn) | **≈ instantáneo** (TTL 5 min) |
| Junk / Cleaner | ~6.2 s (1 spawn) | **≈ instantáneo** (TTL 30 s) |
| System Info | ~2.0–5.8 s (1 spawn) | **≈ instantáneo** (TTL 60 s) |

La caché se invalida explícitamente tras Clean, Apply, toggle de servicios/startup y `Refresh`.

## Virtualización y render (P0.4 / P3)

| Métrica | Antes | Después |
|---|---|---|
| Filas en DOM para una lista de 500 drivers | 500 | **< 120** (virtualizado + chunked reveal) |
| Render inicial | todas las filas | **30 filas** y crecimiento progresivo |
| Trabajo fuera de viewport | completo | `content-visibility: auto` en secciones largas |

Verificado en navegador real por `e2e/performance.spec.ts`.

## Correcciones de fluidez (P0.2 / P0.3)

- Estados `loading / empty / error` coherentes por sección (sin spinners infinitos).
- Progreso por etapas con throttle de 180 ms (evita spam de eventos IPC).
- Animaciones decorativas pausadas durante scans (`data-scanning`).

## Huella de la app (portable v0.3.0, en reposo)

Medido con `Get-Process` sobre el portable elevado, ~35 s después del arranque:

| Métrica | Valor |
|---|---|
| Procesos Electron | 4 (main + renderer + GPU + utility) |
| RAM en reposo (WorkingSet total) | **≈ 330 MB** |
| CPU acumulada en ~35 s | ≈ 3.5 s (pico en startup, luego ocioso) |

## Free RAM (P1.1)

Acción rápida en el header (`memory:free`, serializada por el mutex global): recorta el
working set del proceso principal + hijos con `EmptyWorkingSet` (psapi.dll vía
`Add-Type`), con fallback a GC de .NET si psapi no está disponible. El `freedMb`
reportado es la diferencia de `process.memoryUsage().rss` medida en Node.

**Medido con `node scripts/measure-free-memory.mjs`** (proceso con ~266 MB de RSS):

| Muestra | RSS antes | RSS después | RAM liberada | Wall-clock |
|---|---|---|---|---|
| 1 | 266.3 MB | 12.8 MB | **253 MB** | 3125 ms |
| 2 | 266.2 MB | 12.7 MB | **254 MB** | 3028 ms |

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

| Canal IPC | Antes (v0.4.0) | Después | Δ |
|---|---|---|---|
| `audit:run` (1ª llamada, en frío) | **72 991 ms** | **7 789 ms** | **−89 %** |
| `services:get-all` | 61 687 ms (timeout a 60 s → `[]`) | **2 779 ms** | −95 % |
| `privacy:get-settings` | 35 696 ms | **2 276 ms** | −94 % |
| `dns:benchmark` | 27 204 ms | **12 754 ms** | −53 % |

Integridad de la auditoría tras el batching (sonda de detalle): **31 checks**, 0 payloads
vacíos, 25 pass / 4 warning / 2 critical, score 50. Payload total 7 401 B → 7 402 B
(mismo contenido que el baseline).

Desde el harness de UI completo (`scripts/measure-ui-perf.mjs`, 3 ciclos × 14 páginas =
42 navegaciones, **máximo por canal** sobre `summary.worstIpc`):

| Canal IPC | Baseline (v0.4.0) | Después | Δ |
|---|---|---|---|
| `audit:run` | 76 635 ms (en baseline nunca terminaba dentro de la ventana) | **9 273 ms** | **−88 %** |
| `services:get-all` | 68 036 ms | **3 935 ms** | −94 % |
| `dns:benchmark` | 35 470 ms | **13 472 ms** | −62 % |
| `apps:get-installed` | 17 087 ms | **10 572 ms** | −38 % |
| `cleaning:get-history` | 4 647 ms | **2 493 ms** | −46 % |
| `cleaning:get-schedules` | 5 009 ms | **4 194 ms** | −16 % |
| Interacción *Refresh* del dashboard | 1 688 ms | **744 ms** | −56 % |

Otras señales de fluidez (mismo harness):

| Métrica | Baseline | Después |
|---|---|---|
| Errores de navegación | 0 | **0** |
| Long tasks > 50 ms (máx. duración) | 2 (144 ms) | 3 (**65 ms**) |
| `drivers:scan` | 11 641 ms | no concluyente (31 457 ms en una corrida en frío, 4 838 ms en otra: varianza de Defender sobre `dist/`) |

No concluyente (medido pero con varianza insuficiente para afirmar): `drivers:scan`,
`bundles:check-installed` (5 768 → 6 500 ms) y `system:get-info` (3 336 → 742 ms en una
muestra; requiere más repeticiones).

### Métricas de UI / navegación (arranque, render, interacción)

Todo medido con `scripts/measure-ui-perf.mjs` (Playwright sobre el binario real
`dist/main/index.js`, 3 ciclos × 14 páginas = **42 navegaciones**, artefactos
`docs/perf/ui-metrics-baseline.json` = v0.4.0 y `docs/perf/ui-metrics-final.json` = después).

**Arranque hasta primera ventana** (3 lanzamientos por corrida):

| Métrica | Baseline (v0.4.0) | Después | Δ |
|---|---|---|---|
| Primera ventana visible (`windowMs`, p50) | 915 ms | **772 ms** | −16 % |
| Primera ventana (valores) | 915 / 915 / 1093 ms | **772 / 793 / 740 ms** | — |
| First Contentful Paint (p50) | 800 ms | **629 ms** | −21 % |
| `DOMContentLoaded` (p50) | 380 ms | **259 ms** | −32 % |

**Navegación entre páginas** (42 navs, clic en sidebar → título de la página objetivo):

| Métrica (ms) | Baseline | Después |
|---|---|---|
| `readyMs` p50 / p95 / máx. | 2 / 18 / **1 542** | 2 / 7 / **11** |
| `settledMs` (navegación + IPC asentados) p50 / p95 / máx. | 3 / 915 / **7 359** | 3 / 24 / **87** |
| IPC total por navegación, máx. | 103 507 ms | **19 966 ms** |
| IPC máximo por navegación, máx. | 68 036 ms | **13 472 ms** |
| Título de página (`titleMs`), máx. | 11 ms | 7 ms |
| Errores de navegación | 0 | **0** |

*Significado:* `readyMs` es clic → página marcada lista; `settledMs` es clic → sin
actividad IPC pendiente. El p95 de `settledMs` **915 → 24 ms** y el máximo **7 359 → 87 ms**
son la mejora que el usuario percibe: antes una página podía quedar "colgada" esperando un
canal IPC de 30–70 s.

**Long tasks** (`PerformanceObserver('longtask')` desde el inicio del documento):

| Corrida | Long tasks > 50 ms | Duraciones |
|---|---|---|
| Baseline | 2 | **144 ms**, 53 ms |
| Después | 3 | **65 ms**, 61 ms, 50 ms |

La máxima baja de **144 → 65 ms** y ninguna supera los 100 ms.

**Otras mediciones del harness:** interacción *Refresh* del dashboard 1 688 → **744 ms**;
retención estable a lo largo de los 3 ciclos (heap p50 **10 MB**, listeners p50 ≈ 162,
DOM p50 114/121 nodos); `pageIssues` sin regresiones.

Reproducir:

```bash
npm run build
node scripts/measure-ui-perf.mjs --cycles 3            # → docs/perf/ui-metrics-final.json
node scripts/measure-ui-perf.mjs --out docs/perf/x.json
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

### Gates frescos (post-cambios)

- `npx vitest run` → **328/328** (36 archivos), exit 0
- `npx tsc --noEmit` → exit 0
- `npx eslint . --max-warnings 0` → exit 0
- `npm run build` → exit 0

## Pendiente / no instrumentado

- **FPS de scroll / frame timing**: **no medido**. La virtualización y el chunked reveal están
  verificados por conteo de DOM (< 120 filas para 500), no por frames renderizados. Queda
  como medición recomendada en un equipo con perfilador.
  *(Sí se midieron **long tasks** con `PerformanceObserver('longtask')` — ver tabla
  144 → 65 ms en § Métricas de UI / navegación.)*
- **`drivers:scan`, `bundles:check-installed`, `system:get-info`**: medidos pero
  **no concluyentes** por varianza de Defender sobre el binario recién compilado; requieren
  más repeticiones para afirmar.
- `backgroundThrottling`: se mantuvo el default seguro de Electron (no se desactiva).

*Build. Learn. Evolve.*
