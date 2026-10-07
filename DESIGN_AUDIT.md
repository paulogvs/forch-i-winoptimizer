# DESIGN_AUDIT.md — FORCH.iA WinOptimizer

> **Análisis de diseño UI/UX — solo lectura.** No se modificó código de la aplicación.
> Auditoría: @f.design · App v0.18.0 · Rama `main` · Working tree limpio.
> Documento anexo a `PLAN_MEJORAS.md` (no lo reemplaza: aquel cubre rendimiento/funcional; este cubre diseño).
> **Built with FORCH.i by Paulo Velasco**

---

## 0. Alcance, método y estado de gates

**Método:** lectura de tokens, CSS de componentes/layout, 17 componentes UI, 4 de layout, 14 páginas,
`tailwind.config.ts`, `DESIGN.md`, `SPEC_INICIAL.md`, `PLAN_MEJORAS.md`, `index.html`, config de ventana Electron.

**Gates deterministas:**

| Gate | Estado | Evidencia |
| ---- | ------ | --------- |
| `g.tokens` (no hex hardcodeado fuera de tokens) | **PARCIAL — FALLA** | Escaneo `#[0-9a-fA-F]{3,8}` en `src/renderer/**.tsx` → limpio salvo test. Pero hex **sí** aparece en CSS de componentes: `components.css:38,68,72,253` y `layout.css:177`. |
| `g.a11y` (contraste WCAG AA) | **EJECUTADO (equivalente)** | Script Node con fórmula de luminancia relativa WCAG 2.x sobre los pares de tokens reales. Resultados en §3. |
| `g.a11y` (axe-core / Playwright) | **NO EJECUTADO — VERIFICADO PARCIAL** | La superficie es Electron (requiere runtime + `window.electronAPI`); no hay build/servidor disponible en esta sesión. Marcado como **unverified**. Comando sugerido en §7. |
| `g.brand` | **REVISIÓN MANUAL** | §4. Paleta y badge correctos; favicon e iconografía no conformes. |

Las cifras de contraste de §3 son evidencia fresca y reproducible (`node -e "..."`, ver §3.1).

---

## 1. INVENTARIO ACTUAL DE DISEÑO

### 1.1 Sistema de tokens — **existe y es la fuente de verdad** (`src/renderer/styles/tokens.css`)

- **Colores** (`tokens.css:7-60`): 5 fondos, 4 foreground, acento cian (`--color-accent: #06b6d4`), 4 semánticos
  (+ `*-muted`), `--color-danger`/`--color-danger-foreground` (`:37-38`), 2 de borde, 4 sombras, 6 de charts.
- **Dark/light** (`tokens.css:110-156`): modo claro completo y bien derivado (acentos oscurecidos para contraste).
  ⚠️ El bloque claro **no redefine** `--color-chart-*` (`tokens.css:54-60` solo en `:root`).
- **Tipografía** (`tokens.css:63-78`): Inter + JetBrains Mono; escala `--text-xs`(11) → `--text-2xl`(32); 4 pesos.
- **Espaciado** (`tokens.css:81-91`): base 4px, 11 pasos. **Radios** (`:94-99`): 6 pasos. **Motion** (`:102-106`): 3 duraciones + 2 easings.
- **Accesibilidad global** (`tokens.css:253-262`): `prefers-reduced-motion` respetado; `:focus-visible` global (`:290-293`).
- **Binding a Tailwind** (`tailwind.config.ts:8-105`): cada token expuesto como utilidad (`bg-*`, `fg-*`, `accent`, `space-*`, `radius-*`, `shadow-*`). `darkMode: ['selector','[data-theme="dark"]']`.
- **Acento dinámico** (`utils/accent.ts:76-105`): el usuario elige un hex y se derivan `--color-accent`, `-hover`, `-muted`, `--color-border-focus`, `--color-chart-primary`. **Buen patrón de tokenización.**

