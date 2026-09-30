# SPEC_INICIAL.md — FORCH.iA WinOptimizer

> **Built with FORCH.i by Paulo Velasco**
> FORCH.iA Ecosystem — App Oficial
> Fecha: 2026-09-30 | Versión: 0.1.0 | Estado: MVP

---

## 1. Visión General

**FORCH.iA WinOptimizer** es una suite de optimización para Windows que permite:
- **Escanear** el sistema (apps instaladas, servicios, archivos temporales)
- **Limpiar** archivos basura y cachés innecesarios
- **Optimizar** servicios de Windows
- **Remover** apps bloatware de forma segura
- **Aplicar tweaks** de rendimiento y privacidad
- **Actualizarse** automáticamente desde 4 fuentes GitHub

---

## 2. Requerimientos Funcionales

### 2.1 Módulo Scanner
- [ ] Escanear apps instaladas (Win32 + UWP)
- [ ] Escanear servicios de Windows
- [ ] Escanear archivos temporales y cachés
- [ ] Escanear programas de inicio
- [ ] Generar reporte de estado del sistema

### 2.2 Módulo Cleaner
- [ ] Limpiar archivos temporales (%TEMP%, Windows\Temp, Prefetch)
- [ ] Limpiar caché de navegadores (Chrome, Edge, Firefox)
- [ ] Limpiar caché de Windows Update
- [ ] Vaciar papelera de reciclaje
- [ ] Limpiar crash dumps
- [ ] Limpiar caché de miniaturas
- [ ] Estimar espacio recuperable antes de limpiar

### 2.3 Módulo ServiceManager
- [ ] Listar servicios de Windows con estado
- [ ] Comparar con catálogo de optimización
- [ ] Desactivar servicios seguros (con confirmación)
- [ ] Proteger servicios críticos (bloquear desactivación)
- [ ] Crear punto de restauración antes de cambios

### 2.4 Módulo AppManager
- [ ] Listar apps instaladas
- [ ] Comparar con catálogo de bloatware
- [ ] Desinstalar apps seguras (1 clic)
- [ ] Confirmación nivel 2 para apps "caution"
- [ ] Confirmación nivel 3 para apps "protected"
- [ ] Crear punto de restauración automático

### 2.5 Módulo Tweaks
- [ ] Aplicar tweaks de registro
- [ ] Aplicar tweaks de privacidad
- [ ] Aplicar tweaks de rendimiento
- [ ] Revertir tweaks aplicados
- [ ] Backup del registro antes de cambios

### 2.6 Módulo Updater (Sistema de Actualizaciones)
- [x] Monitorear 4 fuentes GitHub (kudu, winrift, winscript, winutil)
- [x] Detectar nuevas features, tweaks, apps, servicios
- [x] Comparar con catálogos locales
- [x] Sugerir nuevas adiciones al usuario
- [x] Importar automáticamente (con confirmación)
- [x] Reporte claro de cambios encontrados
- [x] Rechazar actualizaciones no deseadas

### 2.7 Sistema de Confirmaciones
- [ ] Nivel 1: Apps seguras — 1 clic
- [ ] Nivel 2: Apps caution — Confirmación con detalle
- [ ] Nivel 3: Apps protected — Confirmación con advertencia + typing
- [ ] Punto de restauración automático antes de cambios

### 2.8 Interfaz de Usuario
- [x] Dashboard con resumen del sistema
- [x] Navegación por pestañas
- [x] Diseño oscuro moderno
- [x] Badge "Built with FORCH.i by Paulo Velasco"
- [ ] Gráficos de uso de disco
- [ ] Barra de progreso para operaciones

---

## 3. Requerimientos No Funcionales

### 3.1 Rendimiento
- Arranque < 3 segundos
- Escaneo completo < 30 segundos
- UI responsiva (60 fps)

### 3.2 Seguridad
- No ejecutar como admin por defecto
- Elevar privilegios solo cuando sea necesario
- Validar todas las operaciones de registro
- Backup automático antes de cambios

### 3.3 Compatibilidad
- Windows 10 (20H2+)
- Windows 11 (todas las versiones)
- Arquitectura x64

### 3.4 Mantenibilidad
- Código modular (cada módulo independiente)
- Catálogos JSON actualizables
- Tests unitarios para cada módulo
- Documentación inline

### 3.5 Branding
- Badge "Built with FORCH.i by Paulo Velasco" en header y footer
- Paleta de colores FORCH.iA
- Logo y tipografía consistentes

---

## 4. Arquitectura Técnica

### 4.1 Stack
- **Framework:** Electron 31 + TypeScript 5.5
- **Frontend:** React 18 + Vite 5
- **Estilos:** CSS con variables (tema oscuro)
- **Build:** electron-builder (NSIS installer)

### 4.2 Estructura del Proyecto
```
forch-i-winoptimizer/
├── src/
│   ├── main/           # Proceso principal (Electron)
│   │   └── main.ts     # Ventana + IPC handlers
│   ├── preload/        # Bridge seguro
│   │   └── preload.ts  # API expuesta al renderer
│   └── renderer/       # UI (React)
│       ├── App.tsx     # Componente raíz
│       ├── main.tsx    # Entry point
│       └── styles.css  # Estilos globales
├── catalogs/           # Catálogos JSON
│   ├── apps-catalog.json
│   ├── services-catalog.json
│   ├── tweaks-catalog.json
│   └── cleaners-rules.json
├── sources/            # Configuración de fuentes
│   ├── sources.json    # Lista de repos a monitorear
│   └── last-check.json # Estado de última verificación
├── updater/            # Módulo de actualizaciones
│   ├── types.ts        # Tipos TypeScript
│   ├── check-updates.ts   # Verificar cambios
│   ├── diff-catalogs.ts    # Comparar catálogos
│   ├── import-updates.ts  # Importar lo nuevo
│   └── update-report.ts   # Reporte de actualizaciones
├── assets/             # Iconos y recursos
├── SPEC_INICIAL.md     # Este archivo
├── package.json
├── tsconfig.main.json
├── tsconfig.renderer.json
└── vite.config.ts
```

