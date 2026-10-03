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

### 11. Error al empaquetar para Windows (electron-builder)

**Síntomas:** `npm run electron:build` falla con:

```
ERROR: Cannot create symbolic link : El cliente no dispone de un privilegio requerido
  ...\winCodeSign\<hash>\darwin\10.12\lib\libcrypto.dylib
```

**Causa:** electron-builder extrae el paquete `winCodeSign`, que incluye enlaces simbólicos de macOS (`darwin/*.dylib`). Windows necesita el privilegio `SeCreateSymbolicLinkPrivilege` (Modo Desarrollador o Administrador) para crearlos.

**Soluciones (elige una):**

1. **Activar Modo Desarrollador** (recomendado): Configuración → Privacidad y seguridad → Para desarrolladores → _Modo para desarrolladores_ = Activado. Vuelve a ejecutar `npm run electron:build`.
2. **Ejecutar la terminal como Administrador.**
3. **Workaround sin privilegios** — pre-extraer `winCodeSign` excluyendo `darwin`:
   ```powershell
   $cache = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
   $7za   = ".\node_modules\7zip-bin\win\x64\7za.exe"
   $arc   = (Get-ChildItem "$cache\*.7z" | Select-Object -First 1).FullName
   & $7za x $arc "-o$cache\winCodeSign-2.6.0" "-xr!darwin" -y
   ```
4. **Alternativa rápida (sin icono/metadatos embebidos en el `.exe`):**
   ```bash
   npx electron-builder --win --config.win.signAndEditExecutable=false
   ```

---

### 12. Requisitos de administrador (por módulo)

Muchas funciones leen o modifican el sistema y requieren **ejecutar la app como administrador**:

| Módulo                                                                                                                                                  | ¿Requiere admin? |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------: |
| Dashboard / System Info                                                                                                                                 |        No        |
| Cleaner (limpiar `C:\Windows\*`, caché de Windows Update)                                                                                               |        Sí        |
| Boost / Servicios (cambiar tipo de inicio, detener)                                                                                                     |        Sí        |
| App Manager (desinstalar apps UWP/Win32)                                                                                                                |        Sí        |
| Debloat (remover paquetes UWP)                                                                                                                          |        Sí        |
| Free RAM (liberar memoria de la app)                                                                                                                    |        No        |
| Bundles (instalar vía `winget`)                                                                                                                         |        No        |
| Drivers (punto de restauración, `pnputil`)                                                                                                              |        Sí        |
| Network Fixer (reset TCP/IP, Winsock, firewall)                                                                                                         |        Sí        |
| Scheduled Cleaning (crear tareas programadas)                                                                                                           |        Sí        |
| Audit / Benchmark (lectura de HKLM)                                                                                                                     |     Parcial      |
| Security Scan — 6 checks admin-gated (LSASS, Credential Guard, protectores de BitLocker, cuentas de administrador, reglas entrantes de firewall, WinRM) |     Parcial      |
| Tweaks — Performance: SysMain, Prefetch (`HKLM`/servicios)                                                                                              |        Sí        |
| Tweaks — Privacy: Telemetry/DiagTrack (servicio + tareas + `HKLM`)                                                                                      |        Sí        |
| Tweaks — Background Apps, Suggested Content, Explorer (`HKCU`)                                                                                          |        No        |

**Portable:** si las acciones fallan, cerrá la app y reabrí con clic derecho → **Ejecutar como administrador**.

**Nota técnica:** todos los scripts se ejecutan vía `-EncodedCommand` (Base64 UTF-16LE) para evitar problemas de comillas y codificación. Si un módulo devuelve datos vacíos, verificá que `powershell.exe` esté disponible y que no haya políticas de ejecución restrictivas.

---

### 13. Tweaks: cómo funcionan, reversibilidad y administrador

**Qué son:** ajustes curados (Performance / Privacy / Explorer) para Windows 11. Sólo se incluye
el **subset seguro**; no hay tweaks destructivos ni "Remove All".

**Reversibilidad (garantizada):**

1. Antes de aplicar, la app **captura el estado previo** (valor de registro, tipo de inicio del
   servicio, estado de la tarea programada) y lo persiste en
   `%APPDATA%/forch-i-winoptimizer/tweaks-state.json`.
2. **Restore** escribe ese estado previo (o borra el valor si no existía).
3. Si la captura no está disponible, se usan los valores por defecto documentados de Windows.

**Preview antes de aplicar:** el botón **Preview** lista exactamente las claves de registro,
servicios y tareas que se tocan (Apply y Restore).

**Un tweak falla o no tiene efecto:**

