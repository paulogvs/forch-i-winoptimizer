# FORCH.iA WinOptimizer — DESIGN.md

> **Built with FORCH.i by Paulo Velasco**
> FORCH.iA Ecosystem App — System Design Specification

---

## 1. Visual Theme

**Mood:** Mission Control / System Utility — professional, precise, trustworthy
**Density:** Compact (information-dense, power-user oriented)
**Philosophy:** "System optimization should feel like a surgical instrument, not a toy"
**Aesthetic:** Dark-first with light mode support, cyan/amber accent system, monospace data display

---

## 2. Color Palette

### 2.1 Core Tokens (CSS Variables)

```css
/* === DARK MODE (default) === */
:root {
  /* Backgrounds */
  --color-bg-primary: #0a0e1a; /* Deep space black-blue */
  --color-bg-secondary: #111827; /* Panel background */
  --color-bg-tertiary: #1f2937; /* Card/elevated surface */
  --color-bg-hover: #374151; /* Hover state */
  --color-bg-active: #4b5563; /* Active/pressed state */

  /* Foreground */
  --color-fg-primary: #f9fafb; /* Primary text */
  --color-fg-secondary: #d1d5db; /* Secondary text */
  --color-fg-tertiary: #9ca3af; /* Tertiary/muted text */
  --color-fg-disabled: #6b7280; /* Disabled text */

  /* Accent — Cyan (primary brand) */
  --color-accent: #06b6d4; /* Primary accent */
  --color-accent-hover: #22d3ee; /* Accent hover */
  --color-accent-muted: rgba(6, 182, 212, 0.15); /* Accent background */
  --color-accent-content: #22d3ee; /* Bright text on muted accent (nav-active) */
  --color-on-accent: #0a0e1a; /* AA text on accent fills (Fase A: white-on-cyan fails) */

  /* Semantic — Success */
  --color-success: #10b981;
  --color-success-muted: rgba(16, 185, 129, 0.15);
  --color-success-content: #10b981; /* Badge text (AA on muted) */

  /* Semantic — Warning */
  --color-warning: #f59e0b;
  --color-warning-muted: rgba(245, 158, 11, 0.15);
  --color-warning-content: #f59e0b; /* Badge text (AA on muted) */

  /* Semantic — Error/Danger */
  --color-error: #ef4444;
  --color-error-muted: rgba(239, 68, 68, 0.15);
  --color-error-content: #f87171; /* Badge text (AA on muted) */
  --color-danger: #ef4444;
  --color-danger-foreground: #ffffff;
  --color-danger-strong: #b91c1c; /* Button fill (AA with white text) */
  --color-danger-strong-hover: #991b1b;

  /* Semantic — Info */
  --color-info: #3b82f6;
  --color-info-muted: rgba(59, 130, 246, 0.15);
  --color-info-content: #60a5fa; /* Badge text (AA on muted) */

  /* Borders */
  --color-border: #374151;
  --color-border-focus: #06b6d4;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 20px rgba(6, 182, 212, 0.15);
}

/* === LIGHT MODE === */
[data-theme='light'] {
  /* Backgrounds */
  --color-bg-primary: #f8fafc;
  --color-bg-secondary: #ffffff;
  --color-bg-tertiary: #f1f5f9;
  --color-bg-hover: #e2e8f0;
  --color-bg-active: #cbd5e1;

  /* Foreground */
  --color-fg-primary: #0f172a;
  --color-fg-secondary: #334155;
  --color-fg-tertiary: #64748b;
  --color-fg-disabled: #94a3b8;

  /* Accent — Cyan (darker for light mode contrast) */
  --color-accent: #0891b2;
  --color-accent-hover: #06b6d4; /* Brighter on hover so dark on-accent text stays AA */
  --color-accent-muted: rgba(8, 145, 178, 0.12);
  --color-accent-content: #0e7490; /* Dark text on muted accent (nav-active) */
  --color-on-accent: #0a0e1a;

  /* Semantic — Success */
  --color-success: #059669;
  --color-success-muted: rgba(5, 150, 105, 0.12);
  --color-success-content: #047857;

  /* Semantic — Warning */
  --color-warning: #d97706;
  --color-warning-muted: rgba(217, 119, 6, 0.12);
  --color-warning-content: #92400e;

  /* Semantic — Error/Danger */
  --color-error: #dc2626;
  --color-error-muted: rgba(220, 38, 38, 0.12);
  --color-error-content: #b91c1c;
  --color-danger: #dc2626;
  --color-danger-foreground: #ffffff;
  --color-danger-strong: #991b1b;
  --color-danger-strong-hover: #7f1d1d;

  /* Semantic — Info */
  --color-info: #2563eb;
  --color-info-muted: rgba(37, 99, 235, 0.12);
  --color-info-content: #1d4ed8;

  /* Borders */
  --color-border: #cbd5e1;
  --color-border-focus: #0891b2;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
  --shadow-glow: 0 0 20px rgba(8, 145, 178, 0.1);
}
```