### 1.2 Componentes UI (`src/renderer/components/ui/`) — 17 componentes, todos con test

| Componente | Archivo | Calidad |
| --- | --- | --- |
| Button | `Button.tsx` | 4 variantes, 3 tamaños, loading, icon. Sólido. |
| Card | `Card.tsx` | title/header/footer/hoverable. Correcto. |
| Badge | `Badge.tsx` | 5 variantes. Contraste en claro falla (§3). |
| Modal | `Modal.tsx` | `role=dialog`, Esc, overlay click. **Sin focus trap.** |
| Toggle | `Toggle.tsx` | `role=switch` + `aria-checked` + teclado. Correcto. |
| Input | `Input.tsx` | label/error/helper + `aria-invalid`/`aria-describedby`. Muy bueno. |
| Toast | `Toast.tsx` | `aria-live` + acción + dismiss. **Live region anidada.** |
| Tooltip | `Tooltip.tsx` | Hover/focus. Prop `position` **muerta**. |
| Progress | `Progress.tsx` | Determinado + indeterminado. **Indeterminado sin CSS.** |
| ScanProgress | `ScanProgress.tsx` | Stepper 5 etapas + % real. Excelente. |
| Skeleton | `Skeleton.tsx` | 4 formas, `aria-hidden`. Excelente. |
| EmptyState | `EmptyState.tsx` | icono+título+CTA. Correcto. |
| BarChart/LineChart | `BarChart.tsx`, `LineChart.tsx` | SVG propio, `role=img` + lista `sr-only`. Excelente a11y. |
| VirtualList | `VirtualList.tsx` | `@tanstack/react-virtual`. Correcto. |

### 1.3 Layout (`components/layout/`)

- `Layout.tsx:32-46` shell: Sidebar fija 240px + Header sticky + `main-content` (max 1400px, `layout.css:187-193`) + StatusBar.
- `Sidebar.tsx:9-24`: 14 ítems con **emoji** como icono; marca con lockup theme-aware (`Sidebar.tsx:30-39`); badge de marca en footer (`:56-65`).
- `Header.tsx:132-190`: búsqueda, badge de operación en curso (`:147-158`), Free RAM, tema, settings, avatar, controles de ventana.
- `WindowControls.tsx`: minimizar/maximizar/cerrar accesibles (`aria-label`, `aria-pressed`).

### 1.4 Consistencia entre las 14 páginas

**Alta.** Todas usan `<div className="page"><h2 className="page-title">`, `Card`, `Button`, `Badge`, `Skeleton`,
`EmptyState`, `ScanProgress`. El estado inicial con skeleton y el estado vacío con `EmptyState` son sistemáticos
(`Dashboard.tsx:57-76`, `Cleaner.tsx:156-195`, `Tweaks.tsx:438-451`). Documentación de diseño:
`DESIGN.md` (867 líneas) coherente con `tokens.css`, salvo omisiones (§6-P3).

---

## 2. EVALUACIÓN HEURÍSTICA (Nielsen) + criterios

| # | Heurística | Nota | Evidencia |
| - | --- | --- | --- |
| 1 | Visibilidad del estado del sistema | **9/10** | `Header.tsx:147-158` (badge de operación + cola), `ScanProgress`, `Skeleton`, toasts. |
| 2 | Correspondencia con el mundo real | **8/10** | Copy honesto: "Free RAM · this app's own working set" (`Header.tsx:93,129-130`), receipts de fallo (`Cleaner.tsx:159-182`). |
| 3 | Control y libertad del usuario | **7/10** | Esc en Modal, cancel de perfil (`Settings.tsx:534-542`). Falta focus trap/restore (§3). |
| 4 | Consistencia y estándares | **7/10** | Sistema de tokens fuerte, pero **iconografía emoji** vs SVG (mix), search decorativo, StatusBar estático. |
| 5 | Prevención de errores | **8/10** | Preview obligatorio de perfiles (`Settings.tsx:250-273`), `aria-invalid`, Toggle con tooltip. |
| 6 | Reconocer antes que recordar | **8/10** | `Card` con título, KPIs etiquetados, stepper de scans. |
| 7 | Flexibilidad y eficiencia | **7/10** | Quick fixes (`Dashboard.tsx:188-189`), búsqueda **no implementada**. |
| 8 | Estética y minimalismo | **8/10** | Densidad compacta intencional, jerarquía por `--text-*` clara; **doble borde** KPI (§6). |
| 9 | Recuperación de errores | **8/10** | Roles `alert`, retry de limpieza, mensajes por operación. |
| 10 | Ayuda y documentación | **7/10** | helperText, tooltips, `title`; sin ayuda in-app contextual. |