- Ejecutá la app **como administrador** para los tweaks de servicios/`HKLM` (SysMain, Prefetch,
  Telemetry/DiagTrack).
- El mensaje de error se muestra en la tarjeta del tweak (motivo real de PowerShell).
- Los tweaks **informativos** (Game Mode / HAGS) nunca modifican nada: sólo sugieren.

**Restaurar todo:** marcá los tweaks aplicados y usá **Restore selected**.

---

### 14. Ventana frameless: mover, maximizar o cerrar

**No puedo mover la ventana:** arrastrá desde la **barra superior** o el **encabezado del menú
lateral** (zonas de drag). Los controles y el buscador no arrastran (por diseño).

**El botón Maximizar no cambia de ícono:** debería alternar con el estado de la ventana. Si usás
un gestor de ventanas que evita eventos `maximize`/`unmaximize` de Electron, reiniciá la app.

**La caché me muestra datos viejos (≤ TTL):** System Info 60 s, Drivers 5 min, Junk 30 s. Usá
**Refresh** en el Dashboard (invalida la caché) o volvé a ejecutar el scan del módulo.

---

### 15. Un botón está deshabilitado o el header muestra un badge ("Applying tweak…")

**Síntomas:** los botones de acción no responden y/o el badge del header marca una
operación en curso, a veces con **"+N queued"**.

**Causa:** el **mutex global** — las operaciones que mutan el sistema corren **una a la
vez, en FIFO** (26 canales: tweaks, apps, bundles, limpiezas, debloat, Free RAM…). Esto es
**comportamiento normal**, no un bug.

**Soluciones:**

1. **Esperá a que termine** — el badge se apaga y los botones se reactivan solos
2. Mirá el módulo implicado: si la operación falló, el error aparece ahí y el lock se
   libera igual (el badge no queda pegado por errores)
3. "+N queued" significa que hay operaciones esperando en orden — no hacen falta acciones
4. Si el badge siguiera visible con la app **responsiva** durante mucho tiempo, cerrá y
   volvé a abrir la app (el lock vive en el proceso main y muere con él)

---

### 16. Debloat: una app no se remueve o quiero restaurarla

**Síntomas:** una casilla está deshabilitada, el resultado dice `skipped`/`failed`, o ya
removiste algo y lo querés de vuelta.

**Por qué ocurre:**

- **`protected` (4 paquetes)** — nunca se remueven; la casilla queda deshabilitada y el
  backend los rechaza aunque la UI se eluda. A salvo: Microsoft Store y apps clave.
- **"not installed"** — el paquete no está en tu sistema; la casilla está deshabilitada.
- **`skipped`** — al ejecutar, el paquete ya no existía (nada que hacer).
- **`failed`** — falta permiso de administrador o Windows devolvió el error real (se muestra
  por app en el resultado).
- **Falta admin** — reabrí la app con clic derecho → **Ejecutar como administrador**.

**Restaurar lo removido:** `Remove-AppxPackage` sólo quita el paquete **para tu usuario**;
reinstalalo desde la **Microsoft Store** o con `winget install <id>`.

**Garantía anti-inyección:** el renderer sólo puede enviar ids del catálogo (no nombres de
paquete arbitrarios); ids desconocidos, duplicados o con caracteres inválidos se descartan
**sin ejecutar PowerShell**.

---

### 17. SmartScreen: "Windows protegió tu PC" (binarios sin firmar)

**Síntomas:** al ejecutar el Setup o el Portable, Windows muestra _"Windows protegió tu
PC — Microsoft Defender SmartScreen impidió el inicio de una aplicación no reconocida"_.

**Por qué ocurre:** los binarios **no están firmados con un certificado de code signing**.
Sin firma Authenticode, SmartScreen desconfía de un `.exe` descargado de internet. **No
es un bug de la app ni se puede arreglar con código** — requiere un certificado **de
pago**.

