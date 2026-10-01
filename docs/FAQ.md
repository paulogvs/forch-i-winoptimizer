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

*Build. Learn. Evolve.*