### 2.2 Chart/Data Colors

```css
:root {
  --color-chart-primary: #06b6d4; /* Cyan — primary metric */
  --color-chart-secondary: #8b5cf6; /* Violet — secondary */
  --color-chart-tertiary: #f59e0b; /* Amber — tertiary */
  --color-chart-quaternary: #10b981; /* Green — quaternary */
  --color-chart-grid: rgba(148, 163, 184, 0.15);
  --color-chart-text: #9ca3af;
}
```

---

## 3. Typography

### 3.1 Font Families

```css
:root {
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  --font-display: 'Inter', sans-serif; /* Headings */
}
```

### 3.2 Type Scale

| Token         | Size | Weight | Line Height | Usage                        |
| ------------- | ---- | ------ | ----------- | ---------------------------- |
| `--text-xs`   | 11px | 400    | 14px        | Badges, labels, captions     |
| `--text-sm`   | 12px | 400    | 16px        | Secondary text, table cells  |
| `--text-base` | 14px | 400    | 20px        | Body text, inputs            |
| `--text-md`   | 16px | 500    | 24px        | Section headers, card titles |
| `--text-lg`   | 18px | 600    | 26px        | Page titles                  |
| `--text-xl`   | 24px | 700    | 30px        | Hero numbers, dashboard KPIs |
| `--text-2xl`  | 32px | 700    | 38px        | Splash/empty states          |

### 3.3 Font Weights

```css
:root {
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

---

## 4. Spacing System

**Base unit: 4px** (8px grid with half-steps)

```css
:root {
  --space-0: 0;
  --space-1: 4px; /* xs */
  --space-2: 8px; /* sm */
  --space-3: 12px; /* md */
  --space-4: 16px; /* base */
  --space-5: 20px; /* lg */
  --space-6: 24px; /* xl */
  --space-8: 32px; /* 2xl */
  --space-10: 40px; /* 3xl */
  --space-12: 48px; /* 4xl */
  --space-16: 64px; /* 5xl */
}
```

### Spacing Usage

| Context                    | Value                      |
| -------------------------- | -------------------------- |
| Component internal padding | `--space-3` to `--space-4` |
| Card padding               | `--space-4` to `--space-6` |
| Section gap                | `--space-6` to `--space-8` |
| Page padding               | `--space-6` to `--space-8` |
| Sidebar width              | 240px (fixed)              |
| Icon + text gap            | `--space-2`                |

---

## 5. Border Radius

```css
:root {
  --radius-none: 0;
  --radius-sm: 4px; /* Containers, panels */
  --radius-md: 6px; /* Cards */
  --radius-lg: 8px; /* Buttons, inputs, interactive */
  --radius-xl: 12px; /* Modals, dialogs */
  --radius-full: 9999px; /* Avatars, pills, badges */
}
```

---

## 6. Components

### 6.1 Button

```css
/* Base */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-lg);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: var(--font-weight-medium);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 150ms ease;
  min-height: 36px;
}