**Jerarquía visual:** buena (título → KPI → detalle). **Ritmo/espaciado:** grid de 4px consistente; alguna
desviación por utilidades ad-hoc. **Tipografía:** bien; mono para datos es apropiado. **Estados:** loading/empty/
error cubiertos; **éxito** vía toast; falta estado *success* persistente en algunas páginas. **Motion:** funcional
y con `prefers-reduced-motion`; el indeterminado está roto (§6-P1). **Affordances:** botones claros; el search
es una affordance falsa (§6-P1). **Responsive Electron:** breakpoints ≤768px **inalcanzables** por `minWidth:960`
(`main/index.ts:37`) → CSS muerto (`layout.css:209-243`).

---

## 3. AUDITORÍA DE ACCESIBILIDAD

### 3.1 Contraste WCAG (evidencia fresca, reproducible)

Fórmula: luminancia relativa WCAG 2.x. Comando ejecutado (solo-lectura, sin escribir archivos):

```
node -e "const L=h=>{...}; const R=(a,b)=>{...}; ..."
```

| Par (token) | Ratio | AA normal (4.5) | Severidad |
| --- | ---: | --- | --- |
| **texto blanco sobre `--color-accent` #06b6d4** (btn-primary) | **2.43** | ❌ FAIL | **P0** |
| texto blanco sobre accent claro #0891b2 | 3.68 | ❌ FAIL | P1 |
| `--color-fg-disabled` #6b7280 sobre #111827 | 3.67 | ⚠️ (exento si *disabled*) | P2 |
| `--color-fg-disabled` sobre blanco (claro) | 2.56 | ⚠️ (exento) | P2 |
| **badge success (claro)** #10b981 / muted | **2.27** | ❌ FAIL | P1 |
| **badge warning (claro)** #f59e0b / muted | **1.96** | ❌ FAIL | P1 |
| **badge error (claro)** #ef4444 / muted | **3.23** | ❌ FAIL | P1 |
| **badge info (claro)** #3b82f6 / muted | **3.20** | ❌ FAIL | P1 |
| badge error (oscuro) #ef4444 / muted | 4.08 | ❌ FAIL | P1 |
| badge info (oscuro) #3b82f6 / muted | 4.00 | ❌ FAIL | P1 |
| **btn-danger** blanco/#ef4444 | 3.76 | ❌ FAIL | P1 |
| fg-primary/secondary/tertiary, accent, success, warning, error, info (oscuro) | 4.8–18.4 | ✅ PASS | — |
| modo claro fg-primary/tertiary | 4.76–17.06 | ✅ PASS | — |

**Conclusión:** el sistema de texto base es sólido; el fallo se concentra en **(a) texto blanco sobre botones de color**
(y sobre el acento personalizable) y **(b) badges semánticos en modo claro**. Como el acento es **configurable**
por el usuario (`accent.ts`), el riesgo de contraste es sistémico: no existe un token de "texto sobre acento".

### 3.2 Foco, teclado, ARIA, roles, targets

