# FORCH.iA WinOptimizer — Guía de Usuario

> **Novedades v0.10.0** — el cuarto **auto-fix reversible** llega al catálogo:
> `smb-signing` ahora exige firma SMB en servidor y cliente
> (`RequireSecuritySignature` / `EnableSecuritySignature` = `$true`) con preview,
> confirmación, **revert exacto** (restaura ambos valores capturados, incluido
> `absent`) y re-lectura de verificación. Además, el portable estable vive en una
> carpeta sin versión (`C:\Users\paulo\Apps\FORCH.iA WinOptimizer\`) para que el
> acceso directo no se rompa con cada release. Ver `docs/SECURITY_CHECKS.md`.

## Tabla de Contenidos

1. [Introducción](#introducción)
   - [Mutex global de operaciones](#mutex-global-de-operaciones)
2. [Instalación](#instalación)
3. [Módulos](#módulos)
   - [Dashboard](#dashboard)
   - [Quick fixes (1 clic)](#quick-fixes-1-clic)
   - [Cleaner](#cleaner)
   - [Boost](#boost)
   - [Bundles](#bundles)
   - [Tools](#tools)
   - [Tweaks](#tweaks)
   - [Security](#security)
   - [Statistics](#statistics)
   - [Settings](#settings)
4. [Atajos de Teclado](#atajos-de-teclado)
5. [FAQ](#faq)
6. [Solución de Problemas](#solución-de-problemas)

---

## Introducción

**FORCH.iA WinOptimizer** es una aplicación de optimización para Windows desarrollada con Electron, TypeScript y React. Te permite limpiar archivos basura, gestionar servicios del sistema, controlar aplicaciones de inicio y monitorear el rendimiento de tu PC.

### Características principales

- **Limpieza de archivos basura** — Elimina archivos temporales, caché, logs y más
- **Optimización de inicio** — Gestiona aplicaciones que inician con Windows
- **Gestión de servicios** — Controla servicios de Windows para mejorar rendimiento
- **Monitoreo del sistema** — CPU, RAM, disco y GPU en tiempo real
- **Gestión de apps** — Desinstalar aplicaciones fácilmente
- **Seguridad** — Auditoría de seguridad del sistema
- **Tweaks seguros** — 19 ajustes de rendimiento/privacidad/Explorer/accesibilidad, reversibles y con vista previa
- **Debloat** — 30 paquetes UWP preinstalados con niveles safe/caution/protected (los protected nunca se remueven)
- **Bundles** — 8 bundles y 48 apps instalables en bloque vía `winget`
- **Free RAM** — Botón ⚡ en el header: libera al instante la RAM que ocupa **la propia app** (recorta el _working set_ de sus procesos, main + renderizadores, sin tocar la de otros programas) y muestra cuánto liberó con el alcance explícito (`Freed N MB (this app: A→B MB)`, se resetea a los 3 s). **Decisión explícita:** no se recorta memoria de otros procesos — Windows gestiona la RAM del sistema y recortarla a la fuerza puede empeorar el rendimiento. **Medido:** RSS **266 → 13 MB (~253 MB liberados)** en ~3 s
- **Mutex global de operaciones** — Una operación del sistema a la vez (ver [Mutex global de operaciones](#mutex-global-de-operaciones))
- **Multi-idioma** — Español e Inglés
- **Temas** — Oscuro, claro y más

### Controles de ventana

La ventana es _frameless_ con controles propios en la esquina superior derecha
(estilo Windows 11):

- **Minimizar** — envía la ventana a la barra de tareas
- **Maximizar / Restaurar** — alterna el tamaño; el ícono cambia según el estado
- **Cerrar** — cierra la aplicación (hover rojo)

Podés **arrastrar la ventana** desde la barra superior o desde el encabezado del menú
lateral. Los botones de control y los campos de búsqueda no arrastran. Todos los botones
son accesibles por teclado (`Tab` + `Enter`/`Espacio`, con anillo de foco visible).

### Mutex global de operaciones

Las acciones que modifican el sistema (aplicar tweaks, instalar/desinstalar apps, limpiar,
remover bloatware, Free RAM…) pasan por una **cola única**: **una operación a la vez, en
orden FIFO**. Así nunca corren dos procesos conflictivos juntos (por ejemplo, un tweak y
una limpieza escribiendo a la vez).

- Mientras una operación corre, los botones de acción se **deshabilitan automáticamente**
  en los módulos implicados. **Eso es normal**, no es un error: se reactivan solos.
- En el header aparece un **badge con punto pulsante** que identifica la operación en
  curso: **"Applying tweak…"**, **"Installing apps…"**, **"Removing apps…"**,
  **"Freeing RAM…"**, etc. (`data-testid="op-status"`).
- Si otras operaciones están esperando, el badge muestra **"+N queued"**; se ejecutan en
  orden cuando se libera la cola.
- El badge desaparece al terminar, **incluso si la operación falla** (el error se muestra
  en el módulo que lo disparó). Si el badge siguiera visible con la app responsiva
  durante mucho tiempo, cerrá y volvé a abrir la app.

---

## Instalación

### Requisitos

- Windows 10 o Windows 11
- 4 GB de RAM (mínimo)
- 100 MB de espacio en disco

### Instalación desde binario

1. Descarga el instalador `.exe` desde la [página de releases](https://github.com/paulogvs/forch-i-winoptimizer/releases)
2. Ejecuta el instalador
3. Sigue las instrucciones en pantalla

Por defecto la instalación es **por usuario** (`%LOCALAPPDATA%\Programs\FORCH.iA WinOptimizer`)
y no requiere elevación. Para instalarla sin interfaz:

```powershell
# Per-user (recomendado, sin UAC)
.\FORCH.iA-WinOptimizer-Setup-0.10.0.exe /S /currentuser

# Desinstalación silenciosa
& "$env:LOCALAPPDATA\Programs\FORCH.iA WinOptimizer\Uninstall FORCH.iA WinOptimizer.exe" /S
```

> **Limitación conocida:** `Setup.exe /S` a secas deja que el instalador NSIS elija el modo
> "todos los usuarios" y **pida elevación (UAC)**; en un contexto sin escritorio interactivo
> puede fallar. Pasá siempre `/currentuser` para forzar el modo por usuario.

### Actualización automática (build instalable)

La build **instalable (NSIS)** incluye `electron-updater` contra GitHub Releases; la build
**portable** no puede auto-actualizarse (el toggle _Automatic updates_ se deshabilita).

1. Activá _Settings → General → Automatic updates_ (se guarda en `settings.json` del userData).
2. El updater revisa al iniciar y cada 4 horas, o al pulsar _Check now_ en _Settings → Updates_.
3. Cuando hay versión nueva: _Download_ → _Restart & install_ (aparece también un diálogo
   nativo "Restart Now / Later").
4. La app se cierra, el instalador se aplica en silencio y la app se reabre ya actualizada.

Flujo verificado end-to-end (2026-10-03): instalado **0.9.1** → detectó **0.10.0** → descargó el
Setup publicado (sha256 idéntico al de `checksums.sha256`) → reinició → el `.exe` instalado quedó
con `FileVersion` **0.10.0**.

### Instalación portable

1. Descarga el archivo `FORCH.iA-WinOptimizer-Portable-X.X.X.exe`
2. Ejecuta directamente (no requiere instalación)

### Actualizar el portable estable (acceso directo del escritorio)

Para que el acceso directo del escritorio no se rompa en cada versión, el
portable "de uso diario" vive en una carpeta **estable** con un nombre **sin
versión**:

```
C:\Users\paulo\Apps\FORCH.iA WinOptimizer\FORCH.iA WinOptimizer (Portable).exe
```

Tras compilar una versión nueva (`npm run electron:build`), el original en
`release\` **no se borra**; sólo se refresca la copia estable y el acceso directo:

```powershell
$src = 'release\FORCH.iA-WinOptimizer-Portable-<VERSION>.exe'
$dstDir = 'C:\Users\paulo\Apps\FORCH.iA WinOptimizer'
New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
Copy-Item -LiteralPath $src -Destination (Join-Path $dstDir 'FORCH.iA WinOptimizer (Portable).exe') -Force
Unblock-File -LiteralPath (Join-Path $dstDir 'FORCH.iA WinOptimizer (Portable).exe')
```

El acceso directo `%USERPROFILE%\Desktop\FORCH.iA WinOptimizer.lnk` apunta al
nombre sin versión, así que **no hay que re-apuntarlo** en cada release. Sólo se
re-apunta cuando la carpeta estable cambia de ubicación:

```powershell
$exe = 'C:\Users\paulo\Apps\FORCH.iA WinOptimizer\FORCH.iA WinOptimizer (Portable).exe'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("$env:USERPROFILE\Desktop\FORCH.iA WinOptimizer.lnk")
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = Split-Path -Parent $exe
$lnk.IconLocation = "$exe,0"
$lnk.Description = 'FORCH.iA WinOptimizer (portable)'
$lnk.Save()
```

Verificación (debe devolver la ruta estable y el mismo `WorkingDirectory`):

```powershell
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("$env:USERPROFILE\Desktop\FORCH.iA WinOptimizer.lnk")
$lnk.TargetPath; $lnk.WorkingDirectory; $lnk.IconLocation
```

### Ver el estado del programa (`scripts/status.ps1`)

¿Querés saber, sin abrir nada raro, _cómo está_ tu instalación? El repo trae un
comando de **una sola corrida, de solo lectura y sin elevación**:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\status.ps1
```

Muestra, en criollo:

1. **Portable estable** — ruta, versión (`FileVersion` del `.exe`) y si el acceso
   directo del Escritorio existe y a dónde apunta.
2. **Instalación NSIS** — si está instalada y qué versión.
3. **Última publicada** en GitHub y si tu portable está **AL DIA** o
   **DESACTUALIZADO**.
4. **Resumen del scan de seguridad** — puntaje, conteo por estado y qué checks **no**
   están en `pass` (una línea cada uno). Recordá: `requires-admin` sólo significa que
   ese dato necesita elevación; **no** es un fallo y queda fuera del score.
5. **Resumen** — la lista de cosas a revisar.

El escaneo usa el **mismo** scanner real que la app (vía
`scripts/security-scan-report.cjs`, ~25 s) y es **de solo lectura**: no aplica
tweaks, no desinstala nada, no toca servicios. Si todavía no compilaste el `dist/`,
esa parte se saltea con un mensaje claro. Para saltearla vos (más rápido) usá
`-SkipSecurityScan`.

Con `-Json` además volcás el mismo resumen a un archivo (por defecto
`artifacts\status-report.json`, ignorado por git):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\status.ps1 -Json
# o a una ruta propia:
powershell -ExecutionPolicy Bypass -File .\scripts\status.ps1 -Json -OutFile .\status-report.json
```

Ejemplo de salida real (cuando el portable estaba en `0.10.0` y la última era `0.10.1`):

```text
==========================================================
 FORCH.iA WinOptimizer - Estado
==========================================================

[1. Portable estable (uso diario)]
    Ruta     : C:\Users\paulo\Apps\FORCH.iA WinOptimizer\FORCH.iA WinOptimizer (Portable).exe
    Version  : 0.10.0
    Acceso   : OK -> C:\Users\paulo\Apps\FORCH.iA WinOptimizer\FORCH.iA WinOptimizer (Portable).exe

[2. Instalacion NSIS (opcional)]
    Instalada: NO (solo portable)

[3. Ultima publicada (GitHub)]
    Ultima   : v0.10.1
    Titulo   : FORCH.iA WinOptimizer v0.10.1 - quoted UninstallString + honest winget timeout
    Estado   : DESACTUALIZADO (portable 0.10.0 < ultima v0.10.1)
               -> actualizar, ver docs/USER_GUIDE.md

[4. Scan de seguridad (solo lectura)]
    Puntaje  : 85 / 100   (13 de 22 checks medidos)
    Conteo   : pass 9 | warn 4 | fail 0 | unknown 0 | n/a 1 | requires-admin 8
    No estan en pass:
      not-applicable   secure-boot            Secure Boot only applies to UEFI firmware.
      requires-admin   tpm                    TPM state could not be read.
      warn             windows-update         A reboot is pending to finish installing updates.
      ...
    Nota     : requires-admin = el dato necesita elevacion (corre la app como admin); no es un fallo y queda fuera del score.

[Resumen]
    1 punto(s) a revisar:
      - El portable estable esta desactualizado.
```

> Tras actualizar el portable (ver arriba) la sección 3 pasa a **`Estado : AL DIA`**.

### Compilar desde código fuente

```bash
git clone https://github.com/paulogvs/forch-i-winoptimizer.git
cd forch-i-winoptimizer
npm install
npm run electron:build
```

---

## Módulos

### Quick fixes (1 clic)

La barra **Quick fixes** (en el **Dashboard** y en **Tools → Utilities**) reúne
cinco acciones rápidas. Cada una ejecuta de verdad, entra a la cola global de
operaciones y muestra el **resultado real** en un _toast_ con el enlace
**"View in Statistics"**. Mientras corre cualquier operación, los cinco botones
quedan **deshabilitados** (se reactivan solos).

| Acción                      | Qué hace                                                                                                                                     | Confirmación |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| ⚡ **Free RAM**             | Recorta el _working set_ **de esta app** y muestra **MB antes → después** (`Freed N MB (this app: A → B MB)`). No toca la RAM del sistema.   | No (1 clic)  |
| 🧹 **Clean Temp**           | Borra **solo** basura con `safeToDelete`: temporales, caché, logs, miniaturas y caché de navegador. **Nunca** Windows Update ni la Papelera. | Sí           |
| 🌐 **Flush DNS**            | Ejecuta `ipconfig /flushdns` y **verifica** que la caché del resolver se vació (`DNS cache flushed (N → M entries)`).                        | No (1 clic)  |
| 🛡️ **Create Restore Point** | Crea un punto de restauración **verificado** (`Checkpoint-Computer`). Requiere Protección del sistema activada y permisos de administrador.  | Sí           |
| 🔍 **Scan Drivers**         | Escanea dispositivos y consulta Windows Update por actualizaciones reales de drivers.                                                        | No (1 clic)  |

Resultados reales observados en la verificación (máquina de desarrollo):

- **Free RAM:** `Freed 172 MB (this app: 172 → 0 MB)` sobre un proceso de prueba.
- **Clean Temp:** borró 3 archivos de un directorio _scratch_ (112 KB) y los 3
  quedaron confirmados como eliminados (`removed`), sin tocar la Papelera ni
  Windows Update.
- **Flush DNS:** `DNS cache flushed (1 → 1 entries)` (la caché ya estaba casi
  vacía; la verificación exige que no crezca).
- **Scan Drivers:** 95 dispositivos, 0 actualizaciones ofrecidas por Windows
  Update (`wuStatus: ok`).
- **Create Restore Point:** en un proceso **sin elevación** devuelve
  `Failed to create restore point: Acceso denegado` (estado honesto; con la app
  elevada y Protección del sistema activa, crea y verifica el punto).

Cada acción queda registrada en **Statistics** (eventos `clean`, `boost` y
`maintenance`).

### Dashboard

El Dashboard es la pantalla principal. Muestra:

- **CPU Usage** — Porcentaje de uso de CPU en tiempo real
- **Memory** — Uso de RAM (total, usada, libre)
- **Disk** — Espacio en disco (total, usado, libre)
- **GPU Information** — Nombre, VRAM y driver de la GPU
- **System Information** — Versión de Windows, build, hostname, uptime
- **Quick Actions** — Accesos rápidos a funciones comunes

**Uso:** Navega a la sección Dashboard desde el menú lateral. La información se actualiza automáticamente cada 5 segundos.

### Cleaner

El módulo Cleaner escanea y elimina archivos basura:

- **Archivos temporales** — `.tmp`, `.temp`, `.bak`
- **Caché de navegadores** — Chrome, Edge
- **Caché de Windows Update** — Descargas de actualizaciones
- **Papelera de reciclaje** — Contenido eliminado
- **Miniaturas** — Caché de thumbnails del explorador
- **Logs** — Archivos de registro del sistema
- **Volcados de memoria** — Crash dumps
- **Prefetch** — Datos de prefetch de Windows

**Uso:**

1. Ve a **Cleaner** en el menú lateral
2. Click en **"Scan"** para buscar archivos
3. Selecciona los archivos a eliminar
4. Click en **"Delete Selected"**

> **Nota:** Los archivos marcados como "caution" requieren confirmación adicional.
> Si la limpieza falla, los archivos **siguen visibles** en la lista con el error y
> un botón **Retry cleaning** — nunca se ocultan como si se hubieran borrado.

### Drivers (actualización automática, v0.12.0)

El módulo Driver Updater ya **no usa una base simulada**. Ahora consulta la **API COM
de Windows Update** (`IsInstalled=0 AND Type='Driver'`) y compara lo que Windows
ofrece con lo que tenés instalado. Los estados son honestos:

- **up to date** — Windows Update **respondió** y no ofrece nada para ese dispositivo.
- **update available** — Windows Update ofrece un driver; el botón **Update** hace
  todo el pipeline automático: punto de restauración **verificado** → descarga/instalación
  vía Windows Update → **re-lectura** de la versión y del estado del dispositivo.
- **status unknown** — Windows Update **no respondió** (o la GPO "Do not include
  drivers" está activa). Nunca se muestra "up to date" por un resultado vacío.

**Progreso real:** durante una actualización verás el paso actual (crear punto de
restauración, descargar, verificar, instalar, re-verificar), el **porcentaje real** y,
cuando aplica, **bytes descargados / totales**. Podés **Cancel** en cualquier momento.

**Reboot:** si Windows pide reiniciar, la app muestra un aviso **"A reboot is
required"** — nunca reinicia sola.

**Rollback:** el botón **Rollback** revierte **de verdad** (`pnputil /delete-driver
<oem#.inf> /uninstall` + punto de restauración + re-verificación), pero **solo** para
drivers que **esta app instaló** (guarda un recibo con el `oem#.inf` y la versión
previa). Si no hay recibo, el rollback se **deshabilita y lo dice** — nunca simula
haber revertido.

**Qué NO se automatiza (por diseño):** BIOS/UEFI/firmware, DDU o limpieza agresiva,
drivers sin firma WHQL/Authenticode, reinicio forzado, deshabilitar la exigencia de
firma de drivers e instalaciones en paralelo. Ver `docs/DRIVERS_AUTO_UPDATE_DESIGN.md`.

### Boost

El módulo Boost optimiza el rendimiento del sistema:

- **Servicios optimizables** — Lista de servicios que se pueden desactivar
- **Impacto** — Bajo, medio o alto
- **Protección** — Los servicios críticos están protegidos

**Uso:**

1. Ve a **Boost** en el menú lateral
2. Revisa la lista de servicios
3. Click en **"Optimize"** para aplicar cambios recomendados

### Bundles

Instalación **masiva de apps por categoría** vía `winget`: **8 bundles y 48 apps**, con
todos los IDs validados en vivo contra winget.

Categorías: **Web Browsers**, **Media Players**, **Development Tools**, **System
Utilities**, **Gaming**, **Productivity** (PowerToys, Obsidian, Notion, Flow Launcher),
**Communication** (Zoom, Telegram, WhatsApp, Slack, Signal) y **Security & Privacy**
(Bitwarden, KeePassXC, Malwarebytes, Wireshark).

**Uso:**

1. Ve a **Bundles** en el menú lateral
2. Explorá una categoría e instalá una app con **Install**, o marcá varias y usá
   **Install Selected**
3. Mientras instala, los botones quedan deshabilitados y el badge del header muestra
   "Installing apps…" (ver [Mutex global](#mutex-global-de-operaciones))

> Los IDs inválidos se rechazan antes de tocar PowerShell; winget reporta éxito/error
> real por app (tolerancia a "already installed").

### Tools

Cuatro pestañas:

**App Manager** — las apps instaladas (Win32 y UWP) con versión, editor, tamaño, fecha y
protección. **Uninstall** elimina la app seleccionada. El string de desinstalación se
**valida antes de tocar PowerShell**: sólo se aceptan rutas absolutas terminadas en `.exe`
sin metacaracteres de shell, o `MsiExec /x {GUID}` con GUID bien formado; los argumentos
extra se descartan y cualquier otra cosa se rechaza sin ejecutar nada.

**Startup Manager** — apps que arrancan con Windows: impacto (high/medium/low) y botón
**Disable/Enable** por app.

**Debloat** — remoción de **30 paquetes UWP preinstalados** (curados, fuente winutil) con
tres niveles de protección:

| Nivel         | Cantidad | Comportamiento                                                                            |
| ------------- | :------: | ----------------------------------------------------------------------------------------- |
| **safe**      |    19    | Seleccionable; remoción sin riesgo conocido                                               |
| **caution**   |    7     | Seleccionable, pero la confirmación te avisa para revisar                                 |
| **protected** |    4     | **Nunca se remueven** — casilla deshabilitada y rechazo server-side aunque la UI se eluda |

Las apps **no instaladas** también quedan deshabilitadas ("not installed"). Flujo:

1. Ve a **Tools → Debloat**
2. Marcá las casillas (sólo las seleccionables)
3. **Remove selected (N)** → confirmás → ves el resultado por app
   (removed / skipped / failed) y el catálogo se refresca

> **Cómo restaurar:** la remoción usa `Remove-AppxPackage`, que quita el paquete **para tu
> usuario**. Para volver a tenerlo, reinstalalo desde la **Microsoft Store** o con
> `winget install <id>`. Los paquetes _protected_ jamás se tocan, así que apps clave del
> sistema (como Microsoft Store) están a salvo. Requiere ejecutar la app **como
> administrador**.
>
> **Garantías del backend:** el renderer sólo puede enviar **ids del catálogo** (nunca
> nombres de paquete arbitrarios); los ids se validan con gramática estricta, las entradas
> _protected_ se rechazan en Main y los ids desconocidos/duplicados se descartan **sin
> llegar a PowerShell**.

**Utilities** — accesos a Registry Cleaner, Disk Defragmenter, Privacy Eraser, File
Shredder, Network Optimizer y System Info.

### Tweaks

Ajustes **seguros y reversibles** de rendimiento, privacidad, Explorador y accesibilidad.
**Nada se aplica automáticamente** y todo se puede restaurar.

Categorías y tweaks incluidos (todos **Safe** y **Reversible: Sí**):

**Performance**

- **SysMain (Superfetch)** — desactiva el servicio; recomendado sólo en SSD si notás uso alto de disco/CPU
- **Prefetch / Superfetch (conservador)** — restaura los valores recomendados por Windows (no lo desactiva)
- **Background Apps (usuario)** — evita que las apps de la Store corran en segundo plano
- **Game Mode / HAGS** — **informativo**: detecta y sugiere, nunca fuerza (depende de GPU/driver)
- **Snappier animations** — `MenuShowDelay=0` y sin animación de minimizar/maximizar
- **Mouse acceleration off** — puntero 1:1 (raw input), sin "pointer precision"
- **No delay for startup apps** — quita el retardo artificial de las apps de inicio (`StartupDelayInMSec=0`)

**Privacy**

- **Telemetry & DiagTrack** — desactiva DiagTrack, fija telemetría al mínimo y apaga tareas CEIP/feedback
- **Suggested Content & Ads** — quita sugerencias, tips y publicidad de Windows 11
- **Turn off Copilot** — oculta el botón y desactiva Copilot por política (Windows 11 23H2+)
- **Turn off Windows Spotlight** — apaga las fotos/sugerencias de la pantalla de bloqueo (HKCU + HKLM)

**Explorer**

- **Mostrar extensiones de archivos**
- **Ocultar recientes y frecuentes** (Acceso rápido)
- **Menú contextual clásico/compacto** (Windows 11)
- **Taskbar aligned left** — barra de tareas alineada a la izquierda (Windows 11)
- **Hide taskbar search box** — quita el cuadro de búsqueda de la barra de tareas (Windows 11)
- **Hide Task View button** — oculta el botón Task View (Win+Tab sigue funcionando) (Windows 11)
- **Hide Widgets** — oculta el botón de Widgets; sólo registry, el servicio no se toca (Windows 11)

**Accessibility**

- **Disable Sticky Keys prompts** — corta el aviso de "presioná Shift 5 veces" y apaga Sticky Keys

**Uso:**

1. Ve a **Tweaks** en el menú lateral
2. Click en **Preview** para ver **exactamente** qué claves/servicios se tocan
3. Click en **Apply** (individual) o marcá varios y usá **Apply selected**
4. Para deshacer, click en **Restore** (o **Restore selected**)

> **Reversibilidad:** antes de aplicar, la app **captura el estado previo** (valor del registro,
> tipo de inicio del servicio, estado de la tarea) y lo guarda para restaurarlo. Si no puede
> capturarlo, usa los valores por defecto de Windows documentados en el tweak.
>
> **Administrador:** los tweaks que tocan servicios del sistema, tareas programadas o `HKLM`
> (SysMain, Prefetch, Telemetry/DiagTrack, Turn off Windows Spotlight) requieren ejecutar la
> app como administrador. Los de `HKCU` (Background Apps, Suggested Content, Explorer,
> Accessibility) no.
>
> **Versión de Windows:** los tweaks exclusivos de Windows 11 declaran un build mínimo
> (`requiresBuild`); si tu build es anterior, Apply falla con un mensaje claro **sin tocar
> nada** — y Restore nunca se bloquea.

### Security

Escaneo de seguridad **real y de solo lectura** contra tu máquina (22 chequeos:
antivirus, firewall, UAC, SMBv1, Secure Boot, TPM, BitLocker, updates, cuenta Guest,
RDP, política de contraseñas, autorun/autoplay, LM hash, SMB signing, puertos
escuchando, servicio Windows Update, y 6 controles de hardening **admin-gated**:
LSASS/`RunAsPPL`, Credential Guard, protectores de BitLocker, cuentas de
administrador, reglas entrantes de firewall y exposición de WinRM), mostrando la
**evidencia observada** en cada fila. Sin elevación, los 6 admin-gated salen como
`requires-admin` y quedan fuera del score. Cuatro chequeos ofrecen además
**auto-fix reversible** (preview → confirmar → aplicar → revertir): `smb1`,
`guest-account`, `remote-desktop` y `smb-signing`. Todo lo demás es guía. Ver
`docs/SECURITY_CHECKS.md`.

### Statistics

Gráficas de rendimiento:

- **CPU** — Historial de uso de CPU
- **Memory** — Historial de uso de RAM
- **Disk** — Historial de uso de disco

### Settings

Configuración de la aplicación:

- **Idioma** — Español / Inglés
- **Tema** — Oscuro / Claro / Azul / Verde / Naranja
- **Actualizaciones** — Verificar actualizaciones
- **Acerca de** — Información de la versión

---

## Atajos de Teclado

| Atajo      | Acción                      |
| ---------- | --------------------------- |
| `Ctrl + 1` | Ir al Dashboard             |
| `Ctrl + 2` | Ir a Cleaner                |
| `Ctrl + 3` | Ir a Boost                  |
| `Ctrl + 4` | Ir a Tools                  |
| `Ctrl + 5` | Ir a Security               |
| `Ctrl + 6` | Ir a Statistics             |
| `Ctrl + 7` | Ir a Settings               |
| `Ctrl + R` | Refrescar página actual     |
| `Ctrl + D` | Cambiar tema (oscuro/claro) |
| `Ctrl + L` | Cambiar idioma              |
| `F1`       | Abrir ayuda                 |
| `Esc`      | Cerrar diálogo              |

---

## FAQ

### ¿Es seguro usar FORCH.iA WinOptimizer?

Sí. La aplicación está diseñada con seguridad en mente:

- Los servicios críticos están protegidos y no se pueden desactivar
- Las aplicaciones de Microsoft están marcadas como "protected"
- Todas las acciones requieren confirmación del usuario
- Se crean puntos de restauración antes de cambios importantes

### ¿Puedo deshacer los cambios?

Sí. La mayoría de los cambios se pueden revertir:

- **Tweaks:** botón **Restore** por tweak (o "Restore selected"); vuelve al estado previo capturado
- **Servicios:** Se pueden volver a activar manualmente
- **Archivos eliminados:** Se pueden restaurar desde la papelera (si no se vació)
- **Apps de inicio:** Se pueden volver a activar

### ¿La aplicación es gratuita?

Sí, es completamente gratuita y de código abierto (MIT License).

### ¿Funciona en Windows 10?

Sí, es compatible con Windows 10 (versión 1809 o superior) y Windows 11.

### ¿Cómo reporto un error?

Puedes reportar errores en la [sección de issues](https://github.com/paulogvs/forch-i-winoptimizer/issues) de GitHub.

---

## Solución de Problemas

### La aplicación no inicia

- Verifica que tengas Windows 10 o 11
- Intenta ejecutar como administrador
- Revisa el archivo de log en `%APPDATA%/forch-i-winoptimizer/logs/`

### "Access denied" al eliminar archivos

- Ejecuta la aplicación como administrador
- Verifica que los archivos no estén en uso por otro programa

### Los servicios no se pueden desactivar

- Algunos servicios están protegidos por seguridad
- Verifica que tengas permisos de administrador

### La aplicación está lenta

- Cierra otras aplicaciones
- Reinicia el sistema
- Verifica que tu PC cumpla los requisitos mínimos

### Un tweak no se aplica ("FAILED" o sin efecto)

- Los tweaks de servicios/`HKLM` requieren **ejecutar como administrador**
- Revisá el mensaje de error en la tarjeta del tweak (indica el motivo real)
- Podés volver atrás con **Restore**; si el estado previo no estaba disponible, se usan los default de Windows

### Error "PowerShell not found"

- Verifica que PowerShell esté instalado (viene con Windows por defecto)
- Revisa la variable de entorno PATH

### Las actualizaciones no se descargan

- Verifica tu conexión a internet
- Revisa que el firewall no bloquee la aplicación
- Intenta descargar manualmente desde GitHub

---

## Novedades v0.10.0

### Cuarto auto-fix: SMB signing

`smb-signing` se une a los auto-fixes reversibles. El fix **requiere firma SMB en
servidor y cliente** (`Set-SmbServerConfiguration -RequireSecuritySignature $true
-EnableSecuritySignature $true`, con fallback por registro que escribe ambos
DWORD). Antes de escribir, captura los valores **reales** de
`RequireSecuritySignature` y `EnableSecuritySignature`; el **revert restaura los
dos exactos** (y **elimina** el valor si originalmente estaba `absent`, sin
asumir ningún default). Igual que los otros tres: preview obligatorio,
confirmación, **requiere administrador** (sin elevación queda deshabilitado con
el motivo) y el veredicto sale de **re-leer** la máquina, no de un mensaje.

### Portable estable + acceso directo

El acceso directo del escritorio ya no apunta al `release\` de cada versión. Ahora
apunta a una copia estable sin versión en
`C:\Users\paulo\Apps\FORCH.iA WinOptimizer\FORCH.iA WinOptimizer (Portable).exe`
(ver [Actualizar el portable estable](#actualizar-el-portable-estable-acceso-directo-del-escritorio)).
El `release\` original se conserva.

## Novedades v0.7.0

### Arranque sin listas (Boost)

La clasificación de impacto de las apps de arranque ya **no usa listas de productos**.
Se deriva solo de **señales observables** (origen/persistencia, existencia y firma del
binario, ruta del sistema, huella CPU/RAM medida del proceso en vivo y gramática
genérica del nombre), así que funciona en cualquier PC. Ver
`docs/STARTUP_APP_IMPACT.md`.

### Auto-fix de seguridad reversible

`smb1`, `guest-account` y `remote-desktop` ahora se pueden reparar desde la app con
**preview obligatorio** (valor actual observado), confirmación y **revert** que restaura
el valor previo real. Requiere **administrador**: sin elevación la acción aparece
**deshabilitada con el motivo** y ofrece "Reiniciar como administrador". El resto de los
checks sigue siendo solo lectura + guía.

### Build reproducible

Se eliminó la deuda de `@shared/*` que vivía en `node_modules` (no viajaba en el repo ni
sobrevivía a un `npm ci`). La resolución del alias se registra en runtime desde el propio
_main_, sin tocar `node_modules`. Ver `docs/BUILD_REPRODUCIBILITY.md`.

---

## Novedades v0.5.0

Todas las funciones que antes aparecían como _stub deshabilitado_ (“Not implemented yet”)
ahora funcionan de verdad.

### Settings

- **Accent color** — elegí un color; se derivan los tokens (`--color-accent`,
  `--color-accent-hover`, `--color-border-focus`, `--color-chart-primary`) y se aplican
  en vivo. Se guarda y se vuelve a aplicar al abrir la app. _Reset to brand cyan_ vuelve al
  cyan de marca.
- **Start with Windows** — registra la app para que arranque con Windows. El toggle **lee el
  estado real del sistema operativo**, así que nunca miente. En la build **portable** aparece
  deshabilitado con la explicación (no aplica).
- **Minimize to tray on close** — al cerrar, la app queda en la bandeja del sistema. El menú
  de la bandeja tiene _Show_ y _Quit_ (Quit cierra de verdad). Desactivalo para cerrar normal.
- **Enable notifications** — apaga/enciende las notificaciones nativas de Windows.
- **Automatic updates** — chequeos de fondo cada 4 horas (sólo build instalada, no portable).
  La tarjeta **Updates** muestra el estado (buscando / al día / disponible / descargando /
  error) con **Check now**, **Download** y **Restart & install**.
- **Cleaner** — _Scan browser cache_, _Scan Windows temp files_ y _Scan recycle bin_ controlan
  qué escanea el Cleaner (mismo motor, sin lógica duplicada). _Exclude paths_ acepta rutas
  separadas por comas (se aplican al perder el foco) que el escáner ignora.

### Statistics

- **Export CSV** — abre el diálogo nativo de guardado y escribe los datos reales en un CSV.
- **Gráficos** — barras/líneas en SVG puro: junk encontrado por escaneo, archivos limpiados,
  historial de puntaje de auditoría y RAM liberada. Se alimentan de eventos reales; si no hay
  datos, se muestra un **empty state honesto** (no se inventan valores). Accesibles: cada
  gráfico es un `role="img"` con una lista equivalente para lectores de pantalla.

### Audit y Security

- El botón **Fix** ya no está muerto. Como la auditoría **no** debe tocar la máquina a ciegas,
  _Fix_ abre el flujo reversible que resuelve el hallazgo: Audit → _Security · Privacy_,
  _Tweaks_, _Cleaner_ o _Network_ según el caso; Security → pestaña _Privacy_. El tooltip
  indica el destino.

### Tools → Utilities

- La pestaña **Windows utilities** abre herramientas reales del sistema (Administrador de
  tareas, Liberador de espacio, Administrador de dispositivos, Servicios, Información del
  sistema, Panel de control, Monitor de recursos, Programas y características, Conexiones de
  red, Administración de discos, Visor de eventos, Monitor de rendimiento). El binario se
  valida en `System32` antes de lanzarlo y cualquier error se informa en pantalla.

---

## Soporte

- **GitHub:** https://github.com/paulogvs/forch-i-winoptimizer
- **Issues:** https://github.com/paulogvs/forch-i-winoptimizer/issues
- **Autor:** Paulo Velasco (FORCH.iA)

---

_Build. Learn. Evolve._

---

## Security Scan (v0.6.0)

El **Security Scan** es un escaneo **de solo lectura** contra tu máquina real.
Cada fila muestra la **evidencia observada** (el valor realmente leído), no solo un
icono. Los estados posibles son:

- **Pass** — cumple.
- **Warning** — parcial / mejorable.
- **Fail** — no cumple.
- **Unknown** — no se pudo leer el dato (y no es un problema de permisos). No se
  inventa: un dato no leído nunca se marca como _fail_.
- **Not applicable** — el chequeo no aplica a esta PC (ej. Secure Boot en BIOS legacy,
  BitLocker en edición Home sin el cmdlet).
- **Requires admin** — el dato necesita elevación; el error observable fue "acceso
  denegado".

El **puntaje** usa una fórmula explícita (visible en el tooltip): excluye del
denominador los checks _unknown_ / _not-applicable_ / _requires-admin_, porque no
tiene sentido penalizar lo que no aplica ni lo que no se pudo medir. Si nada es
medible, muestra _not scored_ en vez de un número.

Por qué un check puede salir **unknown** o **requires-admin** y cómo interpretarlo:
ver `docs/SECURITY_CHECKS.md`.

### Auto-fix (v0.10.0)

Cuatro checks — `smb1`, `guest-account`, `remote-desktop` y `smb-signing` — tienen
un botón **Auto-fix**. Al pulsarlo se muestra un **preview** con el valor **actual
observado** y el valor objetivo; recién al confirmar se aplica. Si la app no corre
como administrador, la acción aparece **deshabilitada con el motivo** y podés
**reiniciar como administrador** desde el mismo diálogo. Tras aplicar, el check
**se vuelve a medir** (no se asume "pass"). El revert restaura el **valor previo
real** capturado antes del cambio (nunca un default); en `smb-signing` restaura
`RequireSecuritySignature` y `EnableSecuritySignature` de forma exacta. El resto
de los checks sigue siendo solo lectura + guía.

### Verificación elevada (kit del repo)

Para medir los 6 controles **admin-gated** y validar el ciclo del auto-fix de RDP fuera
de la UI, el repo incluye un kit que **se autoeleva una vez** (un solo UAC):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1
```

Corre el **mismo** escáner que la app (los 22 checks, con evidencia), ejecuta
**revert → apply → revert** sobre Remote Desktop con guarda de sesiones activas (aborta
el ciclo si hay una RDP en uso), deja el sistema **endurecido** (`fDenyTSConnections=1`)
y reporta el estado final (SMBv1, RDP, DNS por adaptador).

Con `-ApplyFixes` además **aplica** los tres fixes reversibles pendientes (`smb1`,
`guest-account`, `smb-signing`): captura el valor original, escribe el endurecido y lo
**relee** para confirmarlo; el JSON incluye `before`/`after` y el **comando exacto para
revertir**. Si la relectura no confirma el cambio, se reporta como fallo (código `1`).
Con `-DryRun` sólo **planifica** (no pide UAC, no escribe nada):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -ApplyFixes
powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -ApplyFixes -DryRun
```

El resultado queda en
`artifacts/elevated-verification/elevated-verification-latest.json`. Detalle completo,
códigos de salida, variantes `-SkipRdpCycle`/`-DryRun`, **cómo revertir** y **riesgos**
(deshabilitar SMBv1 o requerir firma SMB puede afectar NAS/dispositivos antiguos) en
`docs/TROUBLESHOOTING.md` → _Verificación elevada (kit para el usuario)_.

> Es una herramienta de desarrollo: **no forma parte del binario** distribuido.