/* Variants (Fase A: AA text via on-accent / danger-strong tokens) */
.btn-primary {
  background: var(--color-accent);
  color: var(--color-on-accent);
}
.btn-primary:hover {
  background: var(--color-accent-hover);
  box-shadow: var(--shadow-glow);
}

.btn-secondary {
  background: var(--color-bg-tertiary);
  color: var(--color-fg-primary);
  border-color: var(--color-border);
}
.btn-secondary:hover {
  background: var(--color-bg-hover);
}

.btn-ghost {
  background: transparent;
  color: var(--color-fg-secondary);
}
.btn-ghost:hover {
  background: var(--color-bg-hover);
  color: var(--color-fg-primary);
}

.btn-danger {
  background: var(--color-danger-strong);
  color: var(--color-danger-foreground);
}
.btn-danger:hover {
  background: var(--color-danger-strong-hover);
}

/* Icon slot inside Button (Fase A) */
.btn-icon {
  display: inline-flex;
  align-items: center;
  line-height: 0;
}

/* Sizes */
.btn-sm {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  min-height: 28px;
}
.btn-md {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-base);
  min-height: 36px;
}
.btn-lg {
  padding: var(--space-3) var(--space-6);
  font-size: var(--text-md);
  min-height: 44px;
}

/* States */
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
.btn:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
.btn-loading {
  position: relative;
  color: transparent;
}
.btn-loading::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
```

### 6.2 Card

```css
.card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  box-shadow: var(--shadow-sm);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.card-title {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-fg-primary);
}

.card-body {
  color: var(--color-fg-secondary);
  font-size: var(--text-base);
}

.card-hover:hover {
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-md);
}
```

### 6.3 Input

```css
.input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-fg-primary);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  transition: border-color 150ms ease;
}

.input::placeholder {
  color: var(--color-fg-tertiary);
}

.input:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: 0 0 0 3px var(--color-accent-muted);
}

.input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-error {
  border-color: var(--color-error);
}
.input-error:focus {
  box-shadow: 0 0 0 3px var(--color-error-muted);
}
```

### 6.4 Toggle/Switch

```css
.toggle {
  position: relative;
  width: 44px;
  height: 24px;
  background: var(--color-bg-hover);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: background 200ms ease;
  border: none;
}

.toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background: var(--color-fg-primary);
  border-radius: var(--radius-full);
  transition: transform 200ms ease;
}

.toggle[aria-checked='true'] {
  background: var(--color-accent);
}

.toggle[aria-checked='true']::after {
  transform: translateX(20px);
  background: var(--color-on-accent); /* AA knob on the accent track (Fase A) */
}

.toggle:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
```

### 6.5 Badge

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.badge-success {
  background: var(--color-success-muted);
  color: var(--color-success-content); /* AA text, not the raw semantic (Fase A) */
}

.badge-warning {
  background: var(--color-warning-muted);
  color: var(--color-warning-content);
}

.badge-error {
  background: var(--color-error-muted);
  color: var(--color-error-content);
}

.badge-info {
  background: var(--color-info-muted);
  color: var(--color-info-content);
}

.badge-neutral {
  background: var(--color-bg-hover);
  color: var(--color-fg-secondary);
}
```

### 6.6 Modal/Dialog

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 150ms ease;
}

.modal {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  max-width: 480px;
  width: 90%;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
  animation: slideUp 200ms ease;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.modal-title {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-fg-primary);
}