- ✅ `:focus-visible` global (`tokens.css:290-293`) + por componente. Navegación por teclado en Toggle (Enter/Space, `Toggle.tsx:21-26`) y WindowControls.
- ✅ Roles correctos: `dialog`+`aria-modal` (`Modal.tsx:48-51`), `switch`+`aria-checked` (`Toggle.tsx:31-32`), `progressbar` (`Progress.tsx:36,56`), `status`/`alert`, `img`+`aria-label` (charts).
- ✅ Charts no dependen del color (lista `sr-only`, `BarChart.tsx:112-118`).
- ❌ **Modal sin focus trap ni restauración de foco** (`Modal.tsx:26-30` enfoca, pero Tab escapa al fondo; no vuelve al trigger). `aria-labelledby="modal-title"` es un **id fijo** (`:50,54`) → colisiona con 2 modales.
- ⚠️ **Toast con doble live region**: contenedor `aria-live="polite"` (`Toast.tsx:67`) + `role="status"` por ítem (`:78`) puede duplicar el anuncio.
- ⚠️ `aria-label="User profile"` sobre un `<div>` sin rol (`Header.tsx:185`) → ignorado por AT.
- ⚠️ Checkbox de tweak 16px sin `label` envolvente (`components.css:986-987`, `Tweaks.tsx:324-331`) → target < 24px (WCAG 2.5.8); los botones `sm` (28px) y `md` (36px) cumplen.
- ✅ `prefers-reduced-motion` global (`tokens.css:253-262`).

---

## 4. CUMPLIMIENTO DE MARCA FORCH.i

| Criterio | Estado | Evidencia |
| --- | --- | --- |
| Paleta FORCH.i (cian) | ✅ | `tokens.css:22` `#06b6d4`; reset "brand cyan" (`Settings.tsx:335-338`). |
| Lockup theme-aware en sidebar | ✅ | `Sidebar.tsx:30-39`, `layout.css:53-63`; assets `public/brand/lockup-{dark,light}.png`. |
| Badge "Built with FORCH.i by Paulo Velasco" | ⚠️ Parcial | Presente en sidebar (`Sidebar.tsx:56-65`) y About (`Settings.tsx:637`); `SPEC_INICIAL §3.5` pide **header y footer**. |
| Jerarquía (app = estrella, FORCH.iA = sello) | ✅ | Marca discreta, app protagonista. |
| Iconografía de marca | ❌ | Nav con emoji (`Sidebar.tsx:9-24`); header con emoji (`Header.tsx:174,183`); favicon Vite por defecto (`index.html:5`). |
| Tipografía de marca | ✅ | Inter/JetBrains Mono (`index.html:13-18`) — **remoto** (riesgo offline/privacy, P2). |

---

## 5. HALLAZGOS PRIORIZADOS

Severidad: **P0** rompe accesibilidad/uso · **P1** defecto relevante de diseño/UX · **P2** pulido/tokens · **P3** cosmético/docs.