### 4.3 Sistema de Actualizaciones — Flujo

```
┌─────────────────────────────────────────────────────────────┐
│                    UPDATER FLOW                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. CHECK          2. DIFF           3. IMPORT               │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐             │
│  │ GitHub  │─────▶│ Compare │─────▶│ Merge   │             │
│  │ API     │      │ Catalogs│      │ & Save  │             │
│  └─────────┘      └─────────┘      └─────────┘             │
│       │                │                │                    │
│       ▼                ▼                ▼                    │
│  sources.json    local vs remote    updated catalogs          │
│  last-check.json new/modified/removed  last-check.json       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 Fuentes Monitoreadas

| ID | Nombre | URL | Tipo | Catálogos |
|----|--------|-----|------|-----------|
| kudu | Kudu | adventdevinc/kudu | base | apps, services, tweaks, cleaners |
| winrift | Winrift | emylfy/Winrift | tweaks | tweaks |
| winscript | Winscript | flick9000/Winscript | debloat | apps, services, tweaks |
| winutil | winutil | christitustech/winutil | ui-tweaks | apps, services, tweaks, cleaners |

---

## 5. Plan de Fases

### Fase 1: Proyecto Base ✅
- [x] Estructura del proyecto
- [x] package.json + tsconfig + vite config
- [x] Catálogos JSON iniciales
- [x] Sistema de actualizaciones (updater module)
- [x] UI base con navegación
- [x] Branding FORCH.iA

### Fase 2: Módulo Scanner
- [ ] Escaner apps instaladas
- [ ] Escanear servicios
- [ ] Escanear archivos temporales
- [ ] Dashboard con datos reales

### Fase 3: Módulo Cleaner
- [ ] Implementar reglas de limpieza
- [ ] Barra de progreso
- [ ] Confirmación antes de limpiar

### Fase 4: Módulo AppManager
- [ ] Desinstalar apps
- [ ] Sistema de confirmaciones (3 niveles)
- [ ] Punto de restauración

### Fase 5: Módulo ServiceManager
- [ ] Gestionar servicios
- [ ] Protección de servicios críticos

### Fase 6: Módulo Tweaks
- [ ] Aplicar tweaks de registro
- [ ] Revertir tweaks
- [ ] Backup del registro

### Fase 7: Instalador + Distribución
- [ ] electron-builder config
- [ ] Instalador NSIS
- [ ] Icono y assets finales

### Fase 8: Tests + Documentación
- [ ] Tests unitarios
- [ ] Tests de integración
- [ ] README.md
- [ ] Documentación de usuario

---

## 6. Criterios de Aceptación

### 6.1 Sistema de Actualizaciones
- Dado que el usuario hace clic en "Verificar Actualizaciones"
- Cuando el sistema consulta las 4 fuentes GitHub
- Entonces muestra un reporte claro de lo nuevo encontrado
- Y permite importar o rechazar cada cambio

### 6.2 Catálogos
- Dado que se detecta un nuevo item en una fuente
- Cuando se compara con el catálogo local
- Entonces se identifica como nuevo, modificado o eliminado
- Y se presenta al usuario para su aprobación

### 6.3 Branding
- Dado que se abre la aplicación
- Cuando se muestra la interfaz
- Entonces el badge "Built with FORCH.i by Paulo Velasco" es visible
- Y la paleta de colores es consistente con FORCH.iA

### 6.4 Seguridad
- Dado que el usuario intenta desinstalar una app "protected"
- Cuando se muestra el diálogo de confirmación
- Entonces se requiere typing "CONFIRM" para proceder
- Y se crea un punto de restauración automático

---

## 7. Skill de OpenCode — "vamos a buscar actualizaciones"

**Ubicación:** `D:\OTRO DISCO\FORCH-IA\FORCH-IA-ECOSYSTEM\plugins\skills\forchi-skills\winoptimizer-updates\SKILL.md`

**Triggers:**
- "vamos a buscar actualizaciones"
- "buscar actualizaciones"
- "revisar fuentes"
- "check updates"
- "actualizar catálogos"
- "nuevas features de winoptimizer"

**Qué hace:**
1. Ejecuta `updater:check` en la app WinOptimizer
2. Muestra el reporte de cambios encontrados
3. Pregunta al usuario si desea importar lo nuevo
4. Ejecuta `updater:import-all` o `updater:reject-all` según decisión

---

## 8. Referencias

- **Ecosistema:** FORCH.iA (220 agents, 330 skills, 85 rules)
- **Branding:** `plugins/custom-agents/forchi-brand-guardian/`
- **SDD Factory:** `plugins/custom-agents/sdd-factory-agent/`
- **Ecosystem Protocol:** `docs/ECOSYSTEM_FIRST_PROTOCOL.md`

---

*Built with FORCH.i by Paulo Velasco — FORCH.iA Ecosystem*