**Si las PCs son tuyas (uso interno) — solución gratis:** el aviso lo dispara la "marca
de internet" que Windows le pone al `.exe` descargado. Quitala una vez y no vuelve a
aparecer en esa máquina:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\unblock-release.ps1
```

O clic derecho sobre el `.exe` → _Propiedades_ → **Desbloquear**. (Si te equivocaste de
archivo, podés volver a marcarlo con: `Set-Content -LiteralPath <exe> -Stream
Zone.Identifier -Value "[ZoneTransfer]`nZoneId=3"`.)

**Qué podés hacer (si no):**

1. _Más información_ → _Ejecutar de todas formas_ (el flujo esperado para software open
   source sin firmar).
2. Verificá la integridad primero: compará el SHA-256 con `checksums.sha256` de la Release
   (`Get-FileHash ".\FORCH.iA-WinOptimizer-Portable-x.y.z.exe" -Algorithm SHA256`).

**Qué NO sirve:** certificados autofirmados (siguen warning) o re-subir el binario.
**Cómo se elimina de verdad (para distribuir a terceros):** certificado **OV** (tras
ganar reputación) o **EV/Trusted Signing** (inmediato) — el desbloqueo de arriba es sólo
para tus propias PCs. Pasos, coste y wiring del build en
[docs/CODE_SIGNING.md](CODE_SIGNING.md).

---

### 18. Actualizaciones automáticas no funcionan (v0.5.0)

**Síntomas:** en _Settings → Updates_, _Automatic updates_ está deshabilitado, o el estado
queda en error, o el chequeo nunca encuentra nada.

**Por qué ocurre:**

- **Build portable** — el `.exe` portable se auto-extrae a una carpeta temporal; el
  `electron-updater` no puede reemplazarlo en caliente. Por eso el toggle se deshabilita y se
  explica en pantalla. **Solución:** usá la build instalable (NSIS) o descargá el Setup más
  reciente de GitHub Releases y reinstalá.
- **Build instalable sin `latest.yml`** — el updater necesita el `latest.yml` de
  electron-builder junto al Setup en la misma Release. Si falta, el chequeo falla con error.
  Se publica siempre junto a los binarios.
- **Sin conexión / firewall** — el chequeo consulta GitHub Releases. Verificá tu red.

**Recordatorio:** el botón _Check for Updates_ de la tarjeta consulta la API de GitHub
(informativo); _Check now_ dispara el chequeo del updater de fondo.

---

### 19. "Start with Windows" no se puede activar (v0.5.0)

**Síntomas:** el toggle aparece deshabilitado, o al activarlo vuelve a apagarse.

**Por qué ocurre:** en la build **portable** no aplica (la ruta del ejecutable es temporal), y
se muestra deshabilitado con la explicación. En la build instalable el toggle **lee el estado
real** de Windows: si el registro de arranque no se pudo escribir, el toggle refleja la
verdad en lugar de mentir. Verificá en _Administrador de tareas → Inicio_ o en
_Configuración → Aplicaciones → Inicio_.

---

### 20. Statistics: "No activity recorded yet"

**Síntomas:** la página Statistics muestra el empty state o gráficos vacíos.

**Por qué ocurre:** es **honesto**: todavía no hay eventos reales registrados. Los datos se
crean al usar el Cleaner (escaneo/limpieza), ejecutar una auditoría o _Free RAM_. No se
inventan valores. El **Export CSV** funciona igualmente (exporta el encabezado).

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

_Build. Learn. Evolve._

---

### Security Scan devuelve "Unknown" o "Requires admin"

**Síntomas:** El Security Scan muestra checks en "Unknown" o "Requires admin".

**Qué significa:**

- **Unknown**: el dato no se pudo leer (no es un error de permisos). El scanner no
  inventa resultados — prefiere declarar que no midió.
- **Requires admin**: el dato necesita elevación. El error observable fue "acceso
  denegado".
- **v0.9.0 — 6 checks admin-gated**: `lsass-protection`, `credential-guard`,
  `bitlocker-protectors`, `admin-accounts`, `firewall-inbound-rules` y
  `winrm-exposure` requieren elevación por diseño. Sin admin se reportan como
  `requires-admin` con el valor observado y **no cuentan para el score** (no se
  penaliza lo que no se pudo medir).

**Soluciones:**

1. Ejecuta la app como administrador si quieres medir los checks que requieren
   privilegios (ej. TPM, BitLocker).
2. Consulta `docs/SECURITY_CHECKS.md` para ver exactamente qué consulta hace cada
   check.
3. Si un check debería pasar pero sale "Unknown" de forma persistente, revisa que
   PowerShell no esté restringido y reporta el caso con la evidencia que muestra la UI.

**Nota:** el Security Scan es de solo lectura salvo auto-fix explícito. Desde v0.7.0
tres checks (`smb1`, `guest-account`, `remote-desktop`) ofrecen auto-fix reversible
con preview, confirmación y revert; el resto muestra guía o acción separada.

### Un scan devuelve todo "Unknown" en una máquina concreta

**Síntomas:** todos (o casi todos) los checks aparecen en "Unknown" con evidencia
vacía, aunque en otra máquina funcionen.

**Causa:** el scan batchea todos los checks en **un solo** script de PowerShell. Si
la lista crece, el script puede superar el límite de ~32767 caracteres de la línea
de comandos de Windows una vez codificado en Base64/UTF-16LE, y `-EncodedCommand`
no llega a arrancar (resultado vacío).

**Solución (v0.8.0):** `powershell.ts` detecta el caso y ejecuta el script desde un
`.ps1` temporal con `-File`, que no tiene ese límite. Si ves este síntoma en una
build antigua, actualiza. Si persiste, adjunta la evidencia que muestra la UI.

### El auto-fix de seguridad pide administrador

**Síntomas:** el diálogo de auto-fix muestra el cambio, pero el botón _Apply_ no está
disponible o aparece "requires-admin".

**Qué significa:** aplicar `smb1`, `guest-account` o `remote-desktop` es un cambio
persistente del sistema y **requiere elevación**. La app nunca falla en silencio: si no
corre como administrador, la acción se **deshabilita con el motivo**.

**Solución:** usá _Reiniciar como administrador_ en el mismo diálogo (lanza una
instancia elevada con `Start-Process -Verb RunAs`) o abrí la app con clic derecho →
_Ejecutar como administrador_.

### Cómo revertir un auto-fix de seguridad

Abrí el preview del check (botón _Auto-fix_) y usá **Revert**. Restaura el **valor previo
real** que la app capturó antes de aplicar; si nunca aplicaste ese fix, no hay valor
guardado y el revert no está disponible. El revert también requiere administrador.

### Una app de arranque se clasifica distinto de lo esperado (Boost)

El impacto de las apps de arranque se calcula por **señales observables** (origen, firma,
ruta del sistema, CPU/RAM medida en vivo, patrones genéricos del nombre), **no** por
listas de productos. Es esperable que una app firmada en reposo sea _low_ y suba a _high_
cuando su proceso está consumiendo CPU/RAM. El criterio completo está en
`docs/STARTUP_APP_IMPACT.md`.

---

## Verificación elevada (kit para el usuario)

Los 6 controles admin-gated del Security Scan y las operaciones de registro del
auto-fix **necesitan una sesión elevada**, que la app no puede concederse sola (Windows
muestra UAC y la app no puede aceptarlo por vos). Para esos casos el repo incluye un kit
que **se autoeleva una sola vez** y deja la evidencia en disco.

### Qué comando correr

Desde una PowerShell normal, en la raíz del repo:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1
```