.modal-close {
  background: none;
  border: none;
  color: var(--color-fg-tertiary);
  cursor: pointer;
  padding: var(--space-1);
  border-radius: var(--radius-lg);
}
.modal-close:hover {
  background: var(--color-bg-hover);
  color: var(--color-fg-primary);
}
```

### 6.7 Progress Bar

```css
.progress {
  width: 100%;
  height: 8px;
  background: var(--color-bg-hover);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: var(--radius-full);
  transition: width 300ms ease;
}

.progress-bar-primary {
  background: var(--color-accent);
}
.progress-bar-success {
  background: var(--color-success);
}
.progress-bar-warning {
  background: var(--color-warning);
}
.progress-bar-error {
  background: var(--color-error);
}

/* Honest indeterminate mode (Fase A): GPU transform sweep, no fake percent */
.progress-indeterminate .progress-bar-animated {
  width: 40%;
  animation: progressIndeterminate 1.4s var(--ease-in-out) infinite;
}
```

### 6.8 Tooltip

```css
.tooltip {
  position: absolute;
  padding: var(--space-1) var(--space-2);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--color-fg-secondary);
  white-space: nowrap;
  z-index: 100;
  pointer-events: none;
  box-shadow: var(--shadow-md);
}

/* Position variants (Fase D): .tooltip-top (default) | -bottom | -left | -right */
```

### 6.9 Icon (Fase B)

Inline SVG set (`components/ui/Icon.tsx`): 16 names, 24px grid, `stroke="currentColor"`,
`aria-hidden` by default. Replaces emoji in nav/header. Class `.ui-icon` inherits text color.

### 6.10 Thinking indicators (Fase C, CSS-only)

- `.op-spinner`: 14px GPU ring in the header operation badge.
- `.busy-overlay` + `.busy-card` + `.busy-spinner`: non-blocking global veil
  (`pointer-events: none`) for operations longer than 800ms (`GlobalBusyOverlay.tsx`).
- `.stagger > *`: entrance rise in 50ms steps, capped at 8 children.

---

## 7. States

### 7.1 Interactive States

| State              | Visual Treatment                                           |
| ------------------ | ---------------------------------------------------------- |
| **Default**        | Base appearance                                            |
| **Hover**          | `background: var(--color-bg-hover)`, subtle shadow         |
| **Active/Pressed** | `background: var(--color-bg-active)`, scale(0.98)          |
| **Focus**          | `outline: 2px solid var(--color-border-focus)`, offset 2px |
| **Disabled**       | `opacity: 0.5`, `cursor: not-allowed`                      |
| **Loading**        | Spinner replaces content, `color: transparent`             |

### 7.2 Semantic States

| State       | Color Token       | Usage                               |
| ----------- | ----------------- | ----------------------------------- |
| **Success** | `--color-success` | Operation completed, healthy status |
| **Warning** | `--color-warning` | Caution, attention needed           |
| **Error**   | `--color-error`   | Failure, critical issue             |
| **Info**    | `--color-info`    | Neutral information                 |

### 7.3 Data States

| State       | Treatment                           |
| ----------- | ----------------------------------- |
| **Empty**   | Icon + message + CTA button         |
| **Loading** | Skeleton screens or spinner         |
| **Error**   | Error message + retry button        |
| **Partial** | Show available data + warning badge |

---

## 8. Dark/Light Mode

### 8.1 Theme Toggle

- Toggle in header/sidebar
- Persists to `localStorage`
- Respects `prefers-color-scheme` on first visit
- Smooth transition: `transition: background-color 200ms ease, color 200ms ease`

### 8.2 Implementation

```typescript
// Theme hook
const [theme, setTheme] = useState<'dark' | 'light'>(() => {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
});