| ID | Sev | Problema | Evidencia (archivo:línea) | Recomendación concreta |
| --- | --- | --- | --- | --- |
| H1 | **P0** | Botón primario: texto blanco sobre cian = **2.43:1** (falla AA; también 3.68:1 en claro). Es el CTA de todas las páginas y el acento es configurable. | `components.css:36-39`; `tokens.css:22`; `accent.ts:92-104` | Añadir token `--color-on-accent` y usarlo en `.btn-primary`/`.user-avatar`; calcular el color de texto por luminancia del acento (`accent.ts` ya exporta `luminance()`), eligiendo `#0a0e1a`/`#ffffff` para garantizar ≥4.5:1. Alternativa: oscurecer el cian de botón a ≥`#0e7490` en claro y usar texto oscuro en oscuro. |
| H2 | **P1** | `Progress` indeterminado sin CSS: `.progress-indeterminate`/`.progress-bar-animated` (usados en TSX) **no existen** en ningún CSS → barra estática, sin animación ni `prefers-reduced-motion`. | `Progress.tsx:35,40`; grep en `styles/` → **sin resultados** | Definir en `components.css` `@keyframes progress-indeterminate` + `.progress-indeterminate .progress-bar{width:40%;animation:...}` y cubrir con `@media (prefers-reduced-motion)` (o usar el `pulse` ya existente). |
| H3 | **P1** | Feature de **presets de Tweaks** sin estilos: `.tweak-card`, `.tweak-preset`, `.tweak-preset-modes`, `.tweak-preset-mode`, `.tweak-preset-children`, `.tweak-warning`, `.tweak-preview` no existen → radios/listas sin formato y aviso de riesgo sin color semántico. | `Tweaks.tsx:105-144,321,361,459`; grep `styles/` → **sin resultados** | Añadir bloque CSS para preset (radiogroup con estados checked/focus, listas con espaciado) y `.tweak-warning{color:var(--color-warning)}`. |
| H4 | **P1** | Badges semánticos **fallan AA en modo claro** (success 2.27, warning 1.96, error 3.23, info 3.20) y dos en oscuro (error 4.08, info 4.00); el texto es 11px (texto normal). | `components.css:286-309`; `tokens.css:130-145` | En `[data-theme='light']` usar variantes `-600/700` (p.ej. success `#047857`, warning `#b45309`, error `#b91c1c`, info `#1d4ed8`) para el **texto** del badge, o bajar la luminancia del fondo muted. En oscuro, oscurecer info/error de texto o subir el alfa del muted. |
| H5 | **P1** | `btn-danger` blanco/#ef4444 = **3.76:1** (falla AA). | `components.css:66-69` | Igual que H1: token `--color-danger-foreground` (ya existe, `tokens.css:38`) + usar un rojo más oscuro para el fondo por defecto, o texto oscuro cuando el rojo sea claro. |
| H6 | **P1** | **Búsqueda del header decorativa**: `searchQuery` se guarda pero ninguna página la consume ni filtra nada. | `Header.tsx:135-144`; `App.tsx:31,54-56`; `Layout.tsx:100-101`; grep consumidores → solo el propio Header | Ocultar el input hasta implementar búsqueda, o implementarla (filtrar ítems del sidebar + contenido de página activa). Mientras tanto, `disabled` + tooltip "Coming soon" para no mentir. |
| H7 | **P1** | **Modal sin focus trap/restore** y `aria-labelledby` con id fijo → Tab sale al fondo y dos modales comparten título accesible. | `Modal.tsx:26-30,50` | Atrapar Tab/Shift+Tab dentro del diálogo, devolver el foco al disparador al cerrar, y generar id único con `useId()`. |
| H8 | **P2** | **Iconografía emoji** en nav y header → renderizado dependiente de plataforma, rompe la estética "surgical instrument" y la marca. | `Sidebar.tsx:9-24`; `Header.tsx:174,183` | Introducir `Icon` component con SVG inline (stroke `currentColor`), 20px, y sustituir emoji. Mantener `aria-hidden`. |
| H9 | **P2** | **Tokens violados** en CSS: hex literales pese a existir tokens. | `components.css:38,68,72,253`; `layout.css:177` (`.user-avatar #ffffff`); tokens disponibles en `tokens.css:37-38` | Reemplazar `#ffffff`→`--color-on-accent`/`--color-danger-foreground` y `#dc2626`→`--color-error` (o token `--color-danger-hover`). |
| H10 | **P2** | **KPI card anidada**: `Card` (borde+padding) contiene `.kpi-card` (borde+padding) → doble borde y padding. | `Dashboard.tsx:88-97`; `components.css:110-119,484-492` | Usar `.kpi-card` sin envolver en `Card`, o neutralizar borde/padding: `.card .kpi-card{border:0;padding:0;background:transparent}`. |
| H11 | **P2** | **Responsive muerto**: breakpoints ≤768 (`layout.css:209-243`) inalcanzables por `minWidth:960`; el colapso del sidebar nunca ocurre. | `main/index.ts:37`; `layout.css:209-243` | Definir comportamiento real para 960–1100px (rail de iconos) o eliminar el bloque y documentar "desktop-only". |
| H12 | **P2** | **Favicon Vite por defecto** (`/vite.svg`) → incumple marca. | `index.html:5` | Apuntar al icono de marca (`assets/icons/icon.ico` o un `favicon.svg` FORCH.iA). |
| H13 | **P2** | **Fuentes remotas** (Google Fonts) en app de escritorio → fallback si offline y llamada externa. | `index.html:13-18` | Empaquetar `Inter`/`JetBrains Mono` (subset woff2) o aceptar fallback documentándolo. |
| H14 | **P2** | **Toast doble live region** (contenedor `aria-live` + `role="status"` por ítem). | `Toast.tsx:67,78` | Quitar `role="status"` de los ítems (dejar el contenedor) o viceversa. |
| H15 | **P2** | `StatusBar` muestra "Ready"/online **hardcodeado**, sin estado real; `lastScan` siempre `null`. | `StatusBar.tsx:16-21`; `App.tsx:32` | Derivar el indicador del estado real (operación en curso / último scan) o retirar el punto "online". |
| H16 | **P2** | `.btn-icon` (usado por `Button`) sin CSS; `.tooltip` ignora la prop `position`; checkboxes de 16px sin label envolvente. | `Button.tsx:34`; `Tooltip.tsx:9,13-18`; `components.css:986-987` | Definir `.btn-icon{display:inline-flex;line-height:0}`; implementar `position` o eliminar la prop; envolver checkbox en `<label>`/ampliar hit-area. |
| H17 | **P3** | `DESIGN.md` desincronizado: no documenta `--color-danger`, `.kpi-card`, `.scan-progress`, `.toast`, `.skeleton`, `.virtual-list`, `.tweak-*`, `.quick-fix-bar`; declara breakpoints que no aplican y `page-title` en `--text-lg` cuando el CSS usa `--text-xl`. | `DESIGN.md:146-154,719-726`; `layout.css:200-206` | Actualizar `DESIGN.md` a la implementación real (o marcar como aspiracional). |
| H18 | **P3** | Estado Zustand `useAppStore.searchQuery` sin uso (App usa `useState`). | `stores/useAppStore.ts:9,23,28`; `App.tsx:31` | Unificar en el store o eliminar el campo muerto. |