Aparece **un** prompt de UAC. Aceptalo y la ventana elevada hace el trabajo; al terminar
imprime las rutas exactas del JSON y del `.log`.

Variante solo-scan (no toca el registro de RDP):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-elevated.ps1 -SkipRdpCycle
```

### Qué verifica, en orden

1. **Scan de seguridad real (22 checks)** — ejecuta el **mismo** escáner que la app
   (`scripts/security-scan-report.cjs` sobre el `dist/` compilado) y guarda cada check
   con su `status` y su `evidence`. Si falta `dist/`, el kit corre `npm run build` solo.
2. **Ciclo RDP revert → apply → revert** sobre `fDenyTSConnections`, **releyendo** el
   valor después de cada escritura para confirmarla. Si detecta una **sesión RDP activa**
   (`Win32_LogonSession` tipo 10), **no toca el registro** (falla en cerrado), lo reporta
   y sale con código `2`. Al terminar el ciclo deja el sistema **endurecido**
   (`fDenyTSConnections=1`).
3. **Estado final** — reporta SMBv1 (`Get-SmbServerConfiguration` con fallback a
   registro), RDP (`fDenyTSConnections`) y el DNS IPv4 de cada adaptador.

### Dónde queda el JSON

```
artifacts/elevated-verification/elevated-verification-latest.json   <- el más reciente
artifacts/elevated-verification/elevated-verification-<fecha>.json  <- copia con timestamp
artifacts/elevated-verification/elevated-verification-<fecha>.log   <- transcripción
artifacts/elevated-verification/security-scan-<fecha>.json          <- el scan crudo
```

Ese directorio está en `.gitignore` (es salida de máquina, nunca se commitea).

### Códigos de salida

| Código | Significado                                                           |
| ------ | --------------------------------------------------------------------- |
| `0`    | Todo confirmado (scan completo + ciclo RDP + estado final endurecido) |
| `1`    | Algún paso no quedó confirmado por el read-back                       |
| `2`    | Ciclo RDP **omitido**: había una sesión RDP activa (no se tocó nada)  |

> **Nota:** el kit es una **herramienta del repositorio**. Los binarios solo empaquetan
> `dist/`, `assets/`, `catalogs/` y `sources/`, así que este script **no viaja al
> producto**.