useEffect(() => {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}, [theme]);
```

---

## 9. Accessibility

### 9.1 WCAG AA Compliance

- **Contrast ratio:** Minimum 4.5:1 for normal text, 3:1 for large text.
  Verified by script over real token pairs (Fase A: 18/18 AA, incl. buttons,
  badges, nav-active, toggle knob). Rules: text on accent fills uses
  `--color-on-accent` (derived per user accent via `contrastOn()`); badge text
  uses `--color-*-content`; danger buttons use `--color-danger-strong`.
- **Focus indicators:** Visible focus rings on all interactive elements.
  Modal traps Tab/Shift+Tab, restores focus to the trigger, unique title id (Fase D).
- **Touch targets:** Minimum 44x44px for interactive elements
- **Keyboard navigation:** All functionality accessible via keyboard.
  Header search: Enter jumps to first match, Esc clears (Fase B).

### 9.2 ARIA Patterns

```html
<!-- Toggle -->
<button role="switch" aria-checked="true/false" aria-label="Enable feature">
  <!-- Modal -->
  <div role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <!-- Progress -->
    <div role="progressbar" aria-valuenow="50" aria-valuemin="0" aria-valuemax="100">
      <!-- Navigation -->
      <nav aria-label="Main navigation">
        <ul role="list">
          <li><a aria-current="page">Active Page</a></li>
        </ul>
      </nav>
    </div>
  </div>
</button>
```

### 9.3 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 10. Layout

### 10.1 App Shell

```
┌─────────────────────────────────────────────────────────┐
│  HEADER: Logo | Search | Theme Toggle | Settings        │
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│ SIDEBAR  │  MAIN CONTENT                                │
│          │                                              │
│ - Nav    │  (Routes/Pages)                              │
│ - Nav    │                                              │
│ - Nav    │                                              │
│          │                                              │
├──────────┴──────────────────────────────────────────────┤
│  STATUS BAR: Version | System Info | Status            │
└─────────────────────────────────────────────────────────┘
```

### 10.2 Sidebar (Fase B)

- **Width:** 240px (fixed)
- **Background:** `var(--color-bg-secondary)`
- **Border-right:** `1px solid var(--color-border)`
- **Sections:** System health (Dashboard, Boost, Cleaner, Cleaning) · System
  (Tweaks, Tools, Drivers, Network, Security) · Analysis (Audit, Benchmark,
  Statistics, Bundles) · App (Settings). Source of truth: `layout/nav.ts`.
- **Navigation items:** Inline SVG `Icon` + Label, hover/active states.
  Active text uses `--color-accent-content` (AA on muted).
- **Live filter:** header search filters sections; honest empty note + Esc to clear.

### 10.3 Main Content

- **Padding:** `var(--space-6)`
- **Max-width:** 1400px (centered)
- **Background:** `var(--color-bg-primary)`

### 10.4 Responsive Breakpoints

> Desktop-only app (`main/index.ts` `minWidth: 960`; H11). The ≤768px rules in
> `layout.css` are aspirational and currently unreachable — do not rely on them.

| Breakpoint | Width  | Layout                      |
| ---------- | ------ | --------------------------- |
| `sm`       | 640px  | Sidebar collapses to icons  |
| `md`       | 768px  | Sidebar overlay (hamburger) |
| `lg`       | 1024px | Full sidebar + content      |
| `xl`       | 1280px | Max content width           |

---

## 11. Motion

### 11.1 Timing

```css
:root {
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
}
```

### 11.2 Easing

```css
:root {
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}
```

### 11.3 Animations

| Animation               | Duration                | Easing      | Usage                                        |
| ----------------------- | ----------------------- | ----------- | -------------------------------------------- |
| `fadeIn`                | 100ms (`fast`)          | ease-out    | Modal overlay, busy veil                     |
| `slideUp`               | 200ms (`normal`)        | ease-out    | Modal content, busy card, stagger entrance   |
| `slideIn`               | 200ms                   | ease-out    | Sidebar                                      |
| `spin`                  | 600–700ms               | linear      | Loading spinner, op-badge ring, busy spinner |
| `pulse`                 | 2s (idle) / 0.9s (busy) | ease-in-out | Status indicator                             |
| `skeletonShimmer`       | 1.6s                    | —           | Skeleton screens                             |
| `progressIndeterminate` | 1.4s                    | ease-in-out | Honest indeterminate bar (GPU transform)     |

Rules (Fase C): animate `transform`/`opacity` only; functional motion ≤400ms;
stagger 50ms steps capped at 8; every animation honours `prefers-reduced-motion`.

---

## 12. Agent Prompt Guide

### 12.1 Quick Prompts

```
"Create a card component with title, description, and action button"
→ Use .card, .card-header, .card-title, .card-body, .btn

