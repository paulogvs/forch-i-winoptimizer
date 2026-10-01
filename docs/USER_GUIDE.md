# FORCH.iA WinOptimizer — Guía de Usuario

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [Instalación](#instalación)
3. [Módulos](#módulos)
   - [Dashboard](#dashboard)
   - [Cleaner](#cleaner)
   - [Boost](#boost)
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
- **Tweaks seguros** — Ajustes de rendimiento/privacidad/Explorer, reversibles y con vista previa
- **Free RAM** — Botón en el header que libera la memoria ocupada por la app al instante (muestra "Freed N MB")
- **Multi-idioma** — Español e Inglés
- **Temas** — Oscuro, claro y más

### Controles de ventana

La ventana es *frameless* con controles propios en la esquina superior derecha
(estilo Windows 11):

- **Minimizar** — envía la ventana a la barra de tareas
- **Maximizar / Restaurar** — alterna el tamaño; el ícono cambia según el estado
- **Cerrar** — cierra la aplicación (hover rojo)

Podés **arrastrar la ventana** desde la barra superior o desde el encabezado del menú
lateral. Los botones de control y los campos de búsqueda no arrastran. Todos los botones
son accesibles por teclado (`Tab` + `Enter`/`Espacio`, con anillo de foco visible).

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

### Instalación portable

1. Descarga el archivo `FORCH.iA-WinOptimizer-Portable-X.X.X.exe`
2. Ejecuta directamente (no requiere instalación)

### Compilar desde código fuente

```bash
git clone https://github.com/paulogvs/forch-i-winoptimizer.git
cd forch-i-winoptimizer
npm install
npm run electron:build
```

---

## Módulos

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

### Boost

El módulo Boost optimiza el rendimiento del sistema:

- **Servicios optimizables** — Lista de servicios que se pueden desactivar
- **Impacto** — Bajo, medio o alto
- **Protección** — Los servicios críticos están protegidos

**Uso:**
1. Ve a **Boost** en el menú lateral
2. Revisa la lista de servicios
3. Click en **"Optimize"** para aplicar cambios recomendados

### Tools

Herramientas del sistema:

- **Abrir carpeta Temp** — Abre la carpeta de archivos temporales
- **Abrir msconfig** — Configuración del sistema
- **Abrir Task Manager** — Administrador de tareas
- **Abrir Registry Editor** — Editor del registro
- **Abrir Services** — Administrador de servicios

### Tweaks

Ajustes **seguros y reversibles** de rendimiento, privacidad y Explorador. **Nada se aplica
automáticamente** y todo se puede restaurar.

Categorías y tweaks incluidos (todos **Safe** y **Reversible: Sí**):

**Performance**
- **SysMain (Superfetch)** — desactiva el servicio; recomendado sólo en SSD si notás uso alto de disco/CPU
- **Prefetch / Superfetch (conservador)** — restaura los valores recomendados por Windows (no lo desactiva)
- **Background Apps (usuario)** — evita que las apps de la Store corran en segundo plano
- **Game Mode / HAGS** — **informativo**: detecta y sugiere, nunca fuerza (depende de GPU/driver)

**Privacy**
- **Telemetry & DiagTrack** — desactiva DiagTrack, fija telemetría al mínimo y apaga tareas CEIP/feedback
- **Suggested Content & Ads** — quita sugerencias, tips y publicidad de Windows 11

**Explorer**
- **Mostrar extensiones de archivos**
- **Ocultar recientes y frecuentes** (Acceso rápido)
- **Menú contextual clásico/compacto** (Windows 11)

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
> (SysMain, Prefetch, Telemetry/DiagTrack) requieren ejecutar la app como administrador.
> Los de `HKCU` (Background Apps, Suggested Content, Explorer) no.

### Security

Auditoría de seguridad:

- **Firewall** — Estado del firewall de Windows
- **Windows Defender** — Estado del antivirus
- **UAC** — Control de cuentas de usuario
- **Updates** — Actualizaciones pendientes

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

| Atajo | Acción |
|-------|--------|
| `Ctrl + 1` | Ir al Dashboard |
| `Ctrl + 2` | Ir a Cleaner |
| `Ctrl + 3` | Ir a Boost |
| `Ctrl + 4` | Ir a Tools |
| `Ctrl + 5` | Ir a Security |
| `Ctrl + 6` | Ir a Statistics |
| `Ctrl + 7` | Ir a Settings |
| `Ctrl + R` | Refrescar página actual |
| `Ctrl + D` | Cambiar tema (oscuro/claro) |
| `Ctrl + L` | Cambiar idioma |
| `F1` | Abrir ayuda |
| `Esc` | Cerrar diálogo |

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

## Soporte

- **GitHub:** https://github.com/paulogvs/forch-i-winoptimizer
- **Issues:** https://github.com/paulogvs/forch-i-winoptimizer/issues
- **Autor:** Paulo Velasco (FORCH.iA)

---

*Build. Learn. Evolve.*
