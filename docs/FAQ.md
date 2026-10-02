# FORCH.iA WinOptimizer — FAQ

## Preguntas Frecuentes

### General

**¿Qué es FORCH.iA WinOptimizer?**
Es una aplicación de optimización para Windows que te permite limpiar archivos basura, gestionar servicios, controlar aplicaciones de inicio y monitorear el rendimiento de tu PC.

**¿Es gratuita?**
Sí, es completamente gratuita y de código abierto bajo licencia MIT.

**¿En qué idiomas está disponible?**
Actualmente está disponible en Español (ES) e Inglés (EN). Puedes cambiar el idioma en Settings.

**¿Funciona en Windows 10?**
Sí, es compatible con Windows 10 (versión 1809 o superior) y Windows 11.

---

### Instalación y Actualizaciones

**¿Cómo instalo la aplicación?**
Descarga el instalador `.exe` desde la página de releases en GitHub y sigue las instrucciones.

**¿Hay versión portable?**
Sí, puedes descargar la versión portable que no requiere instalación.

**¿Cómo actualizo la aplicación?**
La aplicación te notificará cuando haya una nueva versión. También puedes verificar manualmente en Settings > Updates.

**¿Cómo desinstalo la aplicación?**
Usa "Agregar o quitar programas" en Windows o ejecuta el desinstalador.

---

### Uso

**¿Cómo limpio archivos basura?**

1. Ve al módulo Cleaner
2. Click en "Scan"
3. Selecciona los archivos a eliminar
4. Click en "Delete Selected"

**¿Qué archivos es seguro eliminar?**
Los archivos marcados como "safe" (temporales, caché, miniaturas) son seguros. Los marcados como "caution" requieren revisión.

**¿Cómo optimizo el inicio de Windows?**

1. Ve al módulo Boost
2. Revisa la lista de servicios y apps de inicio
3. Click en "Optimize" para aplicar cambios recomendados

**¿Qué son los Tweaks?**
Ajustes seguros y reversibles de rendimiento, privacidad y Explorador (por ejemplo mostrar
extensiones, desactivar telemetría/DiagTrack, menú contextual clásico). Nada se aplica
automáticamente: primero ves un **Preview** de lo que se toca.

**¿Los Tweaks son reversibles?**
Sí, todos. La app guarda tu estado previo antes de aplicar y el botón **Restore** lo devuelve
tal cual estaba (o usa los valores por defecto de Windows si no pudo capturarlo).

**¿Los Tweaks necesitan administrador?**
Los que tocan servicios, tareas programadas o `HKLM` sí (SysMain, Prefetch, Telemetry/DiagTrack).
Los de `HKCU` (Background Apps, Suggested Content, Explorer) no.

**¿Qué hace el botón Free RAM (⚡)?**
Libera al instante la RAM que ocupa **la propia aplicación** (no la de otros programas):
recorta el _working set_ de sus procesos y muestra cuánto liberó (`Freed N MB`, se resetea
a los 3 s). Medido en pruebas: de **266 MB a 13 MB (~253 MB liberados)** en ~3 s.

**¿Por qué varios botones aparecen deshabilitados / qué es el badge del header?**
Es el **mutex global**: las operaciones que modifican el sistema (tweaks, instalaciones,
limpiezas, debloat, Free RAM) se ejecutan **una a la vez, en orden** para que no se pisen.
Mientras corre una, los botones de acción se deshabilitan solos y el header muestra un badge
("Applying tweak…", "Installing apps…", "+N queued" si hay otras en cola). Al terminar —
con éxito o con error — se reactivan automáticamente.

**¿Qué es Debloat?**
La pestaña **Tools → Debloat** lista **30 paquetes UWP preinstalados** de Windows con tres
niveles: **safe (19)**, **caution (7)** y **protected (4)** — los _protected_ (ej. Microsoft
Store) **nunca se remueven**, y las apps no instaladas quedan deshabilitadas. Remover no
requiere confirmaciones de Windows pero sí la app **como administrador**.

**¿Puedo restaurar lo que quité en Debloat?**
Sí, en la mayoría de los casos: `Remove-AppxPackage` quita el paquete **para tu usuario**,
así que se reinstala desde la **Microsoft Store** o con `winget install <id>`. Los paquetes
_protected_ no se tocaron nunca.

**¿Cuántos Tweaks y apps incluye?**
**19 tweaks** (Performance, Privacy, Explorer, Accessibility), todos con Preview y Restore,
y **8 bundles con 48 apps** instalables en bloque vía `winget` (Browsers, Media, Dev Tools,
Utilities, Gaming, Productivity, Communication, Security & Privacy).

**¿Puedo mover, maximizar o cerrar la ventana?**
Sí. La ventana es frameless con controles propios arriba a la derecha (Minimizar,
Maximizar/Restaurar, Cerrar). Arrastrás la ventana desde la barra superior o el encabezado del
menú lateral. Todo es accesible por teclado.

**¿Puedo deshacer los cambios?**
Sí, la mayoría de los cambios se pueden revertir manualmente desde los mismos módulos. Los
**Tweaks** tienen su propio botón Restore.

**¿Cómo cambio el tema?**
Ve a Settings > Theme y selecciona el tema deseado (Oscuro, Claro, Azul, Verde, Naranja).