"Add a toggle switch for enabling/disabling a feature"
→ Use .toggle with role="switch" and aria-checked

"Show a success badge for completed operations"
→ Use .badge.badge-success

"Create a modal for confirming destructive actions"
→ Use .modal-overlay, .modal, .modal-header, .modal-title
```

### 12.2 Color Reference

| Element    | Dark Mode              | Light Mode             |
| ---------- | ---------------------- | ---------------------- |
| Background | `--color-bg-primary`   | `--color-bg-primary`   |
| Surface    | `--color-bg-secondary` | `--color-bg-secondary` |
| Text       | `--color-fg-primary`   | `--color-fg-primary`   |
| Accent     | `--color-accent`       | `--color-accent`       |
| Success    | `--color-success`      | `--color-success`      |
| Warning    | `--color-warning`      | `--color-warning`      |
| Error      | `--color-error`        | `--color-error`        |

---

## 13. Brand Badge

Every page/screen must include the brand badge:

```
┌─────────────────────────────────────┐
│  Built with FORCH.i by Paulo Velasco │
└─────────────────────────────────────┘
```

- **Location:** Footer (StatusBar, compact "FORCH.i" link) + sidebar bottom + Settings/About
- **Style:** Subtle, `var(--color-fg-tertiary)`, `var(--text-xs)`
- **Link:** https://github.com/forchia-ecosystem
- **Favicon:** `public/favicon.png` (from `assets/icons/icon-256.png`, Fase E)
- **Fonts:** Google Fonts (Inter + JetBrains Mono, `display=swap`) with system
  fallback stacks in tokens; kept remote to avoid bundle weight (H13 decision, Fase E)

---

## 14. File Structure

```
forch-i-winoptimizer/
├── .claude/
│   └── memory/
│       ├── README.md
│       └── learning/
│           └── README.md
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts
│   │   ├── ipc/
│   │   └── services/
│   ├── preload/           # Electron preload scripts
│   │   └── index.ts
│   ├── renderer/          # React app
│   │   ├── components/    # Reusable components
│   │   ├── pages/         # Page components
│   │   ├── hooks/         # Custom hooks
│   │   ├── stores/        # State management
│   │   ├── utils/         # Utilities
│   │   ├── styles/        # Global styles + tokens
│   │   └── App.tsx
│   └── shared/            # Shared types/constants
│       └── types.ts
├── scripts/
│   ├── DEV/
│   ├── OPS/
│   └── CI_CD/
├── assets/                # Icons, images
├── package.json
├── tsconfig.json
├── DESIGN.md              # This file
├── README.md
└── SCRIPTS.md
```

---

## 15. Technical Stack

| Layer           | Technology               | Version            |
| --------------- | ------------------------ | ------------------ |
| Runtime         | Electron                 | Latest stable      |
| Frontend        | React                    | 18+                |
| Language        | TypeScript               | 5+ (strict mode)   |
| Styling         | Tailwind CSS             | 4+ (CSS variables) |
| State           | Zustand                  | Latest             |
| Build           | Vite                     | Latest             |
| Package Manager | pnpm                     | Latest             |
| Testing         | Vitest + Testing Library | Latest             |
| Linting         | ESLint + Prettier        | Latest             |

---

_This DESIGN.md is the single source of truth for FORCH.iA WinOptimizer visual design. All UI components must conform to these tokens and patterns._
