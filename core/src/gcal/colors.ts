// core/src/gcal/colors.ts
// Map a Bismuth category color → the nearest Google Calendar EVENT color. A category color
// is a THEME TOKEN ("accent"/"teal"/"blue"/"violet"/"green"/"gold"/"rose") or a custom hex
// (app/src/calendar/categoryColor.ts). We resolve tokens to their hex (the fixed category
// swatch ramp; `accent` is per-theme) then snap to the nearest of Google's 11 event colors —
// which works with the calendar.events scope (colorId is just an event field). Pure + tested.
// The swatch ramp + per-theme accents are sourced from core/src/theme/tokens.ts (the single
// source) instead of hand-mirrored here where they used to drift.
import { CATEGORY_SWATCHES, THEME_ACCENTS, DEFAULT_THEME } from "../theme/tokens";

// Google's 11 event colors: colorId → background hex (the classic event palette).
const EVENT_COLORS: Record<string, string> = {
  "1": "#a4bdfc", "2": "#7ae7bf", "3": "#dbadff", "4": "#ff887c", "5": "#fbd75b",
  "6": "#ffb878", "7": "#46d6db", "8": "#e1e1e1", "9": "#5484ed", "10": "#51b749", "11": "#dc2127",
};

// Fixed Bismuth category swatch tokens → hex. Sourced from tokens.ts. `accent` is per-theme.
const SWATCH_HEX: Record<string, string> = { ...CATEGORY_SWATCHES };

// Per-theme `--accent` hex, derived from THEMES (tokens.ts). Resolves the `accent` category token.
const THEME_ACCENT: Record<string, string> = THEME_ACCENTS;
const DEFAULT_ACCENT = THEME_ACCENTS[DEFAULT_THEME];

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Precomputed once: colorId → parsed RGB, in the same order as EVENT_COLORS (the 11 fixed
// hexes above are all valid, so the non-null assertion is safe).
const EVENT_COLORS_RGB = Object.entries(EVENT_COLORS).map(([id, hex]) => [id, hexToRgb(hex)!] as const);

/** Nearest Google event colorId (1–11) to a hex color by RGB distance; undefined if unparseable. */
export function nearestGoogleColorId(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const rgb = hexToRgb(hex);
  if (!rgb) return undefined;
  let best: string | undefined;
  let bestD = Infinity;
  for (const [id, c] of EVENT_COLORS_RGB) {
    const d = (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/**
 * Resolve a Bismuth category color (theme token OR hex) to a Google event colorId, using the
 * active theme to resolve the `accent` token. Returns undefined for unknown/unparseable input.
 */
export function categoryColorId(color: string | undefined, theme?: string): string | undefined {
  if (!color) return undefined;
  if (color === "accent") return nearestGoogleColorId(THEME_ACCENT[theme ?? ""] ?? DEFAULT_ACCENT);
  if (SWATCH_HEX[color]) return nearestGoogleColorId(SWATCH_HEX[color]);
  return nearestGoogleColorId(color); // hex passthrough
}