---

## 6. PLAN DE EJECUCIÓN SIN ROMPER FUNCIONALIDAD

**Principios:** no cambiar APIs de componentes (solo añadir props opcionales); cada cambio con test que ya existe o test nuevo; verificar con `npm run typecheck && npm run lint && npm test && npm run test:e2e`. Los cambios de tokens son retro-compatibles porque todos los componentes derivan de variables CSS.

### Fase A — Accesibilidad de color (P0/P1: H1, H4, H5, H9) — 1 día

| Cambio | Archivos | Riesgo | Verificación |
| --- | --- | --- | --- |
| Nuevo token `--color-on-accent` (dark/light) + helper `contrastOn(hex)` en `accent.ts` | `styles/tokens.css`, `utils/accent.ts` | Bajo (aditivo) | **Test nuevo** `utils/accent.test.ts`: `contrast(contrastOn(c), c) >= 4.5` para #06b6d4, #0891b2 y acentos arbitrarios. |
| `.btn-primary`/`.user-avatar` usan `--color-on-accent`; `.btn-danger` usa `--color-danger-foreground` y fondo oscurecido | `styles/components.css:36-39,66-73`, `styles/layout.css:177` | Bajo (visual) | `Button.test.tsx` (existe); **e2e** `navigation.spec.ts`/`dashboard.spec.ts` no deben romper. |
| Colores de texto de badge en claro/oscuro + alfa muted | `styles/components.css:286-309`, `styles/tokens.css:130-145` | Bajo | `Badge.test.tsx` (existe); re-ejecutar script de contraste en §3.1 (KPIs §8). |
| Reemplazar hex literales por tokens | `styles/components.css`, `styles/layout.css` | Muy bajo | `g.tokens` re-scan: 0 hex en CSS. |

