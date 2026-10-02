# Startup Impact — criterio dinámico (sin listas de apps)

> **FORCH.iA WinOptimizer v0.7.0** — clasificación de apps de arranque por señales.
>
> Built with FORCH.i by Paulo Velasco.

La pestaña **Boost** (arranque) muestra las entradas de inicio reales de la PC y las
clasifica en **low / medium / high** impacto. La clasificación **no** usa ninguna lista
de productos, marcas ni antivirus: se deriva **solo de señales observables** de tu
máquina, así que el resultado es válido en cualquier PC y cambia si cambia el sistema.

Código: `src/main/services/startup-impact.ts` (clasificador puro y testeable) +
`src/main/services/startup-apps.ts` (enumeración real vía un único proceso PowerShell).

## Señales observadas

La enumeración lee, por entrada:

| #   | Señal                             | Cómo se obtiene                                                                                                    | Peso                                                                       |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 1   | **Origen / persistencia**         | Run HKCU, Run HKLM (64 + WOW6432Node), carpeta Startup, tarea programada raíz, servicio auto en ejecución          | HKLM +1 · tarea +2 · servicio +3                                           |
| 2   | **Ruta protegida del sistema**    | el binario destino vive bajo `System32` / `SysWOW64` / `Windows` / `Microsoft`                                     | +1                                                                         |
| 3   | **Firma del binario**             | `Get-AuthenticodeSignature` sobre el `.exe` destino (y su `CN=` como _publisher_)                                  | sin firmar +3 · no verificable +1                                          |
| 4   | **Huella real medida**            | si el proceso está **corriendo ahora**: CPU (`TotalProcessorTime`) y working set, leídos en vivo con `Get-Process` | CPU ≥300s +3 / ≥60s +2 / ≥5s +1 · RAM ≥300MB +2 / ≥100MB +1 · corriendo +1 |
| 5   | **Gramática genérica del nombre** | tokens genéricos `update`, `updater`, `helper`, `tray`, `sync`, `launcher`, `daemon`, `watchdog`, `background`     | +1                                                                         |

> La señal 5 son **patrones genéricos de forma de software** (updaters, helpers,
> agentes de bandeja, motores de sync, lanzadores), **nunca** una lista de productos.
> Un "Totally Unknown Vendor Tool" con token `updater` puntúa igual que cualquier otro
> updater del mundo.

## Umbrales

```
score >= 6  → high
score >= 3  → medium
score <  3  → low
```

Cada resultado devuelve además **`reasons`** (las señales que contribuyeron, en texto)
para que el usuario vea _por qué_ una entrada es high, y **`publisher`** (el `CN=` real
de la firma, o `Unknown`). Si no se observó ninguna señal, se informa
`"no impacting signals were observed"` — nunca se inventa un motivo.

## Por qué es útil en cualquier PC

- **Nada de nombres.** No hay arrays de productos/AV/marcas (la versión anterior
  tenía ~90 nombres hardcodeados; fueron eliminados).
- **El resultado depende del estado del sistema:** una entrada es _high_ si su
  proceso está corriendo y consume CPU/RAM, si corre como servicio, o si su binario
  no está firmado. Eso es distinto en cada máquina y en cada momento.
- **Degrada con honestidad:** si un binario no existe en disco, se reporta
  (`target binary was not found on disk`) en vez de clasificar a ciegas.

## Garantía anti-hardcoding

Un test (`src/main/services/startup-impact.test.ts`) usa a propósito un **vendor
inexistente** en todo el árbol (`Totally Unknown Vendor Tool` / `TotallyUnknownVendor`)
y verifica que:

1. se clasifica **low** estando firmado y en reposo, y **high** cuando se mide
   consumiendo recursos (`running`, CPU 400 s, RAM 500 MB) — el impacto cambia por
   señales, no por nombre;
2. dos nombres distintos con **idénticas señales** producen el **mismo** impacto;
3. sube el impacto si el binario **no está firmado** o vive bajo una **ruta del
   sistema**;
4. los orígenes _machine-wide_ (HKLM, servicio) pesan más que los _per-user_.

Para auditar que no queda ninguna lista de productos:

```bash
rg -i "teams|spotify|avast|norton|nvidia|razer|highImpactApps|mediumImpactApps" src
# → sin coincidencias relevantes (solo falsos positivos como "manufacturer")
```