**¿Cómo cambio el idioma?**
Ve a Settings > Language y selecciona Español o Inglés.

---

### Seguridad

**¿Es seguro desactivar servicios?**
Los servicios marcados como "protected" no se pueden desactivar. Los marcados como "caution" tienen advertencias pero son seguros si entiendes las consecuencias.

**¿La aplicación recopila datos?**
No. La aplicación no recopila ningún dato personal ni envía información a servidores externos.

**¿Necesito ejecutar como administrador?**
Para algunas funciones (eliminar archivos del sistema, gestionar servicios) necesitarás ejecutar como administrador.

---

### Problemas Comunes

**La aplicación no inicia**

- Verifica que tengas Windows 10 o 11
- Intenta ejecutar como administrador
- Revisa los logs en `%APPDATA%/forch-i-winoptimizer/logs/`

**"Access denied" al eliminar archivos**

- Ejecuta la aplicación como administrador
- Verifica que los archivos no estén en uso

**Los servicios no se pueden desactivar**

- Algunos servicios están protegidos
- Verifica permisos de administrador

**Error "PowerShell not found"**

- Verifica que PowerShell esté instalado
- Revisa la variable de entorno PATH

**Las actualizaciones no se descargan**

- Verifica tu conexión a internet
- Revisa el firewall
- Intenta descargar manualmente desde GitHub

---

### Funciones v0.5.0

**¿Los cambios de Settings se guardan al cerrar la app?**
Sí. Se guardan en `settings.json` dentro de `%APPDATA%/forch-i-winoptimizer/` y se vuelven a
aplicar al abrir. El color de acento incluido.

**¿Por qué "Automatic updates" está deshabilitado en la versión portable?**
Porque el ejecutable portable se auto-extrae y **no** puede actualizarse de forma confiable
en caliente (`electron-updater` necesita la instalación NSIS y el `latest.yml`). En portable,
descargá el instalador más reciente desde GitHub Releases y reemplazá el `.exe`.

**¿Por qué "Start with Windows" no está disponible en la versión portable?**
El arranque automático registra la ruta del ejecutable instalado. En portable la ruta es
temporal (carpeta de extracción), así que se deshabilita y se explica en pantalla.

**¿Windows SmartScreen bloquea el instalador? ¿Es un virus?**
No. Los binarios **no están firmados** (certificado de pago); SmartScreen avisa por eso, no
por malware. Verificá la integridad con `checksums.sha256` y usá _Más información →
Ejecutar de todas formas_. Detalle en `docs/CODE_SIGNING.md`.

**¿El botón "Fix" de Audit modifica el sistema?**
No directamente. Abre el flujo reversible donde se resuelve (por ejemplo, Security → Privacy
o Tweaks). Así el cambio siempre pasa por preview/confirmación/revert.

**¿De dónde salen los datos de Statistics?**
De acciones reales que ya hiciste: escaneos del Cleaner, limpiezas, auditorías y _Free RAM_.
Si no hay datos, se muestra un empty state; nunca se inventan valores.

---

### Soporte

**¿Cómo reporto un error?**
Crea un issue en GitHub con:

- Descripción del problema
- Pasos para reproducir
- Screenshots (si es posible)
- Log de la aplicación

**¿Cómo contribuir?**
Haz un fork del repo, crea una rama, haz tus cambios y crea un Pull Request.

**¿Dónde está el código fuente?**
https://github.com/paulogvs/forch-i-winoptimizer

---

_Build. Learn. Evolve._

---

### Security Scan (v0.6.0)

**¿Por qué un check del Security Scan sale "Unknown"?**
Significa que el dato **no se pudo leer** y el error no fue de permisos. Es
deliberado: preferimos decir "no medido" antes que inventar un resultado. Revisa
`docs/SECURITY_CHECKS.md` para ver qué consulta hace cada check.

**¿Por qué sale "Requires admin"?**
Ese dato necesita elevación (el error observable fue "acceso denegado"). Ejemplos
típicos: TPM y BitLocker cuando la app corre sin privilegios de administrador.
Ejecuta la app como administrador si quieres medirlos.

**¿Por qué BitLocker o Secure Boot salen "Not applicable"?**
El chequeo no aplica a tu máquina: BitLocker no está en ediciones Home (sin el
cmdlet), y Secure Boot solo aplica a firmware UEFI (en BIOS legacy no aplica).

**¿El puntaje es un número mágico?**
No. La fórmula es explícita y aparece en el tooltip y en `docs/SECURITY_CHECKS.md`.
Los checks no medidos / no aplicables **no** cuentan en el denominador.

**¿El scan cambia mi sistema?**
El escaneo es **de solo lectura**: no modifica nada. Aparte, tres checks
(`smb1`, `guest-account`, `remote-desktop`) tienen un botón **Auto-fix** que aplica un
cambio **reversible** recién después de un preview y tu confirmación; el resto de los
hallazgos son guía.

**¿Cómo funciona el auto-fix y cómo lo deshago?**
Al pulsar _Auto-fix_ ves primero un **preview** con el valor actual observado y el valor
objetivo. Si confirmás, se aplica y el check **se vuelve a medir**. Requiere
**administrador**: sin elevación la acción aparece deshabilitada con el motivo y podés
reiniciar como administrador desde el diálogo. Para deshacerlo, usá **Revert**, que
restaura el **valor previo real** capturado antes del cambio.