### Fase B — Componentes faltantes (P1: H2, H3) — 1 día

| Cambio | Archivos | Riesgo | Verificación |
| --- | --- | --- | --- |
| CSS del Progress indeterminado + keyframes + reduced-motion | `styles/components.css` | Bajo | `Progress.test.tsx` (existe); **test nuevo**: `[data-testid]` con `aria-valuetext`. |
| CSS de preset/warning/card de Tweaks | `styles/components.css` | Bajo (solo estilos) | `Tweaks.test.tsx` + e2e `tweaks.spec.ts` (existen). |
| `.btn-icon` definido | `styles/components.css` | Muy bajo | `Button.test.tsx`. |

### Fase C — Modal y a11y de teclado (P1: H7, H14, H16) — 1 día

| Cambio | Archivos | Riesgo | Verificación |
| --- | --- | --- | --- |
| Focus trap + restore + `useId()` en Modal | `ui/Modal.tsx` | Medio (comportamiento) | `Modal.test.tsx` extendido (Tab cicla, foco vuelve al trigger, Esc cierra). |
| Live region única en Toast | `ui/Toast.tsx` | Bajo | `Toast.test.tsx` (existe). |
| `position` de Tooltip real o eliminado; hit-area de checkboxes | `ui/Tooltip.tsx`, `styles/components.css`, `Tweaks.tsx` | Bajo | `Tooltip.test.tsx`, `Tweaks.test.tsx`. |

### Fase D — Marca e iconografía (P2: H8, H12, H13) — 1–2 días

| Cambio | Archivos | Riesgo | Verificación |
| --- | --- | --- | --- |
| `Icon` SVG set + reemplazo de emoji en nav/header | `components/ui/Icon.tsx` (nuevo), `Sidebar.tsx`, `Header.tsx` | Medio (visual) | `Header.test.tsx`, `nav` e2e `navigation.spec.ts`; snapshot visual opcional. |
| Favicon de marca | `index.html`, `public/` | Bajo | Inspección visual / `dist/index.html`. |
| Fuentes locales | `index.html`, `public/fonts/` | Bajo | `format:check` + build. |

### Fase E — UX honesta y pulsos (P1/P2: H6, H15, H11, H10) — 1–2 días

| Cambio | Archivos | Riesgo | Verificación |
| --- | --- | --- | --- |
| Search: implementar o marcar `disabled`+tooltip | `Header.tsx` | Bajo | `Header.test.tsx` (existe). |
| StatusBar con estado real (o sin "online" falso) | `layout/StatusBar.tsx`, `App.tsx` | Bajo | **test nuevo** `StatusBar.test.tsx`. |
| Neutralizar `.card .kpi-card` | `styles/components.css` | Muy bajo | `dashboard.spec.ts`. |
| Decidir rail 960–1100px o retirar CSS muerto | `styles/layout.css` | Bajo | `window.spec.ts`. |

### Fase F — Documentación (P3: H17, H18) — 0.5 día

Actualizar `DESIGN.md` al estado real y limpiar el store muerto. Verificación: revisión + `typecheck`/`lint`.

**Verificación global (Iron Law):** `npm run typecheck` · `npm run lint` · `npm run format:check` · `npm test` (Vitest, 588) · `npm run test:e2e` (Playwright) · `npm run test:e2e:electron`.

**Gate a11y completo (cuando haya runtime):** iniciar `npm run dev`, luego `agent_browser_a11y` (axe-core) sobre `http://localhost:5173` para las 14 páginas; adjuntar el reporte. Hoy **unverified**.

---

## 7. KPIs DE MEJORA (antes → después esperado)

