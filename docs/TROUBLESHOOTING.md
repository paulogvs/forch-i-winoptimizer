# FORCH.iA WinOptimizer — Solución de Problemas

## Problemas Comunes y Soluciones

### 1. La aplicación no inicia

**Síntomas:** Al ejecutar el .exe, no aparece ninguna ventana o se cierra inmediatamente.

**Soluciones:**
1. Verifica que tengas Windows 10 (1809+) o Windows 11
2. Ejecuta como administrador (click derecho → "Ejecutar como administrador")
3. Revisa el archivo de log en `%APPDATA%/forch-i-winoptimizer/logs/`
4. Verifica que tu antivirus no esté bloqueando la aplicación
5. Intenta reinstalar la aplicación

---

### 2. "Access denied" al eliminar archivos

**Síntomas:** Al intentar eliminar archivos basura, aparece un error de "Access denied".

**Soluciones:**
1. Ejecuta la aplicación como administrador
2. Verifica que los archivos no estén en uso por otro programa
3. Cierra los navegadores antes de limpiar la caché
4. Reinicia el sistema e intenta de nuevo

---

### 3. Los servicios no se pueden desactivar

**Síntomas:** Al intentar desactivar un servicio, no se aplica el cambio.

**Soluciones:**
1. Verifica que estés ejecutando como administrador
2. Algunos servicios están protegidos y no se pueden desactivar
3. Verifica que el servicio no sea esencial para el sistema
4. Intenta desactivar desde `services.msc` manualmente

---

### 4. Error "PowerShell not found"

**Síntomas:** La aplicación no puede ejecutar comandos PowerShell.

**Soluciones:**
1. Verifica que PowerShell esté instalado (viene con Windows por defecto)
2. Abre PowerShell manualmente para verificar que funciona
3. Revisa la variable de entorno PATH incluya `C:\Windows\System32\WindowsPowerShell\v1.0\`
4. Reinstala PowerShell desde "Activar o desactivar características de Windows"

---

### 5. Las actualizaciones no se descargan

**Síntomas:** Al intentar descargar una actualización, falla o se queda en 0%.

**Soluciones:**
1. Verifica tu conexión a internet
2. Revisa que el firewall no bloquee la aplicación
3. Intenta descargar manualmente desde GitHub
4. Verifica que tengas espacio en disco suficiente
5. Revisa los logs para más detalles

---

### 6. La aplicación está lenta

**Síntomas:** La interfaz se siente lenta o las operaciones tardan mucho.

**Soluciones:**
1. Cierra otras aplicaciones para liberar recursos
2. Reinicia el sistema
3. Verifica que tu PC cumpla los requisitos mínimos (4 GB RAM)
4. Desactiva el escaneo en tiempo real del antivirus temporalmente
5. Limpia los archivos temporales con la propia aplicación

---

### 7. "No se encontraron archivos basura"

**Síntomas:** El escaneo no encuentra archivos para limpiar.

**Soluciones:**
1. Verifica que los permisos sean correctos (ejecuta como administrador)
2. Los archivos pueden haber sido limpiados previamente
3. Verifica que las rutas de escaneo sean correctas
4. Intenta un escaneo manual desde el módulo Cleaner

---

### 8. La aplicación se cierra inesperadamente

**Síntomas:** La aplicación se cierra sin mostrar error.

**Soluciones:**
1. Revisa los logs en `%APPDATA%/forch-i-winoptimizer/logs/`
2. Verifica que no haya conflictos con otros programas
3. Actualiza a la última versión
4. Reinstala la aplicación
5. Reporta el error en GitHub con los logs

---

### 9. Error al desinstalar aplicaciones

**Síntomas:** Al intentar desinstalar una app, falla.

**Soluciones:**
1. Ejecuta como administrador
2. Verifica que la app no esté en uso
3. Intenta desinstalar manualmente desde "Agregar o quitar programas"
4. Algunas apps de Windows no se pueden desinstalar

---

### 10. Problemas con el tema o idioma

**Síntomas:** El tema o idioma no se aplica correctamente.

**Soluciones:**
1. Reinicia la aplicación
2. Verifica que el archivo de configuración no esté corrupto
3. Elimina la carpeta `%APPDATA%/forch-i-winoptimizer/` y reinicia
4. Reinstala la aplicación

---

## Obtener Ayuda

Si ninguna de estas soluciones funciona:

1. **Revisa los logs:** `%APPDATA%/forch-i-winoptimizer/logs/`
2. **Crea un issue en GitHub:** https://github.com/paulogvs/forch-i-winoptimizer/issues
3. **Incluye en tu reporte:**
   - Versión de la aplicación
   - Versión de Windows
   - Descripción del problema
   - Pasos para reproducir
   - Screenshots (si es posible)
   - Contenido del archivo de log

---

*Build. Learn. Evolve.*
