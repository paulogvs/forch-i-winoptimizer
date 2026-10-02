/**
 * Accent-colour token derivation (no hardcoded colours in components).
 *
 * The user picks a single `#RRGGBB` accent; the related tokens (`--color-accent`,
 * `--color-accent-hover`, `--color-accent-muted`, `--color-border-focus`) are
 * derived from it and written onto the document root so every CSS variable
 * consumer picks them up.
 */

const HEX = /^#?([0-9a-fA-F]{6})$/;

export interface AccentTokens {
  accent: string;
  hover: string;
  muted: string;
  focus: string;
}

export function normalizeHex(value: string): string | null {
  const match = HEX.exec(value.trim());
  if (!match) return null;
  return `#${(match[1] ?? '').toUpperCase()}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function toHex(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, '0').toUpperCase();
}

function mix(hex: string, target: number, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const t = Math.max(0, Math.min(1, amount));
  return `#${toHex(rgb.r + (target - rgb.r) * t)}${toHex(rgb.g + (target - rgb.g) * t)}${toHex(rgb.b + (target - rgb.b) * t)}`;
}

/** Blend toward white (0 = unchanged, 1 = white). */
export function lighten(hex: string, amount: number): string {
  return mix(hex, 255, amount);
}

/** Blend toward black (0 = unchanged, 1 = black). */
export function darken(hex: string, amount: number): string {
  return mix(hex, 0, amount);
}

export function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

/** Relative luminance (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Derive the full accent token set from a single hex colour. */
export function accentTokens(hex: string): AccentTokens {
  const accent = normalizeHex(hex) ?? '#06B6D4';
  // Dark accents brighten on hover; light accents darken, preserving contrast.
  const hover = luminance(accent) < 0.5 ? lighten(accent, 0.18) : darken(accent, 0.18);
  return {
    accent,
    hover,
    muted: rgba(accent, 0.15),
    focus: accent,
  };
}

/**
 * Apply the derived tokens to the document root. Returns false for an invalid
 * colour (callers should keep the previous accent).
 */
export function applyAccentColor(hex: string, root: HTMLElement = document.documentElement): boolean {
  const tokens = normalizeHex(hex);
  if (!tokens) return false;
  const { accent, hover, muted, focus } = accentTokens(tokens);
  root.style.setProperty('--color-accent', accent);
  root.style.setProperty('--color-accent-hover', hover);
  root.style.setProperty('--color-accent-muted', muted);
  root.style.setProperty('--color-border-focus', focus);
  root.style.setProperty('--color-chart-primary', accent);
  return true;
}
