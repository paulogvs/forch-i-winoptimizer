# FORCH.iA WinOptimizer — Performance

Mediciones de la optimización de rendimiento introducida en **v0.3.0** (fases P0–P3).

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

## Pendiente / no instrumentado

- **Long Tasks y FPS de scroll**: no se capturaron con DevTools Performance en este entorno.
  La virtualización y el chunked reveal están verificados por conteo de DOM (< 120 filas para 500),
  no por frame timing. Queda como medición recomendada en un equipo con perfilador.
- `backgroundThrottling`: se mantuvo el default seguro de Electron (no se desactiva).

*Build. Learn. Evolve.*