| KPI | Antes | Después objetivo | Cómo se mide |
| --- | --- | --- | --- |
| Pares de contraste que fallan AA (texto normal) | **8** (H1,H4×6,H5) | **0** | Script §3.1 |
| Hex hardcodeados en CSS fuera de `tokens.css` | 5 (`components.css:38,68,72,253`; `layout.css:177`) | **0** | grep `#[0-9a-fA-F]{3,8}` en `styles/*.css` |
| Clases CSS usadas por TSX pero no definidas | ≥9 (H2×2, H3×6, H16×1) | **0** | diff entre clases usadas y definidas |
| Cobertura de estados (loading/empty/error/success) por página | 12/14 con empty+loading; success solo toast | 14/14 con estado success persistente donde aplique | checklist |
| Componentes reutilizados vs. inline | 17 UI + 4 layout | sin regresión; +1 (`Icon`) | conteo |
| Affordances falsas (search, StatusBar) | 2 | **0** | revisión |
| Contraste mín. CTA primario | 2.43:1 | **≥4.5:1** | script §3.1 |
| a11y axe (violaciones) | *unverified* | 0 críticas/serias | axe-core |
| Cobertura de test de UI | 13 archivos `.test.tsx` UI + layout | +3 (`accent`, `StatusBar`, Modal extendido) | `npm test` |

---

## 8. SCORING POR DIMENSIÓN

| Dimensión | Score | Justificación breve |
| --- | ---: | --- |
| **Visual** (jerarquía, ritmo, tipografía, terminación) | **78** | Sistema coherente y pulido; penalizan doble borde KPI (H10) e indeterminado roto (H2). |
| **Consistencia** (tokens, sistema, componentes) | **72** | Tokenización ejemplar; penalizan hex literales (H9), CSS faltante (H2/H3), responsive muerto (H11). |
| **Accesibilidad** | **60** | Excelente base (roles, focus-visible, reduced-motion, charts accesibles) pero fallos AA de contraste (H1/H4/H5) y Modal sin trap (H7). |
| **Marca FORCH.i** | **80** | Paleta, lockup y badge correctos; penalizan emoji-iconos y favicon (H8/H12). |
| **UX / funcional** | **70** | Estados honestos y feedback fuertes; penalizan search decorativo (H6) y StatusBar falso (H15). |
| **TOTAL (promedio ponderado)** | **72/100** | Base sólida; deuda concentrada en color/accesibilidad y piezas de sistema faltantes. |

---

## 9. RESUMEN EJECUTIVO Y VEREDICTO

Sistema de diseño **maduro y disciplinado**: tokens como única fuente de verdad, 17 componentes UI testeados,
estados loading/empty/error sistemáticos, charts accesibles y respeto de `prefers-reduced-motion`. El mayor
riesgo es de **color/accesibilidad**: el CTA primario (texto blanco sobre cian) rinde **2.43:1** — falla WCAG AA
de forma transversal y se agrava porque el acento es configurable por el usuario. Le siguen piezas de sistema
incompletas (Progress indeterminado y preset de Tweaks **sin CSS**), un Modal sin focus trap, y señales de UX
poco honestas (search decorativo, StatusBar "online" falso). Ninguna corrección propuesta modifica APIs de
componentes ni lógica de negocio: son tokens, CSS y a11y, de bajo riesgo y alto retorno.

**VEREDICTO: CAMBIOS NECESARIOS**

Bloqueantes antes de "aprobado": (1) contraste de botones/badges AA (H1, H4, H5), (2) definir el CSS faltante
de Progress indeterminado y de los presets de Tweaks (H2, H3), (3) focus trap/restore en Modal (H7). Con las
Fases A–C completadas, el scoring proyectado de accesibilidad sube a ~90 y el total a ~86.

---

_Built with FORCH.i by Paulo Velasco — FORCH.iA Ecosystem. Documento de auditoría (solo lectura del código)._
